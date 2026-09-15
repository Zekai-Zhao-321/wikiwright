// docs/concepts.md §Findings and routing, docs/concepts.md §The gate,
// docs/concepts.md §Section grammar · docs/architecture.md §How a verdict is produced · docs/architecture.md §The invariants (the
// correction guards), .23 (the base name index), .24 (a mode-disabled fixer),
// .26 (illegality is the table's), .27 (the cap fills error-first), .31 (one
// waiver, N occurrences), .32 (an info row may not be excepted).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundedLevenshtein,
  evidenceDigestFor,
  fixerExecutes,
  inheritedLines,
  judge,
  KERNEL_LANES,
  loadConstitution,
  PASS_TABLE,
  routeOf,
  standardLibrary,
  trigramJaccard,
  unroutableRows,
  type VaultState,
} from "../src/index.ts";
// docs/extending.md §An arm: the correction predicate is the CLAIMS
// module's, and these cases are about claim semantics. Imported from the module
// that owns it, which is what the kernel no longer does.
import { isCorrection } from "../src/stdlib/claims-transition.ts";
import { constitutionOf } from "./helpers/constitution.ts";

// --------------------------------------------------------------------------
// the routing law, as a static property of the table

describe("the routing law (docs/concepts.md §Findings and routing)", () => {
  it("every error/warning row routes, and no info row does", () => {
    assert.deepEqual(unroutableRows(), []);
  });

  it("the derived route is the fixer, then the advisory, then the lane", () => {
    assert.equal(
      routeOf({ id: "tombstone", kind: "LAW", severity: "error", fixer: "retype" }),
      "retype",
    );
    assert.equal(
      routeOf({ id: "x", kind: "LAW", severity: "error", fixer: "retype", lane: "type-review" }),
      "queue type-review",
      "a fixer the registry does not carry for the rule is no route",
    );
    assert.equal(
      routeOf({ id: "x", kind: "LAW", severity: "error", lane: "type-review" }),
      "queue type-review",
    );
    assert.equal(routeOf({ id: "x", kind: "LAW", severity: "info" }), "—");
  });

  it("`finding-unroutable` names the offending row, by name", () => {
    const bad = unroutableRows([
      { id: "no-route-here", kind: "LAW", severity: "error" },
      { id: "census-with-a-lane", kind: "LAW", severity: "info", lane: "type-review" },
    ]);
    assert.deepEqual(bad, ["census-with-a-lane", "no-route-here"]);
  });

  it("every declared lane is used and every used lane is declared", () => {
    const declared = new Set<string>(KERNEL_LANES);
    const used = new Set(PASS_TABLE.map((r) => r.lane).filter((l) => l !== undefined));
    assert.deepEqual([...used].sort(), [...declared].sort());
  });
});

// --------------------------------------------------------------------------
// line inheritance (docs/concepts.md §The gate)

describe("line-level inheritance (docs/concepts.md §The gate)", () => {
  it("an unchanged line is inherited", () => {
    const inherited = inheritedLines("a\nb\nc\n", "a\nb\nc\n");
    assert.deepEqual(
      [...inherited].sort((x, y) => x - y),
      [1, 2, 3, 4],
    );
  });

  it("a moved line is inherited; an edited line is new", () => {
    const inherited = inheritedLines("a\nb\nc\n", "c\na\nb2\n");
    assert.equal(inherited.has(1), true, "c moved and is still inherited");
    assert.equal(inherited.has(2), true, "a is inherited");
    assert.equal(inherited.has(3), false, "b2 is an edit of b, so it is new");
  });

  it("a line deleted and re-added elsewhere with one character changed is new", () => {
    const inherited = inheritedLines("x\n- alpha likes tea\ny\n", "x\ny\n- alpha likes teas\n");
    assert.equal(inherited.has(3), false);
  });

  it("CRLF and a BOM are normalized by the parse seam, not by the caller", () => {
    const inherited = inheritedLines("﻿a\r\nb\r\n", "a\nb\n");
    assert.equal(inherited.has(1), true);
    assert.equal(inherited.has(2), true);
  });
});

// --------------------------------------------------------------------------
// the corrected tolerance (docs/concepts.md §Section grammar)

