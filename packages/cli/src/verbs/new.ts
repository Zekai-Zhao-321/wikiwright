// docs/cli.md §new (the typed write-path gate: unknown values fail with the
// legal domain enumerated; folder tags are seeded at the deliberate new
// invocation) · docs/cli.md §lint · docs/architecture.md §Directories. The
// skeleton is rendered here and WRITTEN by the one write path, so the stamps,
// the identity gate, the proof and the write log are one implementation
// rather than two.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  codeUnitCompare,
  type EffectiveType,
  folderSegmentsFor,
  segmentIdentity,
  shapeAuto,
  shapeKind,
  shapeRequired,
  tagsOf,
  yamlScalar,
} from "@wikiwright/core";
import { today } from "../clock.ts";
import { type CommandResult, type ErrEnvelope, fail } from "../envelope.ts";
import { rootsOf } from "../law.ts";
import { activeTypeNames, skeletonOf, templateOf } from "../pages.ts";
import { contentPathRefusal } from "../paths.ts";
import { type CommandArgs, type CommandSpec, listFlag, type Plan, planOf } from "../spec.ts";
import { loadVault } from "../vaultio.ts";
import { splicePlan, writeOps } from "../writer.ts";
import { appendUnderSection, performWholePageWrite } from "./write.ts";

const ENGINE_FRONTMATTER_KEYS = new Set(["type", "title", "description", "tags"]);

/**
 * docs/cli.md §new: the shape kinds whose one legal value is a string scalar —
 * `--set field=text` takes the text as it is. Every other kind (a list, a
 * number, a boolean, an object) takes JSON, so a value is typed by the field's
 * declared shape rather than guessed from its spelling.
 */
const RAW_VALUE_KINDS: ReadonlySet<string> = new Set([
  "any",
  "string",
  "enum",
  "date",
  "datetime",
  "dated-string",
  "page-ref",
  // A pin is a commit id: one string scalar, never JSON (a kit's anchored page
  // is created with `--set pin=<sha>`).
  "pin",
]);

function takesRaw(shape: unknown): boolean {
  return RAW_VALUE_KINDS.has(shapeKind(shape) ?? "any");
}

