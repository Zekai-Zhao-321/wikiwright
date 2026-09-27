// v2 contracts §2: each declared engine.json key changes a real CLI answer.
// The schema walk in law-libraries.test.ts requires one e2e:<key> test per key.
import { afterAll, describe, expect, it } from "bun:test";
import { cleanBundles, cli, findingsOf, gardenBundle } from "./fixtures/garden-cli.ts";
import { BASIL, START } from "./fixtures/garden-judge.ts";
import { engineJson } from "./fixtures/garden-law.ts";

afterAll(cleanBundles);

function withEngine(
  overrides: Record<string, unknown>,
  extra: Record<string, string> = {},
): string {
  return gardenBundle({ "config/engine.json": engineJson(overrides), ...extra });
}

function issueCode(dir: string): string | undefined {
  const issues = cli(["check"], dir).envelope.data?.["issues"] as { code: string }[] | undefined;
  return issues?.[0]?.code;
}

describe("every v4 engine key reaches a CLI consumer", () => {
  it("e2e:schema rejects a different engine document kind", () => {
    expect(issueCode(withEngine({ schema: "other/engine" }))).toBe("engine-invalid");
  });

  it("e2e:schema_version rejects a different engine document version", () => {
    expect(issueCode(withEngine({ schema_version: 3 }))).toBe("engine-invalid");
  });

  it("e2e:label appears in the bundle identity", () => {
    const r = cli(["check"], withEngine({ label: "herbarium" }));
    expect(r.envelope.metadata.bundle?.["label"]).toBe("herbarium");
  });

  it("e2e:engine refuses a binary outside its declared range", () => {
    const r = cli(["check"], withEngine({ engine: "<0.0.1" }));
    expect(r.envelope.error?.code).toBe("engine-mismatch");
  });

  it("e2e:content_roots selects the pages the CLI judges", () => {
    const dir = withEngine({ content_roots: ["notes"] }, { "notes/Start.md": START });
    const r = cli(["check", "--all"], dir);
    expect((r.envelope.data?.summary as { pages?: number } | undefined)?.pages).toBe(1);
    expect((r.envelope.data?.findings ?? []).some((f) => f.path.startsWith("wiki/"))).toBe(false);
  });

  it("e2e:source_roots changes a claim's parsed provenance", () => {
    const page = BASIL.replace("([[Herb bed]])", "(raw/observations.md)");
    const expr = 'section.items.all(i, i.provenance.kind == "path")';
    const args = ["rule", "try", "--type", "planting", "--section", "Observations", "--expr", expr];
    const yes = cli(args, withEngine({ source_roots: ["raw"] }, { "wiki/Basil.md": page }));
    const no = cli(args, withEngine({ source_roots: [] }, { "wiki/Basil.md": page }));
    const working = (r: typeof yes) =>
      r.envelope.data?.["working"] as {
        would_pass: string[];
        would_refuse: { path: string }[];
      };
    expect(working(yes).would_pass).toContain("wiki/Basil.md");
    expect(working(no).would_refuse.map((f) => f.path)).toContain("wiki/Basil.md");
  });

  it("e2e:local_origins binds a named pin to an explicit local directory", () => {
    const sourceType = `type: source\nrole: reference\ndescription: A capture.\nfields:\n  type: object\n  properties:\n    capture: { $ref: "#/$defs/pin" }\n  required: [capture]\n`;
    const page = `---\ntype: source\ntitle: Seed list\ncapture:\n  commit: 0123456789abcdef\n  origin: local-code\n  covers: [notes/seeds.txt]\n---\n\n# Seed list\n`;
    const extra = { "constitution/types/source.yaml": sourceType, "wiki/Seed list.md": page };
    const without = cli(["check", "--all"], withEngine({}, extra));
    const withBinding = cli(
      ["check", "--all"],
      withEngine({ local_origins: [{ name: "local-code", path: "../no-such-origin" }] }, extra),
    );
    expect(findingsOf(without.envelope, "pin-unmeasured")[0]?.details["reason"]).toBe(
      "remote-origin",
    );
    expect(findingsOf(withBinding.envelope, "pin-unmeasured")[0]?.details["reason"]).toBe(
      "no-repository",
    );
  });

  it("e2e:libraries supplies the imported garden types", () => {
    expect(cli(["type", "list"], withEngine({ libraries: [] })).envelope.error?.code).toBe(
      "constitution-invalid",
    );
    expect(cli(["type", "list"], withEngine({})).envelope.ok).toBe(true);
  });

  it("e2e:field_sources derives the title from a page basename", () => {
    const page = "---\ntype: guide\n---\n\n# Untitled\n\n## Start here\n\nRead on.\n";
    const extra = { "wiki/Untitled.md": page };
    const defaultResult = cli(["check", "--all"], withEngine({}, extra));
    const derived = cli(
      ["check", "--all"],
      withEngine({ field_sources: { title: "basename" } }, extra),
    );
    const atPage = (r: typeof defaultResult) =>
      findingsOf(r.envelope, "page-shape-invalid").filter((f) => f.path === "wiki/Untitled.md");
    expect(atPage(defaultResult).length).toBeGreaterThan(0);
    expect(atPage(derived)).toEqual([]);
  });

  it("e2e:folder_tags requires a tag for a registered folder", () => {
    const page = "---\ntype: garden/bed\ntitle: North bed\n---\n\n# North bed\n";
    const extra = { "wiki/beds/North bed.md": page };
    expect(
      findingsOf(cli(["check", "--all"], withEngine({}, extra)).envelope, "folder-tags-present"),
    ).toEqual([]);
    expect(
      findingsOf(
        cli(["check", "--all"], withEngine({ folder_tags: { mode: "validate" } }, extra)).envelope,
        "folder-tags-present",
      ).map((f) => f.path),
    ).toEqual(["wiki/beds/North bed.md"]);
  });

  it("e2e:folder_tag_aliases resolves a folder against its declared tag", () => {
    const page = "---\ntype: garden/bed\ntitle: North bed\ntags: [beds]\n---\n\n# North bed\n";
    const extra = { "wiki/patches/North bed.md": page };
    const without = cli(
      ["check", "--all"],
      withEngine({ folder_tags: { mode: "validate" } }, extra),
    );
    const withAlias = cli(
      ["check", "--all"],
      withEngine(
        { folder_tags: { mode: "validate" }, folder_tag_aliases: { patches: "beds" } },
        extra,
      ),
    );
    expect(findingsOf(without.envelope, "folder-segment-registered").length).toBe(1);
    expect(findingsOf(withAlias.envelope, "folder-segment-registered")).toEqual([]);
    expect(findingsOf(withAlias.envelope, "folder-tags-present")).toEqual([]);
  });

  it("e2e:extensions controls whether an unregistered field is admitted", () => {
    const page = BASIL.replace("title: Basil", "title: Basil\ncolour: green");
    const extra = { "wiki/Basil.md": page };
    const closed = cli(["check", "--all"], withEngine({}, extra));
    const open = cli(["check", "--all"], withEngine({ extensions: { mode: "open" } }, extra));
    const atBasil = (r: typeof closed) =>
      findingsOf(r.envelope, "page-shape-invalid").filter((f) => f.path === "wiki/Basil.md");
    expect(atBasil(closed).length).toBeGreaterThan(0);
    expect(atBasil(open)).toEqual([]);
  });
});