describe("the `corrected` tolerance and its length floor (docs/concepts.md §Section grammar)", () => {
  const claim = (core: string, marker: string) => ({
    kind: "claim" as const,
    line: 1,
    raw: `[address] ${core} ${marker}`,
    rationale: [],
    category: "address",
    categoryId: "address",
    core,
    coreId: core,
    handle: "#00000000",
    markerLike: [],
    provenance: {
      form: "stated" as const,
      raw: marker,
      date: "2026-01-01",
    },
  });

  it("a typo in a long core under identical markers is a correction", () => {
    assert.equal(
      isCorrection(
        claim("lives in Shangai since 2024", "(stated 2026-01-01)"),
        claim("lives in Shanghai since 2024", "(stated 2026-01-01)"),
      ),
      true,
    );
  });

  it("below the length floor a changed core is a supersession, not a typo", () => {
    // Five characters, three edits: a different fact wearing the same shape.
    assert.equal(
      isCorrection(claim("abcde", "(stated 2026-01-01)"), claim("axyze", "(stated 2026-01-01)")),
      false,
    );
  });

  it("a moved marker clause is not a correction — the markers must be identical", () => {
    assert.equal(
      isCorrection(
        claim("lives in Shangai since 2024", "(stated 2026-01-01)"),
        claim("lives in Shanghai since 2024", "(stated 2026-03-03)"),
      ),
      false,
    );
  });

  it("the two arms are the ones the record states", () => {
    assert.equal(boundedLevenshtein("Shangai", "Shanghai", 3), 1);
    assert.equal(boundedLevenshtein("abcde", "vwxyz", 3), 4, "bounded: past the cap it stops");
    assert.equal(trigramJaccard("alpha", "alpha") >= 0.9, true);
    assert.equal(trigramJaccard("alpha", "omega") < 0.9, true);
  });
});

// --------------------------------------------------------------------------
// the digest (docs/concepts.md §Findings and routing)

describe("the evidence digest keys an item, never a line (docs/concepts.md §Findings and routing)", () => {
  it("the same core on a different line has the same digest", () => {
    const a = evidenceDigestFor("unknown-category", "wiki/a.md", "alpha likes tea");
    const b = evidenceDigestFor("unknown-category", "wiki/a.md", "alpha likes tea");
    assert.equal(a, b);
    assert.equal(a.startsWith("sha256:"), true);
  });

  it("a different rule, path or core is a different digest", () => {
    const base = evidenceDigestFor("unknown-category", "wiki/a.md", "alpha likes tea");
    assert.notEqual(base, evidenceDigestFor("unknown-label", "wiki/a.md", "alpha likes tea"));
    assert.notEqual(base, evidenceDigestFor("unknown-category", "wiki/b.md", "alpha likes tea"));
    assert.notEqual(base, evidenceDigestFor("unknown-category", "wiki/a.md", "alpha likes water"));
  });
});

// --------------------------------------------------------------------------
// the judge over a tiny hand-built law

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: { mode: "registered", entries: { note: { description: "a note" } } },
    categories: {
      mode: "registered",
      entries: { identity: { class: "supersede", description: "who it is" } },
    },
  },
  types: {
    note: {
      extends: "concept",
      description: "A tiny type for the judge's own tests.",
      sections: {
        depth: 2,
        list: [
          {
            heading: "Facts",
            grammar: "claims",
            vocabulary: "categories",
            history: "History",
            severity: "error",
            max: 1,
          },
          {
            heading: "History",
            grammar: "claims",
            role: "history",
            vocabulary: "categories",
            max: 1,
          },
        ],
      },
    },
  },
};

function tinyLaw() {
  const loaded = loadConstitution(CONSTITUTION, standardLibrary());
  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? [] : loaded.issues));
  return {
    registry: (loaded as { ok: true; registry: never }).registry,
    modules: standardLibrary(),
  };
}

const PAGE = `---
type: note
title: Alpha
description: A page.
tags: [note]
---
Alpha is a page.

## Facts

- [identity] Alpha is a page (stated 2026-01-01)
- [bogus] Alpha is odd (stated 2026-01-01)
`;

