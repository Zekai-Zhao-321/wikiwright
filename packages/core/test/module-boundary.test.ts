// docs/extending.md — the refusals that make the
// registration seam a boundary rather than a suggestion.
//
// Every case here is a hole a review found, reproduced before it was fixed: a module could claim a kernel arm id and re-severity it, an arm could
// emit under any id and inherit that id's row, `needsBase` was honoured where
// arms are COUNTED but not where they RUN, an applicability typo loaded inert,
// and omitting the registry silently ran no module arm at all.
//
// The theme is one sentence: a public seam is defined by its refusals.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { armRows, checkGrammar, parseSections, sectionBinding } from "../src/grammar/index.ts";
import {
  KERNEL_OWNED_ARMS,
  loadModules,
  type ModuleManifest,
  observedValues,
  safeParseModule,
  transitionSeam,
} from "../src/modules/index.ts";
import { parseDoc } from "../src/parse/index.ts";
import { STANDARD_LIBRARY } from "../src/stdlib/index.ts";

const page = (body: readonly string[]): string =>
  ["---", "type: person", "tags: []", "---", "", "Lede.", "", ...body, ""].join("\n");

/** A module whose one grammar is shaped by the caller — the fixture for every case. */
function kit(arm: Record<string, unknown>, params: Record<string, unknown> = {}): ModuleManifest {
  return {
    id: "acme/probe",
    grammars: {
      "acme/probe/g": {
        kinds: ["acme/probe:item"],
        parse: (text: string) => ({ kind: "acme/probe:item", text }),
        params,
        arms: [arm],
      } as never,
    },
  };
}

function loadedWith(manifest: ModuleManifest) {
  const loaded = loadModules([...STANDARD_LIBRARY, manifest]);
  return loaded;
}

function findingsFrom(manifest: ModuleManifest, body: readonly string[]) {
  const loaded = loadedWith(manifest);
  assert.equal(loaded.ok, true, "the fixture module loads");
  if (!loaded.ok) throw new Error("unreachable");
  const binding = sectionBinding(
    { heading: "S", depth: 2, grammar: "acme/probe/g" },
    {},
    loaded.registry,
  );
  const ast = parseSections(parseDoc(page(["## S", "", ...body])), [binding]);
  return checkGrammar(ast, { modules: loaded.registry });
}

