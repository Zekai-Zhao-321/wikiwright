// docs/concepts.md §Findings and routing (contributedBy provenance) ·
// docs/constitution.md (append-only strict; folder-tags-present and
// folder-segment-registered; identity-normalized and separator-folded segment
// matching; folder_tag_aliases; unknown key errors, x- exempt; field_sources
// derivation satisfies the closure; scalar tags are a loud error; checker
// evidence roots from configuration; tag aliases are real lookup inputs) ·
// docs/architecture.md §The invariants · ordering.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateArtifacts } from "../src/generate/index.ts";
import { lintPage } from "../src/lint/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { constitutionOf } from "./helpers/constitution.ts";

const TAGS = {
  reset: { description: "Reset behavior." },
  cycling: { description: "Repeated execution." },
  "test-execution": { description: "Running tests on rigs." },
  validation: { description: "Retired umbrella.", status: "retired", replaced_by: ["reset"] },
};

const TYPES = {
  "test-case": {
    extends: "procedure",
    description: "One executable validation case.",
    fields: { case_id: { kind: "any", required: true } },
    sections: {
      depth: 2,
      list: [
        { heading: "Purpose", min: 1 },
        { heading: "Execution", min: 1 },
        { heading: "Random notes", max: 0 },
      ],
    },
    body: { lifecycle: "append-only" },
  },
};

function registry() {
  return constitutionOf({ tags: TAGS, types: TYPES });
}

const GOOD_PAGE = `---
type: test-case
title: Warm reset under load
description: Verifies warm reset recovery.
case_id: TC-0042
tags: [reset, test-execution]
x-owner: someone
---

# Warm reset under load

## Purpose

## Execution
`;

function lint(content: string, path = "wiki/test-execution/example.md", base?: string) {
  // The engine has no content-roots default. A caller that walks pages
  // says which roots it walked, or folder alignment has nothing to align to.
  const options: Parameters<typeof lintPage>[1] = { contentRoots: ["wiki", "raw", "meta"] };
  if (base !== undefined) options.baseText = base;
  return lintPage({ path, doc: parseDoc(content), registry: registry() }, options);
}

function codes(findings: ReturnType<typeof lint>): string[] {
  return findings.map((f) => f.ruleId);
}

describe("engine rules — type and frontmatter closure", () => {
  it("passes a conforming page with zero findings", () => {
    assert.deepEqual(lint(GOOD_PAGE), []);
  });

  it("errors on an unknown type", () => {
    const bad = GOOD_PAGE.replace("type: test-case", "type: no-such-type");
    assert.equal(codes(lint(bad)).includes("unknown-type"), true);
  });

  it("errors when type is missing entirely (no frontmatter)", () => {
    const findings = lint("# Bare page\n");
    assert.equal(codes(findings).includes("unknown-type"), true);
  });

  it("errors on a missing required field with field provenance", () => {
    const bad = GOOD_PAGE.replace("case_id: TC-0042\n", "");
    const f = lint(bad).find((x) => x.ruleId === "missing-required-field");
    assert.notEqual(f, undefined);
    assert.equal(f?.message.includes("case_id"), true);
    assert.equal(f?.contributedBy, "test-case");
  });

  it("attributes engine base fields to the engine", () => {
    const bad = GOOD_PAGE.replace("description: Verifies warm reset recovery.\n", "");
    const f = lint(bad).find((x) => x.ruleId === "missing-required-field");
    assert.equal(f?.contributedBy, "engine");
  });

  it("errors on unknown frontmatter keys, exempting the x- mount", () => {
    const bad = GOOD_PAGE.replace("x-owner: someone", "x-owner: someone\nrogue_key: 1");
    const findings = lint(bad);
    const unknown = findings.filter((f) => f.ruleId === "unknown-frontmatter-key");
    assert.equal(unknown.length, 1);
    assert.equal(unknown[0]?.message.includes("rogue_key"), true);
  });

  it("surfaces duplicate-key parse issues as findings with lines", () => {
    const findings = lint("---\ntype: test-case\ntype: hub\n---\n");
    const dup = findings.find((f) => f.ruleId === "duplicate-key");
    assert.equal(dup?.line, 3);
  });

  it("the unknown-type remediation names a real path, never an unshipped verb", () => {
    const f = lint("# Bare\n").find((x) => x.ruleId === "unknown-type");
    assert.equal(f?.remediation?.includes("type new"), false);
  });
});