describe("judge routes, censuses and caps (docs/concepts.md §Findings and routing, docs/concepts.md §Findings and routing, docs/concepts.md §Findings and routing)", () => {
  it("every non-info finding carries exactly one of fix / queue", () => {
    const state: VaultState = { pages: new Map([["wiki/Alpha.md", PAGE]]) };
    const verdict = judge(state, tinyLaw() as never, { all: true });
    assert.equal(verdict.findings.length > 0, true, "the fixture fires something");
    for (const f of verdict.findings) {
      const routed = (f.fix === undefined ? 0 : 1) + (f.queue === undefined ? 0 : 1);
      if (f.severity === "info") {
        assert.equal(routed, 0, `${f.ruleId}: an info finding is a census, so it routes nowhere`);
      } else {
        assert.equal(routed, 1, `${f.ruleId}: exactly one of fix / queue`);
      }
    }
  });

  it("the coverage block names every pass in the table", () => {
    const state: VaultState = { pages: new Map([["wiki/Alpha.md", PAGE]]) };
    const verdict = judge(state, tinyLaw() as never, {});
    for (const row of PASS_TABLE) {
      assert.notEqual(
        verdict.coverage.passes[row.id],
        undefined,
        `pass "${row.id}" has no coverage row`,
      );
    }
  });

  it("a row whose input is an external origin is not_applicable: external-origin, on every page", () => {
    const state: VaultState = { pages: new Map([["wiki/Alpha.md", PAGE]]) };
    const verdict = judge(state, tinyLaw() as never, { shellPasses: ["stale-capture"] });
    for (const id of [
      "stale-capture",
      "stale-source-cited",
      "pin-unknown-to-origin",
      "origin-unreachable",
    ]) {
      assert.equal(verdict.coverage.passes[id]?.reason, "external-origin", id);
      assert.equal(verdict.coverage.passes[id]?.evaluated, 0, id);
      assert.equal(verdict.coverage.passes[id]?.not_applicable, 1, id);
    }
    // Naming the row in `shellPasses` changes nothing: no judge-based verb
    // measures an origin, so the reason is never `capability-unavailable`.
    const plain = judge(state, tinyLaw() as never, {});
    assert.deepEqual(
      plain.coverage.passes["stale-capture"],
      verdict.coverage.passes["stale-capture"],
    );
  });

  it("a base-carrying arm with no base is not_applicable: no-base, never a zero", () => {
    const state: VaultState = { pages: new Map([["wiki/Alpha.md", PAGE]]) };
    const verdict = judge(state, tinyLaw() as never, {});
    assert.equal(verdict.coverage.passes["claims-transition"]?.reason, "no-base");
    assert.equal(verdict.coverage.passes["claims-transition"]?.evaluated, 0);
    assert.equal(verdict.summary.unevaluated > 0, true);
    // The scalar is the sum of a block that names the pass and the reason.
    assert.deepEqual(verdict.unevaluated["claims-transition"], { count: 1, reason: "no-base" });
    const sum = Object.values(verdict.unevaluated).reduce((a, row) => a + row.count, 0);
    assert.equal(sum, verdict.summary.unevaluated);
    assert.equal(
      verdict.unevaluated["canonical-form"],
      undefined,
      "a census row is never a blind spot",
    );
  });

  it("the cap trims the array; the summary and the exit code read the uncapped set", () => {
    const pages = new Map<string, string>();
    for (let i = 0; i < 8; i += 1) {
      pages.set(`wiki/p${i}.md`, PAGE.replace("title: Alpha", `title: P${i}`));
    }
    const capped = judge({ pages }, tinyLaw() as never, { limit: 3 });
    assert.equal(capped.findings.length, 3);
    assert.equal(capped.caps.hit, true);
    const all = judge({ pages }, tinyLaw() as never, { all: true });
    assert.equal(all.caps.hit, false);
    assert.deepEqual(capped.summary.by_rule, all.summary.by_rule, "by_rule is uncapped");
    assert.equal(capped.summary.errors, all.summary.errors, "the exit code is uncapped");
  });

  it("--rule and --path filter before the cap", () => {
    const state: VaultState = {
      pages: new Map([
        ["wiki/Alpha.md", PAGE],
        ["wiki/Beta.md", PAGE.replace("title: Alpha", "title: Beta")],
      ]),
    };
    const scoped = judge(state, tinyLaw() as never, { rule: "unknown-category", all: true });
    assert.equal(
      scoped.findings.every((f) => f.ruleId === "unknown-category"),
      true,
    );
    const one = judge(state, tinyLaw() as never, { path: "wiki/Beta.md", all: true });
    assert.equal(
      one.findings.every((f) => f.path === "wiki/Beta.md"),
      true,
    );
  });
});

describe("per-page exceptions (docs/concepts.md §Findings and routing)", () => {
  it("a matching digest removes the finding and censuses it", () => {
    const law = tinyLaw() as never;
    const bare = judge({ pages: new Map([["wiki/Alpha.md", PAGE]]) }, law, { all: true });
    const target = bare.findings.find((f) => f.ruleId === "unknown-category");
    assert.notEqual(target, undefined, "the fixture fires unknown-category");
    assert.notEqual(target?.evidenceDigest, undefined, "a queue-routed finding carries a digest");
    const excepted = PAGE.replace(
      "tags: [note]",
      `tags: [note]\nexceptions:\n  - rule: unknown-category\n    digest: "${target?.evidenceDigest}"\n    reason: deliberate`,
    );
    const after = judge({ pages: new Map([["wiki/Alpha.md", excepted]]) }, law, { all: true });
    assert.equal(
      after.findings.some((f) => f.ruleId === "unknown-category"),
      false,
      "the excepted finding is gone",
    );
    assert.equal(after.summary.excepted["unknown-category"], 1, "and it is counted, never silent");
  });

  it("an exception matching no finding is `exception-stale`", () => {
    const law = tinyLaw() as never;
    const page = PAGE.replace(
      "tags: [note]",
      'tags: [note]\nexceptions:\n  - rule: unknown-category\n    digest: "sha256:deadbeef"\n    reason: gone',
    );
    const verdict = judge({ pages: new Map([["wiki/Alpha.md", page]]) }, law, { all: true });
    const stale = verdict.findings.find((f) => f.ruleId === "exception-stale");
    assert.notEqual(stale, undefined);
    assert.equal(stale?.severity, "warning");
    assert.equal(stale?.queue, "exception-review");
  });

  it("an exception naming a fix-routed row or a parse law is `exception-illegal`", () => {
    const law = tinyLaw() as never;
    const page = PAGE.replace(
      "tags: [note]",
      'tags: [note]\nexceptions:\n  - rule: malformed-frontmatter\n    digest: "sha256:x"\n    reason: no',
    );
    const verdict = judge({ pages: new Map([["wiki/Alpha.md", page]]) }, law, { all: true });
    const illegal = verdict.findings.find((f) => f.ruleId === "exception-illegal");
    assert.notEqual(illegal, undefined);
    assert.equal(illegal?.severity, "error");
  });
});

