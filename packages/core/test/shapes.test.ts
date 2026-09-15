// One bounded shape vocabulary for frontmatter field schemas:
// inspectable data, validated at load, never executable; unknown kinds and malformed shapes are load errors.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkValue, pinFieldOf, validateShape } from "../src/shapes/index.ts";

describe("shape meta-validation", () => {
  it("accepts every documented kind", () => {
    const shapes = [
      { kind: "string", min_length: 1, max_length: 200, pattern: "^[A-Z]+-[0-9]+$" },
      { kind: "integer" },
      { kind: "number", min: 0, max: 10 },
      { kind: "boolean" },
      { kind: "enum", values: ["draft", "active"] },
      { kind: "date" },
      { kind: "datetime" },
      { kind: "list", item: { kind: "string", min_length: 1 }, min_items: 1 },
      {
        kind: "object",
        keys: { name: { kind: "string" }, count: { kind: "integer" } },
        required: ["name"],
      },
      { kind: "page-ref", target_root: "raw" },
      { kind: "page-ref-list", target_root: "raw" },
      { kind: "pin", origin: "locator" },
      { kind: "pin", origin: "locator", covers: "covers", required: true },
    ];
    for (const shape of shapes) {
      assert.deepEqual(validateShape(shape), [], JSON.stringify(shape));
    }
  });

  it("refuses unknown kinds, unknown keys, and malformed nests", () => {
    assert.notEqual(validateShape({ kind: "uuid" }).length, 0);
    assert.notEqual(validateShape({ kind: "string", minLength: 1 }).length, 0);
    assert.notEqual(validateShape({ kind: "list" }).length, 0, "list needs an item shape");
    assert.notEqual(
      validateShape({ kind: "list", item: { kind: "nope" } }).length,
      0,
      "nested shapes validate recursively",
    );
    assert.notEqual(validateShape({ kind: "enum", values: [] }).length, 0);
    assert.notEqual(validateShape({ kind: "string", pattern: "([" }).length, 0, "bad regex");
  });
});

describe("value checking", () => {
  it("string constraints", () => {
    const shape = { kind: "string", min_length: 2, pattern: "^[a-z]+$" };
    assert.deepEqual(checkValue("abc", shape), []);
    assert.notEqual(checkValue("", shape).length, 0);
    assert.notEqual(checkValue("A1", shape).length, 0);
    assert.notEqual(checkValue([], shape).length, 0, "record_id: [] fails the string shape");
  });

  it("numbers, integers, booleans, enums", () => {
    assert.deepEqual(checkValue(3, { kind: "integer" }), []);
    assert.notEqual(checkValue(3.5, { kind: "integer" }).length, 0);
    assert.notEqual(checkValue(11, { kind: "number", max: 10 }).length, 0);
    assert.deepEqual(checkValue(true, { kind: "boolean" }), []);
    assert.deepEqual(checkValue("draft", { kind: "enum", values: ["draft", "active"] }), []);
    assert.notEqual(checkValue("gone", { kind: "enum", values: ["draft"] }).length, 0);
  });

  it("dates are real calendar dates, not just shaped strings", () => {
    assert.deepEqual(checkValue("2026-09-01", { kind: "date" }), []);
    assert.notEqual(checkValue("2026-13-01", { kind: "date" }).length, 0);
    assert.notEqual(checkValue("2026-02-30", { kind: "date" }).length, 0);
    assert.deepEqual(checkValue("2026-09-01T10:00:00Z", { kind: "datetime" }), []);
  });

  it("a dated string carries a date inside the text", () => {
    assert.deepEqual(checkValue("seen 2026-01-01 in the ledger", { kind: "dated-string" }), []);
    assert.notEqual(checkValue("sometime last spring", { kind: "dated-string" }).length, 0);
  });

  it("lists and closed objects", () => {
    const list = { kind: "list", item: { kind: "string", min_length: 1 }, min_items: 1 };
    assert.deepEqual(checkValue(["a"], list), []);
    assert.notEqual(checkValue([], list).length, 0);
    assert.notEqual(checkValue(["a", ""], list).length, 0, "item problems carry the index");
    const obj = {
      kind: "object",
      keys: { name: { kind: "string" } },
      required: ["name"],
    };
    assert.deepEqual(checkValue({ name: "x" }, obj), []);
    assert.notEqual(checkValue({}, obj).length, 0);
    assert.notEqual(checkValue({ name: "x", extra: 1 }, obj).length, 0, "keys are closed");
  });

  it("page refs resolve through the name index and pin the root", () => {
    const names = {
      resolve: (name: string) =>
        name === "capture" ? { path: "raw/capture.md", viaAlias: false } : undefined,
    };
    const shape = { kind: "page-ref", target_root: "raw" };
    assert.deepEqual(checkValue("capture", shape, { names }), []);
    assert.notEqual(checkValue("ghost", shape, { names }).length, 0);
    assert.notEqual(
      checkValue("capture", { kind: "page-ref", target_root: "wiki" }, { names }).length,
      0,
      "the resolved page must live under the declared root",
    );
    assert.deepEqual(
      checkValue(["capture"], { kind: "page-ref-list", target_root: "raw" }, { names }),
      [],
    );
  });
});