describe("engine rules — tags and folder alignment", () => {
  it("errors on unregistered tags", () => {
    const bad = GOOD_PAGE.replace(
      "tags: [reset, test-execution]",
      "tags: [reset, mystery, test-execution]",
    );
    const f = lint(bad).find((x) => x.ruleId === "unknown-tag");
    assert.equal(f?.message.includes("mystery"), true);
  });

  it("errors on newly applied retired tags", () => {
    const bad = GOOD_PAGE.replace(
      "tags: [reset, test-execution]",
      "tags: [reset, validation, test-execution]",
    );
    assert.equal(codes(lint(bad)).includes("tag-retired"), true);
  });

  it("requires current folder segments as tags, naming the missing ones", () => {
    const bad = GOOD_PAGE.replace("tags: [reset, test-execution]", "tags: [reset]");
    const f = lint(bad).find((x) => x.ruleId === "folder-tags-present");
    assert.equal(f?.message.includes("test-execution"), true);
    assert.equal(f?.contributedBy, "engine");
  });

  it("errors when a folder segment is not a registered tag", () => {
    const findings = lint(GOOD_PAGE, "wiki/unregistered-area/example.md");
    assert.equal(codes(findings).includes("folder-segment-registered"), true);
  });

  it("does not require folder tags for a page at a content root", () => {
    const findings = lint(GOOD_PAGE, "wiki/example.md");
    assert.equal(codes(findings).includes("folder-tags-present"), false);
  });

  it("scalar tags are a loud error, and folder alignment still runs", () => {
    const findings = lint(
      "---\ntype: concept\ntitle: T\ndescription: x.\ntags: bogus\n---\n\n# T\n",
      "wiki/reset/t.md",
    );
    assert.equal(
      findings.some((f) => f.ruleId === "invalid-tags-field" && f.severity === "error"),
      true,
    );
    assert.equal(
      codes(findings).includes("folder-tags-present"),
      true,
      "folder alignment must not be silently disabled",
    );
  });
});

describe("type-carried rules — headings (docs/concepts.md §Findings and routing)", () => {
  it("errors on a missing required heading with type provenance", () => {
    const bad = GOOD_PAGE.replace("\n## Execution\n", "");
    const f = lint(bad).find((x) => x.ruleId === "sections");
    assert.equal(f?.message.includes("Execution"), true);
    assert.equal(f?.contributedBy, "test-case");
    assert.equal(f?.severity, "error");
  });

  it("errors on a forbidden heading", () => {
    const bad = `${GOOD_PAGE}\n## Random notes\n`;
    const f = lint(bad).find((x) => x.ruleId === "sections" && x.message.includes("Random notes"));
    assert.notEqual(f, undefined);
  });
});

describe("the page-wide append-only arm (docs/concepts.md)", () => {
  it("passes when the base body is preserved and content is appended", () => {
    const base = GOOD_PAGE;
    const current = `${GOOD_PAGE}\n2026-08-31: run 1 green.\n`;
    const findings = lint(current, "wiki/test-execution/example.md", base);
    assert.equal(codes(findings).includes("body-append-only"), false);
  });

  it("errors with the declaring type's provenance when base content is edited", () => {
    const base = `${GOOD_PAGE}\n2026-08-30: run 0 red.\n`;
    const current = `${GOOD_PAGE}\n2026-08-30: run 0 green.\n`;
    const f = lint(current, "wiki/test-execution/example.md", base).find(
      (x) => x.ruleId === "body-append-only",
    );
    assert.notEqual(f, undefined);
    assert.equal(f?.contributedBy, "test-case");
  });

  it("does not run without a base text", () => {
    const findings = lint(GOOD_PAGE);
    assert.equal(codes(findings).includes("body-append-only"), false);
  });

  it("passes an append that does not begin with a blank line", () => {
    const base = `${GOOD_PAGE}2026-08-30: run 0 red.\n`;
    const current = `${base}2026-08-31: run 1 green.\n`;
    const findings = lint(current, "wiki/test-execution/example.md", base);
    assert.equal(
      codes(findings).includes("body-append-only"),
      false,
      "a pure append must not be flagged",
    );
  });
});

