// v2 contracts §9.5, §9.6: a page's status, carried by `read` and by each
// `search` result, so material due for reconsideration is not reused blind —
// the first delivery's "expose invalidation to the consumer".
//
//   stale       true when one of the page's pins is stale (`pin-stale`) or a
//               page it links, by an edge of any kind but `tagged`, carries
//               one (`stale-source-cited`); null when a pin of its own was
//               not measured (`remote-origin`, `no-repository`, `no-head`)
//               or is not on HEAD's history (`pin-unknown`); false otherwise.
//               Measured live against the local repository, as `check`
//               measures every pin (pins.ts).
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
  type TypeLaw,
  typeLawGraph,
} from "@wikiwright/core";
import { ENGINE_VERSION } from "./envelope.ts";
import { measurePins } from "./pins.ts";
import { stateContentDigest } from "./typelaw.ts";

export interface PageStatus {
  stale: boolean | null;
  reason: string | null;
  unresolved: string[] | null;
  unresolved_reason: "queue-stale" | "queue-missing" | null;
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
  const pins = await measurePins(root, read, [], measured);
  const queue = queueRows(root, state, law);
  const out = new Map<string, PageStatus>();
  for (const path of paths) {
    const own = pins.entries.filter((e) => e.path === path);
    const cited = [...(links.get(path) ?? [])].filter((t) => pins.stale.has(t));
    let stale: boolean | null = false;
    let reason: string | null = null;
    if (own.some((e) => e.state === "stale")) [stale, reason] = [true, "pin-stale"];
    else if (cited.length > 0) [stale, reason] = [true, "stale-source-cited"];
    else {
      const unmeasured = own.find((e) => e.state === "unmeasured");
      const unknown = own.find((e) => e.state === "unknown");
      if (unmeasured !== undefined) [stale, reason] = [null, unmeasured.reason ?? "no-head"];
      else if (unknown !== undefined) [stale, reason] = [null, "pin-unknown"];
    }
    out.set(path, {
      stale,
      reason,
      unresolved:
        typeof queue === "string" ? null : [...(queue.get(path) ?? [])].sort(codeUnitCompare),
      unresolved_reason: typeof queue === "string" ? queue : null,
    });
  }
  return out;
}
