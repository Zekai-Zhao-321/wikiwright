import { afterAll, describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildBefore,
  buildPageInterface,
  celOccurrence,
  type JudgeState,
  judgeTypeLaw,
  loadTypeLaw,
  type RelationRecord,
  type ResolveTarget,
  readPages,
  resolvedRelation,
} from "@wikiwright/core";
import { fsState } from "../src/lawstate.ts";
import { cli, commitAll, findingsOf, git } from "./fixtures/garden-cli.ts";
import { writeTree } from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  for (const path of made) rmSync(path, { recursive: true, force: true });
});
const bytes = (text: string) => new TextEncoder().encode(text);

const OLD_A = `---
type: source
title: A
expected_path: wiki/B.md
expected_type: target-old
---

# A

## Relations

- points-to [[B]]
`;
const OLD_B = `---
type: target-old
title: B
---

# B
`;
const NEW_B = OLD_B.replace("target-old", "target-new");
const NEW_C = `---
type: target-old
title: C
aliases: [B]
---

# C
`;

const RULE = `type: source
role: reference
description: A synthetic relation source.
fields:
  type: object
  properties:
    expected_path: { type: string }
    expected_type: { type: string }
sections:
  depth: 2
  list:
    - { heading: Relations, grammar: relations, vocabulary: relations }
rules:
  - id: before-relation-target
    section: Relations
    expr: '!before.present || before.section.items[0].target.resolved && before.section.items[0].target.path == page.fields.expected_path && before.section.items[0].target.type == page.fields.expected_type && before.sections[1].items[0].target.path == page.fields.expected_path && before.sections[1].items[0].target.type == page.fields.expected_type && before.page.sections[1].items[0].target.path == page.fields.expected_path && before.page.sections[1].items[0].target.type == page.fields.expected_type'
    severity: error
    message: The base relation target keeps its original identity.
`;

function source(target: string): string {
  return OLD_A.replace("[[B]]", `[[${target}]]`);
}

const TEST_PAGE = OLD_A.replace("title: A", "title: Test")
  .replace("expected_path: wiki/B.md", "expected_path: wiki/Anchor.md")
  .replace("[[B]]", "[[Anchor]]");

function fixture(): string {
  const dir = writeTree(
    {
      "config/engine.json": JSON.stringify({
        schema: "wikiwright/engine",
        schema_version: 4,
        label: "relation-base",
        content_roots: ["wiki"],
        libraries: [],
      }),
      "constitution/vocabularies/relations.yaml":
        "vocabulary: relations\nmode: registered\nentries:\n  points-to: {}\n",
      "constitution/types/source.yaml": RULE,
      "constitution/types/target-old.yaml":
        "type: target-old\nrole: reference\ndescription: The original synthetic target.\n",
      "constitution/types/target-new.yaml":
        "type: target-new\nrole: reference\ndescription: The retyped synthetic target.\n",
      "rule-tests/before-relation-target/expect.json":
        '{"rule":"before-relation-target","location":{"section":"Relations","occurrence":0}}',
      "rule-tests/before-relation-target/negative.md": TEST_PAGE.replace(
        "expected_type: target-old",
        "expected_type: target-new",
      ),
      "rule-tests/before-relation-target/before/negative.md": TEST_PAGE,
      "rule-tests/before-relation-target/repaired.md": TEST_PAGE,
      "rule-tests/before-relation-target/before/repaired.md": TEST_PAGE,
      "rule-tests/before-relation-target/positive/new.md": TEST_PAGE,
      "wiki/A.md": OLD_A,
      "wiki/B.md": OLD_B,
      "wiki/Anchor.md": OLD_B.replaceAll("B", "Anchor"),
    },
    "ww-relation-before-",
  );
  made.push(dir);
  return dir;
}

