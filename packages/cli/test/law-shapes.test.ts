// v2 contracts §3.1: shapes. The gardening constitution under os.tmpdir(),
// compiled by Ajv 2020 in strict mode with RE2 for `pattern`, the engine's
// formats, `$defs` and keywords; the effective shape composed with `allOf` and
// closed once; and the load-time codes a shape raises.
import { afterAll, describe, expect, it } from "bun:test";
import { loadTypeLaw, type TypeLaw, type TypeLawResult } from "@wikiwright/core";
import { workingTreeLawSnapshot } from "../src/lawfiles.ts";
import { engineJson, gardenTree, removeTree, type Tree, writeTree } from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) removeTree(dir);
});

async function load(overrides: Tree = {}): Promise<TypeLawResult> {
  const dir = writeTree({ ...gardenTree(), ...overrides });
  made.push(dir);
  return loadTypeLaw(await workingTreeLawSnapshot(dir));
}

async function law(overrides: Tree = {}): Promise<TypeLaw> {
  const result = await load(overrides);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.law;
}

function codes(result: TypeLawResult): string[] {
  return result.ok ? [] : result.issues.map((i) => i.code);
}

/** A bundle type with the given fields block, beside the fixture. */
function typeWith(name: string, body: string): Tree {
  return { [`constitution/types/${name}.yaml`]: `type: ${name}\n${body}` };
}

const BASIL = {
  type: "planting",
  title: "Basil in the herb bed",
  tags: ["herbs"],
  bed: "herb",
  sown: "2026-04-12",
  source: "https://seeds.example/basil",
  origin: "Herb bed",
};

describe("the effective shape", () => {
  it("is allOf of the reserved keys and every document, each with its own $id, closed once", async () => {
    const shape = (await law()).shapes.get("planting") as Record<string, unknown>;
    expect(shape["$id"]).toBe("wikiwright:shape/planting");
    expect(shape["unevaluatedProperties"]).toBe(false);
    expect((shape["allOf"] as { $id: string }[]).map((p) => p.$id)).toEqual([
      "wikiwright:reserved",
      "wikiwright:fragment/garden/planted",
      "wikiwright:type/planting",
    ]);
    // Each document carries the engine's $defs beside its own, so a local
    // $ref resolves inside its own resource.
    for (const part of shape["allOf"] as Record<string, unknown>[]) {
      expect(Object.keys(part["$defs"] as object)).toEqual(["page-ref", "page-ref-list", "pin"]);
      expect("unevaluatedProperties" in part).toBe(false);
    }
  });

  it("accepts a conformant page and refuses what the documents refuse", async () => {
    const validate = (await law()).validators.get("planting");
    if (validate === undefined) throw new Error("no validator");
    expect(validate(BASIL)).toBe(true);
    const refused = (page: Record<string, unknown>): string[] => {
      expect(validate(page)).toBe(false);
      return (validate.errors ?? []).map((e) => e.keyword);
    };
    expect(refused({ ...BASIL, bed: "west" })).toContain("enum");
    expect(refused({ ...BASIL, sown: undefined })).toContain("required");
    expect(refused({ ...BASIL, title: undefined })).toContain("required");
    expect(refused({ ...BASIL, colour: "red" })).toContain("unevaluatedProperties");
    expect(refused({ ...BASIL, exceptions: [{ rule: "known-bed" }] })).toContain("required");
    expect(refused({ ...BASIL, status: "archived" })).toContain("enum");
    expect(refused({ ...BASIL, origin: "" })).toContain("minLength");
  });

  it("asserts date, date-time and uri with the engine's own validators", async () => {
    const validate = (await law()).validators.get("planting");
    if (validate === undefined) throw new Error("no validator");
    for (const sown of ["2026-02-30", "2026-9-5", "2026-13-01", "2025-02-29"]) {
      expect(validate({ ...BASIL, sown })).toBe(false);
    }
    expect(validate({ ...BASIL, sown: "2028-02-29" })).toBe(true);
    expect(validate({ ...BASIL, source: "seeds" })).toBe(false);
    expect(validate({ ...BASIL, source: "mailto:grower@seeds.example" })).toBe(true);
    const stamped = await law(
      typeWith(
        "log",
        "role: reference\ndescription: A log.\nfields:\n  type: object\n  properties:\n    at: { type: string, format: date-time }\n",
      ),
    );
    const log = stamped.validators.get("log");
    if (log === undefined) throw new Error("no validator");
    const at = (value: string) => log({ type: "log", title: "L", at: value });
    expect(at("2026-09-26T08:30:00Z")).toBe(true);
    expect(at("2026-09-26T08:30:00.25+02:00")).toBe(true);
    expect(at("2026-09-26T24:00:00Z")).toBe(false);
    expect(at("2026-09-26 08:30:00Z")).toBe(false);
    expect(at("2026-02-30T08:30:00Z")).toBe(false);
  });

  it("leaves the shape open under extensions.mode open", async () => {
    const open = await law({ "config/engine.json": engineJson({ extensions: { mode: "open" } }) });
    expect("unevaluatedProperties" in (open.shapes.get("planting") ?? {})).toBe(false);
    expect(open.validators.get("planting")?.({ ...BASIL, colour: "red" })).toBe(true);
  });

  it("derives no title requirement where field_sources.title does", async () => {
    const derived = await law({
      "config/engine.json": engineJson({ field_sources: { title: "basename" } }),
    });
    expect(derived.validators.get("planting")?.({ ...BASIL, title: undefined })).toBe(true);
  });
});

