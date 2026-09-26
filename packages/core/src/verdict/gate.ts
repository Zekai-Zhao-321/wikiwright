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
// exception); a link verdict the base's names would not have given is the
// commit's, whatever the holder's lines say, so it is never demoted and is
// shown on a page the commit did not touch; every other finding on an
// untouched page is left out. Changed: a finding's line is its section
// occurrence's line or, on the page, the frontmatter key's line
// (`details.line`); a finding with neither — a missing key, the page as a
// whole — counts as touched whenever the frontmatter block changed, as the
// step-3 judge's note on `withFrontmatterLines` set out (the old judge never
// demoted a finding with no line).
import { utf8Text, withoutBom } from "../law/text.ts";
import type { StateRead } from "./judge.ts";
import { buildNames, type NamedPage, type VaultNames } from "./names.ts";
import type { Unrouted } from "./page.ts";
import type { JudgeState } from "./state.ts";
import { sameBytes } from "./state.ts";
import { routeVerdictFinding } from "./table.ts";

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

/** The codes whose verdict is the vault's names, with what each asserts of a target. */
const NAME_RULES: ReadonlyMap<string, "unresolved" | "alias"> = new Map([
  ["wikilink-unresolved", "unresolved"],
  ["wikilink-alias-target", "alias"],
  ["relation-target-unresolved", "unresolved"],
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

function lineOf(finding: Unrouted): number | undefined {
  if (finding.location.kind === "section") return finding.location.line;
  const line = finding.details["line"];
  return typeof line === "number" ? line : undefined;
}

/** The names the base held: a renamed page under the path it was renamed from. */
function baseNames(state: JudgeState, read: StateRead): VaultNames | undefined {
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
  return buildNames(named);
}

function verdictOf(names: VaultNames, target: string): "ok" | "unresolved" | "alias" {
  const entry = names.resolve(target);
  if (entry === undefined) return "unresolved";
  return entry.viaAlias ? "alias" : "ok";
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
  const names = baseNames(state, read);
  const causedByNames = (f: Unrouted): boolean => {
    const asserts = NAME_RULES.get(f.rule);
    const target = f.details["target"];
    if (names === undefined || asserts === undefined || typeof target !== "string") return false;
    return verdictOf(names, target) !== asserts;
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
  const pages = new Map(read.pages.map((p) => [p.path, p] as const));
  const out: Unrouted[] = [];
  for (const finding of found) {
    const current = state.pages.get(finding.path);
    const base = state.base.get(finding.path);
    const onPage = current !== undefined;
    const byNames = causedByNames(finding);
    if (onPage && !changed.has(finding.path) && !byNames && !VAULT_WIDE.has(finding.rule)) continue;
    if (!onPage || byNames || base === undefined || base === null || current === undefined) {
      out.push(finding);
      continue;
    }
    const line = lineOf(finding);
    const inherited =
      line === undefined
        ? sameFrontmatter(pages.get(finding.path))
        : inheritedOn(finding.path, base, current).has(line);
    const queued = routeVerdictFinding(finding).queue !== undefined;
    if (inherited && finding.severity === "error" && queued && !NEVER_DEMOTED.has(finding.rule)) {
      out.push({
        ...finding,
        severity: "warning",
        details: { ...finding.details, demoted_from: "error" },
      });
    } else out.push(finding);
  }
  return { findings: out, changed, scoped: true };
}

/** Whether a page's frontmatter block is byte for byte its base's. */
function sameFrontmatter(page: StateRead["pages"][number] | undefined): boolean {
  if (page === undefined || !page.read.ok) return false;
  const base = page.base;
  if (base === undefined || base === null || !base.ok) return false;
  const a = base.page.frontmatterBytes;
  const b = page.read.page.frontmatterBytes;
  if (a === null || b === null) return a === b;
  return sameBytes(a, b);
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
