// v2 contracts §9.7 and §3.3: `type show <name> [--brief]` and `type list`
// over a synthetic gardening bundle under os.tmpdir() — the effective
// contract with the documents each part comes from, the skeleton derived
// from the effective shape and sections, the writing instruction, and the
// vocabularies the type reads with every entry's live count.
import { afterAll, describe, expect, it } from "bun:test";
import { cleanBundles, cli, gardenBundle } from "./fixtures/garden-cli.ts";

afterAll(cleanBundles);

describe("type (v2 contracts §9.7)", () => {
  it("lists every type, a library's by its qualified name", () => {
    const r = cli(["type", "list"], gardenBundle());
    const types = (r.envelope.data?.["types"] ?? []) as {
      name: string;
      role: string;
      abstract: boolean;
    }[];
    expect(types.map((t) => [t.name, t.role, t.abstract])).toEqual([
      ["garden/bed", "reference", false],
      ["garden/planting", "procedure", true],
      ["guide", "hub", false],
      ["planting", "procedure", false],
    ]);
  });

  it("shows the effective contract with attribution", () => {
    const data = cli(["type", "show", "planting"], gardenBundle()).envelope.data ?? {};
    expect(data["ancestry"]).toEqual(["garden/planting"]);
    expect(data["fragments"]).toEqual([]);
    const props = (data["fields"] as { properties: { key: string; declared_by: string[] }[] })
      .properties;
    expect(props.find((p) => p.key === "bed")?.declared_by).toEqual([
      "fragment:garden/planted",
      "type:planting",
    ]);
    expect(props.find((p) => p.key === "title")?.declared_by).toEqual(["reserved"]);
    const rules = data["rules"] as {
      id: string;
      declared_by: string;
      config: Record<string, unknown>;
    }[];
    expect(rules.find((r) => r.id === "known-bed")).toMatchObject({
      declared_by: "garden/planted",
      config: { beds: ["north", "south", "herb", "east"] },
    });
    const sections = data["sections"] as { list: { heading: string; declared_by: string[] }[] };
    expect(sections.list.map((s) => [s.heading, s.declared_by])).toEqual([
      ["Observations", ["garden/planting"]],
      ["History", ["garden/planting"]],
      ["Relations", ["garden/planting"]],
    ]);
    expect(data["brief"]).toBeUndefined();
  });

  it("adds the skeleton, the writing instruction and the vocabularies' live counts under --brief", () => {
    const brief = (cli(["type", "show", "planting", "--brief"], gardenBundle()).envelope.data?.[
      "brief"
    ] ?? {}) as {
      skeleton: string;
      instruction: string[];
      vocabularies: {
        name: string;
        entries: { name: string; count: number }[];
        retired: { name: string }[];
      }[];
    };
    expect(brief.skeleton).toStartWith('---\ntype: planting\ntitle: ""\n');
    expect(brief.skeleton).toContain('\nbed: ""\nsown: ""\n');
    expect(brief.skeleton).toEndWith(
      "---\n\n# <title>\n\n## Observations\n\n## History\n\n## Relations\n\n",
    );
    expect(brief.instruction[0]).toBe(
      'Observations  claims  min 0  |  - [category] core (provenance)  |  provenance="optional"  |  garden/observations: 3 declared (registered)',
    );
    const relations = brief.vocabularies.find((v) => v.name === "garden/relations");
    expect(relations?.entries.find((e) => e.name === "grows-in")?.count).toBe(1);
    expect(relations?.entries.map((e) => e.name)).toContain("shades");
    expect(relations?.retired.map((e) => e.name)).toEqual(["planted-in"]);
  });

  it("refuses a type the law does not declare, with the names it does", () => {
    const r = cli(["type", "show", "bed"], gardenBundle());
    expect(r.status).toBe(3);
    expect(r.envelope.error?.code).toBe("unknown-type");
    expect(r.envelope.error?.details?.["valid_values"]).toContain("garden/bed");
  });
});
