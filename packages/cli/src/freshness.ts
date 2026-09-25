// docs/cli.md §freshness, docs/constitution.md §Shapes: staleness is measured
// against the local repository only. A page whose origin is "." — the
// repository the vault sits in — is measured against its history: how far
// behind, and does the covering diff touch the capture. A page that names any
// other origin (a git URL) is not measured and says so: remote freshness, the
// `ls-remote` depth and the `--fetch` cache, was removed (CHANGELOG.md,
// docs/roadmap.md). Snapshot-external findings are warnings; the report is
// uncommitted; nothing here lands in frontmatter except through the Writer.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  COMMIT_ID,
  codeUnitCompare,
  type Finding,
  type FlattenedRegistry,
  type GraphEdge,
  type PageInput,
  pinFieldOf,
} from "@wikiwright/core";
import {
  gitBlobLineCount,
  gitCommitKnown,
  gitDiffNames,
  gitHasHead,
  gitHead,
  gitIsAncestor,
  gitObjectType,
  gitRevListCount,
  gitTopLevel,
  gitTreeEntries,
} from "./git.ts";

/** The one origin measured: the repository the vault sits in. */
export const LOCAL_ORIGIN = ".";

/** A page carrying a well-formed pin, with the origin and paths its type's shape names. */
export interface PinnedPage {
  path: string;
  field: string;
  pin: string;
  origin: string;
  covers: string[];
  /** The page's bytes, for the citations it makes to the origin's paths. */
  source: string;
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.length > 0);
}

/**
 * docs/constitution.md §Shapes: the pins a vault carries, read off the one `pin` shape each
 * type declares. A malformed pin or a missing origin is `malformed-pin` on the
 * page (lint's, snapshot-internal) and is not measured here. `declared` says
 * whether any type declares a pin at all — the difference between "nothing was
 * pinned" and "nothing can be".
 */
export function pinnedPages(
  registry: FlattenedRegistry,
  pages: readonly PageInput[],
): { pinned: PinnedPage[]; declared: boolean } {
  const declared = [...registry.types.values()].some((t) => pinFieldOf(t.fields) !== undefined);
  const pinned: PinnedPage[] = [];
  for (const page of pages) {
    const fm = page.doc.frontmatter.value;
    const type = fm["type"];
    const effective = typeof type === "string" ? registry.types.get(type) : undefined;
    const shape = effective === undefined ? undefined : pinFieldOf(effective.fields);
    if (shape === undefined) continue;
    const pin = fm[shape.field];
    const origin = fm[shape.origin];
    if (typeof pin !== "string" || !COMMIT_ID.test(pin)) continue;
    if (typeof origin !== "string" || origin.trim().length === 0) continue;
    pinned.push({
      path: page.path,
      field: shape.field,
      pin,
      origin: origin.trim(),
      covers: shape.covers === undefined ? [] : stringsOf(fm[shape.covers]),
      source: page.doc.source,
    });
  }
  return { pinned, declared };
}

export interface OriginState {
  origin: string;
  /** Whether this run read the origin's history: only a repository enclosing the vault, for ".". */
  reachable: boolean;
  head: string | null;
}

/**
 * Every pin's standing, in one word that names what the writer must
 * do. `current` — the pin is the head: nothing. `unchanged` — the head moved
 * and the covering diff is empty: the read holds, and the pin is a
 * `--fast-forward` candidate. `stale` — the covering diff touches a covered
 * path: re-read and re-pin. `unknown` — the repository's history does not
 * hold the pin (a force-push, a rebase, a typo): re-read at the head.
 * `unmeasured` — no head was learned, or the origin is not the local
 * repository, and `reason` says why. `behind`, `stale` and
 * `covering_touched` stay as data beside the word.
 */
export type PinState = "current" | "unchanged" | "stale" | "unknown" | "unmeasured";

const NO_PINS: Record<PinState, number> = {
  current: 0,
  unchanged: 0,
  stale: 0,
  unknown: 0,
  unmeasured: 0,
};

/** One citation the page makes that the origin, at the pin, does not answer. */
export interface UnresolvedCitation {
  /** The repository path, or the span as written when it resolved to no path. */
  path: string;
  /** The cited line, where a line was cited and is past the blob's end; null otherwise. */
  line: number | null;
  /**
   * Why it does not answer: the path is not at the pin (`missing`), the line is
   * past the blob (`past-end`), a bare line names nothing cited before it
   * (`unattached`), a file name is the name of two covered paths (`ambiguous`),
   * or a range does not count up from a first line (`malformed`).
   */
  reason: "missing" | "past-end" | "unattached" | "ambiguous" | "malformed";
}

