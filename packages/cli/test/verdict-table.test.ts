// v2 contracts §10: the routing and coverage tables carried over by id, per
// docs/v2-dispositions.md. Every v1 rule id the disposition table keeps in the
// kernel is carried by a row of the v2 judge's table, or belongs to a verb
// the fourth step rewrites, named here; no row carries an id the table drops
// or re-expresses as a library rule; and the route is total.
import { describe, expect, it } from "bun:test";
import { unroutableVerdictRows, VERDICT_TABLE } from "@wikiwright/core";
import { RULES } from "../../../tools/dispositions.ts";

/** Kernel ids whose pass is a verb's, not the judge's: they arrive with step 4. */
const VERB_OWNED: Readonly<Record<string, string>> = {
  "generated-drift": "check and gate over generated/*",
  "okf-missing-type": "check",
  "freshness-unavailable": "check's pin measurement",
  "folder-segment-registered": "check's folder-tag fixer",
  "folder-tags-present": "check's folder-tag fixer",
  "former-folder-tags-review": "gate's folder-tag review",
  "stale-capture": "check's pin measurement (pin-stale)",
  "stale-source-cited": "check, over graph.json",
  "citation-unresolved": "check's pin measurement",
  "pin-unknown-to-origin": "check's pin measurement",
  "brief-stale": "check over generated/BRIEF.md",
};

describe("the v2 judge's table, carried over by id", () => {
  const carried = new Set(VERDICT_TABLE.flatMap((row) => row.carries));
  const kernel = RULES.filter(([, disposition]) => disposition === "kernel").map(([id]) => id);

  it("carries every kernel id of v1, or names the verb that will", () => {
    const orphans = kernel.filter((id) => !carried.has(id) && VERB_OWNED[id] === undefined);
    expect(orphans).toEqual([]);
  });

  it("carries only kernel ids, and none a verb owns", () => {
    const stray = [...carried].filter((id) => !kernel.includes(id) || VERB_OWNED[id] !== undefined);
    expect(stray).toEqual([]);
  });

  it("routes every row: a lane on an error or a warning, none on an info", () => {
    expect(unroutableVerdictRows()).toEqual([]);
    const ids = VERDICT_TABLE.map((row) => row.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});
