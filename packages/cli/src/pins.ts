// v2 contracts §3.1 (the engine `$def` `pin`: `{commit, origin, covers}`),
// §9.1 (`check` measures every pin against the local repository only:
// `pin-stale`, a warning; a remote-origin pin `pin-unmeasured`, info;
// `stale-source-cited` kept, propagated over graph.json's edges) and §9.5
// (`read` and `search` carry the result as a page's `status`).
//
// Ported from the old measurement (freshness.ts): one origin measured, ".",
// the repository enclosing the bundle; a pin not on the history of HEAD
// (`pin-unknown`, the old `pin-unknown-to-origin`); the covering diff between
// the pin and HEAD over the pin's `covers`, read with `:(top)` so the paths
// are repository-root-relative wherever the bundle sits (`pin-stale`, the old
// `stale-capture`); the page's citations held to the pin, read by
// freshness.ts's own `citationsIn` (`citation-unresolved`, kept); and one hop
// of propagation into every page whose edge, of any kind but `tagged`, names
// a stale page. Changed: a pin is found by its shape — a top-level property
// whose schema is the engine `$def` `pin` — and its three parts are one
// value; a pin nothing measures is an info finding (`pin-unmeasured`, reason
// `remote-origin`, `no-repository` or `no-head`), the old
// `origin-unreachable` dropped with remote freshness; `--fast-forward` and
// the uncommitted `generated/freshness.json` report are not ported.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  codeUnitCompare,
  type LawType,
  PAGE_LOCATION,
  type StateRead,
  type TypeLawGraphEdge,
  type Unrouted,
} from "@wikiwright/core";
import { citationsIn } from "./freshness.ts";
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

/** The one origin measured: the repository the bundle sits in. */
export const LOCAL_ORIGIN = ".";

const COMMIT = /^[0-9a-f]{7,64}$/u;

export type PinState = "current" | "unchanged" | "stale" | "unknown" | "unmeasured";
export type UnmeasuredReason = "remote-origin" | "no-repository" | "no-head";

export interface UnresolvedCitation {
  path: string;
  line: number | null;
  reason: "missing" | "past-end" | "unattached" | "ambiguous" | "malformed";
}

export interface PinEntry {
  path: string;
  field: string;
  commit: string;
  origin: string;
  state: PinState;
  /** With `unmeasured`: why nothing measured it. */
  reason?: UnmeasuredReason;
  behind: number | null;
  covering_touched: string[] | null;
  citations: { checked: number; unresolved: UnresolvedCitation[] } | null;
}

export interface PinMeasurement {
  entries: PinEntry[];
  /** How many pins stand in each state, every state present. */
  counts: Record<PinState, number>;
  findings: Unrouted[];
  /** The pages whose pins are stale, and the pages that cite one (`stale-source-cited`). */
  stale: ReadonlySet<string>;
  citing: ReadonlyMap<string, string[]>;
}

/** The top-level properties a type's effective shape declares as the engine `$def` `pin`. */
export function pinFields(type: LawType): string[] {
  const out: string[] = [];
  for (const part of type.parts) {
    const properties = part.schema["properties"];
    if (properties === null || typeof properties !== "object") continue;
    for (const [key, schema] of Object.entries(properties as Record<string, unknown>)) {
      const ref = (schema as Record<string, unknown> | null)?.["$ref"];
      if (ref === "#/$defs/pin" && !out.includes(key)) out.push(key);
    }
  }
  return out;
}

interface Pinned {
  path: string;
  field: string;
  commit: string;
  origin: string;
  covers: string[];
  text: string;
}

/** Every well-formed pin the pages carry; a malformed one is the judge's `page-shape-invalid`. */
function pinnedPages(read: StateRead, only?: ReadonlySet<string>): Pinned[] {
  const out: Pinned[] = [];
  for (const page of read.pages) {
    if (!page.read.ok || (only !== undefined && !only.has(page.path))) continue;
    const parsed = page.read.page;
    if (parsed.type === undefined) continue;
    for (const field of pinFields(parsed.type)) {
      const value = parsed.frontmatter[field];
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const pin = value as Record<string, unknown>;
      const commit = pin["commit"];
      const origin = pin["origin"];
      const covers = pin["covers"];
      if (typeof commit !== "string" || !COMMIT.test(commit)) continue;
      if (typeof origin !== "string" || origin.trim() === "") continue;
      if (!Array.isArray(covers) || covers.some((c) => typeof c !== "string")) continue;
      out.push({
        path: page.path,
        field,
        commit,
        origin: origin.trim(),
        covers: covers as string[],
        text: `${parsed.body}`,
      });
    }
  }
  return out.sort((a, b) => codeUnitCompare(a.path, b.path) || codeUnitCompare(a.field, b.field));
}

interface Repository {
  dir: string | null;
  head: string | null;
  reason?: UnmeasuredReason;
}

async function repositoryAt(root: string): Promise<Repository> {
  if ((await gitTopLevel(root)) === undefined) {
    // A `.git` git does not recognise is the measurement breaking, not a
    // bundle outside every repository.
    if (existsSync(join(root, ".git"))) {
      throw new Error(`"${join(root, ".git")}" exists and git recognises no repository there`);
    }
    return { dir: null, head: null, reason: "no-repository" };
  }
  if (!(await gitHasHead(root))) return { dir: root, head: null, reason: "no-head" };
  return { dir: root, head: await gitHead(root) };
}