describe("finding order is deterministic (docs/concepts.md §Findings and routing)", () => {
  it("sorts by line, then ruleId", () => {
    const bad = GOOD_PAGE.replace("type: test-case", "type: no-such-type").replace(
      "tags: [reset, test-execution]",
      "tags: [mystery, reset, test-execution]",
    );
    const findings = lint(bad);
    const sorted = [...findings].sort((a, b) => {
      const la = a.line ?? 0;
      const lb = b.line ?? 0;
      if (la !== lb) return la - lb;
      return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
    });
    assert.deepEqual(findings, sorted);
  });
});

/** A law from bare type and tag maps, for the alignment and closure cases below. */
function registryOf(types: Record<string, unknown>, tags: Record<string, unknown> = {}) {
  return constitutionOf({ types, tags });
}

// The engine has no content-roots default, so a caller that walks pages
// says which roots it walked — folder alignment has nothing to align to otherwise.
const ROOTS = { contentRoots: ["wiki", "raw", "meta"] } as const;

describe("folder-segment matching is identity-normalized", () => {
  const registry = registryOf({}, { people: { description: "People pages." } });

  it("a TitleCase folder satisfies its lowercase registered tag", () => {
    const doc = parseDoc(
      "---\ntype: concept\ntitle: T\ndescription: d.\ntags: [people]\n---\n\n# T\n",
    );
    const findings = lintPage({ path: "wiki/People/x.md", doc, registry }, ROOTS);
    assert.equal(
      findings.some((f) => f.ruleId === "folder-segment-registered"),
      false,
    );
    assert.equal(
      findings.some((f) => f.ruleId === "folder-tags-present"),
      false,
    );
  });

  it("a genuinely unregistered segment still fails", () => {
    const doc = parseDoc("---\ntype: concept\ntitle: T\ndescription: d.\ntags: []\n---\n\n# T\n");
    const findings = lintPage({ path: "wiki/Nowhere/x.md", doc, registry }, ROOTS);
    assert.equal(
      findings.some((f) => f.ruleId === "folder-segment-registered"),
      true,
    );
  });
});

describe("segment separator folding", () => {
  const registry = registryOf({}, { "western-university": { description: "UWO pages." } });

  it("a spaced TitleCase folder satisfies its kebab-case tag", () => {
    const doc = parseDoc(
      "---\ntype: concept\ntitle: T\ndescription: d.\ntags: [western-university]\n---\n\n# T\n",
    );
    for (const dir of ["Western University", "Western_University", "western-university"]) {
      const findings = lintPage({ path: `wiki/${dir}/x.md`, doc, registry });
      assert.equal(
        findings.some(
          (f) => f.ruleId === "folder-segment-registered" || f.ruleId === "folder-tags-present",
        ),
        false,
        `segment "${dir}" aligns`,
      );
    }
  });
});

describe("folder_tag_aliases: the escape from the daily collision", () => {
  const registry = registryOf(
    { daily: { extends: "reference", description: "One day." } },
    { "journal-daily": { description: "Daily notes." } },
  );

  it("an aliased segment aligns through its mapped tag — the type/tag collision never forms", () => {
    const doc = parseDoc(
      "---\ntype: daily\ntitle: T\ndescription: d.\ntags: [journal-daily]\n---\n\n# T\n",
    );
    const findings = lintPage(
      { path: "journal/daily/2026-09-01.md", doc, registry },
      {
        contentRoots: ["journal"],
        folderTagAliases: { daily: "journal-daily" },
      },
    );
    assert.equal(
      findings.some((f) => f.ruleId === "folder-segment-registered"),
      false,
    );
    assert.equal(
      findings.some((f) => f.ruleId === "folder-tags-present"),
      false,
    );
  });

  it("a missing aliased tag is reported under the RESOLVED tag name", () => {
    const doc = parseDoc("---\ntype: daily\ntitle: T\ndescription: d.\ntags: []\n---\n\n# T\n");
    const findings = lintPage(
      { path: "journal/daily/2026-09-01.md", doc, registry },
      {
        contentRoots: ["journal"],
        folderTagAliases: { daily: "journal-daily" },
      },
    );
    const f = findings.find((x) => x.ruleId === "folder-tags-present");
    assert.match(String(f?.message), /journal-daily/);
  });
});

