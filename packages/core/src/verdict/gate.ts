// v2 contracts §9.2: the gate over the index with HEAD as its base — today's
// demotion of a queued error on a line the commit did not touch, and today's
// change-scoping to the pages the commit touches, both suspended when the
// commit changes the law (`configChanged`, §8).
//
// Ported from the old judge (judge/index.ts, "line inheritance" and "the
// gate's change-scoping"): a current line is inherited when the base holds an
// identical line it has not already accounted for (a moved line is a move,
// not an edit); a queued error on an inherited line is a warning, marked
// `demoted_from: "error"`, unless its code is one no inherited line demotes
// (the frontmatter's syntax, identity collisions, instance counts, an illegal
// exception); a finding with no line is never demoted; a verdict the base's
// names would not have given is the commit's, whatever the holder's lines
// say, so it is never demoted and is shown on a page the commit did not
// touch; every other finding on an untouched page is left out.
//
// Changed, because a v2 finding is located at a page or a section
// occurrence (§6), not at a line:
// - a finding's line is its item's line, or on the page the frontmatter
//   key's line (`details.line`); a finding at the page with neither — a
//   missing section, a CEL page rule — has no line and is never demoted;
// - a finding at an occurrence's heading judges the occurrence as a whole
//   (its count, its order, a `require` row, a CEL section rule), so it is
//   inherited when that occurrence's raw text is its base occurrence's —
//   same heading, same index — byte for byte, and touched otherwise;
// - a transition (`entry-edited`, `claims-transition`, `relation-removed`,
//   a CEL rule that reads `before`) is the commit's change measured against
//   the base, so it is never demoted. The old judge located a transition at
//   no line, and so never demoted one either;
// - "the base's names" is re-asked by judging the page again against the
//   names the base held, for every code whose verdict reads another page's
//   name or type (the link and relation-target codes, `page-ref-type`, the
//   CEL rules, which read `facts.links`): a finding that judgment does not
//   give is the commit's. The old judge re-asked only the three link codes,
//   by their target; that left out a page reference whose target the
//   commit retyped, on a page the commit did not touch.
import { parsePage } from "../interface/index.ts";
import type { TypeLaw } from "../law/load.ts";
import { utf8Text, withoutBom } from "../law/text.ts";
import { indexed } from "./grammar.ts";
import {
  judgePage,
  pageContext,
  type ReadPage,
  resolveRelations,
  type StateRead,
} from "./judge.ts";
import { buildNames, type NamedPage, type VaultNames } from "./names.ts";
import type { Unrouted } from "./page.ts";
import type { JudgeState } from "./state.ts";
import { sameBytes } from "./state.ts";
import { routeVerdictFinding, VERDICT_TABLE } from "./table.ts";

/** The codes an inherited line never demotes. */
const NEVER_DEMOTED: ReadonlySet<string> = new Set([
  "page-too-large",
  "page-not-utf8",
  "malformed-frontmatter",
  "frontmatter-not-mapping",
  "duplicate-key",
  "identity-collision",
  "instances-min",
  "instances-max",
  "exception-illegal",
]);

/** The kernel's transitions: each compares the page with its base (§4). */
const TRANSITIONS: ReadonlySet<string> = new Set(
  VERDICT_TABLE.filter((row) => row.needsBase === true && row.scope === "page").map(
    (row) => row.id,
  ),
);

/** The kernel codes whose verdict reads the vault's names (§3.1, §4). */
const NAME_READERS: ReadonlySet<string> = new Set([
  "wikilink-unresolved",
  "wikilink-alias-target",
  "relation-target-unresolved",
  "page-ref-type",
  "rule-error",
]);

/** The codes that judge the vault as a whole: shown whatever the commit touched. */
const VAULT_WIDE: ReadonlySet<string> = new Set([
  "identity-collision",
  "instances-min",
  "instances-max",
  "path-skipped",
]);