export interface FreshnessEntry {
  path: string;
  field: string;
  origin: string;
  pin: string;
  state: PinState;
  /** With `state: "unmeasured"`: why the pin was not measured. */
  reason?: string;
  /** `pin === head`; null where no head was learned. */
  current: boolean | null;
  /** Known to the repository AND on its head's history; null where unmeasured. */
  known: boolean | null;
  behind: number | null;
  stale: boolean | null;
  covering_touched: string[] | null;
  /** "origin" where the local repository answered; null where the pin was not measured. */
  measured_against: "origin" | null;
  /** The page's repository-path citations checked at the pin; null where the objects were not read. */
  citations: { checked: number; unresolved: UnresolvedCitation[] } | null;
}

/**
 * docs/cli.md §check, docs/constitution.md §Shapes: the pass's applicability, in the coverage
 * vocabulary. `no-pin-field` is a constitution with nothing to measure.
 */
export type FreshnessCoverage = { evaluated: true } | { not_applicable: "no-pin-field" };

export interface FreshnessResult {
  origins: OriginState[];
  /** Every pin the vault carries, with its state: a report where "current" and "not measured" read alike is no report. */
  entries: FreshnessEntry[];
  /** How many pins stand in each state, so the summary line is one read. */
  pins: Record<PinState, number>;
  findings: Finding[];
  /** Pins behind their head whose covering diff is empty: fast-forward candidates. */
  eligible: Array<{ path: string; field: string; pin: string; head: string }>;
  coverage: FreshnessCoverage;
}

export interface FreshnessOptions {
  /** The graph's edges, for the one-hop propagation of staleness into citing pages. */
  edges: readonly GraphEdge[];
}

interface Measured {
  reachable: boolean;
  head: string | null;
  /** The repository whose objects answer, or null where none does. */
  dir: string | null;
  /** Why the origin's pins are not measured, when it is not the local repository. */
  unmeasured?: string;
  /** Why the local repository could not answer; reported as `origin-unreachable`. */
  unreachable?: string;
}

/**
 * What a page CITES, checked at its pin, and what it says that cannot be read
 * as a citation at all. Run-external — it reads objects — so it lives here
 * beside `stale-capture`, never in the judge.
 *
 * A code span is a citation in one of four spellings, and nothing else is:
 *
 * - a repository path whose first segment is an entry at the root of the tree
 *   at the pin (`packages/cli/src/git.ts`), the root file included (`AGENTS.md`);
 * - that path with a line or a range (`packages/cli/src/git.ts:31`, `:31-44`);
 * - a bare file name, suffix included, that is the basename of exactly one
 *   FILE the page covers (`git.ts:31`) — two covered paths of that name are
 *   ambiguous and are reported rather than guessed at, a covered directory is
 *   no candidate, and a name with no suffix is prose: `skills` is a verb in a
 *   sentence far more often than it is a path;
 * - a line or range alone (`:31-44`), which names the nearest FILE cited before
 *   it on the page, and is reported when nothing is cited before it. A
 *   directory (`packages/cli/src/verbs/`) is a citation of its own and is not
 *   that file: a line does not live in a directory, and a page that names one
 *   in passing is still writing about the file it was reading.
 *
 * Each distinct path must exist at the pin, and a cited line must not exceed
 * the blob's line count. A range must count up from a first line, so `:0` and
 * `:12-3` are refused rather than read as line 12 or line 3. What this does NOT
 * check is whether those lines say what the prose says they say; a citation
 * that resolves is a citation whose file and lines are there.
 *
 * A code span is a backtick run closed by a run of the same length (CommonMark
 * §6.1), so a span that soft-wraps over a line break, and a fenced block, each
 * pair as one token — neither shifts the pairing of the spans after it. A
 * single-line matcher paired the closing backtick of a wrapped span with the
 * opening backtick of the next one, and read every span in the rest of the
 * paragraph as its gap; the citations there were never checked.
 */