describe("the gate rule demotes only inherited, queue-routed errors (docs/concepts.md §The gate)", () => {
  // The shape: a legacy page carrying a backlog of unknown categories on
  // lines the committer did not write, plus one bullet they did.
  const legacy = PAGE.replace(
    "- [bogus] Alpha is odd (stated 2026-01-01)\n",
    "- [bogus] Alpha is odd (stated 2026-01-01)\n- [alsobogus] Alpha is old (stated 2026-01-01)\n",
  );
  const withNewBullet = `${legacy}- [thirdbogus] Alpha bought a bike (stated 2026-02-02)\n`;

  it("one new bullet: exit 5 with exactly one error and the backlog demoted", () => {
    const state: VaultState = {
      pages: new Map([["wiki/Alpha.md", withNewBullet]]),
      base: new Map([["wiki/Alpha.md", legacy]]),
    };
    const verdict = judge(state, tinyLaw() as never, { gate: true, all: true });
    const unknown = verdict.findings.filter((f) => f.ruleId === "unknown-category");
    assert.equal(unknown.length, 3);
    assert.equal(verdict.summary.errors, 1, "only the line the commit wrote blocks it");
    const demoted = unknown.filter((f) => f.details?.["demoted_from"] === "error");
    assert.equal(demoted.length, 2, "the inherited lines ratchet down to warnings");
    for (const f of demoted) {
      assert.equal(f.severity, "warning");
      assert.equal(f.new_since_base, false);
    }
    const fresh = unknown.filter((f) => f.new_since_base === true);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0]?.severity, "error");
  });

  it("an unrelated one-line edit: no error at all, the backlog still counted", () => {
    const edited = legacy.replace("Alpha is a page.", "Alpha is a page, briefly.");
    const state: VaultState = {
      pages: new Map([["wiki/Alpha.md", edited]]),
      base: new Map([["wiki/Alpha.md", legacy]]),
    };
    const verdict = judge(state, tinyLaw() as never, { gate: true, all: true });
    assert.equal(verdict.summary.errors, 0, "a one-bullet ingest never inherits a backlog");
    assert.equal(
      verdict.findings.filter((f) => f.ruleId === "unknown-category").length,
      2,
      "the backlog is reported, as warnings",
    );
  });

  it("a new violation on a MOVED line is still inherited", () => {
    const moved = legacy
      .replace("- [alsobogus] Alpha is old (stated 2026-01-01)\n", "")
      .replace(
        "- [identity] Alpha is a page (stated 2026-01-01)\n",
        "- [alsobogus] Alpha is old (stated 2026-01-01)\n- [identity] Alpha is a page (stated 2026-01-01)\n",
      );
    const state: VaultState = {
      pages: new Map([["wiki/Alpha.md", moved]]),
      base: new Map([["wiki/Alpha.md", legacy]]),
    };
    const verdict = judge(state, tinyLaw() as never, { gate: true, all: true });
    assert.equal(verdict.summary.errors, 0, "moving a line is not writing it");
  });

  it("without a gate there is no demotion, and no base means no new_since_base", () => {
    const whole = judge({ pages: new Map([["wiki/Alpha.md", legacy]]) }, tinyLaw() as never, {
      all: true,
    });
    for (const f of whole.findings.filter((x) => x.ruleId === "unknown-category")) {
      assert.equal(f.severity, "error");
      assert.equal(f.new_since_base, undefined);
    }
  });

  it("a config/ change suspends demotion — the interim until slice 8's plan", () => {
    const state: VaultState = {
      pages: new Map([["wiki/Alpha.md", withNewBullet]]),
      base: new Map([["wiki/Alpha.md", legacy]]),
    };
    const verdict = judge(state, tinyLaw() as never, {
      gate: true,
      configChanged: true,
      all: true,
    });
    for (const f of verdict.findings.filter((x) => x.ruleId === "unknown-category")) {
      assert.equal(f.severity, "error");
    }
  });
});

