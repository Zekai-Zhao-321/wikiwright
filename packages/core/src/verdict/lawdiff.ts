// v2 contracts §8 (`law-changed`, `law-relaxed`): the law diff between the
// law HEAD holds and the law the index holds, each loaded from git.
//
// Reported, each with its `details.kind`: a rule's expression, config,
// section or severity changed (`rule-expr`, `rule-config`, `rule-section`,
// `rule-severity`); a rule, a type, a fragment, a vocabulary entry or a
// library removed (`rule-removed`, `type-removed`, `fragment-removed`,
// `vocabulary-entry-removed`, `library-removed`); a type's fields,
// sections, grammar parameters, meta, instances, abstract, extends or
// fragments changed (`type-fields`, `type-sections`, `type-grammar-params`,
// `type-meta`, `type-instances`, `type-abstract`, `type-extends`,
// `type-fragments`); an entry added to a registered vocabulary
// (`vocabulary-entry-added`); a rule-test or example file changed or deleted
// (`rule-test-changed`, `rule-test-deleted`, `example-changed`,
// `example-deleted`); `content_roots` or `libraries` changed
// (`content-roots`, `libraries`). Beyond the contracts' list, because a
// passing page must never conceal the removal of its constraint (the first
// delivery's words), four more relaxations: a vocabulary's `mode` changed
// (`vocabulary-mode`: registered to census admits every value) or a retired
// entry un-retired (`vocabulary-retired-removed`); a rule a type carried
// that it no longer carries while the rule stands (`rule-attachment`: a
// declaration moved to another type); and the engine keys that decide
// what a page may hold, `extensions`, `source_roots` and `field_sources`
// (`extensions`, `source-roots`, `field-sources`). Nothing else is a law
// change: a rule, a type or a test added tightens the law, and a
// description or a message changes no verdict.
//
// At `pre-commit` every change is `law-changed` (info) and never blocks. At
// `commit-msg` it is `law-relaxed` (error) unless the message's body carries
// a line `law-change: <reason>`, which makes it `law-changed` with the
// reason in its details. The reason lives in the commit; nothing records it
// in the queue.
import { canonicalJson } from "../digest/index.ts";
import { codeUnitCompare } from "../identity/index.ts";
import type { LawRule, LawType } from "../law/compose.ts";
import type { TypeLaw, TypeLawResult } from "../law/load.ts";
import { jsonNumbers } from "../law/yaml.ts";
import { PAGE_LOCATION, type Unrouted } from "./page.ts";
import { sameBytes } from "./state.ts";
import { routeVerdictFinding, type VerdictFinding } from "./table.ts";

export interface LawChange {
  kind: string;
  /** The changed thing's place, framed as the law digest frames it. */
  path: string;
  message: string;
  details: Record<string, unknown>;
}

const ENGINE_WHERE = "bundle:config/engine.json";

/** A rule as it is declared: the fragments' own and each type's own. */
function declaredRules(law: TypeLaw): Map<string, LawRule> {
  const out = new Map<string, LawRule>();
  for (const fragment of law.fragments.values()) {
    for (const rule of fragment.rules) {
      const declared: LawRule = {
        id: rule.id,
        expr: rule.expr,
        config: rule.config,
        severity: rule.severity,
        message: rule.message,
        declaredBy: fragment.name,
        where: fragment.where,
        pointer: rule.pointer,
      };
      if (rule.section !== undefined) declared.section = rule.section;
      out.set(rule.id, declared);
    }
  }
  for (const type of law.types.values())
    for (const rule of type.rules) if (rule.declaredBy === type.name) out.set(rule.id, rule);
  return out;
}

function sectionsShape(type: LawType): string {
  const sections = type.sections;
  if (sections === null) return "null";
  return canonicalJson({
    depth: sections.depth,
    ordered: sections.ordered,
    additional: sections.additional,
    list: sections.list.map((s) => ({
      heading: s.heading,
      min: s.min,
      max: s.max,
      grammar: s.grammar ?? null,
      vocabulary: s.vocabulary ?? null,
    })),
  });
}