/** One frontmatter value as YAML: a scalar through the Writer's renderer, a collection as JSON (which YAML reads as flow). */
function yamlValue(value: unknown): string {
  if (typeof value === "string") return yamlScalar(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * The `--set` flags, typed by the field each names. An undeclared field is
 * usage, with the declared fields listed — the legal domain travels in
 * `details` (docs/cli.md §The envelope), never only in prose.
 */
function parseSetFlags(
  effective: EffectiveType,
  raw: readonly string[],
): { ok: true; set: Map<string, unknown> } | { ok: false; result: CommandResult } {
  const set = new Map<string, unknown>();
  const declared = [...effective.fields.keys()]
    .filter((f) => f !== "type" && f !== "title")
    .sort(codeUnitCompare);
  for (const entry of raw) {
    const eq = entry.indexOf("=");
    if (eq < 1) {
      return {
        ok: false,
        result: fail("new", "usage", "invalid-value", `--set takes field=value, not "${entry}"`),
      };
    }
    const field = entry.slice(0, eq);
    const text = entry.slice(eq + 1);
    if (field === "type" || field === "title") {
      return {
        ok: false,
        result: fail(
          "new",
          "usage",
          "invalid-value",
          `--set may not name "${field}": the type and the title are the positionals`,
        ),
      };
    }
    const shape = effective.fields.get(field)?.shape;
    if (shape === undefined) {
      return {
        ok: false,
        result: fail(
          "new",
          "usage",
          "unknown-field",
          `"${field}" is not a declared field of type "${effective.name}"`,
          { details: { field, valid_values: declared } },
        ),
      };
    }
    if (set.has(field)) {
      return {
        ok: false,
        result: fail("new", "usage", "invalid-value", `--set names "${field}" twice`),
      };
    }
    // The engine's own keys have shapes the engine knows whatever the type
    // declares for them: `tags` is a list of tag names, so it takes JSON, and
    // the folder tags seeded from the destination merge with it below.
    const kind = field === "tags" ? "list" : (shapeKind(shape) ?? "any");
    if (field !== "tags" && takesRaw(shape)) {
      set.set(field, text);
      continue;
    }
    const notJson = (): { ok: false; result: CommandResult } => ({
      ok: false,
      result: fail(
        "new",
        "usage",
        "invalid-value",
        `--set ${field}: a ${kind} value is JSON, and ${JSON.stringify(text)} is not`,
        {
          details: { field, kind },
          hint: `write it as JSON: --set ${field}='${kind === "list" || kind === "page-ref-list" ? '["one", "two"]' : kind === "boolean" ? "true" : kind === "object" ? '{"key": "value"}' : "1"}'`,
        },
      ),
    });
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return notJson();
    }
    if (field === "tags" && !(Array.isArray(value) && value.every((t) => typeof t === "string"))) {
      return notJson();
    }
    set.set(field, value);
  }
  return { ok: true, set };
}

/**
 * A skeleton refused over the stubs `--set` would have filled says so —
 * the fields, the kind of each and the form its value takes — so the second
 * invocation can be written from the first envelope.
 */
function withSetHint(
  result: CommandResult,
  effective: EffectiveType,
  stubbed: readonly string[],
): CommandResult {
  if (result.envelope.ok || result.envelope.error.code !== "draft-invalid") return result;
  if (stubbed.length === 0) return result;
  const fields = stubbed.map((field) => {
    const shape = effective.fields.get(field)?.shape;
    return {
      field,
      kind: shapeKind(shape) ?? "any",
      value: takesRaw(shape) ? "the raw text" : "JSON",
    };
  });
  const argv = fields.map((f) => `--set ${f.field}=<${f.value === "JSON" ? "json" : "value"}>`);
  const error: ErrEnvelope["error"] = {
    ...result.envelope.error,
    hint: `the skeleton stubs ${stubbed.length} required field(s) as ""; fill them on the command line: ${argv.join(" ")}`,
    details: { ...result.envelope.error.details, set: fields },
  };
  return { ...result, envelope: { ...result.envelope, error } };
}

/** `--item "<Section heading>: <item line>"`, split at the first `: `. */
function parseItemFlags(
  raw: readonly string[],
): { ok: true; items: { heading: string; line: string }[] } | { ok: false; result: CommandResult } {
  const items: { heading: string; line: string }[] = [];
  for (const entry of raw) {
    const at = entry.indexOf(": ");
    const heading = at < 0 ? "" : entry.slice(0, at).trim();
    const line = at < 0 ? "" : entry.slice(at + 2).trim();
    if (heading === "" || line === "") {
      return {
        ok: false,
        result: fail(
          "new",
          "usage",
          "invalid-value",
          `--item takes "<Section heading>: <item line>", not ${JSON.stringify(entry)}`,
        ),
      };
    }
    items.push({ heading, line });
  }
  return { ok: true, items };
}

/** A grammar section's item is one top-level list line; a bare line gets the marker. */
const LIST_MARKER = /^(?:[-*+]|\d+[.)])[ \t]/u;

/**
 * The dry-run law: `new` creates exactly one page. The gate it runs first —
 * identity, the draft's own findings — is a REFUSAL, not a write, and the dry
 * run runs it too: the plan is answered where the write would
 * happen, so a draft the verb would refuse is refused with the flag as well.
 */
function planForNew(args: CommandArgs): Plan {
  const [typeName] = args.positionals;
  const dest = args.flags["dest"];
  if (typeName === undefined || typeof dest !== "string" || dest.length === 0) return planOf([]);
  if (existsSync(join(args.root, dest))) return planOf([]);
  // The skeleton lands through the Writer.
  return planOf(writeOps(dest, "create", `a new ${typeName} page from its template`));
}

