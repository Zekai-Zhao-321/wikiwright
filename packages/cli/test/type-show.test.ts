// v2 contracts §9.7 and §3.3: `type show <name> [--brief]` and `type list`
// over a synthetic gardening bundle under os.tmpdir() — the effective
// contract with the documents each part comes from, the skeleton derived
// from the effective shape and sections, the writing instruction, and the
// vocabularies the type reads with every entry's live count.
import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    const concrete = (cli(["type", "list", "--concrete"], gardenBundle()).envelope.data?.[
      "types"
    ] ?? []) as { name: string }[];
    expect(concrete.map((t) => t.name)).toEqual(["garden/bed", "guide", "planting"]);
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
    expect(data["use_when"]).toBe("A crop went into a bed on a date.");
    expect(data["use_when_declared_by"]).toBe("garden/planting");
    const vocabularies = data["vocabularies"] as {
      name: string;
      entries: { name: string; count: number }[];
      retired: { name: string }[];
    }[];
    const relations = vocabularies.find((v) => v.name === "garden/relations");
    expect(relations?.entries.find((e) => e.name === "grows-in")?.count).toBe(1);
    expect(relations?.entries.map((e) => e.name)).toContain("shades");
    expect(relations?.retired.map((e) => e.name)).toEqual(["planted-in"]);
  });

  it("keeps --brief short and points back to the full contract in the same bundle", () => {
    const dir = gardenBundle();
    const data = cli(["type", "show", "planting", "--brief"], dir).envelope.data ?? {};
    const brief = (data["brief"] ?? {}) as {
      skeleton: string;
      instruction: string[];
      vocabularies: {
        name: string;
        entries: number;
        retired: number;
      }[];
    };
    expect(data["fields"]).toBeUndefined();
    expect(data["rules"]).toBeUndefined();
    expect(data["use_when_declared_by"]).toBe("garden/planting");
    expect(data["full_argv"]).toEqual([
      "wikiwright",
      "type",
      "show",
      "planting",
      "--root",
      realpathSync(dir),
    ]);
    expect(brief.skeleton).toStartWith('---\ntype: planting\ntitle: ""\n');
    expect(brief.skeleton).toContain('\nbed: ""\nsown: ""\n');
    expect(brief.skeleton).toEndWith(
      "---\n\n# <title>\n\n## Observations\n\n## History\n\n## Relations\n\n",
    );
    expect(brief.instruction[0]).toBe(
      'Observations  claims  scope direct  min 0  |  - [category] core (provenance)  |  provenance="optional"  |  garden/observations: 3 declared (registered)',
    );
    const relations = brief.vocabularies.find((v) => v.name === "garden/relations");
    expect(relations).toMatchObject({ entries: 3, retired: 1 });
    const abstract = cli(["type", "show", "garden/planting", "--brief"], dir).envelope.data ?? {};
    expect(abstract["abstract"]).toBe(true);
    expect(abstract["extends"]).toBeNull();
  });

  it("refuses flags on the subcommand that cannot use them", () => {
    const dir = gardenBundle();
    expect(cli(["type", "list", "--brief"], dir).envelope.error?.code).toBe("flag-not-applicable");
    expect(cli(["type", "show", "planting", "--concrete"], dir).envelope.error?.code).toBe(
      "flag-not-applicable",
    );
  });

  it("shares nearest attributed guidance across list, show, brief and generated BRIEF", () => {
    const dir = gardenBundle();
    const parent = join(dir, "libraries/kit-garden/types/planting.yaml");
    const child = join(dir, "constitution/types/planting.yaml");
    writeFileSync(
      parent,
      readFileSync(parent, "utf8").replace(
        "use_when: A crop went into a bed on a date.",
        "use_when: A crop went into a bed on a date.\navoid_when: The crop was only planned.",
      ),
    );
    writeFileSync(
      child,
      readFileSync(child, "utf8").replace(
        "description: A planting in this kitchen garden.",
        "description: A planting in this kitchen garden.\nuse_when: A seed was actually sown here.",
      ),
    );
    for (const data of [
      (
        (cli(["type", "list"], dir).envelope.data?.["types"] ?? []) as Record<string, unknown>[]
      ).find((t) => t["name"] === "planting"),
      cli(["type", "show", "planting"], dir).envelope.data,
      cli(["type", "show", "planting", "--brief"], dir).envelope.data,
    ]) {
      expect(data).toMatchObject({
        use_when: "A seed was actually sown here.",
        use_when_declared_by: "planting",
        avoid_when: "The crop was only planned.",
        avoid_when_declared_by: "garden/planting",
      });
    }
    expect(cli(["check", "--write"], dir).status).toBe(0);
    expect(readFileSync(join(dir, "generated/BRIEF.md"), "utf8")).toContain(
      "A seed was actually sown here.",
    );
    expect(readFileSync(join(dir, "generated/BRIEF.md"), "utf8")).toContain(
      "Avoid when: The crop was only planned. (declared by `garden/planting`)",
    );
  });

  it("refuses a type the law does not declare, with the names it does", () => {
    const r = cli(["type", "show", "bed"], gardenBundle());
    expect(r.status).toBe(3);
    expect(r.envelope.error?.code).toBe("unknown-type");
    expect(r.envelope.error?.details?.["valid_values"]).toContain("garden/bed");
  });
});
