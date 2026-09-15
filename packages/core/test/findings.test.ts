// docs/concepts.md §Findings and routing (envelope v2: layer as audience, breadcrumb from matched
// headings, hint from registry prose, registryPath, evidenceDigest on
// judgment-class findings) (the evidence
// key a queued finding carries).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintPage } from "../src/lint/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { constitutionOf } from "./helpers/constitution.ts";

const REGISTRY = constitutionOf({
  types: {
    runbook: {
      extends: "procedure",
      description: "A runbook: one operational procedure.",
      avoid_when: "Narrative debugging — use an investigation page.",
      sections: {
        ordered: true,
        list: [
          { heading: "Purpose", min: 1 },
          { heading: "Steps", min: 1 },
          { heading: "Timeline", max: 0 },
        ],
      },
    },
    log: {
      extends: "reference",
      description: "An append-only log.",
      body: { lifecycle: "append-only" },
    },
  },
});

function lintBody(body: string) {
  const doc = parseDoc(`---\ntype: runbook\ntitle: T\ndescription: d.\ntags: []\n---\n\n${body}`);
  return lintPage({ path: "wiki/t.md", doc, registry: REGISTRY });
}

describe("findings envelope v2 (docs/concepts.md §Findings and routing)", () => {
  it("every finding carries a layer; engine and type rules are constitution law", () => {
    const findings = lintBody("# T\n\n## Steps\ns\n");
    assert.equal(findings.length > 0, true);
    for (const f of findings) {
      assert.equal(["okf-core", "constitution", "editorial"].includes(f.layer), true);
    }
    const sections = findings.find((f) => f.ruleId === "sections");
    assert.equal(sections?.layer, "constitution");
  });

  it("a section finding carries a hint from the contributing type's own prose and a registryPath", () => {
    const findings = lintBody("# T\n\n## Purpose\np\n\n## Steps\ns\n\n## Timeline\nx\n");
    const f = findings.find((x) => x.ruleId === "sections" && x.message.includes("Timeline"));
    assert.notEqual(f, undefined, JSON.stringify(findings.map((x) => x.ruleId)));
    assert.match(f?.hint ?? "", /investigation/);
    assert.match(f?.registryPath ?? "", /^\/types\/runbook\/sections\//);
  });

  it("a finding with a line inside a section carries a breadcrumb from the matched heading", () => {
    const findings = lintBody("# T\n\n## Purpose\np\n\n## Steps\ns\n\n## Timeline\nx\n");
    const f = findings.find((x) => x.ruleId === "sections" && x.message.includes("Timeline"));
    assert.equal(f?.breadcrumb, "Timeline");
  });

  it("a transition arm carries its own evidenceDigest; a state arm gets the judge's", () => {
    // The digest a state arm's finding carries is filled ONCE, by the judge, for
    // every queue-routed finding — so `lintPage` alone shows none, and computing
    // a second one here would change the key every exception is written
    // against. A transition arm computes its own, because its identity is the
    // item that moved rather than the page and the rule.
    const state = lintBody("# T\n\n## Purpose\np\n\n## Steps\ns\n\n## Timeline\nx\n");
    assert.equal(state.find((x) => x.ruleId === "sections")?.evidenceDigest, undefined);

    const body = "---\ntype: log\ntitle: T\ndescription: d.\ntags: []\n---\n\n- 2026-01-01 one\n";
    const mutated = lintPage(
      { path: "wiki/log.md", doc: parseDoc(body.replace("one", "two")), registry: REGISTRY },
      { baseText: body },
    ).find((f) => f.ruleId === "body-append-only");
    assert.notEqual(mutated, undefined);
    assert.equal(typeof mutated?.evidenceDigest, "string");
  });
});