function lines(bytes: Uint8Array): string[] {
  const text = withoutBom(utf8Text(bytes) ?? "");
  return text.split("\n").map((l: string) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

/** The 1-based current lines the base accounts for. */
export function inheritedLines(base: Uint8Array, current: Uint8Array): Set<number> {
  const pool = new Map<string, number>();
  for (const line of lines(base)) pool.set(line, (pool.get(line) ?? 0) + 1);
  const out = new Set<number>();
  lines(current).forEach((line, i) => {
    const left = pool.get(line) ?? 0;
    if (left === 0) return;
    pool.set(line, left - 1);
    out.add(i + 1);
  });
  return out;
}

/**
 * The names the base held: a renamed page under the path it was renamed
 * from, and a page the commit deletes under its own.
 */
function baseNames(state: JudgeState, read: StateRead, law: TypeLaw): VaultNames | undefined {
  if (state.base === undefined) return undefined;
  const renamedFrom = new Map((state.renames ?? []).map((r) => [r.to, r.from] as const));
  const current = new Map(read.named.map((p) => [p.path, p] as const));
  const named: NamedPage[] = [];
  for (const page of read.pages) {
    const base = page.base;
    if (base === undefined || base === null || !base.ok) continue;
    const path = renamedFrom.get(page.path) ?? page.path;
    named.push({
      path,
      frontmatter:
        base === page.read ? (current.get(page.path)?.frontmatter ?? {}) : base.page.frontmatter,
    });
  }
  for (const [path, bytes] of state.removed ?? []) {
    const removed = parsePage(path, bytes, law);
    if (removed.ok) named.push({ path, frontmatter: removed.page.frontmatter });
  }
  return buildNames(named);
}

/** One finding as a key: its rule, its path, its location and its details. */
export function findingKey(f: Unrouted): string {
  const at =
    f.location.kind === "page"
      ? "page"
      : `${f.location.heading}\u0000${f.location.occurrence}\u0000${f.location.line}`;
  return `${f.rule}\u0000${f.path}\u0000${at}\u0000${JSON.stringify(f.details)}`;
}

export interface GateScope {
  findings: Unrouted[];
  /** The pages the commit touches: changed bytes, a new page, a rename's target. */
  changed: Set<string>;
  /** Whether the scoping applied: a state with a base and no change to the law. */
  scoped: boolean;
}

/**
 * The gate's reading of one collection: queued errors on inherited lines
 * demoted, and only the findings the commit is answerable for kept. With no
 * base, or with `configChanged`, nothing is demoted or left out.
 */
export function gateScope(
  found: readonly Unrouted[],
  state: JudgeState,
  read: StateRead,
  law: TypeLaw,
  configChanged: boolean,
): GateScope {
  const changed = new Set<string>();
  if (state.base !== undefined) {
    for (const [path, bytes] of state.pages) {
      const base = state.base.get(path);
      if (base === undefined || base === null || !sameBytes(base, bytes)) changed.add(path);
    }
    for (const rename of state.renames ?? []) changed.add(rename.to);
  }
  if (state.base === undefined || configChanged) {
    return { findings: [...found], changed, scoped: false };
  }
  const pages = new Map(read.pages.map((p) => [p.path, p] as const));
  const names = baseNames(state, read, law);
  const ctx = names === undefined ? undefined : pageContext(state, law, names);
  // Each page judged again against the base's names, once, and only a page
  // that carries a finding whose verdict reads them.
  const underBaseNames = new Map<string, Set<string>>();
  const keysUnderBaseNames = (page: ReadPage): Set<string> => {
    let keys = underBaseNames.get(page.path);
    if (keys !== undefined) return keys;
    keys = new Set();
    underBaseNames.set(page.path, keys);
    const bytes = state.pages.get(page.path);
    if (ctx === undefined || names === undefined || bytes === undefined) return keys;
    const current = parsePage(page.path, bytes, law);
    const baseBytes = state.base?.get(page.path);
    const base =
      page.base === undefined
        ? undefined
        : page.base === null || baseBytes === undefined || baseBytes === null
          ? null
          : page.base === page.read
            ? current
            : parsePage(page.path, baseBytes, law);
    if (current.ok) resolveRelations(current.page, names);
    if (base?.ok === true && base !== current) resolveRelations(base.page, names);
    for (const f of judgePage(ctx, { path: page.path, read: current, base }).findings)
      keys.add(findingKey(f));
    return keys;
  };
  const readsNames = (f: Unrouted): boolean => NAME_READERS.has(f.rule) || law.rules.has(f.rule);
  const causedByNames = (f: Unrouted): boolean => {
    const page = pages.get(f.path);
    if (page === undefined || !readsNames(f)) return false;
    return !keysUnderBaseNames(page).has(findingKey(f));
  };
  const isTransition = (f: Unrouted): boolean => {
    if (TRANSITIONS.has(f.rule)) return true;
    const id = f.rule === "rule-error" ? f.details["rule"] : f.rule;
    return typeof id === "string" && law.rules.get(id)?.transition === true;
  };
  const alignments = new Map<string, Set<number>>();
  const inheritedOn = (path: string, base: Uint8Array, current: Uint8Array): Set<number> => {
    let lined = alignments.get(path);
    if (lined === undefined) {
      lined = inheritedLines(base, current);
      alignments.set(path, lined);
    }
    return lined;
  };
  /** Whether the commit left the finding where the base had it. */
  const inherited = (f: Unrouted, base: Uint8Array, current: Uint8Array): boolean => {
    if (isTransition(f)) return false;
    if (f.location.kind === "section") {
      const at = f.location;
      const page = pages.get(f.path);
      if (page === undefined || !page.read.ok) return false;
      const now = indexed(page.read.page).find(
        (a) => a.occurrence.heading === at.heading && a.index === at.occurrence,
      );
      if (now !== undefined && now.occurrence.location.line === at.line) {
        // The occurrence as a whole: inherited when its raw text is unchanged.
        if (page.base === undefined || page.base === null || !page.base.ok) return false;
        const was = indexed(page.base.page).find(
          (a) => a.occurrence.heading === at.heading && a.index === at.occurrence,
        );
        return was !== undefined && was.occurrence.raw === now.occurrence.raw;
      }
      return inheritedOn(f.path, base, current).has(at.line);
    }
    const line = f.details["line"];
    if (typeof line !== "number") return false;
    return inheritedOn(f.path, base, current).has(line);
  };
  const out: Unrouted[] = [];
  for (const finding of found) {
    const current = state.pages.get(finding.path);
    const base = state.base.get(finding.path);
    const onPage = current !== undefined;
    const byNames = onPage && causedByNames(finding);
    if (onPage && !changed.has(finding.path) && !byNames && !VAULT_WIDE.has(finding.rule)) continue;
    if (!onPage || byNames || base === undefined || base === null || current === undefined) {
      out.push(finding);
      continue;
    }
    const demotable =
      finding.severity === "error" &&
      routeVerdictFinding(finding).queue !== undefined &&
      !NEVER_DEMOTED.has(finding.rule);
    if (demotable && inherited(finding, base, current)) {
      out.push({
        ...finding,
        severity: "warning",
        details: { ...finding.details, demoted_from: "error" },
      });
    } else out.push(finding);
  }
  return { findings: out, changed, scoped: true };
}

/** Whether a staged path changes the law (§8): the whole vault is then judged. */
export function changesLaw(path: string, bundle: string, libraries: readonly string[]): boolean {
  const inBundle =
    bundle === ""
      ? path
      : path.startsWith(`${bundle}/`)
        ? path.slice(bundle.length + 1)
        : undefined;
  if (inBundle !== undefined) {
    for (const dir of ["config/", "constitution/", "rule-tests/", "examples/"])
      if (inBundle.startsWith(dir)) return true;
  }
  return libraries.some((library) => path === library || path.startsWith(`${library}/`));
}
