// docs/constitution.md §Types (vault-wide identity) · docs/concepts.md §Generated artifacts
// (nodes: pages + tags only; edges wikilink/tagged/supersedes; deterministic)
//  (alias-targeted wikilinks are a lint
// error; canonical-name links only) · docs/concepts.md · byte stability.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateArtifacts } from "../src/generate/index.ts";
import { lintPage } from "../src/lint/index.ts";
import { buildNameIndex, checkVaultIdentity } from "../src/names/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { constitutionOf } from "./helpers/constitution.ts";

function registry() {
  return constitutionOf({
    tags: {
      reset: { description: "Reset behavior." },
      "test-execution": { description: "Running tests." },
    },
    types: {
      "test-case": { extends: "procedure", description: "One executable validation case." },
    },
  });
}

function page(path: string, content: string) {
  return { path, doc: parseDoc(content) };
}

const ZHANGWEI = page(
  "wiki/张伟.md",
  '---\ntype: concept\ntitle: 张伟\ndescription: A person.\naliases: ["Zhang Wei"]\ntags: []\n---\n\n# 张伟\n\nSee [[warm-reset]].\n',
);
const WARM = page(
  "wiki/test-execution/warm-reset.md",
  "---\ntype: test-case\ntitle: Warm reset\ndescription: A case.\ntags: [reset, test-execution]\n---\n\n# Warm reset\n\nLinks: [[张伟]] and [[Zhang Wei|him]] and [[Nowhere]].\n",
);

describe("buildNameIndex — vault-wide identity", () => {
  it("resolves basenames and aliases through normalizeIdentity", () => {
    const index = buildNameIndex([ZHANGWEI, WARM]);
    assert.equal(index.resolve("张伟")?.path, "wiki/张伟.md");
    assert.equal(index.resolve("warm-RESET")?.path, "wiki/test-execution/warm-reset.md");
    const viaAlias = index.resolve("zhang wei");
    assert.equal(viaAlias?.path, "wiki/张伟.md");
    assert.equal(viaAlias?.viaAlias, true);
    assert.equal(index.resolve("nowhere"), undefined);
  });
});

describe("checkVaultIdentity — collisions are hard errors", () => {
  it("rejects duplicate basenames across folders, case-insensitively", () => {
    const dup = page(
      "raw/Warm-Reset.md",
      "---\ntype: concept\ntitle: Other\ndescription: x.\ntags: []\n---\n\n# Other\n",
    );
    const findings = checkVaultIdentity([WARM, dup]);
    const f = findings.find((x) => x.ruleId === "identity-collision");
    assert.notEqual(f, undefined);
    assert.equal(f?.severity, "error");
  });

  it("rejects an alias colliding with another page's basename", () => {
    const clash = page(
      "wiki/other.md",
      '---\ntype: concept\ntitle: Other\ndescription: x.\naliases: ["Warm-Reset"]\ntags: []\n---\n\n# Other\n',
    );
    const findings = checkVaultIdentity([WARM, clash]);
    assert.equal(
      findings.some((x) => x.ruleId === "identity-collision"),
      true,
    );
  });

  it("passes distinct pages including NFC-distinct CJK", () => {
    assert.deepEqual(checkVaultIdentity([ZHANGWEI, WARM]), []);
  });
});

describe("wikilink lint with a name index", () => {
  it("errors on alias-targeted wikilinks and warns on unresolved ones", () => {
    const findings = lintPage(
      { path: WARM.path, doc: WARM.doc, registry: registry() },
      {
        names: buildNameIndex([ZHANGWEI, WARM]),
      },
    );
    const aliasHit = findings.find((f) => f.ruleId === "wikilink-alias-target");
    assert.equal(aliasHit?.severity, "error");
    assert.equal(aliasHit?.message.includes("Zhang Wei"), true);
    assert.equal(aliasHit?.message.includes("张伟"), true); // remediation names the canonical
    const unresolved = findings.find((f) => f.ruleId === "wikilink-unresolved");
    assert.equal(unresolved?.severity, "warning");
    assert.equal(
      findings.some((f) => f.ruleId === "wikilink-alias-target" && f.message.includes("张伟")),
      true,
    );
  });

  it("accepts canonical-basename links without findings", () => {
    const findings = lintPage(
      { path: ZHANGWEI.path, doc: ZHANGWEI.doc, registry: registry() },
      { names: buildNameIndex([ZHANGWEI, WARM]) },
    );
    assert.equal(
      findings.some((f) => f.ruleId.startsWith("wikilink-")),
      false,
    );
  });
});