describe("field_sources derivation satisfies engine-required fields", () => {
  const registry = registryOf({});

  it("title from basename and description from lede satisfy the closure", () => {
    const doc = parseDoc(
      "---\ntype: concept\ntags: []\n---\n\n# 张伟\n\nMom's friend from 昆明.\n",
    );
    const findings = lintPage(
      { path: "wiki/张伟.md", doc, registry },
      {
        fieldSources: { title: "basename", description: "lede" },
      },
    );
    assert.equal(
      findings.some((f) => f.ruleId === "missing-required-field" && f.message.includes("title")),
      false,
    );
    assert.equal(
      findings.some(
        (f) => f.ruleId === "missing-required-field" && f.message.includes("description"),
      ),
      false,
    );
  });

  it("without the declaration the requirements stand; explicit values always satisfy", () => {
    const doc = parseDoc("---\ntype: concept\ntags: []\n---\n\n# T\n");
    const findings = lintPage({ path: "wiki/t.md", doc, registry });
    assert.equal(
      findings.some((f) => f.ruleId === "missing-required-field" && f.message.includes("title")),
      true,
    );
  });
});

describe("tag aliases are real lookup inputs", () => {
  const registry = registryOf(
    {},
    { "western-university": { description: "UWO pages.", aliases: ["uwo", "西大"] } },
  );

  it("a page-authored alias errors with the canonical name, not unknown-tag", () => {
    const doc = parseDoc(
      "---\ntype: concept\ntitle: T\ndescription: d.\ntags: [uwo]\n---\n\n# T\n",
    );
    const findings = lintPage({ path: "wiki/t.md", doc, registry });
    const f = findings.find((x) => x.ruleId === "tag-alias-target");
    assert.notEqual(f, undefined);
    assert.match(String(f?.remediation ?? f?.message), /western-university/);
    assert.equal(
      findings.some((x) => x.ruleId === "unknown-tag"),
      false,
    );
  });

  it("the generated tag catalog lists aliases", () => {
    const plans = generateArtifacts(registry, []);
    const catalog = plans.find((p) => p.path === "generated/tag-catalog.md")?.content ?? "";
    assert.equal(catalog.includes("uwo"), true);
    assert.equal(catalog.includes("西大"), true);
  });
});

describe("a frontmatter that does not parse is one finding, and no shape arm runs (docs/concepts.md §Findings and routing)", () => {
  it("malformed-frontmatter alone, with the page line and the parser's column", () => {
    const findings = lint(
      GOOD_PAGE.replace(
        "title: Warm reset under load",
        "title: Warm reset under load: the compact-mapping trap",
      ),
    );
    assert.deepEqual(codes(findings), ["malformed-frontmatter"], JSON.stringify(findings));
    const [only] = findings;
    assert.equal(only?.line, 3, "the page line, opening fence counted");
    assert.equal(only?.details?.["column"], 8);
    assert.match(only?.message ?? "", /line 3, column 8/);
    assert.equal(
      only?.message.includes("\n"),
      false,
      "the parser's excerpt stays out of the message",
    );
    assert.match(only?.remediation ?? "", /quote/);
  });

  it("a frontmatter that is not a mapping is the same one finding", () => {
    const findings = lint("---\n- a\n- b\n---\n\n# list\n");
    assert.deepEqual(codes(findings), ["frontmatter-not-mapping"]);
  });

  it("a duplicate key parsed to a value, so the page is judged as it reads", () => {
    const findings = lint(GOOD_PAGE.replace("x-owner: someone", "rogue: 1\ncase_id: TC-0043"));
    // The parse finding AND the closure finding: the arms ran over the mapping
    // the parser produced, because there is one.
    assert.deepEqual(codes(findings).sort(), ["duplicate-key", "unknown-frontmatter-key"]);
  });
});

describe("tombstones at lint", () => {
  it("a page of a retired type gets a tombstone finding carrying the migration hint — not unknown-type", () => {
    const registry = registryOf({
      successor: { extends: "concept", description: "new." },
      "old-model": {
        extends: "concept",
        description: "old.",
        status: "retired",
        replaced_by: ["successor"],
      },
    });
    const doc = parseDoc("---\ntype: old-model\ntitle: T\ndescription: d.\ntags: []\n---\n\n# T\n");
    const findings = lintPage({ path: "wiki/t.md", doc, registry });
    const f = findings.find((x) => x.ruleId === "tombstone");
    assert.notEqual(f, undefined);
    assert.match(f?.remediation ?? "", /successor/);
    assert.equal(
      findings.some((x) => x.ruleId === "unknown-type"),
      false,
    );
  });
});