describe("renamed-without-alias is the slice's one fix-routed row", () => {
  const renamed = PAGE.replace("title: Alpha", "title: Alpha").replace(
    "tags: [note]",
    "tags: [note]",
  );

  it("a directory move or case normalization preserving identity needs no self-alias", () => {
    for (const rename of [
      { from: "sources/Alpha.md", to: "raw/source/Alpha.md" },
      { from: "wiki/ALPHA.md", to: "wiki/Alpha.md" },
    ]) {
      const state: VaultState = {
        pages: new Map([[rename.to, renamed]]),
        base: new Map([[rename.to, renamed]]),
        renames: [rename],
      };
      const verdict = judge(state, tinyLaw() as never, { gate: true, all: true });
      assert.equal(
        verdict.findings.some((f) => f.ruleId === "renamed-without-alias"),
        false,
        `${rename.from} -> ${rename.to}`,
      );
    }
  });

  it("a rename whose new page lacks the old basename as an alias is a MachineApplicable error", () => {
    const state: VaultState = {
      pages: new Map([["wiki/Alpha.md", renamed]]),
      base: new Map([["wiki/Alpha.md", renamed]]),
      renames: [{ from: "wiki/Older Name.md", to: "wiki/Alpha.md" }],
    };
    const verdict = judge(state, tinyLaw() as never, { gate: true, all: true });
    const finding = verdict.findings.find((f) => f.ruleId === "renamed-without-alias");
    assert.notEqual(finding, undefined);
    assert.equal(finding?.severity, "error");
    assert.equal(finding?.fix?.applicability, "MachineApplicable");
    // A rename is an index fact, judged under `gate: true`, so the argv names
    // the index: `fix` then judges the state the finding came from.
    assert.deepEqual(finding?.fix?.argv, [
      "fix",
      "--rule",
      "renamed-without-alias",
      "--path",
      "wiki/Alpha.md",
      "--line",
      String(finding?.line),
      "--staged",
      "--expect",
      "1",
    ]);
    assert.equal(finding?.queue, undefined, "a fix-routed finding queues nowhere");
  });

  it("a rename whose new page already carries the alias fires nothing", () => {
    const carried = renamed.replace("tags: [note]", "tags: [note]\naliases: [Older Name]");
    const state: VaultState = {
      pages: new Map([["wiki/Alpha.md", carried]]),
      base: new Map([["wiki/Alpha.md", carried]]),
      renames: [{ from: "wiki/Older Name.md", to: "wiki/Alpha.md" }],
    };
    const verdict = judge(state, tinyLaw() as never, { gate: true, all: true });
    assert.equal(
      verdict.findings.some((f) => f.ruleId === "renamed-without-alias"),
      false,
    );
  });

  it("a fix-routed error on an inherited line is NEVER demoted", () => {
    const state: VaultState = {
      pages: new Map([["wiki/Alpha.md", renamed]]),
      base: new Map([["wiki/Alpha.md", renamed]]),
      renames: [{ from: "wiki/Older Name.md", to: "wiki/Alpha.md" }],
    };
    const verdict = judge(state, tinyLaw() as never, { gate: true, all: true });
    const finding = verdict.findings.find((f) => f.ruleId === "renamed-without-alias");
    assert.equal(finding?.severity, "error");
  });
});

describe("a section law routes by its own row (docs/concepts.md §Findings and routing)", () => {
  it("a missing declared section routes by the `sections` row and carries no second id", () => {
    const registry = constitutionOf({
      tags: { note: { description: "a note" } },
      types: {
        note: {
          extends: "concept",
          description: "a note",
          sections: { list: [{ heading: "Facts", min: 1 }] },
        },
      },
    });
    const page = `---
type: note
title: Alpha
description: A page.
tags: [note]
---
No Facts heading here.
`;
    const verdict = judge(
      { pages: new Map([["wiki/Alpha.md", page]]) },
      { registry, modules: standardLibrary() },
      { all: true },
    );
    const finding = verdict.findings.find((f) => f.ruleId === "sections");
    assert.notEqual(finding, undefined, JSON.stringify(verdict.findings.map((f) => f.ruleId)));
    assert.equal(finding?.pass, undefined, "no checker name rides along any more");
    // A MISSING declared section is `section-stub`'s case, so this row is
    // fix-routed now rather than queued. What the case is about is that it routes
    // at all — the xor, under the arm that absorbed the v2 checker.
    assert.equal(
      (finding?.fix === undefined) !== (finding?.queue === undefined),
      true,
      JSON.stringify({ fix: finding?.fix, queue: finding?.queue }),
    );
    assert.deepEqual(finding?.fix?.argv.slice(0, 3), ["fix", "--rule", "sections"]);
  });
});