function sectionParams(type: LawType): string {
  return canonicalJson((type.sections?.list ?? []).map((s) => [s.heading, s.params]));
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** Every law change between two laws, in a stable order. */
export function lawDiff(head: TypeLaw, index: TypeLaw): LawChange[] {
  const out: LawChange[] = [];
  const add = (kind: string, path: string, message: string, details: Record<string, unknown>) =>
    out.push({ kind, path, message, details: { kind, ...details } });

  // Rules: declared, and as each type carries them after configure.
  const before = declaredRules(head);
  const after = declaredRules(index);
  for (const [id, was] of before) {
    const is = after.get(id);
    if (is === undefined) {
      add("rule-removed", was.where, `rule ${id} is removed`, { rule: id });
      continue;
    }
    if (was.expr !== is.expr)
      add("rule-expr", is.where, `rule ${id}'s expression changed`, {
        rule: id,
        before: was.expr,
        after: is.expr,
      });
    if ((was.section ?? null) !== (is.section ?? null))
      add("rule-section", is.where, `rule ${id} attaches to another section`, {
        rule: id,
        before: was.section ?? null,
        after: is.section ?? null,
      });
    if (was.severity !== is.severity)
      add("rule-severity", is.where, `rule ${id}'s severity changed`, {
        rule: id,
        before: was.severity,
        after: is.severity,
      });
  }
  for (const [name, type] of index.types) {
    const prior = head.types.get(name);
    if (prior === undefined) continue;
    for (const rule of type.rules) {
      const was = prior.rules.find((r) => r.id === rule.id);
      if (was === undefined || same(was.config, rule.config)) continue;
      // The config as YAML read it holds integers as bigint; a finding's
      // details are JSON, as the envelope writes them.
      add("rule-config", type.where, `rule ${rule.id}'s config under ${name} changed`, {
        rule: rule.id,
        type: name,
        before: jsonNumbers(was.config),
        after: jsonNumbers(rule.config),
      });
    }
  }

  // Types and fragments.
  for (const [name, was] of head.types) {
    const is = index.types.get(name);
    if (is === undefined) {
      add("type-removed", was.where, `type ${name} is removed`, { type: name });
      continue;
    }
    const aspects: [string, unknown, unknown, string][] = [
      [
        "type-fields",
        was.parts.map((p) => [p.origin, p.schema]),
        is.parts.map((p) => [p.origin, p.schema]),
        "fields",
      ],
      ["type-meta", was.meta, is.meta, "meta"],
      ["type-instances", was.instances, is.instances, "instances"],
      ["type-abstract", was.abstract, is.abstract, "abstract"],
      ["type-extends", was.extends ?? null, is.extends ?? null, "extends"],
      ["type-fragments", was.fragments, is.fragments, "fragments"],
    ];
    for (const [kind, a, b, key] of aspects) {
      if (same(a, b)) continue;
      add(kind, is.where, `type ${name}'s ${key} changed`, { type: name });
    }
    if (sectionsShape(was) !== sectionsShape(is))
      add("type-sections", is.where, `type ${name}'s sections changed`, { type: name });
    if (sectionParams(was) !== sectionParams(is))
      add("type-grammar-params", is.where, `type ${name}'s grammar parameters changed`, {
        type: name,
      });
  }
  for (const [name, was] of head.fragments) {
    if (!index.fragments.has(name))
      add("fragment-removed", was.where, `fragment ${name} is removed`, { fragment: name });
  }

  // A rule a type carried and carries no longer, while it stands elsewhere.
  const standing = new Set(after.keys());
  for (const [name, was] of head.types) {
    const is = index.types.get(name);
    if (is === undefined) continue;
    const carried = new Set(is.rules.map((r) => r.id));
    for (const rule of was.rules) {
      if (carried.has(rule.id) || !standing.has(rule.id)) continue;
      add("rule-attachment", is.where, `type ${name} no longer carries rule ${rule.id}`, {
        rule: rule.id,
        type: name,
      });
    }
  }

  // Vocabularies: an entry removed, or added to a registered one; the mode
  // changed; a retired entry no longer retired.
  for (const [name, was] of head.vocabularies) {
    const is = index.vocabularies.get(name);
    if (is !== undefined && is.mode !== was.mode)
      add("vocabulary-mode", is.where, `${name}'s mode changed from ${was.mode} to ${is.mode}`, {
        vocabulary: name,
        before: was.mode,
        after: is.mode,
      });
    for (const entry of was.retired.keys()) {
      if (is?.retired.has(entry) === true) continue;
      add(
        "vocabulary-retired-removed",
        is?.where ?? was.where,
        `"${entry}" is no longer retired from ${name}`,
        { vocabulary: name, entry },
      );
    }
    for (const entry of was.entries.keys()) {
      if (is?.entries.has(entry) === true) continue;
      add(
        "vocabulary-entry-removed",
        is?.where ?? was.where,
        `"${entry}" is removed from ${name}`,
        { vocabulary: name, entry },
      );
    }
  }
  for (const [name, is] of index.vocabularies) {
    if (is.mode !== "registered") continue;
    const was = head.vocabularies.get(name);
    for (const [entry, declared] of is.entries) {
      if (was?.entries.has(entry) === true) continue;
      add("vocabulary-entry-added", is.where, `"${entry}" is added to the registered ${name}`, {
        vocabulary: name,
        entry,
        by: declared.contributedBy,
      });
    }
  }

  // Libraries, and the two engine keys.
  const libraries = new Set(index.libraries.map((l) => l.id));
  for (const library of head.libraries) {
    if (!libraries.has(library.id))
      add("library-removed", ENGINE_WHERE, `library ${library.id} is removed`, {
        library: library.id,
      });
  }
  if (!same(head.engine.content_roots, index.engine.content_roots))
    add("content-roots", ENGINE_WHERE, "content_roots changed", {
      before: head.engine.content_roots,
      after: index.engine.content_roots,
    });
  if (!same(head.engine.libraries, index.engine.libraries))
    add("libraries", ENGINE_WHERE, "libraries changed", {
      before: head.engine.libraries,
      after: index.engine.libraries,
    });
  const engineKeys: [string, keyof TypeLaw["engine"], string][] = [
    ["extensions", "extensions", "extensions"],
    ["source-roots", "source_roots", "source_roots"],
    ["field-sources", "field_sources", "field_sources"],
  ];
  for (const [kind, key, written] of engineKeys) {
    if (same(head.engine[key], index.engine[key])) continue;
    add(kind, ENGINE_WHERE, `${written} changed`, {
      before: head.engine[key] ?? null,
      after: index.engine[key] ?? null,
    });
  }

  // Rule tests and examples: a file changed or deleted.
  const files = (law: TypeLaw) =>
    new Map([...law.files.values()].map((f) => [`${f.owner}:${f.path}`, f] as const));
  const now = files(index);
  for (const [framed, was] of files(head)) {
    const path = was.path;
    const kind = path.startsWith("rule-tests/")
      ? "rule-test"
      : path.startsWith("examples/")
        ? "example"
        : undefined;
    if (kind === undefined) continue;
    const is = now.get(framed);
    if (is === undefined) add(`${kind}-deleted`, framed, `${framed} is deleted`, { file: framed });
    else if (!sameBytes(was.bytes, is.bytes))
      add(`${kind}-changed`, framed, `${framed} changed`, { file: framed });
  }

  return out.sort(
    (a, b) =>
      codeUnitCompare(a.path, b.path) ||
      codeUnitCompare(a.kind, b.kind) ||
      codeUnitCompare(a.message, b.message),
  );
}

/** The rules a diff adds or changes: what the gate holds to a test set (§8 rule-untested). */
export function changedRules(head: TypeLaw, index: TypeLaw): Set<string> {
  const out = new Set<string>();
  const before = declaredRules(head);
  for (const [id, is] of declaredRules(index)) {
    const was = before.get(id);
    if (
      was === undefined ||
      was.expr !== is.expr ||
      (was.section ?? null) !== (is.section ?? null) ||
      was.severity !== is.severity
    ) {
      out.add(id);
    }
  }
  for (const change of lawDiff(head, index)) {
    const rule = change.details["rule"];
    if (change.kind === "rule-config" && typeof rule === "string") out.add(rule);
  }
  return out;
}

/**
 * The gate's law diff, from what HEAD holds: `null` when there is no HEAD,
 * which §9.2 gives no law diff; else HEAD's law as it loaded. A HEAD whose
 * law does not load (a bundle's first v4 commit, or a law broken at HEAD)
 * cannot be compared, and is never passed over in silence: it is one
 * change, `head-law-unloadable`, which the commit message must give a
 * reason for, and every rule of the index's law counts as added, so each
 * one untested is an error (§8 `rule-untested`).
 */
export function headLawDiff(
  head: TypeLawResult | null,
  index: TypeLaw,
): { changes: LawChange[]; rulesChanged: Set<string> } {
  if (head === null) return { changes: [], rulesChanged: new Set() };
  if (head.ok)
    return { changes: lawDiff(head.law, index), rulesChanged: changedRules(head.law, index) };
  const first = head.issues[0];
  return {
    changes: [
      {
        kind: "head-law-unloadable",
        path: first?.where ?? ENGINE_WHERE,
        message: `HEAD's law does not load${first === undefined ? "" : ` (${first.code}: ${first.message})`}, so nothing it held can be compared with the index's`,
        details: {
          kind: "head-law-unloadable",
          issues: head.issues.map((i) => ({ code: i.code, where: i.where, message: i.message })),
        },
      },
    ],
    rulesChanged: new Set(index.rules.keys()),
  };
}

/** The reason a commit message's body gives for a law change, if it gives one. */
export function lawChangeReason(message: string): string | undefined {
  const lines = message
    .split("\n")
    .map((l) => l.replace(/\r$/u, ""))
    .filter((l) => !l.startsWith("#"));
  for (const line of lines.slice(1)) {
    const match = /^law-change:[ \t]*(\S.*)$/u.exec(line);
    if (match !== null) return (match[1] ?? "").trim();
  }
  return undefined;
}

/**
 * §8: the diff as findings. `pre-commit`: every change `law-changed`, info.
 * `commit-msg`: `law-relaxed`, an error, unless the message's body carries
 * `law-change: <reason>`.
 */
export function lawChangeFindings(
  changes: readonly LawChange[],
  stage: { kind: "pre-commit" } | { kind: "commit-msg"; message: string },
): VerdictFinding[] {
  const reason = stage.kind === "commit-msg" ? lawChangeReason(stage.message) : undefined;
  const relaxed = stage.kind === "commit-msg" && reason === undefined;
  const found: Unrouted[] = changes.map((change) => ({
    rule: relaxed ? "law-relaxed" : "law-changed",
    severity: relaxed ? "error" : "info",
    path: change.path,
    location: PAGE_LOCATION,
    message: relaxed
      ? `${change.message}; the commit message states no reason (a body line "law-change: <reason>")`
      : change.message,
    details: reason === undefined ? change.details : { ...change.details, reason },
  }));
  return found.map(routeVerdictFinding);
}
