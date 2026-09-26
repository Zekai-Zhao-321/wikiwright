// docs/concepts.md §Findings and routing (a pass that produced a finding on this run
// did apply; reporting it as `not_applicable` beside its own findings is the
// incoherence the block exists to prevent) · docs/architecture.md §The invariants
//
// "Did not run here" and "found nothing" are two claims and the coverage block
// keeps them apart. Nothing checked the block against the findings sitting
// beside it, and `canonical-form` spent its whole life reporting
// `evaluated: 0, not_applicable: 41` on a corpus where it fired 45 times.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { REPO, V2_CORPORA } from "./fixtures/corpora.ts";
import { cli } from "./fixtures/garden-cli.ts";

describe("the coverage block agrees with the findings beside it (docs/concepts.md §Findings and routing)", () => {
  // v2 contracts §12 step 5: the corpora on the v2 law, under the v2
  // `check`, whose coverage is keyed by rule id.
  for (const corpus of V2_CORPORA) {
    it(`${corpus}: no rule reports findings while claiming it never applied (the v2 check)`, () => {
      const data = cli(["check", "--all"], join(REPO, corpus)).envelope.data;
      const coverage = (data?.["coverage"] ?? {}) as Record<
        string,
        { evaluated: number; not_applicable: number; unevaluated: number }
      >;
      assert.equal(Object.keys(coverage).length > 20, true, "the coverage block was read");
      for (const f of data?.findings ?? []) {
        const row = coverage[f.rule];
        if (row === undefined || f.rule === "unevaluated") continue;
        assert.equal(
          row.evaluated > 0,
          true,
          `${f.rule} produced a finding on ${corpus} and reports evaluated: ${row.evaluated}`,
        );
      }
    });
  }

  it("the check is non-vacuous: the corpora do produce findings to check against", () => {
    const findings =
      cli(["check", "--all"], join(REPO, "fixtures/memory-synth")).envelope.data?.findings ?? [];
    assert.equal(findings.length > 20, true, `the measurement corpus reports (${findings.length})`);
    const ids = new Set(findings.map((f) => f.rule));
    assert.equal(ids.size > 3, true, `across several rules (${ids.size})`);
  });
});