export const newCommand: CommandSpec = {
  name: "new",
  role: "writer",
  summary: "Create a page of a registered type from its template; the typed write-path gate.",
  positionals: [
    { name: "type", required: true },
    { name: "title", required: true },
  ],
  flags: [
    { name: "dest", type: "string", summary: "destination path (repo-relative)" },
    {
      name: "set",
      type: "string",
      multiple: true,
      summary:
        "field=value into the skeleton's frontmatter (repeatable); a string-valued shape takes the text, a list, number, boolean or object shape takes JSON",
    },
    {
      name: "item",
      type: "string",
      multiple: true,
      summary:
        '"<Section heading>: <item line>" placed under that declared section of the skeleton (repeatable); the section\'s grammar judges the line, and a heading the type does not declare is refused with the declared ones listed',
    },
    { name: "date", type: "string", summary: "the write's date (default: today)" },
    {
      name: "not-any-of",
      type: "string",
      multiple: true,
      summary: "an identity candidate this create ruled out (repeatable)",
    },
  ],
  examples: [
    'wikiwright new architecture-overview "Architecture" --dest wiki/architecture.md',
    'wikiwright new subsystem "Parser" --dest wiki/parser.md --item "Relations: part_of [[Architecture]]"',
    'wikiwright new code-concept "Lexing" --dest wiki/lexing.md --set description="How the lexer tokenizes."',
  ],
  writes: true,
  needsVaultModules: true,
  plan: planForNew,
  run: async (args) => {
    const vault = loadVault("new", args.root);
    if (!vault.ok) return vault.result;
    const [typeName, title] = args.positionals;
    if (typeName === undefined || title === undefined) {
      return fail("new", "usage", "missing-argument", "new requires <type> and <title>");
    }
    const effective = vault.registry.types.get(typeName);
    if (effective === undefined || effective.status !== "active") {
      return fail(
        "new",
        "not_found",
        "unknown-type",
        `"${typeName}" is not a registered active type`,
        {
          details: { valid_values: activeTypeNames(vault.registry) },
          hint: "register the type in config/constitution.json through review, or pick one of details.valid_values",
        },
      );
    }
    const dest = args.flags["dest"];
    if (typeof dest !== "string" || dest.length === 0) {
      return fail("new", "usage", "missing-argument", "new requires --dest <path>");
    }
    // The typed write path only writes inside the vault's content roots; a
    // dest like notes/x.md would create an unindexed page, and one
    // like wiki/../../x.md wrote ABOVE the vault until the path law.
    const destRefused = contentPathRefusal(args.root, dest, rootsOf(vault));
    if (destRefused !== undefined) {
      return fail("new", "usage", "invalid-path", `--dest ${destRefused}`);
    }
    const absDest = join(args.root, dest);
    if (existsSync(absDest)) {
      return fail("new", "conflict", "page-exists", `a page already exists at "${dest}"`, {
        hint: "pick a new destination; identity is never silently overwritten",
      });
    }
    // Seeded folder tags go through the aliases and
    // only under an active folder-tag mode.
    const folderTagMode = vault.engine.folder_tags?.mode ?? "off";
    const segmentAliases = vault.engine.folder_tag_aliases ?? {};
    // Seed the REGISTERED tag whose segmentIdentity matches, so
    // the seeded string always passes the exact unknown-tag lookup.
    const canonicalSegment = (s: string): string => {
      for (const t of tagsOf(vault.registry).entries.values()) {
        if (segmentIdentity(t.name) === segmentIdentity(s)) return t.name;
      }
      return s;
    };
    const segments =
      folderTagMode === "off"
        ? []
        : folderSegmentsFor(dest, rootsOf(vault)).map((s) =>
            canonicalSegment(segmentAliases[s] ?? s),
          );
    const parsedSet = parseSetFlags(effective, listFlag(args, "set"));
    if (!parsedSet.ok) return parsedSet.result;
    const set = parsedSet.set;
    // docs/cli.md §new: the template is the one carrier of seeds. A non-empty
    // value under a declared, non-engine key in its frontmatter fills the
    // field `--set` did not name — `origin: .` on a kit's anchored template —
    // and `--set` always wins. Seeded here, so the stub list and its hint
    // below see only what is still stubbed.
    const template = templateOf(args.root, vault, effective);
    for (const [field, value] of template?.seeds ?? []) {
      if (!set.has(field)) set.set(field, value);
    }
    const parsedItems = parseItemFlags(listFlag(args, "item"));
    if (!parsedItems.ok) return parsedItems.result;
    const stubFields = [...effective.fields]
      .filter(([, s]) => shapeRequired(s.shape) && shapeAuto(s.shape) === undefined)
      .map(([field]) => field)
      .filter((f) => !ENGINE_FRONTMATTER_KEYS.has(f))
      .sort(codeUnitCompare);
    // A `--set` value is rendered into the skeleton BEFORE the draft is
    // judged — a required field with a patterned shape is fillable at the
    // typed create, and left as the `""` stub the judge refuses otherwise.
    const stubbed = stubFields.filter((f) => !set.has(f));
    const extra = [...set.keys()]
      .filter((f) => !stubFields.includes(f) && !ENGINE_FRONTMATTER_KEYS.has(f))
      .sort(codeUnitCompare);
    const setTags = set.get("tags");
    const tags = [
      ...segments,
      ...(Array.isArray(setTags) ? setTags.filter((t): t is string => typeof t === "string") : []),
    ];
    const frontmatter = [
      "---",
      `type: ${typeName}`,
      `title: ${JSON.stringify(title)}`,
      // An explicit empty description would shadow a declared lede
      // derivation forever — stub it only when nothing derives it.
      ...(set.has("description")
        ? [`description: ${yamlValue(set.get("description"))}`]
        : vault.engine.field_sources?.description === undefined
          ? ['description: ""']
          : []),
      ...stubFields.map((f) => `${f}: ${set.has(f) ? yamlValue(set.get(f)) : '""'}`),
      ...extra.map((f) => `${f}: ${yamlValue(set.get(f))}`),
      // JSON string form: a bare segment like "c++" or one with spaces would
      // otherwise change meaning under YAML flow parsing.
      `tags: [${[...new Set(tags)].map((s) => JSON.stringify(s)).join(", ")}]`,
      "---",
      "",
    ].join("\n");

    // docs/extending.md §What a module registers: a module CONTRIBUTES a template as
    // bytes, under a namespaced name; a bundle declares one as a repo-relative
    // path. One resolver, shared with `type show --brief`.
    const body = template?.body;
    // docs/cli.md §new: the skeleton is the type's declared sections
    // MERGED with the template's placeholders, not one or the other — the one
    // renderer `type show --brief` prints.
    // Function form: a title containing $& or $' is replacement-pattern syntax
    // to a string replacement.
    let content =
      frontmatter + skeletonOf(effective, body).replaceAll(/\{\{\s*title\s*\}\}/gu, () => title);
    // `--item` is the section-form counterpart of `--set` — the line
    // lands under the named DECLARED section of the skeleton (the heading is
    // added when the skeleton lacks it), and the grammar the section declares
    // judges it in the one write path below. This verb reads no grammar: a
    // bare line under a grammar section gets the list marker every item has,
    // and nothing else is touched.
    const landed: { section: string; line: string; created: boolean }[] = [];
    for (const item of parsedItems.items) {
      const probe = appendUnderSection(vault, effective, content, item.heading, []);
      if (!probe.ok) {
        return fail("new", "usage", probe.code, probe.message, {
          details: { section: item.heading, valid_values: probe.declared },
        });
      }
      const line =
        probe.binding.grammar !== "prose" && !LIST_MARKER.test(item.line)
          ? `- ${item.line}`
          : item.line;
      const landing = appendUnderSection(vault, effective, content, item.heading, [line]);
      if (!landing.ok) {
        return fail("new", "usage", landing.code, landing.message, {
          details: { section: item.heading, valid_values: landing.declared },
        });
      }
      const spliced = splicePlan(content, { path: dest, ops: landing.ops });
      if (!spliced.ok) {
        return fail(
          "new",
          "conflict",
          "splice-refused",
          `--item "${item.heading}": ${spliced.reason}`,
        );
      }
      content = spliced.spliced.text;
      landed.push({ section: landing.binding.heading, line, created: landing.created });
    }

    // docs/cli.md §new: from here the skeleton is an ordinary draft and
    // the ONE write path owns it — the auto stamps, the identity gate, the
    // judge, the proof and the splice-free whole-page write. Identity is judged
    // there exactly as a `write` of the same bytes is judged; `new` adds no
    // second reading of it.
    const dateFlag = args.flags["date"];
    const date =
      typeof dateFlag === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(dateFlag) ? dateFlag : today();
    const result = await performWholePageWrite({
      args,
      vault,
      path: dest,
      content,
      date,
      notAnyOf: listFlag(args, "not-any-of"),
      command: "new",
      plan: planForNew(args),
      extra: { type: typeName, items: landed },
    });
    return withSetHint(result, effective, stubbed);
  },
};
