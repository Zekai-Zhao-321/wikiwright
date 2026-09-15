// docs/architecture.md §The invariants (every shipped fixture's EXACT finding set
// is asserted — both fixtures carry deliberate defects, and a deliberate defect
// nothing checks is indistinguishable from rot) · docs/constitution.md §Sections (the planted
// `### Timeline` is `section-depth`'s first measurement: 1 firing across 40
// pages).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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

function lint(fixture: string): Verdict {
  const r = spawnSync(process.execPath, [CLI, "lint", "--root", `${FIXTURES}${fixture}`], {
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

  it("minimal-vault: the three defects of its one broken case, and no others", () => {
    const v = lint("minimal-vault");
    assert.equal(v.summary["pages"], 3);
    assert.deepEqual(
      v.findings.map((f) => f.ruleId),
      ["sections", "unknown-tag", "unknown-frontmatter-key"],
    );
    for (const finding of v.findings) {
      assert.equal(
        finding.path,
        "wiki/test-execution/broken-case.md",
        "every defect is the deliberate one; the rest of the fixture is clean",
      );
    }
    assert.equal(v.status, 5);
  });
});
