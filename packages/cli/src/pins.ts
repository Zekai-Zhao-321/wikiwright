// v2 contracts §3.1 (the engine `$def` `pin`: `{commit, origin, covers}`),
// §9.1 (`check` measures pins against the enclosing or a declared local repository:
// `pin-stale`, a warning; a remote-origin pin `pin-unmeasured`, info;
// `stale-source-cited` kept, propagated over graph.json's edges) and §9.5
// (`read` and `search` carry the result as a page's `status`).
//
// Ported from the old measurement (freshness.ts): "." measures the repository
// enclosing the bundle; a pin not on the history of captured HEAD
// (`pin-unknown`, the old `pin-unknown-to-origin`); the covering diff between
// the pin and HEAD over the pin's `covers`, read with `:(top)` so the paths
// are repository-root-relative wherever the bundle sits (`pin-stale`, the old
// `stale-capture`); the page's citations inside each pin's actual blob/tree
// covers held to that pin (`citation-unresolved`), with outside spans counted
// as unverified; and one hop
// of propagation into every page whose edge, of any kind but `tagged`, names
// a stale page. Changed: a pin is found by its shape — a top-level property
// whose schema is the engine `$def` `pin` — and its three parts are one
// value; a pin nothing measures is an info finding (`pin-unmeasured`, reason
// `remote-origin`, `no-repository` or `no-head`, or `shallow` for a commit a
// shallow clone's history does not reach, which is absent there rather than
// unknown), the old `origin-unreachable` dropped with remote freshness; `--fast-forward` and
// the uncommitted `generated/freshness.json` report are not ported.
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  codeUnitCompare,
  type LawType,
  PAGE_LOCATION,
  pathRefusal,
  type StateRead,
  type TypeLawGraphEdge,
  type Unrouted,
} from "@wikiwright/core";
import { type CitationCover, citationsIn } from "./citations.ts";
import {
  GitInconsistentRead,
  gitBlobLineCount,
  gitDiffNames,
  gitHasHead,
  gitHead,
  gitIsAncestor,
  gitIsShallow,
  gitObjectType,
  gitRefHead,
  gitRevListCount,
  gitTopLevel,
  gitTreeEntries,
} from "./git.ts";

/** The implicit origin: the repository the bundle sits in. */
export const LOCAL_ORIGIN = ".";

const COMMIT = /^[0-9a-f]{7,64}$/u;

export type PinState = "current" | "unchanged" | "stale" | "unknown" | "unmeasured";
export type UnmeasuredReason =
  | "remote-origin"
  | "no-repository"
  | "no-head"
  | "shallow"
  | "duplicate-root"
  | "not-root";

export interface UnresolvedCitation {
  path: string;
  line: number | null;
  reason: "missing" | "past-end" | "unattached" | "ambiguous" | "malformed";
}

export interface PinEntry {
  path: string;
  field: string;
  commit: string;
  resolved_commit?: string;
  origin: string;
  /** Full immutable HEAD observed for this origin, null when unavailable. */
  head: string | null;
  state: PinState;
  /** With `unmeasured`: why nothing measured it. */
  reason?: UnmeasuredReason | "coverage-invalid";
  behind: number | null;
  covering_touched: string[] | null;
  coverage_invalid?: string[];
  citations: { checked: number; outside_scope: number; unresolved: UnresolvedCitation[] } | null;
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
  /** A shallow clone: a pin its history does not reach is not measured. */
  shallow: boolean;
  reason?: UnmeasuredReason;
  binding: string;
}