function project(read: ReturnType<typeof readPages>) {
  const a = read.pages.find((page) => page.path === "wiki/A.md");
  if (
    a?.read.ok !== true ||
    a.base?.ok !== true ||
    a.read.page.type === undefined ||
    a.base.page.type === undefined
  )
    throw new Error("synthetic A and its base must parse");
  const resolver =
    (names: typeof read.names): ResolveTarget =>
    (name) => {
      const found = names.resolve(name);
      return found === undefined ? undefined : { path: found.path, type: found.type };
    };
  const original = a.read.page.occurrences.find((section) => section.heading === "Relations")
    ?.items[0];
  const baseOriginal = a.base.page.occurrences.find((section) => section.heading === "Relations")
    ?.items[0];
  if (original?.kind !== "relation" || baseOriginal?.kind !== "relation")
    throw new Error("A must hold a relation");
  const currentSnapshot = { ...original.target };
  const baseSnapshot = { ...baseOriginal.target };
  const current = buildPageInterface(a.read.page, a.read.page.type, resolver(read.names));
  const before = buildBefore(
    { parsed: a.base.page, type: a.base.page.type },
    resolver(read.baseNames),
  );
  const currentOccurrence = a.read.page.occurrences.find(
    (section) => section.heading === "Relations",
  );
  const baseOccurrence = a.base.page.occurrences.find((section) => section.heading === "Relations");
  if (currentOccurrence === undefined || baseOccurrence === undefined)
    throw new Error("Relations missing");
  const currentSection = celOccurrence(currentOccurrence, resolver(read.names));
  const beforeSection = celOccurrence(baseOccurrence, resolver(read.baseNames));
  const target = (value: Record<string, unknown>): Record<string, unknown> =>
    (value["items"] as { target: Record<string, unknown> }[])[0]?.target ?? {};
  const relation = (sections: Record<string, unknown>[]): Record<string, unknown> =>
    sections.find((section) => section["heading"] === "Relations") ?? {};
  const sections = before["sections"] as Record<string, unknown>[];
  const pageSections = (before["page"] as { sections: Record<string, unknown>[] }).sections;
  expect(original.target).toEqual(currentSnapshot);
  expect(baseOriginal.target).toEqual(baseSnapshot);
  expect(target(currentSection)).toEqual(
    target(relation(current["sections"] as Record<string, unknown>[])),
  );
  expect(target(beforeSection)).toEqual(target(relation(sections)));
  expect(target(beforeSection)).toEqual(target(relation(pageSections)));
  expect(target(beforeSection)).not.toBe(baseOriginal.target);
  return {
    a,
    original,
    baseOriginal,
    current: target(currentSection),
    before: target(beforeSection),
  };
}