const CODE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/gu;
const CITATION = /^(?<path>[^\s:]*)(?::(?<from>\d+)(?:-(?<to>\d+))?)?$/u;
const NOT_A_PATH = /[*{<$\s]|:\/\//u;

interface Citation {
  path: string;
  line: number | null;
}

/** A span that reads as a citation and names nothing this page can resolve. */
export interface CitationProblem {
  /** The span as written, so the writer can find it. */
  token: string;
  reason: "unattached" | "ambiguous" | "malformed";
  /** For an ambiguous name, the covered paths it could mean. */
  candidates?: string[];
}

export interface CitationScan {
  citations: Citation[];
  problems: CitationProblem[];
}

/** The last path segment, for resolving a bare file name against `covers`. */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The citations a page makes, deduplicated and in code-unit order, and its unreadable spans. */
export function citationsIn(
  source: string,
  topLevel: ReadonlySet<string>,
  covers: readonly string[] = [],
): CitationScan {
  const seen = new Map<string, Citation>();
  const problems: CitationProblem[] = [];
  const reported = new Set<string>();
  // The page's own reading order: a bare line names the path cited before it.
  let antecedent: string | undefined;
  for (const match of source.matchAll(CODE_SPAN)) {
    const token = match[2] ?? "";
    if (NOT_A_PATH.test(token)) continue;
    const parsed = CITATION.exec(token);
    if (parsed === null) continue;
    const raw = parsed.groups?.["path"] ?? "";
    const written = raw.replace(/\/+$/u, "");
    const fromRaw = parsed.groups?.["from"];
    const toRaw = parsed.groups?.["to"];
    const from = fromRaw === undefined ? null : Number.parseInt(fromRaw, 10);
    const to = toRaw === undefined ? null : Number.parseInt(toRaw, 10);
    const problem = (reason: CitationProblem["reason"], candidates?: string[]): void => {
      const key = `${reason}\u0000${token}`;
      if (reported.has(key)) return;
      reported.add(key);
      problems.push({ token, reason, ...(candidates === undefined ? {} : { candidates }) });
    };
    let path: string | undefined;
    if (written === "") {
      // A line alone. Nothing cited before it means it names no file.
      if (from === null) continue;
      if (antecedent === undefined) {
        problem("unattached");
        continue;
      }
      path = antecedent;
    } else if (topLevel.has(written.split("/")[0] ?? "")) {
      path = written;
    } else if (!written.includes("/") && written.includes(".")) {
      const matches = covers
        .filter((cover) => !cover.endsWith("/"))
        .filter((cover) => basename(cover) === written);
      const first = matches[0];
      if (first === undefined) continue;
      if (matches.length > 1) {
        problem("ambiguous", [...matches].sort(codeUnitCompare));
        continue;
      }
      path = first;
    } else {
      continue;
    }
    if (path === undefined || path.length === 0) continue;
    // A directory does not become the path a later bare line names.
    if (!raw.endsWith("/")) antecedent = path;
    // A range counts up from a first line; anything else is not one, and
    // reading `:12-3` as line 3 would check a line nobody cited.
    if (from !== null && (from < 1 || (to !== null && to < from))) {
      problem("malformed");
      continue;
    }
    const line = to ?? from;
    const key = `${path}\u0000${line ?? ""}`;
    if (!seen.has(key)) seen.set(key, { path, line });
  }
  const citations = [...seen.values()].sort((a, b) =>
    codeUnitCompare(`${a.path}\u0000${a.line ?? ""}`, `${b.path}\u0000${b.line ?? ""}`),
  );
  return { citations, problems };
}

/** Every citation the origin does not answer at the pin, with the objects read once per path. */
async function unresolvedCitations(
  dir: string,
  pin: string,
  citations: readonly Citation[],
): Promise<UnresolvedCitation[]> {
  const types = new Map<string, string | undefined>();
  const lines = new Map<string, number>();
  const out: UnresolvedCitation[] = [];
  for (const citation of citations) {
    const spec = `${pin}:${citation.path}`;
    if (!types.has(citation.path)) types.set(citation.path, await gitObjectType(dir, spec));
    const type = types.get(citation.path);
    if (type === undefined) {
      out.push({ path: citation.path, line: null, reason: "missing" });
      continue;
    }
    if (citation.line === null) continue;
    if (type !== "blob") {
      out.push({ path: citation.path, line: citation.line, reason: "past-end" });
      continue;
    }
    if (!lines.has(citation.path)) lines.set(citation.path, await gitBlobLineCount(dir, spec));
    if (citation.line > (lines.get(citation.path) ?? 0)) {
      out.push({ path: citation.path, line: citation.line, reason: "past-end" });
    }
  }
  // One row per (path, line) — a path cited absent three times is named once.
  const unique = new Map(out.map((u) => [`${u.path}\u0000${u.line ?? ""}`, u]));
  return [...unique.values()];
}

/** Why one citation does not answer, in the words the writer needs to fix it. */
function citationMessage(citation: UnresolvedCitation, where: string, pin: string): string {
  const at = pin.slice(0, 12);
  switch (citation.reason) {
    case "missing":
      return `cites \`${where}\`, which does not exist at pin ${at}`;
    case "past-end":
      return `cites \`${where}\`, past the end of the file at pin ${at}`;
    case "unattached":
      return `cites \`${where}\`, and names no file: nothing is cited before it on the page`;
    case "ambiguous":
      return `cites \`${where}\`, which is the name of more than one covered path`;
    default:
      return `cites \`${where}\`, which is not a line or a range that counts up`;
  }
}

function warning(ruleId: string, path: string, message: string, remediation: string): Finding {
  return {
    ruleId,
    severity: "warning",
    path,
    message,
    remediation,
    contributedBy: "engine",
    layer: "constitution",
  };
}

/**
 * One origin, measured. "." is the repository enclosing the vault — the vault
 * root when it is one, else the nearest ancestor work tree, which is how a
 * code wiki lives in a directory of the repository it documents — and its
 * head is `HEAD` (the no-head row survives: a repository with no commit
 * has nothing to be fresh against, and says so with `head: null`). Git runs
 * from the vault root and `covers` is read with `:(top)`, so the paths a
 * page names are repository-root-relative wherever the vault sits. Any other
 * origin is not contacted: its pins are unmeasured, and the reason says so.
 */
async function measureOrigin(root: string, origin: string): Promise<Measured> {
  const none: Measured = { reachable: false, head: null, dir: null };
  if (origin !== LOCAL_ORIGIN) {
    return {
      ...none,
      unmeasured: `remote-origin: ${origin} is not the repository the vault sits in, and only that repository is measured`,
    };
  }
  if ((await gitTopLevel(root)) === undefined) {
    // A `.git` git does not recognise is the measurement breaking, not a
    // vault outside every repository: thrown, so it is `git-unavailable`.
    if (existsSync(join(root, ".git"))) {
      throw new Error(`"${join(root, ".git")}" exists and git recognises no repository there`);
    }
    return {
      ...none,
      unreachable: `origin "." names the repository enclosing the vault, and no repository encloses it`,
    };
  }
  if (!(await gitHasHead(root))) return { ...none, reachable: true, dir: root };
  return { reachable: true, head: await gitHead(root), dir: root };
}

/** How many pins stand in each of the five states, every state present even at zero. */
function countPins(entries: readonly FreshnessEntry[]): Record<PinState, number> {
  const counts: Record<PinState, number> = { ...NO_PINS };
  for (const entry of entries) counts[entry.state] += 1;
  return counts;
}

export async function computeFreshness(
  root: string,
  pages: readonly PageInput[],
  registry: FlattenedRegistry,
  options: FreshnessOptions,
): Promise<FreshnessResult> {
  const { pinned, declared } = pinnedPages(registry, pages);
  if (!declared) {
    return {
      origins: [],
      entries: [],
      pins: { ...NO_PINS },
      findings: [],
      eligible: [],
      coverage: { not_applicable: "no-pin-field" },
    };
  }
  const origins = [...new Set(pinned.map((p) => p.origin))].sort();
  const measured = new Map<string, Measured>();
  for (const origin of origins) measured.set(origin, await measureOrigin(root, origin));
  const entries: FreshnessEntry[] = [];
  const findings: Finding[] = [];
  const eligible: FreshnessResult["eligible"] = [];
  const stalePaths = new Set<string>();

  for (const page of pinned) {
    const state = measured.get(page.origin);
    if (state === undefined) continue;
    const current = state.head === null ? null : page.pin === state.head;
    const entry: FreshnessEntry = {
      path: page.path,
      field: page.field,
      origin: page.origin,
      pin: page.pin,
      // Settled below once the history is read; a pin with no head stays here.
      state: "unmeasured",
      current,
      known: null,
      behind: null,
      stale: null,
      covering_touched: null,
      measured_against: state.head === null ? null : "origin",
      citations: null,
    };
    if (current === null) {
      entry.reason =
        state.unmeasured ??
        state.unreachable ??
        `the origin ${page.origin} has no head to measure against`;
    }
    entries.push(entry);
    if (state.unreachable !== undefined) {
      findings.push(
        warning(
          "origin-unreachable",
          page.path,
          `the origin ${page.origin} did not answer: ${state.unreachable}`,
          "run `wikiwright freshness` from inside the repository the pages were pinned in",
        ),
      );
    }
    if (state.dir === null || state.head === null) continue;
    const known =
      (await gitCommitKnown(state.dir, page.pin)) &&
      (await gitIsAncestor(state.dir, page.pin, "HEAD"));
    entry.known = known;
    if (!known) {
      entry.state = "unknown";
      findings.push(
        warning(
          "pin-unknown-to-origin",
          page.path,
          `pin ${page.pin.slice(0, 12)} is not on the history of ${page.origin}'s head ${state.head.slice(0, 12)} — a force-push, a rebase, or a mistyped id`,
          "re-read the origin at its current head and re-pin, or correct the recorded id",
        ),
      );
      continue;
    }
    const behind = await gitRevListCount(state.dir, page.pin, "HEAD");
    // `covers` is repository-root-relative wherever the vault sits (`:(top)`).
    const touched = await gitDiffNames(state.dir, page.pin, "HEAD", page.covers, true);
    entry.behind = behind;
    entry.stale = touched.length > 0;
    entry.covering_touched = touched;
    // The objects are at hand, so the page's citations are held to the pin.
    const topLevel = new Set(await gitTreeEntries(state.dir, page.pin));
    const scan = citationsIn(page.source, topLevel, page.covers);
    // A span that reads as a citation and resolves to no path is reported as
    // itself: guessing at the file it meant would check a line nobody cited.
    const unresolved = [
      ...(await unresolvedCitations(state.dir, page.pin, scan.citations)),
      ...scan.problems.map(
        (problem): UnresolvedCitation => ({
          path: problem.token,
          line: null,
          reason: problem.reason,
        }),
      ),
    ];
    entry.citations = { checked: scan.citations.length, unresolved };
    for (const citation of unresolved) {
      const where = citation.line === null ? citation.path : `${citation.path}:${citation.line}`;
      findings.push(
        warning(
          "citation-unresolved",
          page.path,
          citationMessage(citation, where, page.pin),
          citation.reason === "missing" || citation.reason === "past-end"
            ? "re-read at the pin and correct the citation, or the pin"
            : "spell the path the line belongs to, and write a range that counts up",
        ),
      );
    }
    // The diff was read, so the word can say what it found: a page whose
    // covered paths did not move is not behind in any sense a writer acts on.
    entry.state = current ? "current" : entry.stale ? "stale" : "unchanged";
    if (entry.stale) {
      stalePaths.add(page.path);
      findings.push(
        warning(
          "stale-capture",
          page.path,
          `the covering diff since ${page.pin.slice(0, 12)} touches: ${touched.join(", ")} (${behind} commit(s) behind ${page.origin})`,
          "re-read the origin, update the capture, and re-pin — or record why the change does not matter",
        ),
      );
    } else if (behind > 0) {
      eligible.push({ path: page.path, field: page.field, pin: page.pin, head: state.head });
    }
  }

  // One hop, never transitive, over the graph's own edges of every kind but
  // `tagged` — label-agnostic and kernel-vocabulary-free: the page that
  // declares `traces-to` and the page that merely quotes the README are both
  // told, once each, and cleared by refreshing the capture (docs/constitution.md §Shapes).
  if (stalePaths.size > 0) {
    const told = new Set<string>();
    for (const edge of options.edges) {
      if (edge.kind === "tagged" || !stalePaths.has(edge.to) || edge.from === edge.to) continue;
      const key = `${edge.from}\u0000${edge.to}`;
      if (told.has(key)) continue;
      told.add(key);
      findings.push(
        warning(
          "stale-source-cited",
          edge.from,
          `cites the stale capture ${edge.to}; cleared by refreshing that capture`,
          "refresh the cited capture, or re-read it and record why the change does not reach this page",
        ),
      );
    }
  }

  return {
    origins: origins.map((origin) => {
      const state = measured.get(origin);
      return { origin, reachable: state?.reachable ?? false, head: state?.head ?? null };
    }),
    entries,
    pins: countPins(entries),
    findings,
    eligible,
    coverage: { evaluated: true },
  };
}

/** The uncommitted report body (docs/constitution.md §Shapes): derives from origin state, no clock. */
export function freshnessReportJson(result: FreshnessResult): string {
  const body = {
    schema: "wikiwright/freshness",
    origins: result.origins,
    pins: result.pins,
    entries: result.entries,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