describe("the seam fails closed (docs/extending.md)", () => {
  // Reproduced: the module's row won, and `canonical-form` became an
  // `error` the section could not quiet.
  it("a module may not claim a kernel-owned arm id", () => {
    const loaded = loadedWith(kit({ id: "canonical-form", row: "error" }));
    assert.equal(loaded.ok, false, "a kernel arm id is reserved");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "arm-reserved");
    assert.equal(loaded.conflicts[0]?.id, "canonical-form");
  });

  it("every kernel-owned arm is reserved, not just the one that was reported", () => {
    for (const id of KERNEL_OWNED_ARMS) {
      const loaded = loadedWith(kit({ id, row: "error" }));
      assert.equal(loaded.ok, false, `"${id}" is reserved`);
    }
  });

  it("the composed view still answers with the kernel's row", () => {
    const loaded = loadModules(STANDARD_LIBRARY);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) throw new Error("unreachable");
    assert.equal(armRows(loaded.registry).get("canonical-form"), "info");
  });

  // Reproduced: an arm declared `info` emitted `vocabulary-retired`
  // and received `error`. Removing the severity PARAMETER was never enough
  // while the id was free, because the row follows the id.
  // The refusal is exact and still throws inside the emit — a module author must
  // meet it — and the kernel catches the throw at the arm loop and reports it as an
  // attributed `module-failure`. That is the loss this record wrote down and
  // refused to ship kit loading without closing: a stranger's bug is one error on
  // one page, naming the module, not an unattributed crash that takes the whole
  // vault's verdict with it.
  it("an arm that emits another arm's id is refused, and the refusal is attributed", () => {
    const found = findingsFrom(
      kit({
        id: "acme/probe/census",
        row: "info",
        run: (item: { line: number }, ctx: { emit: (...a: unknown[]) => void }) => {
          ctx.emit("vocabulary-retired", item.line, "borrowed", {}, "x");
        },
      }),
      ["- anything"],
    );
    // The borrowed id never reaches the findings…
    assert.equal(
      found.some((f) => f.ruleId === "vocabulary-retired"),
      false,
      "the id an arm may not write is not written",
    );
    // …and the failure is reported, naming the arm that reached and its module.
    const failure = found.find((f) => f.ruleId === "module-failure");
    assert.notEqual(failure, undefined, JSON.stringify(found));
    assert.equal(failure?.severity, "error");
    assert.equal(failure?.details["module"], "acme/probe");
    assert.equal(failure?.details["arm"], "acme/probe/census");
    assert.match(failure?.message ?? "", /acme\/probe\/census/u);
  });

  it("an arm that throws for any other reason is reported the same way", () => {
    const found = findingsFrom(
      kit({
        id: "acme/probe/boom",
        row: "declared",
        lane: "grammar-review",
        run: () => {
          throw new Error("a stranger's bug");
        },
      }),
      ["- anything"],
    );
    const failure = found.find((f) => f.ruleId === "module-failure");
    assert.notEqual(failure, undefined, JSON.stringify(found));
    assert.match(failure?.message ?? "", /a stranger's bug/u);
  });

  it("and one arm's failure does not stop the arms beside it", () => {
    const manifest: ModuleManifest = {
      id: "acme/probe",
      grammars: {
        "acme/probe/g": {
          kinds: ["acme/probe:item"],
          parse: (text: string) => ({ kind: "acme/probe:item", text }),
          params: {},
          arms: [
            {
              id: "acme/probe/boom",
              row: "declared",
              lane: "grammar-review",
              run: () => {
                throw new Error("first");
              },
            },
            {
              id: "acme/probe/fine",
              row: "info",
              run: (item: { line: number }, ctx: { emit: (...a: unknown[]) => void }) => {
                ctx.emit("acme/probe/fine", item.line, "still ran", {}, "x");
              },
            },
          ],
        } as never,
      },
    };
    const found = findingsFrom(manifest, ["- anything"]);
    assert.equal(
      found.some((f) => f.ruleId === "acme/probe/fine"),
      true,
      "the blast radius is one arm, not the section",
    );
  });

  it("and emitting its own id still works", () => {
    const found = findingsFrom(
      kit({
        id: "acme/probe/census",
        row: "info",
        run: (item: { line: number }, ctx: { emit: (...a: unknown[]) => void }) => {
          ctx.emit("acme/probe/census", item.line, "mine", {}, "x");
        },
      }),
      ["- anything"],
    );
    const mine = found.filter((f) => f.ruleId === "acme/probe/census");
    assert.equal(mine.length, 1, JSON.stringify(found));
    assert.equal(mine[0]?.severity, "info", "and takes the row its own manifest declared");
  });

  // docs/concepts.md §Findings and routing: a module registers no fixer. The one its arm names must be
  // a fixer the kernel ships for THAT id, or the row would print a route the
  // verb refuses.
  it("an arm naming a fixer the registry does not carry for it is refused", () => {
    const loaded = loadedWith(
      kit({ id: "acme/probe/fixable", row: "declared", lane: "grammar-review", fixer: "retype" }),
    );
    assert.equal(loaded.ok, false, "`retype` executes `tombstone`, not this arm");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "arm-fixer-unknown");
  });

  it("a transition arm that does not run still carries its row", () => {
    const loaded = loadedWith(
      kit({
        id: "acme/probe/transition",
        row: "declared",
        lane: "grammar-review",
        needsBase: true,
      }),
    );
    assert.equal(loaded.ok, true, "a declared-only arm is still legal");
  });

  // Reproduced: a `needsBase` arm with a per-item `run` ran with no
  // base anywhere in sight, then was skipped silently once the loop learned to
  // honour the flag. Neither is right: a transition is `runTransition` against
  // a base, a per-item pass runs without one, and an arm is one or the other.
  it("a needsBase arm with a per-item predicate is refused at load", () => {
    const loaded = loadedWith(
      kit({
        id: "acme/probe/needs-base",
        row: "declared",
        lane: "grammar-review",
        needsBase: true,
        run: () => undefined,
      }),
    );
    assert.equal(loaded.ok, false);
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "arm-base-mismatch");
  });

  it("a transition predicate without needsBase is refused at load", () => {
    const loaded = loadedWith(
      kit({
        id: "acme/probe/transition",
        row: "declared",
        lane: "grammar-review",
        runTransition: () => undefined,
      }),
    );
    assert.equal(loaded.ok, false, "it would read `evaluated` on a page it never saw");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "arm-base-mismatch");
  });

  // Reproduced: `mdoe` against a grammar declaring `mode` loaded clean
  // and the arm silently never applied. Same shape as every declared-but-inert
  // defect this project has found.
  it("an arm's applicability condition names a parameter its grammar declares", () => {
    const loaded = loadedWith(
      kit(
        {
          id: "acme/probe/arm",
          row: "declared",
          lane: "grammar-review",
          on: { param: "mdoe" },
          run: () => undefined,
        },
        { mode: { introduction: "any-depth", value: {}, law: "identity" } },
      ),
    );
    assert.equal(loaded.ok, false, "a typo in `on` is refused at load");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "applicability-unknown-param");
    assert.equal(loaded.conflicts[0]?.id, "mdoe");
  });

  it("a delegation's condition is held to the same rule", () => {
    const manifest: ModuleManifest = {
      id: "acme/probe",
      grammars: {
        "acme/probe/g": {
          kinds: ["acme/probe:item"],
          parse: (text: string) => ({ kind: "acme/probe:item", text }),
          params: { mode: { introduction: "any-depth", value: {}, law: "identity" } },
          delegates: [{ to: "entry", on: { param: "mdoe" } }],
          arms: [],
        } as never,
      },
    };
    const loaded = loadedWith(manifest);
    assert.equal(loaded.ok, false, "a typo in a delegation's `on` is refused too");
    if (loaded.ok) throw new Error("unreachable");
    assert.equal(loaded.conflicts[0]?.kind, "applicability-unknown-param");
  });

  it("a correctly spelled condition still loads", () => {
    const loaded = loadedWith(
      kit(
        {
          id: "acme/probe/arm",
          row: "declared",
          lane: "grammar-review",
          on: { param: "mode" },
          run: () => undefined,
        },
        { mode: { introduction: "any-depth", value: {}, law: "identity" } },
      ),
    );
    assert.equal(loaded.ok, true, "the refusal is about the typo, not about `on`");
  });

  // Found by probing rather than by reading. Every one of these is a
  // module entry point the kernel calls OUTSIDE the arm loop, so the arm loop's
  // guard did not cover it: a throw ended the page's parse, the vault's census,
  // or the whole constitution load, with the module's own message and nothing
  // saying whose it was.
  describe("every module entry point fails closed, not loudly", () => {
    const grammarWith = (overrides: Record<string, unknown>): ModuleManifest => ({
      id: "acme/probe",
      grammars: {
        "acme/probe/g": {
          kinds: ["acme/probe:item"],
          parse: (text: string) => ({ kind: "acme/probe:item", text }),
          params: {},
          arms: [],
          ...overrides,
        } as never,
      },
    });

    it("a `canonicalize` that throws loses its census row, not the page", () => {
      const found = findingsFrom(
        grammarWith({
          canonicalize: () => {
            throw new Error("bug");
          },
        }),
        ["- anything"],
      );
      // The page was judged; the dialect census simply has nothing to say.
      assert.equal(
        found.some((f) => f.ruleId === "canonical-form"),
        false,
      );
    });

    it("an `observes` that throws counts nothing, and does not end the census", () => {
      const loaded = loadedWith(
        grammarWith({
          observes: () => {
            throw new Error("bug");
          },
        }),
      );
      assert.equal(loaded.ok, true);
      if (!loaded.ok) throw new Error("unreachable");
      assert.deepEqual(
        observedValues(
          "categories",
          { kind: "acme/probe:item", raw: "x" } as never,
          loaded.registry,
        ),
        [],
      );
    });

    it("a transition capability that throws gives the CLOSED default, not a throw", () => {
      const loaded = loadedWith(
        grammarWith({
          identityOf: () => {
            throw new Error("bug");
          },
          isCorrection: () => {
            throw new Error("bug");
          },
        }),
      );
      assert.equal(loaded.ok, true);
      if (!loaded.ok) throw new Error("unreachable");
      const seam = transitionSeam("acme/probe/g", loaded.registry);
      // No identity and no correction: both are the STRICTER reading, so a
      // module's bug makes the transition arm louder rather than quieter.
      assert.equal(seam.identityOf({ kind: "acme/probe:item", raw: "x" }), undefined);
      assert.equal(
        seam.isCorrection(
          { kind: "acme/probe:item", raw: "x" },
          { kind: "acme/probe:item", raw: "y" },
        ),
        false,
      );
    });

    it("a schema that throws refuses the value, naming the module's schema", () => {
      const boom = {
        safeParse: () => {
          throw new Error("schema bug");
        },
      } as never;
      const parsed = safeParseModule(boom, 1, 'parameter "x"');
      assert.equal(parsed.success, false);
      if (parsed.success) throw new Error("unreachable");
      assert.match(parsed.issues[0]?.message ?? "", /the module's own schema threw/u);
      assert.match(parsed.issues[0]?.message ?? "", /schema bug/u);
    });
  });

  // The enforcement point is the TYPECHECKER: `modules` is a required
  // field of `GrammarCheckOptions`, and `tsc -p tsconfig.test.json` runs in the
  // gate. This case does not duplicate that; it guards the hole a cast can still
  // open, which is not hypothetical — a parity test once built
  // a Law with no `modules` behind `as never`, and nothing reached the field
  // until the coverage loop did.
  //
  // What this replaced, because the replacement is the point: a source scan
  // asserting "no call site omits the registry". It duplicated the typechecker
  // more weakly and reported `lint/index.ts:1065` — a call that passes the
  // registry inside a variable — as an offender on its first run. A check that
  // is both redundant and wrong is worse than no check.
  it("a caller that casts past the type fails loudly rather than silently", () => {
    const loaded = loadModules(STANDARD_LIBRARY);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) throw new Error("unreachable");
    const binding = sectionBinding(
      { heading: "Facts", depth: 2, grammar: "claims" },
      { vocabulary: "categories", provenance: "optional" },
      loaded.registry,
    );
    const ast = parseSections(
      parseDoc(page(["## Facts", "", "- [identity] name: X (recorded 2026-01-01)"])),
      [binding],
    );
    // With the registry, the claims arms run and the census row fires.
    const withRegistry = checkGrammar(ast, { modules: loaded.registry });
    assert.equal(
      withRegistry.some((f) => f.ruleId === "provenance-weak"),
      true,
      "the fixture reaches a module arm at all",
    );
    // Without it, omission must not read as a clean page. Before the refusals this
    // returned [] — every module arm silently absent, which is the verdict a
    // defect-free vault gets.
    assert.throws(() => checkGrammar(ast, {} as never), /modules|undefined/);
  });
});