describe("patterns run on RE2", () => {
  const withPattern = (pattern: string): Tree =>
    typeWith(
      "label",
      `role: reference\ndescription: A plant label.\nfields:\n  type: object\n  properties:\n    code: { type: string, pattern: ${JSON.stringify(pattern)} }\n`,
    );

  it.each([
    ["a lookahead", "^(?!/).+$"],
    ["a backreference", "^(a)\\1$"],
  ])("refuses %s as shape-invalid", async (_label, pattern) => {
    const result = await load(withPattern(pattern));
    expect(codes(result)).toEqual(["shape-invalid"]);
    expect(result.ok ? undefined : result.issues[0]?.where).toBe(
      "bundle:constitution/types/label.yaml",
    );
  });

  it("keeps two patterns apart (Ajv's pattern cache keys on the compiled object's name)", async () => {
    const loaded = await law({
      ...withPattern("^B-[0-9]+$"),
      ...typeWith(
        "tag-label",
        "role: reference\ndescription: A tag.\nfields:\n  type: object\n  properties:\n    code: { type: string, pattern: '^T-[0-9]+$' }\n",
      ),
    });
    const label = loaded.validators.get("label");
    const tag = loaded.validators.get("tag-label");
    expect(label?.({ type: "label", title: "x", code: "B-1" })).toBe(true);
    expect(label?.({ type: "label", title: "x", code: "T-1" })).toBe(false);
    expect(tag?.({ type: "tag-label", title: "x", code: "T-1" })).toBe(true);
    expect(tag?.({ type: "tag-label", title: "x", code: "B-1" })).toBe(false);
  });

  it("answers a pattern that backtracks exponentially in JavaScript in linear time", async () => {
    const validate = (await law(withPattern("^(a+)+$"))).validators.get("label");
    const started = performance.now();
    expect(validate?.({ type: "label", title: "x", code: `${"a".repeat(40)}!` })).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("load-time codes of a shape", () => {
  const fields = (body: string): Tree =>
    typeWith("label", `role: reference\ndescription: A plant label.\nfields:\n${body}`);

  it.each([
    [
      "a format outside the three",
      "  type: object\n  properties:\n    mail: { type: string, format: email }\n",
    ],
    ["an authored additionalProperties", "  type: object\n  additionalProperties: false\n"],
    [
      "an authored unevaluatedProperties applied in place at the top",
      "  type: object\n  allOf:\n    - { unevaluatedProperties: false }\n",
    ],
    ["an authored $id", "  $id: https://example.org/label\n  type: object\n"],
    [
      "a remote $ref",
      "  type: object\n  properties:\n    kind: { $ref: 'https://example.org/kind.json' }\n",
    ],
    [
      "a $ref to a $def nobody declares",
      "  type: object\n  properties:\n    kind: { $ref: '#/$defs/kind' }\n",
    ],
    ["an unknown keyword", "  type: object\n  x-note: a\n"],
    ["properties without type: object", "  properties:\n    code: { type: string }\n"],
    ["required naming a property declared nowhere", "  type: object\n  required: [nowhere]\n"],
    [
      "target_type beside a plain string",
      "  type: object\n  properties:\n    bed: { type: string, target_type: garden/bed }\n",
    ],
    [
      "target_type naming no type",
      "  type: object\n  properties:\n    bed: { $ref: '#/$defs/page-ref', target_type: garden/pond }\n",
    ],
    [
      "target_type that is not a string",
      "  type: object\n  properties:\n    bed: { $ref: '#/$defs/page-ref', target_type: 5 }\n",
    ],
    [
      "target_type on a nested page reference",
      "  type: object\n  properties:\n    origin: { type: object, properties: { bed: { $ref: '#/$defs/page-ref', target_type: garden/bed } } }\n",
    ],
    [
      "target_root on a page reference applied in place",
      "  type: object\n  allOf:\n    - { properties: { seed: { $ref: '#/$defs/page-ref', target_root: content } } }\n",
    ],
    [
      "target_type on a $def",
      "  type: object\n  properties:\n    bed: { $ref: '#/$defs/bedref' }\n  $defs:\n    bedref: { $ref: '#/$defs/page-ref', target_type: garden/bed }\n",
    ],
    [
      "target_root naming an undeclared root",
      "  type: object\n  properties:\n    seed: { $ref: '#/$defs/page-ref', target_root: sources }\n",
    ],
  ])("refuses %s as shape-invalid", async (_label, body) => {
    expect(codes(await load(fields(body)))).toEqual(["shape-invalid"]);
  });

  it("accepts a nested object its author closes (ruling 8)", async () => {
    const loaded = await law(
      fields(
        "  type: object\n  properties:\n    size: { type: object, properties: { rows: { type: integer } }, additionalProperties: false }\n    tray: { type: object, properties: { cells: { type: integer } }, unevaluatedProperties: false }\n",
      ),
    );
    const validate = loaded.validators.get("label");
    expect(validate?.({ type: "label", title: "x", size: { rows: 3 }, tray: { cells: 6 } })).toBe(
      true,
    );
    expect(validate?.({ type: "label", title: "x", size: { rows: 3, cols: 2 } })).toBe(false);
    expect(validate?.({ type: "label", title: "x", tray: { cells: 6, lid: true } })).toBe(false);
  });

  it("accepts the engine keywords beside a page reference, and target_root content or a source root", async () => {
    const loaded = await law(
      fields(
        "  type: object\n  properties:\n    beds: { $ref: '#/$defs/page-ref-list', target_type: garden/bed, target_root: content }\n    seed: { $ref: '#/$defs/page-ref', target_root: raw }\n    pin: { $ref: '#/$defs/pin' }\n    kind: { $ref: '#/$defs/kind' }\n  $defs:\n    kind: { enum: [paper, slate] }\n",
      ),
    );
    const validate = loaded.validators.get("label");
    const page = {
      type: "label",
      title: "x",
      beds: ["Herb bed"],
      seed: "Basil seed",
      kind: "slate",
    };
    expect(validate?.(page)).toBe(true);
    expect(validate?.({ ...page, kind: "tin" })).toBe(false);
    expect(validate?.({ ...page, pin: { commit: "abc1234", origin: ".", covers: [] } })).toBe(true);
    expect(validate?.({ ...page, pin: { commit: "HEAD", origin: ".", covers: [] } })).toBe(false);
  });

  it("refuses a document $def under a reserved name as constitution-collision", async () => {
    const result = await load(fields("  type: object\n  $defs:\n    pin: { type: string }\n"));
    expect(codes(result)).toEqual(["constitution-collision"]);
  });

  describe("a child's declared keywords against its ancestors'", () => {
    const child = (name: string, parent: string, properties: string): Tree =>
      typeWith(
        name,
        `extends: ${parent}\ndescription: A narrower ${parent}.\nfields:\n  type: object\n  properties:\n${properties}`,
      );

    it.each([
      [
        "an enum admitting an inherited-enum outsider",
        "planting",
        "    bed: { type: string, enum: [north, pond] }\n",
        "enum",
        "relaxed",
      ],
      [
        "a lowered minimum",
        "garden/bed",
        "    size: { type: integer, minimum: 0 }\n",
        "minimum",
        undefined,
      ],
      ["a different type", "garden/bed", "    size: { type: number }\n", "type", undefined],
    ])("refuses %s as shape-relaxed", async (_label, parent, properties, keyword, kind) => {
      const result = await load(child("raised-bed", parent, properties));
      expect(codes(result)).toEqual(["shape-relaxed"]);
      expect(result.ok ? undefined : result.issues[0]?.details).toMatchObject({
        keyword,
        ...(kind === undefined ? {} : { kind }),
      });
    });

    it("names a disjoint enum a contradiction", async () => {
      const result = await load(
        child("pond-planting", "planting", "    bed: { type: string, enum: [pond] }\n"),
      );
      expect(codes(result)).toEqual(["shape-relaxed"]);
      expect(result.ok ? undefined : result.issues[0]?.details?.["kind"]).toBe("contradiction");
    });

    it("refuses a raised maxLength and a differing const", async () => {
      const parent = typeWith(
        "plaque",
        "role: reference\ndescription: A plaque.\nfields:\n  type: object\n  properties:\n    text: { type: string, maxLength: 20 }\n    shape: { const: square }\n",
      );
      const result = await load({
        ...parent,
        ...child(
          "big-plaque",
          "plaque",
          "    text: { type: string, maxLength: 40 }\n    shape: { const: round }\n",
        ),
      });
      expect(codes(result)).toEqual(["shape-relaxed", "shape-relaxed"]);
    });

    it("accepts a narrowing: a subset enum, a raised minimum, the same type", async () => {
      const loaded = await law(
        child("raised-bed", "garden/bed", "    size: { type: integer, minimum: 2, maximum: 9 }\n"),
      );
      expect(
        loaded.validators.get("raised-bed")?.({ type: "raised-bed", title: "x", size: 1 }),
      ).toBe(false);
    });

    it("refuses a differing default as default-conflict", async () => {
      const parent = typeWith(
        "plaque",
        "role: reference\ndescription: A plaque.\nfields:\n  type: object\n  properties:\n    colour: { type: string, default: white }\n",
      );
      const result = await load({
        ...parent,
        ...child("dark-plaque", "plaque", "    colour: { type: string, default: black }\n"),
      });
      expect(codes(result)).toEqual(["default-conflict"]);
    });
  });
});