/** Every citation the repository does not answer at the pin, the objects read once per path. */
async function unresolvedCitations(
  dir: string,
  commit: string,
  citations: readonly { path: string; line: number | null }[],
): Promise<UnresolvedCitation[]> {
  const types = new Map<string, string | undefined>();
  const lines = new Map<string, number>();
  const out: UnresolvedCitation[] = [];
  for (const citation of citations) {
    const spec = `${commit}:${citation.path}`;
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
    if (citation.line > (lines.get(citation.path) ?? 0))
      out.push({ path: citation.path, line: citation.line, reason: "past-end" });
  }
  const unique = new Map(out.map((u) => [`${u.path}\u0000${u.line ?? ""}`, u]));
  return [...unique.values()];
}

const REASON_TEXT: Readonly<Record<UnmeasuredReason, string>> = {
  "remote-origin": "names another origin, and only the repository the bundle sits in is measured",
  "no-repository": 'names ".", and no repository encloses the bundle',
  "no-head": "names the repository the bundle sits in, which has no commit to measure against",
};

function countOf(entries: readonly PinEntry[]): Record<PinState, number> {
  const counts: Record<PinState, number> = {
    current: 0,
    unchanged: 0,
    stale: 0,
    unknown: 0,
    unmeasured: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;
  return counts;
}

/**
 * §9.1: every pin measured, or the pins of the pages `only` names, with the
 * findings and the one hop of `stale-source-cited` over `edges`.
 */
export async function measurePins(
  root: string,
  read: StateRead,
  edges: readonly TypeLawGraphEdge[],
  only?: ReadonlySet<string>,
): Promise<PinMeasurement> {
  const pinned = pinnedPages(read, only);
  const entries: PinEntry[] = [];
  const findings: Unrouted[] = [];
  const stale = new Set<string>();
  let repository: Repository | undefined;
  for (const pin of pinned) {
    const entry: PinEntry = {
      path: pin.path,
      field: pin.field,
      commit: pin.commit,
      origin: pin.origin,
      state: "unmeasured",
      behind: null,
      covering_touched: null,
      citations: null,
    };
    entries.push(entry);
    const at = { field: pin.field, commit: pin.commit, origin: pin.origin };
    let reason: UnmeasuredReason | undefined;
    if (pin.origin !== LOCAL_ORIGIN) reason = "remote-origin";
    else {
      repository ??= await repositoryAt(root);
      reason = repository.reason;
    }
    const dir = repository?.dir ?? null;
    const head = repository?.head ?? null;
    if (reason !== undefined || dir === null || head === null) {
      entry.reason = reason ?? "no-head";
      findings.push({
        rule: "pin-unmeasured",
        severity: "info",
        path: pin.path,
        location: PAGE_LOCATION,
        message: `the pin in ${pin.field} ${REASON_TEXT[entry.reason]}; it is not measured`,
        details: { ...at, reason: entry.reason },
      });
      continue;
    }
    const known =
      (await gitCommitKnown(dir, pin.commit)) && (await gitIsAncestor(dir, pin.commit, "HEAD"));
    if (!known) {
      entry.state = "unknown";
      findings.push({
        rule: "pin-unknown",
        severity: "warning",
        path: pin.path,
        location: PAGE_LOCATION,
        message: `the pin in ${pin.field}, ${pin.commit.slice(0, 12)}, is not on the history of HEAD (${head.slice(0, 12)}): a rewritten history, or a mistyped commit`,
        details: { ...at, head },
      });
      continue;
    }
    const behind = await gitRevListCount(dir, pin.commit, "HEAD");
    const touched = await gitDiffNames(dir, pin.commit, "HEAD", pin.covers, true);
    entry.behind = behind;
    entry.covering_touched = touched;
    const topLevel = new Set(await gitTreeEntries(dir, pin.commit));
    const scan = citationsIn(pin.text, topLevel, pin.covers);
    const unresolved: UnresolvedCitation[] = [
      ...(await unresolvedCitations(dir, pin.commit, scan.citations)),
      ...scan.problems.map((p) => ({ path: p.token, line: null, reason: p.reason })),
    ];
    entry.citations = { checked: scan.citations.length, unresolved };
    for (const citation of unresolved) {
      const cited = citation.line === null ? citation.path : `${citation.path}:${citation.line}`;
      findings.push({
        rule: "citation-unresolved",
        severity: "warning",
        path: pin.path,
        location: PAGE_LOCATION,
        message: `cites \`${cited}\`, which the repository does not answer at the pin ${pin.commit.slice(0, 12)} (${citation.reason})`,
        details: { ...at, cited: citation.path, line: citation.line, reason: citation.reason },
      });
    }
    const current = head.startsWith(pin.commit);
    entry.state = touched.length > 0 ? "stale" : current ? "current" : "unchanged";
    if (touched.length > 0) {
      stale.add(pin.path);
      findings.push({
        rule: "pin-stale",
        severity: "warning",
        path: pin.path,
        location: PAGE_LOCATION,
        message: `the paths ${pin.field} covers changed since ${pin.commit.slice(0, 12)}: ${touched.join(", ")} (${behind} commit(s) behind HEAD)`,
        details: { ...at, head, behind, touched },
      });
    }
  }
  const citing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind === "tagged" || edge.from === edge.to || !stale.has(edge.to)) continue;
    const list = citing.get(edge.from) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    citing.set(edge.from, list);
  }
  for (const [from, targets] of [...citing].sort(([a], [b]) => codeUnitCompare(a, b))) {
    for (const target of targets.sort(codeUnitCompare)) {
      findings.push({
        rule: "stale-source-cited",
        severity: "warning",
        path: from,
        location: PAGE_LOCATION,
        message: `links to ${target}, whose pin is stale; cleared when that page is re-read and re-pinned`,
        details: { target },
      });
    }
  }
  return { entries, counts: countOf(entries), findings, stale, citing };
}
