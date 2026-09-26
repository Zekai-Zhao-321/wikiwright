// docs/architecture.md §The invariants (every shipped fixture's EXACT finding set
// is asserted — both fixtures carry deliberate defects, and a deliberate defect
// nothing checks is indistinguishable from rot) · docs/constitution.md §Sections (the planted
// `### Timeline` is `section-depth`'s first measurement: 1 firing across 40
// pages).

import { afterAll, describe, expect, it } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusCopy, REPO, removeCopies } from "./fixtures/corpora.ts";
import { cli, type Envelope, git } from "./fixtures/garden-cli.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

interface Finding {
  ruleId: string;
  severity: string;
  path: string;
}

interface Verdict {
  status: number;
  findings: Finding[];
  summary: Record<string, unknown>;
}

function lint(fixture: string, verb: "lint" | "check" = "lint"): Verdict {
  const r = runCli([CLI, verb, "--all", "--root", `${FIXTURES}${fixture}`], {
    encoding: "utf8",
  });
  const envelope = JSON.parse(r.stdout) as {
    data?: { findings?: Finding[]; summary?: Record<string, unknown> };
  };
  return {
    status: r.status ?? -1,
    findings: envelope.data?.findings ?? [],
    summary: envelope.data?.summary ?? {},
  };
}

describe("the shipped fixtures lint to the verdict the spec records (docs/architecture.md §The invariants)", () => {
  it("memory-synth: 41 pages, one planted section-depth, and the grammar census", () => {
    const v = lint("memory-synth");
    // One synthetic review page was added, so `body-append-only` has a corpus
    // rather than only a test — the arm's declaring type had zero pages before.
    assert.equal(v.summary["pages"], 41, "the fixture is 41 pages");
    assert.deepEqual(
      v.findings.filter((f) => f.severity === "error").map((f) => [f.ruleId, f.path]),
      [["section-depth", "wiki/Craft/Isle Cadence.md"]],
      "docs/constitution.md §Sections' first measurement: one `### Timeline` nested under `## Notes`",
    );
    // docs/concepts.md §Section grammar, the fixture's registry declares the memory genre's
    // grammars in report mode, so its verdict IS the dialect census. Every
    // number here is the fixture's own census, reproduced by the engine's parser
    // rather than by a script:
    //   hearsay 3 = the `stated by` bucket · marker-like 4 = the
    //   keyword-opened-but-not-complete bucket · provenance-weak 71 = the
    //   shorthand `inferred` refs (the fixture plants no legacy/recorded)
    //   journal-only-category 4 = journal-only claims standing in Facts
    //   grammar-unparsed 3 = 2 non-[category] Facts bullets + the 1 of 122
    //   off-grammar Relations lines · unknown-category 0 (29 declared, 22 used,
    //   0 undeclared) · relation-target-unresolved 0 (every target canonical)
    //   sourced-inferred 18 = claims whose trailing parenthetical was eaten by
    //   the ISO-date arm alone, the fixture declaring no `sources`.
    //   That row makes a defect visible: 18 of 339 fixture claims had their
    //   identity set by a punctuation habit with no census row, against 4
    //   `marker-like` — the uncertain population was under-reported more than
    //   fourfold.
    assert.deepEqual(v.summary["by_rule"], {
      // The dialect census — 45 lines whose marker or separator is the
      // corpus's rather than the engine's. `info`, and the only row whose fixer
      // rewrites a dialect, which is why it is opt-in by rule.
      "canonical-form": 45,
      "grammar-unparsed": 3,
      hearsay: 3,
      "journal-only-category": 4,
      "marker-like": 4,
      "provenance-weak": 71,
      "section-depth": 1,
      "sourced-inferred": 18,
    });
    assert.equal(v.summary["errors"], 1, "report mode's promise: the error delta is 0");
    assert.equal(v.summary["warnings"], 7);
    assert.equal(v.summary["infos"], 141, "96 + the 45 canonical-form census rows");
    assert.equal(v.status, 5, "a page finding exits 5 (docs/cli.md §The envelope)");
  });

  // docs/cli.md §bundles: the two handbooks the connection tests read, each one
  // type with a required climate and the same page under the same title. They
  // carry no defect, so a finding of any severity is rot; `check` holds their
  // tracked generated/ too.
  for (const handbook of ["handbooks/orchard", "handbooks/allotment"]) {
    it(`${handbook}: three pages and no finding of any severity, under lint and check`, () => {
      for (const verb of ["lint", "check"] as const) {
        const v = lint(handbook, verb);
        assert.equal(v.summary["pages"], 3, verb);
        assert.deepEqual(v.findings, [], `${handbook} under ${verb}`);
        assert.equal(v.status, 0, verb);
      }
    });
  }
});

// v2 contracts §12 step 5: the corpora migrated onto the v2 law, judged by
// the v2 `check` where they stand and by the v2 `gate` over a copy whose
// every file is staged. A corpus's verdict is the exact set of its
// deliberate defects; `unevaluated` (info, no route) is the transition
// rules a working tree cannot evaluate.

afterAll(removeCopies);

type Row = [rule: string, severity: string, path: string];

function rows(envelope: Envelope, severities: readonly string[]): Row[] {
  return (envelope.data?.findings ?? [])
    .filter((f) => severities.includes(f.severity))
    .map((f): Row => [f.rule, f.severity, f.path])
    .sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
}

interface Expected {
  pages: number;
  /** Every error and warning finding, sorted. */
  findings: Row[];
  /** Every rule `unevaluated` names, and how many pages it names it on. */
  unevaluated: Record<string, number>;
}

const V2_VERDICTS: Record<string, Expected> = {
  // The one broken case keeps its three defects under the v2 names: an
  // undeclared key, a missing section, a tag the vocabulary does not hold.
  "fixtures/minimal-vault": {
    pages: 3,
    findings: [
      ["page-shape-invalid", "error", "wiki/test-execution/broken-case.md"],
      ["section-count", "error", "wiki/test-execution/broken-case.md"],
      ["vocabulary-unknown", "error", "wiki/test-execution/broken-case.md"],
    ],
    unevaluated: { "body-append-only": 3 },
  },
};

describe("the corpora on the v2 law judge to the verdict recorded here (contracts §12 step 5)", () => {
  for (const [corpus, expected] of Object.entries(V2_VERDICTS)) {
    it(`${corpus}: check --all where it stands`, () => {
      const r = cli(["check", "--all"], join(REPO, corpus));
      expect(r.envelope.data?.summary).toMatchObject({ pages: expected.pages });
      expect(rows(r.envelope, ["error", "warning"])).toEqual(expected.findings);
      const unevaluated = r.envelope.data?.["unevaluated"] as Record<string, { count: number }>;
      expect(
        Object.fromEntries(Object.entries(unevaluated).map(([rule, u]) => [rule, u.count])),
      ).toEqual(expected.unevaluated);
      const errors = expected.findings.filter(([, severity]) => severity === "error").length;
      expect(r.status).toBe(errors > 0 ? 5 : 0);
    });

    it(`${corpus}: gate over a copy with every file staged gives the same errors`, () => {
      const { root, top } = corpusCopy(corpus);
      git(top, "add", "-A");
      const r = cli(["gate"], root);
      expect(rows(r.envelope, ["error"])).toEqual(
        expected.findings.filter(([, severity]) => severity === "error"),
      );
      expect(r.status).toBe(expected.findings.some(([, s]) => s === "error") ? 5 : 0);
    });
  }
});