async function repositoryAt(root: string, path: string): Promise<Repository> {
  let real: string;
  try {
    if (!statSync(path).isDirectory())
      return { dir: null, head: null, shallow: false, reason: "no-repository", binding: path };
    real = realpathSync(path);
  } catch {
    return { dir: null, head: null, shallow: false, reason: "no-repository", binding: path };
  }
  const top = await gitTopLevel(real);
  if (top === undefined) {
    return { dir: null, head: null, shallow: false, reason: "no-repository", binding: path };
  }
  const dir = realpathSync(top);
  if (root !== path && real !== dir)
    return { dir: null, head: null, shallow: false, reason: "not-root", binding: path };
  if (!(await gitHasHead(dir))) {
    return { dir, head: null, shallow: false, reason: "no-head", binding: path };
  }
  return { dir, head: await gitHead(dir), shallow: await gitIsShallow(dir), binding: path };
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
  "remote-origin": "names no declared local origin; URL origins are never fetched",
  "no-repository": "names a local directory with no readable Git repository",
  "no-head": "names a local Git repository with no commit to measure against",
  shallow: "names a shallow local clone whose history does not reach the commit",
  "duplicate-root": "names a local repository bound by more than one origin name",
  "not-root": "names a directory inside a repository rather than its root",
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
  localOrigins: readonly { name: string; path: string }[] = [],
  only?: ReadonlySet<string>,
): Promise<PinMeasurement> {
  for (const attempt of [1, 2]) {
    const observed = await measurePinsOnce(root, read, edges, localOrigins, only);
    let moved = false;
    for (const [origin, prior] of observed.repositories) {
      const now = await repositoryAt(root, prior.binding);
      if (
        prior.dir !== now.dir ||
        prior.head !== now.head ||
        prior.shallow !== now.shallow ||
        prior.reason !== now.reason
      ) {
        moved = true;
        break;
      }
      if (origin !== LOCAL_ORIGIN && prior.dir !== null) {
        try {
          if (realpathSync(prior.binding) !== prior.dir) moved = true;
        } catch {
          moved = true;
        }
      }
    }
    const localTop = localOrigins.length > 0 ? await gitTopLevel(root) : undefined;
    if (
      (localTop === undefined ? null : realpathSync(localTop)) !==
      observed.bindings.get(LOCAL_ORIGIN)
    )
      moved = true;
    for (const origin of localOrigins) {
      const path = resolve(realpathSync(root), origin.path);
      let canonical: string | null;
      try {
        canonical = realpathSync(path);
      } catch {
        canonical = null;
      }
      if (canonical !== observed.bindings.get(origin.name)) moved = true;
    }
    if (!moved) return observed.measurement;
    if (attempt === 2)
      throw new GitInconsistentRead(
        ["rev-parse HEAD", "rev-parse HEAD"],
        "a declared origin's path or HEAD moved during measurement twice",
      );
  }
  throw new Error("unreachable origin measurement state");
}

