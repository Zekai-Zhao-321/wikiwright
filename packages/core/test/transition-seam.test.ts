// docs/extending.md §An arm: a transition is the grammar's. The kernel parses both
// revisions under the one parser and hands a `runTransition` arm the items of
// the section and of the History section it names; what a removal, a landing
// or a correction MEANS — and what gets counted — is decided by the manifest
// that registered the arm.
//
// The load-bearing property: replacing the CLAIMS MANIFEST changes the kernel's
// transition verdict. While the kernel carried the claims transition itself,
// every case below passed unchanged with the manifest swapped, which is the
// definition of a vacuous test.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDispositions } from "../src/grammar/index.ts";
import { lintPage } from "../src/lint/index.ts";
import {
  type ArmSpec,
  loadModules,
  type ModuleRegistry,
  transitionSeam,
} from "../src/modules/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { loadConstitution } from "../src/registry/index.ts";
import claims from "../src/stdlib/claims.ts";
import entries from "../src/stdlib/entries.ts";
import relations from "../src/stdlib/relations.ts";

/** The standard library, with the claims grammar's arms rewritten by the caller. */
function libraryWith(patch: (arms: readonly ArmSpec[]) => readonly ArmSpec[]): ModuleRegistry {
  const grammar = claims.grammars?.["claims"];
  assert.notEqual(grammar, undefined);
  if (grammar === undefined) throw new Error("unreachable");
  const patched = {
    ...claims,
    grammars: { claims: { ...grammar, arms: patch(grammar.arms) } },
  } as typeof claims;
  const loaded = loadModules([patched, relations, entries]);
  assert.equal(loaded.ok, true, `the patched manifest loads: ${JSON.stringify(loaded)}`);
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

const SHIPPED = libraryWith((arms) => arms);

/** One replacement of the `claims-transition` arm's body, everything else shipped. */
function withTransition(runTransition: NonNullable<ArmSpec["runTransition"]>): ModuleRegistry {
  return libraryWith((arms) =>
    arms.map((arm) => (arm.id === "claims-transition" ? { ...arm, runTransition } : arm)),
  );
}

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: { mode: "registered", entries: {} },
    categories: { mode: "registered", entries: { identity: { class: "supersede" } } },
  },
  types: {
    person: {
      extends: "concept",
      description: "A person.",
      sections: {
        list: [
          { heading: "Facts", grammar: "claims", history: "History", vocabulary: "categories" },
          { heading: "History", grammar: "claims", role: "history", vocabulary: "categories" },
        ],
      },
    },
  },
};

const page = (facts: readonly string[], history: readonly string[] = []): string =>
  [
    "---",
    "type: person",
    "tags: []",
    "---",
    "",
    "Lede.",
    "",
    "## Facts",
    "",
    ...facts,
    "",
    "## History",
    "",
    ...history,
    "",
  ].join("\n");

/** One transition, judged under whatever module set the caller hands in. */
function transition(modules: ModuleRegistry, before: string, after: string) {
  const built = loadConstitution(CONSTITUTION, modules);
  assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
  if (!built.ok) throw new Error("unreachable");
  const collect = { dispositions: emptyDispositions() };
  const findings = lintPage(
    { path: "wiki/p.md", doc: parseDoc(after), registry: built.registry },
    { baseText: before, collect },
  );
  return {
    findings,
    removed: findings.filter((f) => f.ruleId === "claims-transition"),
    landings: findings.filter((f) => f.ruleId === "claim-landing"),
    dispositions: collect.dispositions,
  };
}

