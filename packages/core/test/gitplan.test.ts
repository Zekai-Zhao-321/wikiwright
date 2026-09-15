// docs/architecture.md (git via spawned plumbing with -z output parsed in pure core)
// docs/architecture.md §Directories (core/gitplan: pure parsers) · docs/constitution.md (rename detection feeds
// the former-folder-tags review) · docs/concepts.md (the staged gate's inputs).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNameStatusZ } from "../src/gitplan/index.ts";

describe("parseNameStatusZ — `git diff --cached --name-status -z -M` parser", () => {
  it("parses adds, modifications, and deletions", () => {
    const raw = "A\0wiki/a.md\0M\0wiki/b.md\0D\0wiki/c.md\0";
    assert.deepEqual(parseNameStatusZ(raw), [
      { status: "A", path: "wiki/a.md" },
      { status: "M", path: "wiki/b.md" },
      { status: "D", path: "wiki/c.md" },
    ]);
  });

  it("parses renames with similarity scores and both paths", () => {
    const raw = "R081\0wiki/old.md\0wiki/new.md\0";
    assert.deepEqual(parseNameStatusZ(raw), [
      { status: "R", path: "wiki/new.md", oldPath: "wiki/old.md" },
    ]);
  });

  it("handles CJK paths and empty input", () => {
    const raw = "A\0wiki/people/张伟.md\0";
    assert.deepEqual(parseNameStatusZ(raw), [{ status: "A", path: "wiki/people/张伟.md" }]);
    assert.deepEqual(parseNameStatusZ(""), []);
  });

  it("ignores copy records' scores while keeping both paths", () => {
    const raw = "C075\0wiki/src.md\0wiki/copy.md\0";
    assert.deepEqual(parseNameStatusZ(raw), [
      { status: "C", path: "wiki/copy.md", oldPath: "wiki/src.md" },
    ]);
  });
});