async function measurePinsOnce(
  root: string,
  read: StateRead,
  edges: readonly TypeLawGraphEdge[],
  localOrigins: readonly { name: string; path: string }[],
  only?: ReadonlySet<string>,
): Promise<{
  measurement: PinMeasurement;
  repositories: Map<string, Repository>;
  bindings: Map<string, string | null>;
}> {
  const pinned = pinnedPages(read, only);
  const entries: PinEntry[] = [];
  const findings: Unrouted[] = [];
  const stale = new Set<string>();
  const repositories = new Map<string, Repository>();
  const declared = new Map(localOrigins.map((origin) => [origin.name, origin.path] as const));
  for (const pin of pinned) {
    if (repositories.has(pin.origin)) continue;
    const path = pin.origin === LOCAL_ORIGIN ? root : declared.get(pin.origin);
    if (path === undefined) continue;
    repositories.set(
      pin.origin,
      await repositoryAt(
        root,
        pin.origin === LOCAL_ORIGIN ? root : resolve(realpathSync(root), path),
      ),
    );
  }
  const byDir = new Map<string, string[]>();
  const bindings = new Map<string, string | null>();
  const localTop = localOrigins.length > 0 ? await gitTopLevel(root) : undefined;
  bindings.set(LOCAL_ORIGIN, localTop === undefined ? null : realpathSync(localTop));
  if (localTop !== undefined) byDir.set(realpathSync(localTop), [LOCAL_ORIGIN]);
  for (const origin of localOrigins) {
    const path = resolve(realpathSync(root), origin.path);
    let canonical: string;
    try {
      canonical = realpathSync(path);
    } catch {
      bindings.set(origin.name, null);
      continue;
    }
    bindings.set(origin.name, canonical);
    const names = byDir.get(canonical) ?? [];
    names.push(origin.name);
    byDir.set(canonical, names);
  }
  const duplicate = new Set<string>();
  for (const names of byDir.values()) {
    if (names.length < 2) continue;
    for (const name of names) duplicate.add(name);
  }
  for (const pin of pinned) {
    const entry: PinEntry = {
      path: pin.path,
      field: pin.field,
      commit: pin.commit,
      origin: pin.origin,
      head: repositories.get(pin.origin)?.head ?? null,
      state: "unmeasured",
      behind: null,
      covering_touched: null,
      citations: null,
    };
    entries.push(entry);
    const at = { field: pin.field, commit: pin.commit, origin: pin.origin };
    const repository = repositories.get(pin.origin);
    const reason: UnmeasuredReason | undefined =
      (duplicate.has(pin.origin) ? "duplicate-root" : repository?.reason) ??
      (repository === undefined ? "remote-origin" : undefined);
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
    const pinCommit = await gitRefHead(dir, `${pin.commit}^{commit}`);
    const known = pinCommit !== null && (await gitIsAncestor(dir, pinCommit, head));
    if (!known && repository?.shallow === true) {
      entry.reason = "shallow";
      findings.push({
        rule: "pin-unmeasured",
        severity: "info",
        path: pin.path,
        location: PAGE_LOCATION,
        message: `the pin in ${pin.field} ${REASON_TEXT.shallow}; it is not measured`,
        details: { ...at, reason: "shallow" },
      });
      continue;
    }
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
    const commit = pinCommit as string;
    entry.resolved_commit = commit;
    const invalid: string[] = [];
    const validCovers: CitationCover[] = [];
    for (const cover of pin.covers) {
      const path = cover.endsWith("/") ? cover.slice(0, -1) : cover;
      if (cover !== "." && (pathRefusal(path) !== undefined || path.startsWith(":"))) {
        invalid.push(cover);
        continue;
      }
      if (cover === ".") {
        validCovers.push({ path: ".", kind: "tree" });
        continue;
      }
      const kind = await gitObjectType(dir, `${commit}:${path}`);
      if ((kind !== "blob" && kind !== "tree") || (cover.endsWith("/") && kind !== "tree"))
        invalid.push(cover);
      else validCovers.push({ path, kind });
    }
    if (pin.covers.length === 0) invalid.push("<empty>");
    if (invalid.length > 0) {
      entry.state = "unknown";
      entry.reason = "coverage-invalid";
      entry.coverage_invalid = invalid;
      findings.push({
        rule: "pin-coverage-invalid",
        severity: "warning",
        path: pin.path,
        location: PAGE_LOCATION,
        message: `the pin in ${pin.field} covers a path absent or unsafe at ${pin.commit.slice(0, 12)}: ${invalid.join(", ")}`,
        details: { ...at, invalid },
      });
      continue;
    }
    const behind = await gitRevListCount(dir, commit, head);
    const touched = await gitDiffNames(dir, commit, head, pin.covers, true);
    entry.behind = behind;
    entry.covering_touched = touched;
    const topLevel = new Set(await gitTreeEntries(dir, commit));
    const scan = citationsIn(pin.text, topLevel, [
      ...new Map(validCovers.map((cover) => [cover.path, cover])).values(),
    ]);
    const unresolved: UnresolvedCitation[] = [
      ...(await unresolvedCitations(dir, commit, scan.citations)),
      ...scan.problems.map((p) => ({ path: p.token, line: null, reason: p.reason })),
    ];
    entry.citations = {
      checked: scan.citations.length,
      outside_scope: scan.outside_scope,
      unresolved,
    };
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
    const current = head === commit;
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
  return {
    measurement: { entries, counts: countOf(entries), findings, stale, citing },
    repositories,
    bindings,
  };
}
