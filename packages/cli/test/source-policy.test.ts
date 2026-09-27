// An actual v2 data library and garden bundle, copied under os.tmpdir().
// The cited source's nominal type is a declared policy, evaluated through
// the resolved page reference in all four state adapters.
import { afterAll, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBefore, buildPageInterface, loadTypeLaw, readPages } from "@wikiwright/core";
import { readIndex } from "../src/lawstate.ts";
import { cli, commitAll, findingsOf, git } from "./fixtures/garden-cli.ts";
import { removeTree } from "./fixtures/garden-law.ts";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/source-policy", import.meta.url));
const LIBRARY = fileURLToPath(new URL("../../../libraries/source-kit", import.meta.url));
const CITING = "wiki/Soil observations.md";
const SOURCE = "wiki/Straße.md";
const RULE = "observation-source-type";
const made: string[] = [];

afterAll(() => made.forEach(removeTree));

function bundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "ww-source-policy-"));
  made.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  cpSync(LIBRARY, join(dir, "libraries/source-kit"), { recursive: true });
  return dir;
}

function file(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

function put(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

function retype(dir: string): string {
  return file(dir, SOURCE).replace("type: source-kit/field-note", "type: source-kit/seed-catalog");
}

function errors(result: ReturnType<typeof cli>, rule = RULE): string[] {
  return findingsOf(result.envelope, rule)
    .filter((f) => f.severity === "error")
    .map((f) => f.path);
}

function item(dir: string, query: string): Record<string, unknown> {
  const result = cli(["search", query, "--items"], dir);
  expect(result.status).toBe(0);
  const rows = (result.envelope.data?.["results"] ?? []) as { fields: Record<string, unknown> }[];
  expect(rows.length).toBeGreaterThan(0);
  return rows[0]?.fields ?? {};
}

describe("the garden source policy", () => {
  it("passes its native rule tests and resolves ASCII, full casefold, NFD and CJK citations", () => {
    const dir = bundle();
    const checked = cli(["check", "--all"], dir);
    expect(checked.status).toBe(0);
    expect(findingsOf(checked.envelope, "rule-test-fails")).toEqual([]);
    const guidance = cli(["type", "show", "source-kit/observation"], dir);
    expect(guidance.status).toBe(0);
    expect(JSON.stringify(guidance.envelope.data)).toContain("i.provenance.page.type");
    expect(JSON.stringify(guidance.envelope.data)).toContain("source-kit/field-note");
    const cases = [
      ["beans sprouted", "STRASSE", SOURCE],
      ["Six leaves appeared", "Café", "wiki/Café.md"],
      ["tea bed is damp", "茶园记录", "wiki/茶园记录.md"],
    ] as const;
    for (const [query, authored, path] of cases) {
      const provenance = item(dir, query)["provenance"] as Record<string, unknown>;
      expect(provenance["value"]).toBe(authored);
      expect(provenance["page"]).toEqual({
        resolved: true,
        path,
        type: "source-kit/field-note",
      });
    }
    expect(
      (item(dir, "Try wider spacing")["provenance"] as Record<string, unknown>)["page"],
    ).toBeNull();
  });

  it("requires selected claim categories to cite a field-note page, while advice stays free", () => {
    const dir = bundle();
    const original = file(dir, CITING);
    const claim = "- [observed] The beans sprouted. ([[STRASSE]])";
    for (const source of [
      "[[Seed catalog]]",
      "[[Missing log]]",
      "https://seeds.example",
      "raw/field.md",
      "",
    ]) {
      put(
        dir,
        CITING,
        original.replace(
          claim,
          `- [observed] The beans sprouted.${source === "" ? "" : ` (${source})`}`,
        ),
      );
      const result = cli(["check", "--all"], dir);
      expect(errors(result)).toContain(CITING);
      if (source === "[[Missing log]]")
        expect(findingsOf(result.envelope, "wikilink-unresolved").map((f) => f.path)).toContain(
          CITING,
        );
    }
    put(
      dir,
      CITING,
      original.replace(
        "- [advice] Try wider spacing. (https://seeds.example/spacing)",
        "- [advice] Try wider spacing. (raw/garden.md)",
      ),
    );
    expect(errors(cli(["check", "--all"], dir))).toEqual([]);
  });

  it("preserves heading and display spelling, while aliases still trigger the kernel refusal", () => {
    const dir = bundle();
    const original = file(dir, CITING);
    put(dir, CITING, original.replace("[[STRASSE]]", "[[Straße#Counts|lane count]]"));
    const projection = item(dir, "beans sprouted");
    expect((projection["provenance"] as Record<string, unknown>)["value"]).toBe("Straße");
    const searched = cli(["search", "beans sprouted", "--items"], dir);
    expect(((searched.envelope.data?.["results"] ?? []) as { raw: string }[])[0]?.raw).toContain(
      "[[Straße#Counts|lane count]]",
    );
    expect(errors(cli(["check", "--all"], dir))).toEqual([]);
    put(dir, CITING, original.replace("[[STRASSE]]", "[[Lane log]]"));
    const alias = cli(["check", "--all"], dir);
    expect(findingsOf(alias.envelope, "wikilink-alias-target").map((f) => f.path)).toContain(
      CITING,
    );
    expect((item(dir, "beans sprouted")["provenance"] as Record<string, unknown>)["page"]).toEqual({
      resolved: true,
      path: SOURCE,
      type: "source-kit/field-note",
    });
  });

  it("keeps empty page names unresolved and reports an identity collision", () => {
    const dir = bundle();
    const original = file(dir, CITING);
    put(dir, CITING, original.replace("[[STRASSE]]", "[[   ]]"));
    const empty = cli(["check", "--all"], dir);
    expect(errors(empty)).toEqual([CITING]);
    expect((item(dir, "beans sprouted")["provenance"] as Record<string, unknown>)["page"]).toEqual({
      resolved: false,
      path: null,
      type: null,
    });
    put(dir, CITING, original);
    put(dir, "wiki/STRASSE.md", file(dir, "wiki/Seed catalog.md"));
    const colliding = cli(["check", "--all"], dir);
    expect(findingsOf(colliding.envelope, "identity-collision").length).toBeGreaterThan(0);
  });

  it("rejects a source-only retype in a write overlay before changing any page", () => {
    const dir = bundle();
    const draft = mkdtempSync(join(tmpdir(), "ww-source-draft-"));
    made.push(draft);
    put(draft, SOURCE, retype(dir));
    const before = file(dir, SOURCE);
    for (const argv of [
      ["write", "--from", draft, "--dry-run"],
      ["write", "--from", draft],
    ]) {
      const result = cli(argv, dir);
      expect(result.status).toBe(5);
      expect(errors(result)).toEqual([CITING]);
      expect(file(dir, SOURCE)).toBe(before);
    }
  });

  it("judges staged source bytes, exposes the new error on an untouched citer, and keeps before distinct", async () => {
    const dir = bundle();
    commitAll(dir);
    const original = file(dir, SOURCE);
    put(dir, SOURCE, retype(dir));
    git(dir, "add", SOURCE);
    put(dir, SOURCE, original); // working tree disagrees with the staged source
    const gated = cli(["gate", "--all"], dir);
    expect(gated.status).toBe(5);
    expect(errors(gated)).toEqual([CITING]);
    expect(findingsOf(gated.envelope, RULE)[0]?.details["demoted_from"]).toBeUndefined();
    const index = (await readIndex(dir)).state;
    const loaded = loadTypeLaw(index.law);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    const read = readPages(index, loaded.law);
    const citing = read.pages.find((p) => p.path === CITING);
    if (citing?.read.ok !== true || citing.base?.ok !== true || citing.read.page.type === undefined)
      throw new Error("the citing page and its base must parse");
    expect(citing.base).toBe(citing.read); // no copied or modified citing bytes
    const project = (resolve: typeof read.names.resolve) => (name: string) => {
      const found = resolve(name);
      return found === undefined ? undefined : { path: found.path, type: found.type };
    };
    const current = buildPageInterface(
      citing.read.page,
      citing.read.page.type,
      project(read.names.resolve),
    );
    const before = buildBefore(
      { parsed: citing.base.page, type: citing.base.page.type ?? citing.read.page.type },
      project(read.baseNames.resolve),
    );
    const firstType = (page: Record<string, unknown>) =>
      (page["sections"] as { items: { provenance: { page: { type: string } } }[] }[])[1]?.items[0]
        ?.provenance.page.type ?? null;
    expect(firstType(current)).toBe("source-kit/seed-catalog");
    expect(firstType(before["page"] as Record<string, unknown>)).toBe("source-kit/field-note");
    expect(citing.read.page.occurrences[1]?.items[0]?.kind).toBe("claim");
    git(dir, "add", SOURCE); // stage the repaired bytes
    put(dir, SOURCE, retype(dir)); // disk now disagrees in the other direction
    const accepted = cli(["gate", "--all"], dir);
    expect(accepted.status).toBe(0);
    expect(errors(accepted)).toEqual([]);
  });

  it("finds a new error on an untouched citer when a source is deleted or moved", () => {
    for (const kind of ["delete", "move"] as const) {
      const dir = bundle();
      commitAll(dir);
      if (kind === "delete") git(dir, "rm", SOURCE);
      else git(dir, "mv", SOURCE, "wiki/Lane field note.md");
      const gated = cli(["gate", "--all"], dir);
      expect(gated.status).toBe(5);
      expect(errors(gated)).toEqual([CITING]);
      expect(findingsOf(gated.envelope, "wikilink-unresolved").map((f) => f.path)).toContain(
        CITING,
      );
    }
  });
});