describe("graph.json (docs/concepts.md §Generated artifacts)", () => {
  it("emits page and tag nodes, tagged and resolved wikilink edges, sorted", () => {
    const plans = generateArtifacts(registry(), [ZHANGWEI, WARM], buildNameIndex([ZHANGWEI, WARM]));
    const graphPlan = plans.find((p) => p.path === "generated/graph.json");
    assert.notEqual(graphPlan, undefined);
    const graph = JSON.parse(graphPlan?.content ?? "{}") as {
      nodes: Array<{ id: string; kind: string }>;
      edges: Array<{ from: string; to: string; kind: string }>;
    };
    assert.equal(
      graph.nodes.some((n) => n.id === "wiki/张伟.md" && n.kind === "page"),
      true,
    );
    assert.equal(
      graph.nodes.some((n) => n.id === "tag:reset" && n.kind === "tag"),
      true,
    );
    assert.equal(
      graph.nodes.some((n) => n.id.startsWith("wiki/") === false && n.kind === "page"),
      false,
    );
    assert.equal(
      graph.edges.some(
        (e) => e.kind === "tagged" && e.from.endsWith("warm-reset.md") && e.to === "tag:reset",
      ),
      true,
    );
    // Both the canonical link and the alias-targeted link resolve to the same page node.
    const wikilinks = graph.edges.filter(
      (e) => e.kind === "wikilink" && e.from.endsWith("warm-reset.md"),
    );
    assert.deepEqual(
      wikilinks.map((e) => e.to),
      ["wiki/张伟.md"],
    );
    const ids = graph.nodes.map((n) => n.id);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });

  it("emits supersedes edges from lifecycle pointers", () => {
    const oldPage = page(
      "wiki/old-model.md",
      "---\ntype: concept\ntitle: Old model\ndescription: x.\ntags: []\nstatus: retired\nsuperseded_by: new-model\n---\n\n# Old model\n",
    );
    const newPage = page(
      "wiki/new-model.md",
      "---\ntype: concept\ntitle: New model\ndescription: x.\ntags: []\n---\n\n# New model\n",
    );
    const plans = generateArtifacts(
      registry(),
      [oldPage, newPage],
      buildNameIndex([oldPage, newPage]),
    );
    const graph = JSON.parse(
      plans.find((p) => p.path === "generated/graph.json")?.content ?? "{}",
    ) as {
      edges: Array<{ from: string; to: string; kind: string }>;
    };
    assert.equal(
      graph.edges.some(
        (e) =>
          e.kind === "supersedes" && e.from === "wiki/new-model.md" && e.to === "wiki/old-model.md",
      ),
      true,
    );
  });
});

describe("body wikilinks to source pages are citations (docs/concepts.md §Generated artifacts)", () => {
  it("a wikilink resolving under a source root emits a cites edge", () => {
    const reg = registry();
    const pages = [
      {
        path: "wiki/notes.md",
        doc: parseDoc(
          "---\ntype: concept\ntitle: Notes\ndescription: d.\ntags: []\n---\n\n# Notes\n\nSee [[capture-x]].\n",
        ),
      },
      {
        path: "raw/capture-x.md",
        doc: parseDoc(
          "---\ntype: reference\ntitle: capture-x\ndescription: c.\ntags: []\n---\n\n# c\n",
        ),
      },
    ];
    const plans = generateArtifacts(reg, pages, buildNameIndex(pages), {
      sourceRoots: ["raw"],
    });
    const graph = JSON.parse(
      plans.find((p) => p.path === "generated/graph.json")?.content ?? "{}",
    ) as { edges: Array<Record<string, unknown>> };
    assert.equal(
      graph.edges.some((e) => e["kind"] === "cites" && e["to"] === "raw/capture-x.md"),
      true,
      "a body link to evidence is a citation, not a plain wikilink",
    );
    assert.equal(
      graph.edges.some((e) => e["kind"] === "wikilink" && e["to"] === "raw/capture-x.md"),
      false,
      "not double-counted",
    );
  });
});