// docs/constitution.md §Shapes: a field that pins a git revision of an origin named by a
// sibling field. The kernel learns exactly that.
describe("the pin kind (docs/constitution.md §Shapes)", () => {
  it("needs an origin sibling, and covers must name one", () => {
    assert.notEqual(validateShape({ kind: "pin" }).length, 0, "origin is required");
    assert.notEqual(validateShape({ kind: "pin", origin: "" }).length, 0);
    assert.notEqual(validateShape({ kind: "pin", origin: "locator", covers: 3 }).length, 0);
    assert.notEqual(validateShape({ kind: "pin", origin: "locator", pattern: "x" }).length, 0);
  });

  it("its value law is a full lowercase SHA-1 or SHA-256 id — an abbreviation cannot be compared with a head", () => {
    const shape = { kind: "pin", origin: "locator" };
    assert.deepEqual(checkValue("a".repeat(40), shape), []);
    assert.deepEqual(checkValue("0123456789abcdef".repeat(4), shape), []);
    assert.notEqual(checkValue("abc1234", shape).length, 0, "abbreviated");
    assert.notEqual(checkValue("A".repeat(40), shape).length, 0, "uppercase");
    assert.notEqual(checkValue("a".repeat(41), shape).length, 0);
    assert.notEqual(checkValue(42, shape).length, 0);
  });

  it("pinFieldOf reads the one pin off a type's fields with the siblings it names", () => {
    const fields = new Map<string, { shape: unknown }>([
      ["locator", { shape: { kind: "string" } }],
      ["commit", { shape: { kind: "pin", origin: "locator", covers: "covers" } }],
      ["covers", { shape: { kind: "list", item: { kind: "string" } } }],
    ]);
    assert.deepEqual(pinFieldOf(fields), { field: "commit", origin: "locator", covers: "covers" });
    assert.deepEqual(pinFieldOf(new Map([["commit", { shape: { kind: "pin", origin: "url" } }]])), {
      field: "commit",
      origin: "url",
    });
    assert.equal(pinFieldOf(new Map([["pin", { shape: { kind: "string" } }]])), undefined);
  });
});

// A page reference is the canonical name. A path resolves to no page and
// the refusal says what the legal form is — `move` changes paths and keeps
// names, so a path is the form that breaks next.
describe("page references are names, never paths", () => {
  const names = {
    resolve: (name: string) =>
      name === "sst-8088" ? { path: "raw/sst-8088.md", viaAlias: false } : undefined,
  };
  it("a path is refused with the canonical name named", () => {
    const problems = checkValue(
      ["raw/sst-8088.md"],
      { kind: "page-ref-list" },
      { names },
      "sources",
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /"raw\/sst-8088\.md" is a path/);
    assert.match(problems[0] ?? "", /here "sst-8088"/);
    assert.deepEqual(checkValue(["sst-8088"], { kind: "page-ref-list" }, { names }, "sources"), []);
  });

  it("a name that resolves to nothing says so, and says what a reference is", () => {
    const problems = checkValue("nobody", { kind: "page-ref" }, { names }, "spouse");
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /resolves to no page — a page reference is the canonical name/);
  });
});