describe("CEL relation targets use their own name snapshot", () => {
  it("keeps the original record and nested target immutable during projection", async () => {
    const dir = fixture();
    const state = await fsState(dir);
    const loaded = loadTypeLaw(state.law);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    const read = readPages(state, loaded.law);
    const a = read.pages.find((page) => page.path === "wiki/A.md");
    if (a?.read.ok !== true) throw new Error("A must parse");
    const record = a.read.page.occurrences.find((section) => section.heading === "Relations")
      ?.items[0];
    if (record?.kind !== "relation") throw new Error("A must hold a relation");
    const saved = structuredClone(record) as RelationRecord;
    const projected = resolvedRelation(record, () => ({
      path: "wiki/Other.md",
      type: "target-new",
    }));
    expect(projected).not.toBe(record);
    expect(projected.target).not.toBe(record.target);
    expect(projected.target).toMatchObject({
      name: "B",
      heading: null,
      alias: null,
      path: "wiki/Other.md",
      type: "target-new",
      resolved: true,
    });
    expect(record).toEqual(saved);
    expect(resolvedRelation(record, () => undefined).target).toMatchObject({
      name: "B",
      heading: null,
      alias: null,
      path: null,
      type: null,
      resolved: false,
    });
    const authored: RelationRecord = {
      ...record,
      target: { ...record.target, heading: "Detail", alias: "display" },
    };
    const lexical = resolvedRelation(authored, () => ({ path: "wiki/B.md", type: "target-old" }));
    expect(lexical.target).toMatchObject({ name: "B", heading: "Detail", alias: "display" });
    expect(authored.target).toMatchObject({ heading: "Detail", alias: "display" });
  });

  it("projects shared and distinct parses for retype, repaired rename, and deletion", async () => {
    const dir = fixture();
    const baseline = await fsState(dir);
    const loaded = loadTypeLaw(baseline.law);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    const oldA = baseline.pages.get("wiki/A.md") as Uint8Array;
    const oldB = baseline.pages.get("wiki/B.md") as Uint8Array;
    const cases: { name: string; state: JudgeState; shared: boolean; current: object }[] = [
      {
        name: "retype",
        state: {
          kind: "index",
          law: baseline.law,
          pages: new Map([
            ["wiki/A.md", oldA],
            ["wiki/B.md", bytes(NEW_B)],
          ]),
          base: new Map([
            ["wiki/A.md", oldA],
            ["wiki/B.md", oldB],
          ]),
        },
        shared: true,
        current: { name: "B", path: "wiki/B.md", type: "target-new", resolved: true },
      },
      {
        name: "rename",
        state: {
          kind: "index",
          law: baseline.law,
          pages: new Map([
            ["wiki/A.md", bytes(source("C"))],
            ["wiki/C.md", bytes(NEW_C)],
          ]),
          base: new Map([
            ["wiki/A.md", oldA],
            ["wiki/C.md", oldB],
          ]),
          renames: [{ from: "wiki/B.md", to: "wiki/C.md" }],
        },
        shared: false,
        current: { name: "C", path: "wiki/C.md", type: "target-old", resolved: true },
      },
      {
        name: "deletion",
        state: {
          kind: "index",
          law: baseline.law,
          pages: new Map([["wiki/A.md", oldA]]),
          base: new Map([["wiki/A.md", oldA]]),
          removed: new Map([["wiki/B.md", oldB]]),
        },
        shared: true,
        current: { name: "B", path: null, type: null, resolved: false },
      },
    ];
    for (const test of cases) {
      const read = readPages(test.state, loaded.law);
      const result = project(read);
      expect(result.a.base === result.a.read).toBe(test.shared);
      expect(result.current).toMatchObject(test.current);
      expect(result.before).toMatchObject({
        name: "B",
        heading: null,
        alias: null,
        path: "wiki/B.md",
        type: "target-old",
        resolved: true,
      });
      const verdict = judgeTypeLaw(test.state, loaded.law, { read, lawTests: false, all: true });
      expect(
        verdict.findings.filter(
          (finding) =>
            finding.rule === "before-relation-target" || finding.rule === "relation-removed",
        ),
        test.name,
      ).toEqual([]);
    }
  });

  it("delivers faithful before targets through real staged gate and rule-test seams", () => {
    for (const scenario of ["retype", "rename", "deletion"] as const) {
      const dir = fixture();
      const initial = cli(["check", "--write", "--all"], dir);
      if (initial.status !== 0) throw new Error(JSON.stringify(initial.envelope.data?.findings));
      expect(initial.status, scenario).toBe(0);
      expect(findingsOf(initial.envelope, "rule-test-fails")).toEqual([]);
      commitAll(dir);
      if (scenario === "retype") writeFileSync(join(dir, "wiki/B.md"), NEW_B);
      else if (scenario === "rename") {
        rmSync(join(dir, "wiki/B.md"));
        writeFileSync(join(dir, "wiki/C.md"), NEW_C);
        writeFileSync(join(dir, "wiki/A.md"), source("C"));
      } else rmSync(join(dir, "wiki/B.md"));
      git(dir, "add", "-A");
      const generated = cli(["check", "--write", "--all"], dir);
      expect(generated.status, scenario).toBe(0);
      git(dir, "add", "-A");
      if (scenario === "retype" || scenario === "deletion")
        writeFileSync(join(dir, "wiki/B.md"), OLD_B);
      const gate = cli(["gate", "--all"], dir);
      expect(gate.status, `${scenario}: ${JSON.stringify(gate.envelope.error)}`).toBe(0);
      expect(findingsOf(gate.envelope, "before-relation-target"), scenario).toEqual([]);
      expect(findingsOf(gate.envelope, "relation-removed"), scenario).toEqual([]);
    }
  }, 20_000);
});