// --------------------------------------------------------------------------
// the rulings an adversarial review forced

describe("`corrected` never launders a digit or a polarity (docs/concepts.md §Section grammar)", () => {
  const claim = (core: string) => ({
    kind: "claim" as const,
    line: 1,
    raw: `[identity] ${core} (stated 2026-01-01)`,
    rationale: [],
    category: "identity",
    categoryId: "identity",
    core,
    coreId: core,
    handle: "#00000000",
    markerLike: [],
    provenance: { form: "stated" as const, raw: "(stated 2026-01-01)", date: "2026-01-01" },
  });

  // Each pair is inside a tolerance arm and is not a typo fix. The comment is
  // the arm it walks through.
  const LAUNDERED: [string, string, string][] = [
    ["Alpha is aged 34 today", "Alpha is aged 37 today", "lev 1"],
    ["Alpha was born on 1990-01-01", "Alpha was born on 1998-01-01", "lev 1"],
    ["Alpha earns 50000 CAD a year", "Alpha earns 90000 CAD a year", "lev 1"],
    ["Alpha holds a balance of 250000 CAD", "Alpha holds a balance of 910000 CAD", "jaccard 0.915"],
    ["Alpha joined in the year 2021", "Alpha joined in the year 2027", "jaccard 0.950"],
    ["Alpha is a smoker person", "Alpha is a nonsmoker person", "lev 3, negation"],
    ["Alpha is married now", "Alpha is unmarried now", "lev 2, negation"],
    ["Alpha likes green tea", "Alpha dislikes green tea", "lev 3, negation"],
    ["Alpha can drive a truck", "Alpha cannot drive a truck", "negation"],
    ["Alpha 是 已婚 的 人", "Alpha 是 未婚 的 人", "CJK negation"],
  ];

  for (const [before, after, why] of LAUNDERED) {
    it(`"${before}" -> "${after}" is a supersession, not a correction (${why})`, () => {
      assert.equal(isCorrection(claim(before), claim(after)), false);
    });
  }

  it("the typo archetype still passes both guards", () => {
    assert.equal(
      isCorrection(claim("lives in Shangai since 2024"), claim("lives in Shanghai since 2024")),
      true,
      "identical digits, identical polarity, one edit",
    );
  });

  it("a typo inside a core that carries digits is still a correction when the digits hold", () => {
    assert.equal(
      isCorrection(claim("lives in Shangai since 2024"), claim("lives in Shanghia since 2024")),
      true,
    );
  });

  it("the residual the guards do NOT close, asserted so it is not mistaken for closed", () => {
    // `owes` -> `owns` is one substitution between two real words, which is
    // exactly the shape of `Shangai` -> `Shanghai`. Separating them needs a
    // lexicon this engine does not ship, so the pair stays inside
    // the tolerance and the limit is stated rather than papered over.
    assert.equal(
      isCorrection(claim("Alpha owes 5000 CAD to Beta"), claim("Alpha owns 5000 CAD to Beta")),
      true,
      "if this ever goes false, the guard widened — update docs/concepts.md §Section grammar with it",
    );
  });
});

describe("the name index is state (docs/concepts.md §The gate)", () => {
  const linked = (title: string, body: string, extra = "") => `---
type: note
title: ${title}
description: A page.
tags: [note]${extra}
---
${title} is a page.

${body}

## Facts

- [identity] ${title} is a page (stated 2026-01-01)
`;

  const BOB = linked("Bob", "Bob knows [[Ana]].");

  it("a rename dangles a link on an untouched page, and the gate reports it", () => {
    const law = tinyLaw() as never;
    // The commit: Ana.md -> Anna.md, the old name kept as an alias. Bob.md is
    // untouched, and `[[Ana]]` on it now resolves through an alias.
    const state: VaultState = {
      pages: new Map([
        ["wiki/Anna.md", linked("Anna", "Anna is here.", "\naliases: [Ana]")],
        ["wiki/Bob.md", BOB],
      ]),
      base: new Map([
        ["wiki/Anna.md", linked("Ana", "Ana is here.")],
        ["wiki/Bob.md", BOB],
      ]),
      renames: [{ from: "wiki/Ana.md", to: "wiki/Anna.md" }],
    };
    const verdict = judge(state, law, { all: true, gate: true });
    const finding = verdict.findings.find(
      (f) => f.ruleId === "wikilink-alias-target" && f.path === "wiki/Bob.md",
    );
    assert.notEqual(finding, undefined, "the gate does not scope out what the commit caused");
    assert.equal(finding?.severity, "error", "and it is not demoted onto an inherited line");
    assert.equal(finding?.new_since_base, true);
    assert.equal(verdict.summary.errors >= 1, true, "so the commit is blocked");
  });

  it("a link that was already dangling before the commit stays scoped out", () => {
    const law = tinyLaw() as never;
    // Same vault, no rename: Bob's link resolved through the alias in the base
    // too, so this commit did not cause it.
    const anna = linked("Anna", "Anna is here.", "\naliases: [Ana]");
    const state: VaultState = {
      pages: new Map([
        ["wiki/Anna.md", anna],
        ["wiki/Bob.md", BOB],
        ["wiki/Cara.md", linked("Cara", "Cara is new.")],
      ]),
      base: new Map([
        ["wiki/Anna.md", anna],
        ["wiki/Bob.md", BOB],
        ["wiki/Cara.md", null],
      ]),
    };
    const verdict = judge(state, law, { all: true, gate: true });
    assert.equal(
      verdict.findings.some(
        (f) => f.ruleId === "wikilink-alias-target" && f.path === "wiki/Bob.md",
      ),
      false,
      "the gate blocks nothing it did not cause",
    );
  });

  it("a deletion is a base fact: the link it dangles is the commit's doing", () => {
    const law = tinyLaw() as never;
    const state: VaultState = {
      pages: new Map([["wiki/Bob.md", BOB]]),
      // Ana.md was deleted: present in the base, absent from the page set.
      base: new Map([
        ["wiki/Bob.md", BOB],
        ["wiki/Ana.md", linked("Ana", "Ana is here.")],
      ]),
    };
    const verdict = judge(state, law, { all: true, gate: true });
    const finding = verdict.findings.find(
      (f) => f.ruleId === "wikilink-unresolved" && f.path === "wiki/Bob.md",
    );
    assert.notEqual(finding, undefined, "a base-only path is what makes the deletion visible");
    assert.equal(finding?.new_since_base, true);
  });
});

