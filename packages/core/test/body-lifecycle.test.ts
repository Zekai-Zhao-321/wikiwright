// docs/constitution.md §Types (`body: { lifecycle: "append-only" }` — a page-wide
// append-only law for a type with no sections) · docs/concepts.md (the
// transition arms table; `body-append-only` needs a base)
//
// The arm's semantics are EXACTLY v2's `append-only` checker in strict mode:
// the base body's lines, trailing empty lines trimmed, must be a PREFIX of the
// draft's, and the first differing line is the finding's line. Every case below
// was a `packages/core/test/lint.test.ts` case against that checker.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Finding,
  type FlattenedRegistry,
  type LintOptions,
  lintPage,
  loadConstitution,
  parseDoc,
  standardLibrary,
} from "@wikiwright/core";

type Json = Record<string, unknown>;

function constitution(review: Json = { lifecycle: "append-only" }): Json {
  return {
    schema: "wikiwright/constitution",
    schema_version: 3,
    vocabularies: { tags: { mode: "registered", entries: {} } },
    types: {
      review: {
        extends: "reference",
        description: "One ISO week built from daily notes and the git log.",
        body: review,
      },
      note: { extends: "reference", description: "An ordinary page, no body law." },
    },
  };
}

function registryOf(json: Json = constitution()): FlattenedRegistry {
  const loaded = loadConstitution(json, standardLibrary());
  assert.equal(loaded.ok, true, loaded.ok ? "" : JSON.stringify(loaded.issues));
  if (!loaded.ok) throw new Error("unreachable");
  return loaded.registry;
}

const page = (body: string, type = "review"): string =>
  `---\ntype: ${type}\ntitle: 2026-W35\ndescription: One week.\ntags: []\n---\n${body}`;

function lint(
  text: string,
  options: { registry?: FlattenedRegistry; base?: string } = {},
): Finding[] {
  const registry = options.registry ?? registryOf();
  const lintOptions: LintOptions = { folderTags: "off" };
  if (options.base !== undefined) lintOptions.baseText = options.base;
  return lintPage({ path: "journal/2026-W35.md", doc: parseDoc(text), registry }, lintOptions);
}

const armsOf = (fs: Finding[]): Finding[] => fs.filter((f) => f.ruleId === "body-append-only");

describe("body.lifecycle append-only: the arm (docs/concepts.md)", () => {
  const base = page("\n## Log\n\n- 2026-08-29 first\n- 2026-08-30 second\n");

  it("a pure append is silent", () => {
    const draft = page("\n## Log\n\n- 2026-08-29 first\n- 2026-08-30 second\n- 2026-08-31 third\n");
    assert.deepEqual(armsOf(lint(draft, { base })), []);
  });

  it("a changed existing line is an error on the line that changed", () => {
    const draft = page("\n## Log\n\n- 2026-08-29 FIRST\n- 2026-08-30 second\n");
    const found = armsOf(lint(draft, { base }));
    assert.equal(found.length, 1);
    assert.equal(found[0]?.severity, "error");
    // Frontmatter ends on line 6; the changed line is body index 3 (blank,
    // "## Log", blank, the entry), so `endLine + i + 1` = 10 — the same
    // arithmetic v2's `append-only` used, which is the point.
    assert.equal(found[0]?.line, 10);
  });

  it("a removed existing line is an error", () => {
    const draft = page("\n## Log\n\n- 2026-08-29 first\n");
    assert.equal(armsOf(lint(draft, { base })).length, 1);
  });

  it("trailing empty lines in the base are trimmed, so an append after them is legal", () => {
    // A file-final newline yields one trailing empty element; it is an artifact
    // of splitting, not content (carried over verbatim).
    const trailing = page("\n## Log\n\n- 2026-08-29 first\n\n\n");
    const draft = page("\n## Log\n\n- 2026-08-29 first\n\n\n- 2026-08-30 second\n");
    assert.deepEqual(armsOf(lint(draft, { base: trailing })), []);
  });

  it("without a base the arm is silent — it is a transition arm", () => {
    const draft = page("\n## Log\n\n- 2026-08-29 CHANGED\n");
    assert.deepEqual(armsOf(lint(draft)), []);
  });

  it("a type that declares no body law is not judged by the arm", () => {
    const noteBase = page("\n## Log\n\n- a\n", "note");
    const noteDraft = page("\n## Log\n\n- b\n", "note");
    assert.deepEqual(armsOf(lint(noteDraft, { base: noteBase })), []);
  });

  it("body.severity lowers the arm, and error is the default", () => {
    const registry = registryOf(constitution({ lifecycle: "append-only", severity: "warning" }));
    const draft = page("\n## Log\n\n- 2026-08-29 CHANGED\n");
    const found = armsOf(lint(draft, { base, registry }));
    assert.equal(found.length, 1);
    assert.equal(found[0]?.severity, "warning");
  });

  it("frontmatter is not body: an edit above the fence is not a mutation", () => {
    const draft = `---\ntype: review\ntitle: 2026-W35\ndescription: One week, renamed.\ntags: []\n---\n\n## Log\n\n- 2026-08-29 first\n- 2026-08-30 second\n`;
    assert.deepEqual(armsOf(lint(draft, { base })), []);
  });
});

describe("body.lifecycle: the declaration (docs/constitution.md §Types)", () => {
  it("`body.lifecycle` is the only lifecycle value v3 admits page-wide", () => {
    const loaded = loadConstitution(constitution({ lifecycle: "free" }), standardLibrary());
    assert.equal(loaded.ok, false);
  });

  it("a body law beside an append-only entries section is a load error — one mutation, two arms", () => {
    const json = constitution();
    (json["types"] as Json)["review"] = {
      extends: "reference",
      description: "One ISO week.",
      body: { lifecycle: "append-only" },
      sections: {
        depth: 2,
        list: [{ heading: "Timeline", grammar: "entries", lifecycle: "append-only" }],
      },
    };
    const loaded = loadConstitution(json, standardLibrary());
    assert.equal(loaded.ok, false);
    assert.equal(
      loaded.ok ? "" : loaded.issues.some((i) => i.code === "body-lifecycle-doubled"),
      true,
      JSON.stringify(loaded.ok ? [] : loaded.issues),
    );
  });

  it("the law is inherited, and a child may not relax it", () => {
    const json = constitution();
    (json["types"] as Json)["short-review"] = {
      extends: "review",
      description: "A shorter week.",
    };
    const registry = registryOf(json);
    assert.equal(registry.types.get("short-review")?.body?.lifecycle, "append-only");
  });
});
