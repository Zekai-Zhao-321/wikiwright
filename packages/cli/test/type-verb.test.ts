// docs/cli.md §type (type show prints the flattened effective contract with
// provenance; type list carries provenance for archetypes and bundle types)
// docs/constitution.md §Types (the charter's use_when names the file; one map,
// `required` inside the shape, `contributedBy` beside it).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

interface Outcome {
  status: number;
  envelope: Record<string, unknown>;
}

function run(cwd: string, args: string[]): Outcome {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    // Never consult (or create) the developer's real trust store from a test.
    env: { ...process.env, WIKIWRIGHT_TRUST_FILE: join(cwd, ".trust.json") },
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function dataOf(o: Outcome): Record<string, unknown> {
  return (o.envelope["data"] ?? {}) as Record<string, unknown>;
}

function errorOf(envelope: Record<string, unknown>): Record<string, unknown> {
  return (envelope["error"] ?? {}) as Record<string, unknown>;
}

describe("type show --brief renders the type's template (docs/constitution.md §Types)", () => {
  it("the skeleton follows the template's order and keeps its optional headings, and the template's frontmatter seeds a field — what new writes", () => {
    // A template that lists the declared headings in the other order and adds
    // an optional one: the declaration alone would print neither.
    const tmp = mkdtempSync(join(tmpdir(), "ww-type-template-"));
    try {
      mkdirSync(join(tmp, "config"), { recursive: true });
      mkdirSync(join(tmp, "templates"), { recursive: true });
      mkdirSync(join(tmp, "wiki"), { recursive: true });
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify({
          schema: "wikiwright/constitution",
          schema_version: 3,
          vocabularies: { tags: { mode: "registered", entries: {} } },
          types: {
            recipe: {
              extends: "procedure",
              description: "A recipe.",
              template: "templates/recipe.md",
              fields: { serves: { kind: "integer", min: 1 }, oven: { kind: "string" } },
              sections: {
                depth: 2,
                list: [
                  { heading: "Steps", min: 1 },
                  { heading: "Ingredients", min: 1 },
                  { heading: "Notes", max: 1 },
                ],
              },
            },
          },
        }),
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({ content_roots: ["wiki"] }),
      );
      writeFileSync(
        join(tmp, "templates", "recipe.md"),
        // `serves: 4` seeds; `oven: ""` is a stub, not a seed; `title` is the
        // engine's and never seeds.
        '---\ntype: recipe\ntitle: "Template seed"\nserves: 4\noven: ""\n---\n\n# {{ title }}\n\n## Ingredients\n\n## Steps\n\n## Notes\n',
      );
      const shown = run(tmp, ["type", "show", "recipe", "--brief"]);
      assert.equal(shown.status, 0, JSON.stringify(shown.envelope));
      const skeleton = String(dataOf(shown)["skeleton"]);
      const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("#"));
      assert.deepEqual(headings(skeleton), ["# <title>", "## Ingredients", "## Steps", "## Notes"]);
      // The section lines follow the template too, so the two blocks
      // of one envelope agree; without --brief they keep declaration order.
      const headingOf = (line: string) => line.split(" | ")[0];
      assert.deepEqual((dataOf(shown)["section_lines"] as string[]).map(headingOf), [
        "Ingredients",
        "Steps",
        "Notes",
      ]);
      const plain = run(tmp, ["type", "show", "recipe"]);
      assert.deepEqual((dataOf(plain)["section_lines"] as string[]).map(headingOf), [
        "Steps",
        "Ingredients",
        "Notes",
      ]);
      const fields = dataOf(shown)["fields"] as Record<string, { seed?: unknown }>;
      assert.equal(fields["serves"]?.seed, 4, "the brief shows the seed beside the field");
      assert.equal(fields["oven"]?.seed, undefined, "an empty value is not a seed");
      assert.equal(fields["title"]?.seed, undefined, "an engine key never seeds");
      const created = run(tmp, ["new", "recipe", "Soup", "--dest", "wiki/soup.md"]);
      assert.equal(created.status, 0, JSON.stringify(created.envelope));
      const written = readFileSync(join(tmp, "wiki", "soup.md"), "utf8");
      assert.deepEqual(headings(written), ["# Soup", "## Ingredients", "## Steps", "## Notes"]);
      assert.match(written, /^serves: 4$/mu, "the seed is written");
      assert.doesNotMatch(written, /^oven:/mu, "a stub of an optional field is not written");
      assert.match(written, /^title: "Soup"$/mu);
      const overridden = run(tmp, [
        "new",
        "recipe",
        "Stew",
        "--dest",
        "wiki/stew.md",
        "--set",
        "serves=2",
      ]);
      assert.equal(overridden.status, 0, JSON.stringify(overridden.envelope));
      assert.match(
        readFileSync(join(tmp, "wiki", "stew.md"), "utf8"),
        /^serves: 2$/mu,
        "--set wins",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("type — the introspection surface (docs/constitution.md §Types)", () => {
  it("type show prints the flattened effective contract with provenance", () => {
    const r = run(FIXTURE, ["type", "show", "test-case"]);
    assert.equal(r.status, 0);
    const data = r.envelope["data"] as {
      chain: string[];
      archetype: string;
      fields: Record<string, { shape: { required?: boolean }; contributedBy: string }>;
      sections?: { list: Array<Record<string, unknown>> };
      fragments?: Array<Record<string, unknown>>;
      body?: { lifecycle: string; severity: string; contributedBy: string };
    };
    assert.deepEqual(data.chain, ["test-case", "procedure"]);
    assert.equal(data.archetype, "procedure");
    // One map, `required` inside the shape, the provenance beside it.
    assert.equal(data.fields["case_id"]?.shape.required, true);
    // ONE case per envelope. `sections.list[]` and `fragments[]` in
    // this same object spell it `contributedBy`, and docs/constitution.md specifies the IR
    // as `Map<name, {shape, contributedBy}>` — only the serializer diverged.
    assert.equal(data.fields["case_id"]?.contributedBy, "test-case");
    assert.equal(
      JSON.stringify(data).includes("contributed_by"),
      false,
      "no snake-case twin of a camel-case key",
    );
    for (const entry of data.sections?.list ?? []) {
      assert.equal(typeof entry["contributedBy"], "string");
    }
    // The fixture's page-wide append-only law is the type's own `body`.
    assert.deepEqual(
      { lifecycle: data.body?.lifecycle, severity: data.body?.severity },
      { lifecycle: "append-only", severity: "error" },
    );
  });

  it("type show on an unknown type is not_found with the legal domain", () => {
    const r = run(FIXTURE, ["type", "show", "nope"]);
    assert.equal(r.status, 3);
    const details = errorOf(r.envelope)["details"] as { valid_values?: string[] };
    assert.equal(details.valid_values?.includes("test-case"), true);
  });

  it("type list includes archetypes and bundle types", () => {
    const r = run(FIXTURE, ["type", "list"]);
    assert.equal(r.status, 0);
    const data = r.envelope["data"] as { types: Array<{ name: string }> };
    const names = data.types.map((t) => t.name);
    assert.equal(names.includes("procedure"), true);
    assert.equal(names.includes("test-case"), true);
  });
});

interface TypeListEntry {
  name: string;
  source?: string;
  archetype?: string;
  status?: string;
}

describe("type list carries provenance (docs/cli.md §type)", () => {
  it("archetypes say archetype, bundle types say registry; every entry has the keys", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-r0-types-"));
    try {
      assert.equal(run(tmp, ["init"]).status, 0);
      const r = run(tmp, ["type", "list"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const types = dataOf(r)["types"] as TypeListEntry[];
      const byName = new Map(types.map((t) => [t.name, t]));
      for (const root of ["concept", "hub", "procedure", "reference"]) {
        assert.equal(byName.get(root)?.source, "archetype", `${root} is an engine archetype`);
        assert.equal(byName.get(root)?.archetype, root);
      }
      const charter = byName.get("charter");
      assert.equal(charter?.source, "registry", "the starter declares charter");
      assert.equal(charter?.archetype, "hub");
      assert.equal(charter?.status, "active");
      for (const t of types) {
        assert.equal(
          t.source === "archetype" || t.source === "registry",
          true,
          `${t.name} carries a source`,
        );
        assert.equal(typeof t.archetype, "string", `${t.name} carries its archetype`);
        assert.equal(typeof t.status, "string", `${t.name} carries its status`);
      }
      // The registry file alone under-counts by exactly the archetypes.
      const declared = types.filter((t) => t.source === "registry").length;
      assert.equal(declared, 1);
      assert.equal(types.length - declared, 4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("type show reads the starter's charter text ()", () => {
  it("type show charter on a fresh vault names meta/charter.md, and the file exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-type-charter-"));
    try {
      assert.equal(run(tmp, ["init"]).status, 0);
      const r = run(tmp, ["type", "show", "charter"]);
      assert.equal(r.status, 0);
      assert.match(String(dataOf(r)["use_when"]), /meta\/charter\.md/);
      assert.equal(existsSync(join(tmp, "meta", "charter.md")), true, "the file it names exists");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// The two page-ref kinds take a canonical NAME, never a path, and the
// contract says so where the shape is read — the finding names the form too.
describe("type show prints the form a page reference takes", () => {
  it("page-ref and page-ref-list carry form: canonical name; a string does not", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-type-form-"));
    try {
      mkdirSync(join(tmp, "config"));
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify({
          schema: "wikiwright/constitution",
          schema_version: 3,
          vocabularies: { tags: { mode: "registered", entries: {} } },
          types: {
            note: {
              extends: "concept",
              description: "A note.",
              fields: {
                sources: { kind: "page-ref-list", target_root: "raw" },
                parent: { kind: "page-ref" },
                label: { kind: "string" },
              },
            },
          },
        }),
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({ content_roots: ["wiki"] }),
      );
      const r = run(tmp, ["type", "show", "note"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const fields = dataOf(r)["fields"] as Record<string, { form?: string }>;
      assert.equal(fields["sources"]?.form, "canonical name");
      assert.equal(fields["parent"]?.form, "canonical name");
      assert.equal(fields["label"]?.form, undefined);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