describe("a waiver's illegality is a property of the table (docs/concepts.md §Findings and routing)", () => {
  const withException = (rule: string) =>
    PAGE.replace(
      "tags: [note]",
      `tags: [note]\nexceptions:\n  - rule: ${rule}\n    digest: "sha256:deadbeef"\n    reason: deliberate`,
    );

  it("a fix-routed row may not be excepted even when nothing violates it in this run", () => {
    const law = tinyLaw() as never;
    // Nothing in this state renames anything, so `renamed-without-alias` fires
    // nowhere — and the verdict on the waiver must not depend on that.
    const verdict = judge(
      { pages: new Map([["wiki/Alpha.md", withException("renamed-without-alias")]]) },
      law,
      { all: true },
    );
    const illegal = verdict.findings.filter((f) => f.ruleId === "exception-illegal");
    assert.equal(illegal.length, 1, JSON.stringify(verdict.findings.map((f) => f.ruleId)));
    assert.equal(
      verdict.findings.some((f) => f.ruleId === "exception-stale"),
      false,
      "the same block must not read as merely stale because no sibling page violated it",
    );
  });

  it("an exception naming an info row is illegal, not stale", () => {
    const law = tinyLaw() as never;
    const verdict = judge(
      { pages: new Map([["wiki/Alpha.md", withException("provenance-weak")]]) },
      law,
      { all: true },
    );
    assert.equal(
      verdict.findings.some((f) => f.ruleId === "exception-illegal"),
      true,
      "an info row is a census; there is nothing to waive",
    );
    assert.equal(
      verdict.findings.some((f) => f.ruleId === "exception-stale"),
      false,
    );
  });
});

describe("one exception waives every identical occurrence (docs/concepts.md §Findings and routing)", () => {
  it("two byte-identical items share one digest, and the census reports two", () => {
    const law = tinyLaw() as never;
    const twice = `---
type: note
title: Alpha
description: A page.
tags: [note]
---
Alpha is a page.

Alpha knows [[Nobody Here]].
Alpha knows [[Nobody Here]].

## Facts

- [identity] Alpha is a page (stated 2026-01-01)
`;
    const bare = judge({ pages: new Map([["wiki/Alpha.md", twice]]) }, law, { all: true });
    const hits = bare.findings.filter((f) => f.ruleId === "wikilink-unresolved");
    assert.equal(hits.length, 2, "two lines, two findings");
    assert.equal(hits[0]?.evidenceDigest, hits[1]?.evidenceDigest, "and one digest between them");
    const waived = twice.replace(
      "tags: [note]",
      `tags: [note]\nexceptions:\n  - rule: wikilink-unresolved\n    digest: "${hits[0]?.evidenceDigest}"\n    reason: the page is coming next week`,
    );
    const after = judge({ pages: new Map([["wiki/Alpha.md", waived]]) }, law, { all: true });
    assert.equal(
      after.findings.some((f) => f.ruleId === "wikilink-unresolved"),
      false,
    );
    assert.equal(after.summary.excepted["wikilink-unresolved"], 2, "the breadth is in the census");
  });
});