describe("the transition is the manifest's (docs/extending.md §An arm)", () => {
  it("still runs a module transition on unchanged bytes and normalized BOM/CRLF twins", () => {
    const text = page(["- [identity] name is Zhang Wei (stated 2026-01-01)"]);
    const crlf = `\uFEFF${text.replaceAll("\n", "\r\n")}`;
    let calls = 0;
    const inspecting = withTransition((ctx) => {
      calls += 1;
      assert.deepEqual(ctx.base, ctx.current);
      assert.equal(ctx.base.length, 1);
      ctx.count("unchanged");
      ctx.emit(
        "claims-transition",
        undefined,
        "inspected unchanged items",
        {},
        ctx.base[0]?.raw ?? "",
      );
    });
    const expected = transition(inspecting, text, text);
    assert.equal(calls, 1, "an unchanged page still reaches the module's arm");
    assert.equal(expected.removed.length, 1, "an unchanged page can still produce a finding");
    assert.equal(expected.dispositions["unchanged"], 1);
    for (const [before, after] of [
      [crlf, text],
      [text, crlf],
      [crlf, crlf],
    ] as const) {
      assert.deepEqual(transition(inspecting, before, after), expected);
    }
    assert.equal(calls, 4);
  });

  const TYPO_BEFORE = page(["- [identity] lives in Shangai since 2024 (stated 2026-01-01)"]);
  const TYPO_AFTER = page(["- [identity] lives in Shanghai since 2024 (stated 2026-01-01)"]);

  it("the shipped manifest counts a typo-sized edit as `corrected`, not removed", () => {
    const result = transition(SHIPPED, TYPO_BEFORE, TYPO_AFTER);
    assert.equal(result.dispositions["corrected"], 1, JSON.stringify(result.dispositions));
    assert.equal(result.dispositions["removed_illegally"], 0);
    assert.equal(result.removed.length, 0);
  });

  // Non-vacuous: with the transition carried by the kernel this case cannot
  // fail, because the kernel's verdict is the same whatever the manifest says.
  it("a manifest whose transition arm reads every edit as a removal makes it one", () => {
    const strict = withTransition((ctx) => {
      for (const item of ctx.base) {
        if (ctx.current.some((c) => c.raw === item.raw)) continue;
        ctx.emit("claims-transition", undefined, "left the section", {}, item.raw);
        ctx.count("removed_illegally");
      }
    });
    const result = transition(strict, TYPO_BEFORE, TYPO_AFTER);
    assert.equal(result.removed.length, 1, "the edit is a removal under this manifest");
    assert.equal(result.removed[0]?.severity, "error", "the arm's declared default severity");
    assert.equal(result.dispositions["removed_illegally"], 1);
    assert.equal(
      result.dispositions["corrected"],
      undefined,
      "the counters are the manifest's too",
    );
  });

  it("an arm that throws is one attributed `module-failure`, never a crash", () => {
    const broken = withTransition(() => {
      throw new Error("a stranger's bug");
    });
    const result = transition(broken, TYPO_BEFORE, TYPO_AFTER);
    const failure = result.findings.find((f) => f.ruleId === "module-failure");
    assert.notEqual(failure, undefined, JSON.stringify(result.findings));
    assert.equal(failure?.details?.["module"], "claims");
    assert.equal(failure?.details?.["arm"], "claims-transition");
    assert.equal(result.removed.length, 0, "a predicate that did not finish has no verdict");
  });

  // `identityOf` is the key the diff matches on. The `annotated` disposition is
  // the module asking "is the same value still standing?" — an identity match.
  const ANNOTATE_BEFORE = page(["- [identity] name is Zhang Wei (stated 2026-01-01)"]);
  const ANNOTATE_AFTER = page(["- [identity] name is Zhang Wei (stated 2026-01-01) (legacy)"]);

  it("the shipped manifest matches an in-place annotation by identity", () => {
    const result = transition(SHIPPED, ANNOTATE_BEFORE, ANNOTATE_AFTER);
    assert.equal(result.dispositions["annotated"], 1, JSON.stringify(result.dispositions));
    assert.equal(result.removed.length, 0);
  });

  // The landing escape is the same match, one section over: the History
  // section reaches the arm through `sectionItems`, by the heading it names.
  it("a superseded claim landing in History is matched by the module's identity", () => {
    const before = page(["- [identity] name is Zhang Wei (stated 2026-01-01)"]);
    const after = page(
      [],
      [
        "- [identity] name is Zhang Wei (stated 2026-01-01) (valid 2024→2026, superseded 2026-01-02)",
      ],
    );
    const result = transition(SHIPPED, before, after);
    assert.equal(result.removed.length, 0);
    assert.equal(result.landings.length, 1);
    assert.equal(result.landings[0]?.details?.["escape"], "history-claim-landing");
    assert.equal(result.dispositions["superseded"], 1);
  });
});

// ---------------------------------------------------------------------------
// The relations grammar exercises the same seam — its identity is the
// label and the target, and a relation that leaves the section lands in the
// History section the `history` parameter names, or is named as removed.

const RELATIONS_CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: { mode: "registered", entries: {} },
    relations: {
      mode: "registered",
      entries: {
        implements: { description: "implements" },
        "diverges-from": { description: "diverges from" },
        covers: { description: "covers" },
      },
    },
  },
  types: {
    module: {
      extends: "reference",
      description: "A module.",
      sections: {
        list: [
          {
            heading: "Relations",
            grammar: "relations",
            vocabulary: "relations",
            history: "History",
          },
          { heading: "History", grammar: "entries", date: "required" },
        ],
      },
    },
    bare: {
      extends: "reference",
      description: "A module with no History.",
      sections: { list: [{ heading: "Relations", grammar: "relations", vocabulary: "relations" }] },
    },
  },
};

const modulePage = (type: string, relations: readonly string[], history: readonly string[] = []) =>
  [
    "---",
    `type: ${type}`,
    "tags: []",
    "---",
    "",
    "Lede.",
    "",
    "## Relations",
    "",
    ...relations.map((r) => `- ${r}`),
    "",
    ...(type === "module" ? ["## History", "", ...history, ""] : []),
  ].join("\n");

