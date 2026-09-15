// docs/architecture.md §Directories (the path law). The kernel half: shape, decidable
// from the string, with the closed refusal set and the things it deliberately
// still admits.
//
// Non-vacuity is not a note here, it is a case: `the old guard admits what this
// refuses` restores the exact predicate the law replaced and asserts it says yes
// to the traversal that wrote a file above the vault root. If someone reverts
// the law, that case goes green in a way a reader cannot miss.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isContentPath,
  isVaultPath,
  PATH_REFUSALS,
  type PathRefusal,
  pathRefusal,
} from "../src/index.ts";

const ROOTS = ["wiki", "raw"];

/** The predicate the path law replaced, kept verbatim so the fix cannot go quiet. */
function oldGuard(path: string, roots: readonly string[]): boolean {
  return roots.some((r) => path.startsWith(`${r}/`)) && path.endsWith(".md");
}

describe("docs/architecture.md §Directories — the shape of a vault path", () => {
  it("names the first reason a string is not a vault path", () => {
    const cases: [string, PathRefusal][] = [
      ["", "empty"],
      ["C:/vault/wiki/x.md", "drive"],
      ["c:x.md", "drive"],
      ["//server/share/x.md", "unc"],
      ["\\\\server\\share\\x.md", "unc"],
      ["/etc/passwd.md", "absolute"],
      ["wiki\\x.md", "backslash"],
      ["wiki/x\u0000.md", "control-character"],
      ["wiki/x\n.md", "control-character"],
      ["wiki//x.md", "empty-segment"],
      ["wiki/./x.md", "dot-segment"],
      ["./wiki/x.md", "dot-segment"],
      ["wiki/../../outside.md", "traversal"],
      ["wiki/x/", "trailing-slash"],
    ];
    for (const [path, refusal] of cases) {
      assert.equal(pathRefusal(path), refusal, `${JSON.stringify(path)} is ${refusal}`);
    }
  });

  it("every refusal carries its own message, and no two share one", () => {
    const keys = Object.keys(PATH_REFUSALS) as PathRefusal[];
    const messages = keys.map((k) => PATH_REFUSALS[k]);
    assert.equal(new Set(messages).size, messages.length, "each refusal reads differently");
    for (const message of messages) assert.equal(message.length > 0, true);
  });

  it("admits what a real vault carries: dot segments, spaces, Han", () => {
    // A path law that quietly narrowed would refuse pages that exist.
    for (const path of [
      "wiki/x.md",
      "wiki/.obsidian/config.md",
      "wiki/Chen Jing.md",
      "wiki/记忆/第一页.md",
      "wiki/a.b/c-d_e.md",
      "wiki/..hidden.md",
      "wiki/x..md",
      "docs/wiki/deep/x.md",
    ]) {
      assert.equal(pathRefusal(path), undefined, `${path} is a legal vault path`);
      assert.equal(isVaultPath(path), true);
    }
  });

  it("a declared root is held to the same law, at any depth", () => {
    for (const root of ["wiki", "docs/wiki", ".vault"]) {
      assert.equal(pathRefusal(root), undefined, `${root} is a legal root`);
    }
    assert.equal(pathRefusal(".."), "traversal");
    assert.equal(pathRefusal("/abs"), "absolute");
    assert.equal(pathRefusal("."), "dot-segment");
  });
});

describe("docs/architecture.md §Directories — isContentPath is the one definition", () => {
  it("a path under a root ending .md is content, as it always was", () => {
    assert.equal(isContentPath("wiki/x.md", ROOTS), true);
    assert.equal(isContentPath("raw/deep/y.md", ROOTS), true);
    assert.equal(isContentPath("wiki/x.txt", ROOTS), false);
    assert.equal(isContentPath("notes/x.md", ROOTS), false);
    // A root is a PREFIX with a separator, never a bare prefix match.
    assert.equal(isContentPath("wikiwright/x.md", ROOTS), false);
  });

  it("the old guard admits what this refuses — the defect, restored", () => {
    const reproduction = "wiki/concepts/../../../ESCAPED.md";
    assert.equal(oldGuard(reproduction, ROOTS), true, "the predicate the law replaced said yes");
    assert.equal(isContentPath(reproduction, ROOTS), false, "the one in force says no");
    for (const path of ["wiki/../.git/config.md", "wiki/a/../../../x.md", "wiki//x.md"]) {
      assert.equal(oldGuard(path, ROOTS), true);
      assert.equal(isContentPath(path, ROOTS), false, path);
    }
  });

  it("shape is asked before the roots, so a root cannot argue a path back in", () => {
    // A root that spelled the traversal itself would otherwise re-open it. The
    // schema refuses such a root at load; this is the second lock.
    assert.equal(isContentPath("wiki/../x.md", ["wiki/.."]), false);
  });
});
