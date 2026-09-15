// (normalized-identity contract) · docs/constitution.md §Types (NFC +
// casefold with day-one CJK tests) · vendored generated casefold table
// locale-free code-unit ordering
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeUnitCompare, foldCase, normalizeIdentity } from "../src/identity/index.ts";

describe("normalizeIdentity — canonical equivalence (NFC)", () => {
  it("treats composed and decomposed forms as one identity", () => {
    const composed = "café"; // é as U+00E9
    const decomposed = "café"; // e + combining acute
    assert.equal(normalizeIdentity(composed), normalizeIdentity(decomposed));
  });

  it("is idempotent", () => {
    for (const s of ["Reset", "café", "张伟", "STRASSE", "İstanbul"]) {
      const once = normalizeIdentity(s);
      assert.equal(normalizeIdentity(once), once);
    }
  });
});

describe("normalizeIdentity — full case folding (the 239-divergence class)", () => {
  it("folds ASCII case", () => {
    assert.equal(normalizeIdentity("Reset"), normalizeIdentity("reset"));
  });

  it("folds ß and ẞ to ss (toLowerCase cannot)", () => {
    assert.equal(normalizeIdentity("straße"), normalizeIdentity("STRASSE"));
    assert.equal(normalizeIdentity("ẞ"), normalizeIdentity("ss"));
  });

  it("folds the fi ligature to fi", () => {
    assert.equal(normalizeIdentity("ﬁle"), normalizeIdentity("file"));
  });

  it("folds dotted capital I (U+0130) consistently with i + combining dot", () => {
    assert.equal(normalizeIdentity("İstanbul"), normalizeIdentity("i̇stanbul"));
  });

  it("folds every Greek sigma form to one identity", () => {
    assert.equal(normalizeIdentity("Σ"), normalizeIdentity("σ"));
    assert.equal(normalizeIdentity("ς"), normalizeIdentity("σ"));
  });
});

describe("normalizeIdentity — CJK (the day-one bilingual surface)", () => {
  it("keeps Han text byte-stable under folding", () => {
    assert.equal(normalizeIdentity("张伟"), "张伟");
  });

  it("keeps distinct Han names distinct", () => {
    assert.notEqual(normalizeIdentity("张伟"), normalizeIdentity("张玮"));
  });

  it("mixed-script identities fold the Latin part only", () => {
    assert.equal(normalizeIdentity("张伟-DEV"), normalizeIdentity("张伟-dev"));
  });
});

describe("foldCase — raw folding layer", () => {
  it("maps via the vendored table, passing unmapped code points through", () => {
    assert.equal(foldCase("A"), "a");
    assert.equal(foldCase("ß"), "ss");
    assert.equal(foldCase("张"), "张");
  });
});

describe("codeUnitCompare — locale-free ordering", () => {
  it("orders by code unit, never by locale collation", () => {
    const sorted = ["ä", "z", "a"].sort(codeUnitCompare);
    // Collation would give a, ä, z; code units give a (61), z (7a), ä (e4).
    assert.deepEqual(sorted, ["a", "z", "ä"]);
  });

  it("is a total order consistent with equality", () => {
    assert.equal(codeUnitCompare("a", "a"), 0);
    assert.equal(codeUnitCompare("a", "b") < 0, true);
    assert.equal(codeUnitCompare("b", "a") > 0, true);
  });

  it("orders CJK deterministically", () => {
    const sorted = ["玮", "伟", "张"].sort(codeUnitCompare);
    assert.deepEqual(sorted, ["伟", "张", "玮"]);
  });
});