function relationTransition(before: string, after: string) {
  const built = loadConstitution(RELATIONS_CONSTITUTION, SHIPPED);
  assert.equal(built.ok, true, JSON.stringify(built.ok ? [] : built.issues));
  if (!built.ok) throw new Error("unreachable");
  const collect = { dispositions: emptyDispositions() };
  const findings = lintPage(
    { path: "wiki/m.md", doc: parseDoc(after), registry: built.registry },
    { baseText: before, collect },
  );
  return {
    findings,
    removed: findings.filter((f) => f.ruleId === "relation-removed"),
    retired: findings.filter((f) => f.ruleId === "relation-retired"),
    dispositions: collect.dispositions,
  };
}

describe("a relation has a lifecycle through the seam (docs/extending.md §An arm)", () => {
  it("the relations grammar registers its identity: the label and the target, normalized", () => {
    const seam = transitionSeam("relations", SHIPPED);
    const a = seam.identityOf({ kind: "relation", raw: "x", label: "Implements", target: "REQ-1" });
    const b = seam.identityOf({
      kind: "relation",
      raw: "y",
      label: "implements",
      target: "req-1 ",
    });
    assert.notEqual(a, undefined);
    assert.equal(a, b, "spelling is identity, as everywhere in the engine");
    assert.notEqual(
      a,
      seam.identityOf({ kind: "relation", raw: "z", label: "covers", target: "REQ-1" }),
    );
    assert.equal(
      seam.identityOf({ kind: "relation", raw: "x" }),
      undefined,
      "no label, no identity",
    );
    // `entries` registers neither, and gets the closed defaults.
    const entries = transitionSeam("entries", SHIPPED);
    assert.equal(entries.identityOf({ kind: "entry", raw: "x" }), undefined);
    assert.equal(
      entries.isCorrection({ kind: "entry", raw: "x" }, { kind: "entry", raw: "y" }),
      false,
    );
  });

  it("a dropped relation is named — label and target — and counted", () => {
    const result = relationTransition(
      modulePage("module", ["diverges-from [[REQ-1]]", "covers [[REQ-2]]"]),
      modulePage("module", ["diverges-from [[REQ-1]]"]),
    );
    assert.equal(result.removed.length, 1);
    assert.deepEqual(result.removed[0]?.details, { label: "covers", target: "REQ-2" });
    assert.equal(result.removed[0]?.severity, "warning", "a declared row, undeclared knob");
    assert.match(result.removed[0]?.remediation ?? "", /"## History"/);
    assert.deepEqual(result.dispositions, {
      relation_unchanged: 1,
      relation_added: 0,
      relation_retired: 0,
      relation_removed: 1,
    });
  });

  it("a relabel is a removal of one identity and an addition of another", () => {
    const result = relationTransition(
      modulePage("module", ["diverges-from [[REQ-1]]"]),
      modulePage("module", ["implements [[REQ-1]]"]),
    );
    assert.deepEqual(result.removed[0]?.details, { label: "diverges-from", target: "REQ-1" });
    assert.deepEqual(result.dispositions, {
      relation_unchanged: 0,
      relation_added: 1,
      relation_retired: 0,
      relation_removed: 1,
    });
  });

  it("a NEW History line quoting the relation is the landing; an inherited one is not", () => {
    const closing = "- 2026-09-05 — retired diverges-from [[REQ-1]]: the RTL was read";
    const landed = relationTransition(
      modulePage("module", ["diverges-from [[REQ-1]]"]),
      modulePage("module", ["implements [[REQ-1]]"], [closing]),
    );
    assert.deepEqual(landed.removed, []);
    assert.equal(landed.retired.length, 1);
    assert.deepEqual(landed.retired[0]?.details, { label: "diverges-from", target: "REQ-1" });
    assert.equal(landed.retired[0]?.line, 14);
    assert.deepEqual(landed.dispositions, {
      relation_unchanged: 0,
      relation_added: 1,
      relation_retired: 1,
      relation_removed: 0,
    });

    const inherited = relationTransition(
      modulePage("module", ["diverges-from [[REQ-1]]"], [closing]),
      modulePage("module", ["implements [[REQ-1]]"], [closing]),
    );
    assert.equal(inherited.removed.length, 1, "a line the base already carried closes nothing");
  });

  it("with no History declared the removal is still named, and the remediation says what to declare", () => {
    const result = relationTransition(
      modulePage("bare", ["covers [[REQ-2]]"]),
      modulePage("bare", []),
    );
    assert.equal(result.removed.length, 1);
    assert.match(result.removed[0]?.remediation ?? "", /declare `history`/);
  });
});
