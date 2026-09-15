// docs/concepts.md §Findings and routing (a fixer is a NAMED derivation from a finding's
// own details to WriteOps; the message is never parsed) · docs/concepts.md §The judge and its states · docs/cli.md
//
// The mechanical-write law, applied to the fixer registry: a mechanical write reads VALUES
// the pass already computed, never syntax it re-derives. Every derivation here
// takes `finding.details` and the page's lines, and refuses when the values it
// needs are absent — which is what makes `MachineApplicable` a claim rather than
// a hope.
import { normalizeIdentity } from "../identity/index.ts";
import { parseDoc } from "../parse/index.ts";
import type { WriteOp } from "../writer/index.ts";

export interface FixInput {
  ruleId: string;
  line?: number;
  details?: Record<string, unknown>;
  /** The page's current bytes. */
  text: string;
}

export type FixOps =
  | { ok: true; ops: WriteOp[]; description: string }
  | { ok: false; reason: string };

function bodyLines(text: string): string[] {
  return (text.startsWith("﻿") ? text.slice(1) : text).split(/\r?\n/u);
}

function str(details: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = details?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(details: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = details?.[key];
  return typeof value === "number" ? value : undefined;
}

function listValue(text: string, field: string): unknown[] | undefined {
  const value = parseDoc(text).frontmatter.value[field];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : undefined;
}

/** Re-level one heading to its declared depth, keeping the heading text. */
function headingDepth(input: FixInput): FixOps {
  const depth = num(input.details, "declared_depth");
  const line = input.line;
  if (depth === undefined || line === undefined) return { ok: false, reason: "no declared depth" };
  const original = bodyLines(input.text)[line - 1] ?? "";
  const m = /^(#{1,6})([ \t]+)(.*)$/u.exec(original);
  if (m === null) return { ok: false, reason: `line ${line} is not a heading` };
  return {
    ok: true,
    description: `re-level "${m[3] ?? ""}" to depth ${depth}`,
    ops: [
      {
        kind: "replace",
        from: line,
        to: line,
        lines: [`${"#".repeat(depth)}${m[2] ?? " "}${m[3] ?? ""}`],
      },
    ],
  };
}

/**
 * Add a declared section the page is missing, at the page's tail. A stub is an
 * empty heading and nothing else: the engine knows the section is required, it
 * does not know what belongs in it.
 */
function sectionStub(input: FixInput): FixOps {
  const heading = str(input.details, "missing_heading");
  const depth = num(input.details, "depth") ?? 2;
  const needed = num(input.details, "needed") ?? 1;
  if (heading === undefined) return { ok: false, reason: "no missing heading named" };
  if (needed !== 1) return { ok: false, reason: `${needed} occurrences are needed, not one` };
  const lines = bodyLines(input.text);
  // Insert before the trailing newline sentinel, so the file's last byte holds.
  const endsWithEol = lines[lines.length - 1] === "";
  const at = endsWithEol ? lines.length - 1 : lines.length;
  const blank = (lines[at - 1] ?? "").trim() === "" ? [] : [""];
  return {
    ok: true,
    description: `add the "${heading}" section`,
    ops: [{ kind: "insert", after: at, lines: [...blank, `${"#".repeat(depth)} ${heading}`, ""] }],
  };
}

/** Materialize the missing folder tags, add-only, in the value's own style. */
function folderTags(input: FixInput): FixOps {
  const missing =
    str(input.details, "missing")
      ?.split(" ")
      .filter((t) => t.length > 0) ?? [];
  if (missing.length === 0) return { ok: false, reason: "no missing tags named" };
  const existing = listValue(input.text, "tags");
  if (existing === undefined) return { ok: false, reason: "tags is not a list" };
  return {
    ok: true,
    description: `add the folder tag(s) ${missing.join(", ")}`,
    ops: [{ kind: "frontmatter-list", field: "tags", existing, add: missing }],
  };
}

/** Rewrite one wikilink from an alias to the canonical name, keeping the display. */
function linkRewrite(input: FixInput): FixOps {
  const target = str(input.details, "target");
  const canonical = str(input.details, "canonical");
  const line = input.line;
  if (target === undefined || canonical === undefined || line === undefined) {
    return { ok: false, reason: "no alias/canonical pair" };
  }
  const original = bodyLines(input.text)[line - 1] ?? "";
  // The link as WRITTEN, matched on its own text: a page may carry more than one
  // wikilink on a line, and only the one this finding names may move.
  const escaped = target.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`\\[\\[${escaped}(\\|[^\\]]*)?\\]\\]`, "u");
  if (!pattern.test(original)) return { ok: false, reason: `[[${target}]] is not on line ${line}` };
  const replaced = original.replace(pattern, (_m, display: string | undefined) =>
    display === undefined ? `[[${canonical}|${target}]]` : `[[${canonical}${display}]]`,
  );
  return {
    ok: true,
    description: `rewrite [[${target}]] to the canonical [[${canonical}]]`,
    ops: [{ kind: "replace", from: line, to: line, lines: [replaced] }],
  };
}

/** Replace one tag with the canonical or the single declared replacement. */
function tagRename(input: FixInput): FixOps {
  const tag = str(input.details, "tag");
  const canonical = str(input.details, "canonical");
  if (tag === undefined || canonical === undefined) {
    return { ok: false, reason: "no single replacement is declared for this tag" };
  }
  const existing = listValue(input.text, "tags");
  if (existing === undefined) return { ok: false, reason: "tags is not a list" };
  const kept = existing.filter(
    (t) => typeof t !== "string" || normalizeIdentity(t) !== normalizeIdentity(tag),
  );
  if (kept.length === existing.length) return { ok: false, reason: `"${tag}" is not in tags` };
  const already = kept.some(
    (t) => typeof t === "string" && normalizeIdentity(t) === normalizeIdentity(canonical),
  );
  return {
    ok: true,
    description: `rename the tag "${tag}" to "${canonical}"`,
    ops: [
      {
        kind: "frontmatter-list",
        field: "tags",
        existing: kept,
        add: already ? [] : [canonical],
        remove: [tag],
      },
    ],
  };
}

/** Point a tombstoned page at its single declared replacement type. */
function retype(input: FixInput): FixOps {
  const canonical = str(input.details, "canonical");
  if (canonical === undefined) {
    return { ok: false, reason: "no single replacement type is declared" };
  }
  return {
    ok: true,
    description: `set type: ${canonical}`,
    ops: [{ kind: "frontmatter-set", field: "type", value: canonical }],
  };
}

/** Set a field whose shape admits exactly one legal value (docs/concepts.md §Findings and routing). */
function frontmatterSet(input: FixInput): FixOps {
  const field = str(input.details, "field");
  const alias = str(input.details, "alias");
  if (input.ruleId === "renamed-without-alias") {
    if (alias === undefined) return { ok: false, reason: "no old basename named" };
    const existing = listValue(input.text, "aliases");
    if (existing === undefined) return { ok: false, reason: "aliases is not a list" };
    return {
      ok: true,
      description: `append "${alias}" to aliases`,
      ops: [{ kind: "frontmatter-list", field: "aliases", existing, add: [alias] }],
    };
  }
  const sole = str(input.details, "sole_value");
  if (field === undefined || sole === undefined) {
    return { ok: false, reason: "the shape admits more than one legal value" };
  }
  return {
    ok: true,
    description: `set ${field}: ${sole}`,
    ops: [{ kind: "frontmatter-set", field, value: sole }],
  };
}

/**
 * Delete one frontmatter key with its whole value: the key's line and
 * every line of a block value beneath it, up to the next top-level key or the
 * closing fence. The key comes from the finding's own details, and the line the
 * finding names must carry it — a splice never guesses which key it is deleting.
 */
function frontmatterDelete(input: FixInput): FixOps {
  const key = str(input.details, "key");
  const line = input.line;
  if (key === undefined || line === undefined) return { ok: false, reason: "no key named" };
  const lines = bodyLines(input.text);
  if (lines[0]?.trim() !== "---") return { ok: false, reason: "no frontmatter block" };
  const closing = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (closing < 0 || line <= 1 || line > closing) {
    return { ok: false, reason: `line ${line} is not inside the frontmatter` };
  }
  const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (!new RegExp(`^${escaped}\\s*:`, "u").test(lines[line - 1] ?? "")) {
    return { ok: false, reason: `line ${line} does not carry the key "${key}"` };
  }
  // The value's extent: every line until the next top-level key (an unindented
  // `name:`) or the closing fence — a block list or mapping goes with its key.
  let end = closing;
  for (let i = line; i < closing; i += 1) {
    if (/^[^\s#][^:]*:/u.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  return {
    ok: true,
    description: `delete the undeclared key "${key}"`,
    ops: [{ kind: "replace", from: line, to: end, lines: [] }],
  };
}

/**
 * docs/concepts.md §The judge and its states: `history-close` is a PROPOSAL. It renders the closing clause
 * with the dates as placeholders and is never applied by `fix --expect N`.
 */
function historyClose(input: FixInput): FixOps {
  const line = input.line;
  if (line === undefined) return { ok: false, reason: "no line" };
  const original = bodyLines(input.text)[line - 1] ?? "";
  const category = str(input.details, "category") ?? "category";
  return {
    ok: true,
    description: `close the retired [${category}] claim`,
    ops: [
      {
        kind: "replace",
        from: line,
        to: line,
        lines: [`${original.replace(/\s+$/u, "")} (valid <FROM>→<TO>, superseded <DATE>)`],
      },
    ],
  };
}

/**
 * docs/concepts.md §The judge and its states: the ONE place a line's dialect changes, and only
 * because the caller asked for it by rule. Full-width 【】 markers become `[]`
 * and an entry's `:`/`-` separator becomes `—`; nothing else is touched, and no
 * other verb may reach this function.
 */
function canonicalForm(input: FixInput): FixOps {
  const line = input.line;
  const want = str(input.details, "canonical_line");
  if (line === undefined || want === undefined) return { ok: false, reason: "no canonical form" };
  const original = bodyLines(input.text)[line - 1] ?? "";
  if (original === want) return { ok: false, reason: "the line is already canonical" };
  return {
    ok: true,
    description: `write line ${line} in the engine's dialect`,
    ops: [{ kind: "replace", from: line, to: line, lines: [want] }],
  };
}

/** The pure half of the registry: fixer name → its derivation. */
const DERIVATIONS: Readonly<Record<string, (input: FixInput) => FixOps>> = {
  "heading-depth": headingDepth,
  "section-stub": sectionStub,
  "folder-tags": folderTags,
  "link-rewrite": linkRewrite,
  "tag-rename": tagRename,
  retype,
  "frontmatter-delete": frontmatterDelete,
  "frontmatter-set": frontmatterSet,
  "history-close": historyClose,
  "canonical-form": canonicalForm,
};

/** The fixers whose ops this module can derive from a finding alone. */
export const PURE_FIXERS: readonly string[] = Object.keys(DERIVATIONS).sort();

/**
 * docs/cli.md §fix: the ops one finding licenses, or the reason it licenses none. A fixer
 * whose ops cannot be derived REFUSES — it never returns an empty op list, which
 * would read as "already fixed" to the caller's `--expect`.
 */
export function fixOpsFor(fixer: string, input: FixInput): FixOps {
  const derive = DERIVATIONS[fixer];
  if (derive === undefined) return { ok: false, reason: `no derivation for "${fixer}"` };
  return derive(input);
}
