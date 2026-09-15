// docs/concepts.md §Findings and routing (a pass that produced a finding on this run
// did apply; reporting it as `not_applicable` beside its own findings is the
// incoherence the block exists to prevent) · docs/architecture.md §The invariants
//
// "Did not run here" and "found nothing" are two claims and the coverage block
// keeps them apart. Nothing checked the block against the findings sitting
// beside it, and `canonical-form` spent its whole life reporting
// `evaluated: 0, not_applicable: 41` on a corpus where it fired 45 times.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

import { grantedCopy, kitEnv } from "./fixtures/kit-code.ts";

/** Every corpus this repository ships, judged under its own constitution. */
const CORPORA = ["fixtures/memory-synth", "devwiki", "fixtures/minimal-vault"];

// devwiki is a bundle over the code kit: judged from an installed, granted copy
// under os.tmpdir(), never from the shipped tree (docs/extending.md §The code kit).
const DEVWIKI_COPY = grantedCopy(join(REPO, "devwiki"), "coverage-devwiki");
after(() => rmSync(DEVWIKI_COPY, { recursive: true, force: true }));

const rootOf = (corpus: string): string =>
  corpus === "devwiki" ? DEVWIKI_COPY : join(REPO, corpus);

interface CoverageRow {
  evaluated: number;
  not_applicable: number;
  unevaluable: number;
  reason?: string;
}

function verdict(corpus: string, verb: string) {
  const r = spawnSync(process.execPath, [CLI, verb, "--root", ".", "--all"], {
    cwd: rootOf(corpus),
    encoding: "utf8",
    env: kitEnv(rootOf(corpus)),
  });
  const envelope = JSON.parse(r.stdout) as {
    data?: {
      findings?: { ruleId: string; path: string }[];
      coverage?: { passes?: Record<string, CoverageRow> };
    };
  };
  return {
    findings: envelope.data?.findings ?? [],
    passes: envelope.data?.coverage?.passes ?? {},
  };
}

describe("the coverage block agrees with the findings beside it (docs/concepts.md §Findings and routing)", () => {
  for (const corpus of CORPORA) {
    for (const verb of ["lint", "check"]) {
      it(`${corpus}: no pass reports findings while claiming it never applied (${verb})`, () => {
        const { findings, passes } = verdict(corpus, verb);
        assert.equal(Object.keys(passes).length > 20, true, "the coverage block was read");

        const fired = new Map<string, number>();
        for (const f of findings) fired.set(f.ruleId, (fired.get(f.ruleId) ?? 0) + 1);

        for (const [ruleId, count] of fired) {
          const row = passes[ruleId];
          // A pass with no row at all is pass-table.test.ts's business.
          if (row === undefined) continue;
          assert.equal(
            row.evaluated > 0,
            true,
            `${ruleId} produced ${count} finding(s) on ${corpus} and reports ` +
              `evaluated: ${row.evaluated}, not_applicable: ${row.not_applicable} — ` +
              `a pass that found something applied`,
          );
        }
      });
    }
  }

  it("the check is non-vacuous: the corpora do produce findings to check against", () => {
    const { findings } = verdict("fixtures/memory-synth", "lint");
    assert.equal(findings.length > 20, true, `the measurement corpus reports (${findings.length})`);
    const ids = new Set(findings.map((f) => f.ruleId));
    assert.equal(ids.size > 3, true, `across several passes (${ids.size})`);
  });
});
