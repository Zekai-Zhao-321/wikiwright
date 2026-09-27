// v2 contracts §9.5, §9.6: a page's status, carried by `read` and by each
// `search` result, so material due for reconsideration is not reused blind —
// the first delivery's "expose invalidation to the consumer".
//
//   stale       true for a stale own pin or one-hop linked source; null for
//               missing/unmeasured source paths, invalid covers or citations,
//               unknown/unmeasured own pins, or a directly linked source
//               with any unverified status. False means none of these applies.
//               Git measurement uses captured HEADs of local repositories.
//   reason      why `stale` is true or null; null when it is false.
//   unresolved  the rule ids queue.md holds for the page, when the law and
//               content digests queue.md records are the current ones; null
//               otherwise, with `unresolved_reason` `queue-stale` (the digests
//               differ) or `queue-missing` (no queue.md, or not one).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  codeUnitCompare,
  type JudgeState,
  lawDigest,
  parseTypeLawQueue,
  QUEUE_PATH,
  type StateRead,
  sourcePathFindings,
  type TypeLaw,
  typeLawGraph,
} from "@wikiwright/core";
import { ENGINE_VERSION } from "./envelope.ts";
import { measurePins, pinFields } from "./pins.ts";
import { stateContentDigest } from "./typelaw.ts";

export interface PageStatus {
  stale: boolean | null;
  reason: string | null;
  unresolved: string[] | null;
  unresolved_reason: "queue-stale" | "queue-missing" | null;
  /** Full immutable HEAD ids observed for the pins relevant to this status. */
  observations?: { origin: string; head: string | null }[];
}

/** queue.md's rows by page, when its digests are the state's; else why not. */
function queueRows(
  root: string,
  state: JudgeState,
  law: TypeLaw,
): Map<string, string[]> | "queue-stale" | "queue-missing" {
  let text: string;
  try {
    text = readFileSync(join(root, QUEUE_PATH), "utf8");
  } catch {
    return "queue-missing";
  }
  const queue = parseTypeLawQueue(text);
  if (queue === undefined) return "queue-missing";
  if (
    queue.digests.law !== lawDigest(law, ENGINE_VERSION) ||
    queue.digests.content !== stateContentDigest(state)
  )
    return "queue-stale";
  const out = new Map<string, string[]>();
  for (const row of queue.rows) {
    const rules = out.get(row.path) ?? [];
    if (!rules.includes(row.rule)) rules.push(row.rule);
    out.set(row.path, rules);
  }
  return out;
}

/**
 * The status of each page `paths` names: its pins and the pins of the pages
 * it links measured, queue.md read once. The git work is per page returned
 * and per page it links, and nothing else.
 */
export async function pageStatuses(
  root: string,
  state: JudgeState,
  law: TypeLaw,
  read: StateRead,
  paths: readonly string[],
): Promise<Map<string, PageStatus>> {
  const wanted = new Set(paths);
  const links = new Map<string, Set<string>>();
  for (const edge of typeLawGraph(law, read).edges) {
    if (edge.kind === "tagged" || !wanted.has(edge.from) || edge.from === edge.to) continue;
    const set = links.get(edge.from) ?? new Set<string>();
    set.add(edge.to);
    links.set(edge.from, set);
  }
  const measured = new Set(wanted);
  for (const targets of links.values()) for (const t of targets) measured.add(t);
  const pins = await measurePins(root, read, [], law.engine.local_origins, measured);
  const queue = queueRows(root, state, law);
  const out = new Map<string, PageStatus>();
  const ownStatus = new Map<string, { stale: boolean | null; reason: string | null }>();
  for (const page of read.pages) {
    if (!measured.has(page.path)) continue;
    const own = pins.entries.filter((entry) => entry.path === page.path);
    const parsed = page.read.ok ? page.read.page : null;
    const invalidPin =
      parsed?.type !== undefined &&
      parsed !== null &&
      pinFields(parsed.type).some(
        (field) =>
          Object.hasOwn(parsed.frontmatter, field) && !own.some((entry) => entry.field === field),
      );
    const source = page.read.ok ? sourcePathFindings(page.read.page, state.sources)[0] : undefined;
    const unresolved = own.find((entry) => (entry.citations?.unresolved.length ?? 0) > 0);
    const unmeasured = own.find((entry) => entry.state === "unmeasured");
    const unknown = own.find((entry) => entry.state === "unknown");
    ownStatus.set(
      page.path,
      own.some((entry) => entry.state === "stale")
        ? { stale: true, reason: "pin-stale" }
        : source !== undefined
          ? { stale: null, reason: source.rule }
          : invalidPin
            ? { stale: null, reason: "pin-invalid" }
            : unresolved !== undefined
              ? { stale: null, reason: "citation-unresolved" }
              : unmeasured !== undefined
                ? { stale: null, reason: unmeasured.reason ?? "pin-unmeasured" }
                : unknown !== undefined
                  ? { stale: null, reason: unknown.reason ?? "pin-unknown" }
                  : { stale: false, reason: null },
    );
  }
  for (const path of paths) {
    const own = ownStatus.get(path) ?? { stale: false, reason: null };
    const cited = [...(links.get(path) ?? [])].sort(codeUnitCompare);
    const staleLink = cited.find((target) => ownStatus.get(target)?.stale === true);
    const unverifiedLink = cited.find((target) => ownStatus.get(target)?.stale === null);
    const stale: boolean | null =
      own.stale === true || staleLink !== undefined
        ? true
        : own.stale === null || unverifiedLink !== undefined
          ? null
          : false;
    const reason =
      own.stale === true
        ? own.reason
        : staleLink !== undefined
          ? "stale-source-cited"
          : own.stale === null
            ? own.reason
            : unverifiedLink !== undefined
              ? "source-unverified-cited"
              : null;
    const observations = new Map<string, string | null>();
    for (const entry of pins.entries) {
      if (entry.path === path || cited.includes(entry.path))
        observations.set(entry.origin, entry.head);
    }
    out.set(path, {
      stale,
      reason,
      unresolved:
        typeof queue === "string" ? null : [...(queue.get(path) ?? [])].sort(codeUnitCompare),
      unresolved_reason: typeof queue === "string" ? queue : null,
      ...(observations.size === 0
        ? {}
        : {
            observations: [...observations]
              .sort(([a], [b]) => codeUnitCompare(a, b))
              .map(([origin, head]) => ({ origin, head })),
          }),
    });
  }
  return out;
}
