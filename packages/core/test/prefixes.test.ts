// docs/cli.md §gate (the commit-msg arm reads the Conventional Commits opening)
// · docs/constitution.md (`commit_prefixes` names prefixes, never scopes).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitPrefixOf, commitPrefixOpening, commitPrefixVerdict } from "../src/prefixes/index.ts";

describe("commitPrefixOf reads the word the first line opens with", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["docs: bare", "docs"],
    ["docs(wiki): scoped", "docs"],
    ["docs(wiki)!: scoped and breaking", "docs"],
    ["feat!: breaking", "feat"],
    ["  fix: leading and trailing whitespace  ", "fix"],
    ["fix: first line\n\nchore: second line", "fix"],
    ["kit-code: hyphenated word", "kit-code"],
    ["Docs: case is kept, the registered set decides", "Docs"],
    ["docs:no space after the colon", "docs"],
    ["docs(a b): a scope may carry a space", "docs"],
    ["no opening here", "none"],
    ["docs(): an empty scope is no opening", "none"],
    ["docs (wiki): a space before the scope is no opening", "none"],
    ["docs(wiki) : a space before the colon is no opening", "none"],
    ["docs(wi(ki)): parentheses inside a scope are no opening", "none"],
    ["docs?: a marker other than ! is no opening", "none"],
    ["3d: a word starts with a letter", "none"],
    ["", "none"],
  ];
  for (const [message, prefix] of cases) {
    it(`${JSON.stringify(message)} -> ${prefix}`, () => {
      assert.equal(commitPrefixOf(message), prefix);
    });
  }
});

describe("commitPrefixOpening carries the scope and the breaking marker", () => {
  it("scope only when written; breaking only on !", () => {
    assert.deepEqual(commitPrefixOpening("docs: x"), { prefix: "docs", breaking: false });
    assert.deepEqual(commitPrefixOpening("docs(wiki): x"), {
      prefix: "docs",
      scope: "wiki",
      breaking: false,
    });
    assert.deepEqual(commitPrefixOpening("fix!: x"), { prefix: "fix", breaking: true });
    assert.deepEqual(commitPrefixOpening("fix(cli)!: x"), {
      prefix: "fix",
      scope: "cli",
      breaking: true,
    });
    assert.deepEqual(commitPrefixOpening("x"), { prefix: "none", breaking: false });
  });
});

describe("commitPrefixVerdict holds the word to the registered set", () => {
  const policy = { prefixes: ["docs", "fix"] };
  it("a registered word is known in every shape; the scope is never consulted", () => {
    assert.deepEqual(commitPrefixVerdict(policy, "docs(wiki)!: x"), {
      prefix: "docs",
      scope: "wiki",
      breaking: true,
      known: true,
    });
    assert.deepEqual(commitPrefixVerdict(policy, "fix(docs): x"), {
      prefix: "fix",
      scope: "docs",
      breaking: false,
      known: true,
    });
  });
  it("an unregistered word and no opening are both unknown, and say which", () => {
    assert.deepEqual(commitPrefixVerdict(policy, "chore(wiki): x"), {
      prefix: "chore",
      scope: "wiki",
      breaking: false,
      known: false,
    });
    assert.deepEqual(commitPrefixVerdict(policy, "wiki: docs"), {
      prefix: "wiki",
      breaking: false,
      known: false,
    });
    assert.deepEqual(commitPrefixVerdict(policy, "x"), {
      prefix: "none",
      breaking: false,
      known: false,
    });
    // "none" is not a word a bundle can register its way around.
    assert.equal(commitPrefixVerdict({ prefixes: ["none"] }, "x").known, true);
  });
});