describe("the cap fills error-first (docs/concepts.md §Findings and routing)", () => {
  const warner = (n: number) => `---
type: note
title: Warn ${n}
description: A page.
tags: [note]
---
Warn ${n} is a page.

It knows [[Nobody Here]].

## Facts

- [identity] Warn ${n} is a page (stated 2026-01-01)
`;

  it("an error sorting past the cap is still shown, and the exit code is unmoved", () => {
    const pages = new Map<string, string>();
    for (let i = 0; i < 12; i += 1) pages.set(`wiki/a${String(i).padStart(2, "0")}.md`, warner(i));
    pages.set("wiki/zzz.md", PAGE.replace("title: Alpha", "title: Zzz"));

    const uncapped = judge({ pages }, tinyLaw() as never, { all: true });
    assert.equal(uncapped.summary.errors > 0, true, "the fixture has an error at the end");
    const lastError = uncapped.findings.findIndex((f) => f.severity === "error");
    assert.equal(lastError > 3, true, "and it sorts past a small cap in path order");

    const capped = judge({ pages }, tinyLaw() as never, { limit: 3 });
    assert.equal(capped.findings.length, 3);
    assert.equal(capped.caps.hit, true);
    assert.equal(
      capped.findings.some((f) => f.severity === "error"),
      true,
      "a gate never blocks on a finding it did not print",
    );
    assert.equal(capped.summary.errors, uncapped.summary.errors, "the summary is still uncapped");
    const paths = capped.findings.map((f) => `${f.path}|${f.line ?? "-"}|${f.ruleId}`);
    assert.deepEqual([...paths].sort(), paths, "the emitted array keeps the deterministic order");
  });
});

describe("a fixer a mode disables does not execute (docs/concepts.md §Findings and routing)", () => {
  // renamed the fixer: the materializer is `folder-tags`.
  it("`folder-tags` executes `folder-tags-present` only under materialize-add-only", () => {
    assert.equal(
      fixerExecutes("folder-tags", "folder-tags-present"),
      false,
      "with no mode stated, the fixer cannot be promised",
    );
    assert.equal(
      fixerExecutes("folder-tags", "folder-tags-present", { folderTags: "validate" }),
      false,
    );
    assert.equal(
      fixerExecutes("folder-tags", "folder-tags-present", { folderTags: "materialize-add-only" }),
      true,
    );
  });

  it("the row carries the lane the conditional route falls through to", () => {
    const row = PASS_TABLE.find((r) => r.id === "folder-tags-present");
    assert.equal(row?.lane, "tag-review");
    assert.deepEqual(unroutableRows(), [], "and the static law still holds with no mode");
  });

  it("under validate the finding queues; under materialize-add-only it carries the fix", () => {
    const page = `---
type: note
title: Alpha
description: A page.
tags: [note]
---
Alpha is a page.

## Facts

- [identity] Alpha is a page (stated 2026-01-01)
`;
    const state: VaultState = { pages: new Map([["wiki/Folk/Alpha.md", page]]) };
    const base = tinyLaw() as { registry: never };
    // The engine has no content-roots default, so the law says which
    // roots the caller walked — folder alignment reads them.
    const roots = ["wiki", "raw", "meta"];

    const validate = judge(
      state,
      { ...base, options: { folderTags: "validate", contentRoots: roots } } as never,
      { all: true },
    );
    const queued = validate.findings.find((f) => f.ruleId === "folder-tags-present");
    assert.notEqual(queued, undefined, JSON.stringify(validate.findings.map((f) => f.ruleId)));
    assert.equal(queued?.fix, undefined, "no argv the verb would refuse");
    assert.equal(queued?.queue, "tag-review");

    const materialize = judge(
      state,
      { ...base, options: { folderTags: "materialize-add-only", contentRoots: roots } } as never,
      { all: true },
    );
    const fixed = materialize.findings.find((f) => f.ruleId === "folder-tags-present");
    assert.deepEqual(fixed?.fix?.argv.slice(0, 3), ["fix", "--rule", "folder-tags-present"]);
    assert.equal(fixed?.queue, undefined);
  });

  it("under validate the row may be excepted, because nothing can fix it", () => {
    const page = `---
type: note
title: Alpha
description: A page.
tags: [note]
exceptions:
  - rule: folder-tags-present
    digest: "sha256:deadbeef"
    reason: this page is deliberately outside its folder's vocabulary
---
Alpha is a page.

## Facts

- [identity] Alpha is a page (stated 2026-01-01)
`;
    const base = tinyLaw() as { registry: never };
    const verdict = judge(
      { pages: new Map([["wiki/Folk/Alpha.md", page]]) },
      { ...base, options: { folderTags: "validate" } } as never,
      { all: true },
    );
    assert.equal(
      verdict.findings.some((f) => f.ruleId === "exception-illegal"),
      false,
      "a waiver is legal exactly where no command can do the work",
    );
  });
});
