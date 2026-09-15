// Folder-tag alignment is bundle policy: off by default, `validate` reports a
// missing segment tag, `materialize-add-only` lets the folder-tags fixer add
// and never remove. Type and tag namespaces are independent.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function run(cwd: string, args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function findingsOf(envelope: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = envelope["data"] as Record<string, unknown> | undefined;
  return (data?.["findings"] as Array<Record<string, unknown>> | undefined) ?? [];
}

const TAGS = {
  topics: { description: "Topic pages." },
  "extra-tag": { description: "Pre-existing tag." },
};

function vault(engine: Record<string, unknown> = {}, tags: Record<string, unknown> = TAGS): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-ftp-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki", "topics"), { recursive: true });
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(
      documentOf({ tags, types: { note: { extends: "concept", description: "A note." } } }),
    ),
  );
  writeFileSync(
    join(tmp, "config", "engine.json"),
    JSON.stringify({ content_roots: ["wiki"], ...engine }),
  );
  writeFileSync(
    join(tmp, "wiki", "topics", "alpha.md"),
    "---\ntype: note\ntitle: Alpha\ndescription: a.\ntags: []\n---\n\n# alpha\n",
  );
  return tmp;
}

/** The fixer's argv for one page (docs/concepts.md §Findings and routing: the materializer is a fixer). */
const materialize = (page: string): string[] => [
  "fix",
  "--rule",
  "folder-tags-present",
  "--path",
  page,
  "--expect",
  "any",
];

const folderFindings = (envelope: Record<string, unknown>) =>
  findingsOf(envelope).filter(
    (f) => f["ruleId"] === "folder-tags-present" || f["ruleId"] === "folder-segment-registered",
  );

describe("folder-tag alignment is bundle policy", () => {
  it("undeclared: folders are plain navigation — no findings", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      assert.equal(folderFindings(r.envelope).length, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // e2e:folder_tags — the declared mode in engine.json decides whether the CLI
  // reports a missing segment tag at all.
  it("validate: a missing segment tag is an error", () => {
    const tmp = vault({ folder_tags: { mode: "validate" } });
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 5);
      assert.equal(folderFindings(r.envelope).length > 0, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("materialize-add-only: the folder-tags fixer adds the missing segment and never removes", () => {
    const tmp = vault({ folder_tags: { mode: "materialize-add-only" } });
    try {
      writeFileSync(
        join(tmp, "wiki", "topics", "beta.md"),
        "---\ntype: note\ntitle: Beta\ndescription: b.\ntags: [extra-tag]\n---\n\n# beta\n",
      );
      for (const page of ["wiki/topics/alpha.md", "wiki/topics/beta.md"]) {
        const s = run(tmp, materialize(page));
        assert.equal(s.status, 0, JSON.stringify(s.envelope));
      }
      const alpha = readFileSync(join(tmp, "wiki", "topics", "alpha.md"), "utf8");
      assert.match(alpha, /tags: \["topics"\]/);
      const beta = readFileSync(join(tmp, "wiki", "topics", "beta.md"), "utf8");
      assert.match(beta, /extra-tag/, "sync never removes an existing tag");
      assert.match(beta, /topics/);
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 0, "after sync the vault is aligned");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the folder-tags fixer writes nothing outside materialize-add-only mode", () => {
    const tmp = vault({ folder_tags: { mode: "validate" } });
    try {
      const before = readFileSync(join(tmp, "wiki", "topics", "alpha.md"), "utf8");
      const s = run(tmp, materialize("wiki/topics/alpha.md"));
      assert.deepEqual(
        (s.envelope["data"] as Record<string, unknown> | undefined)?.["changed"],
        [],
        "mechanical writes need the declared mode",
      );
      assert.equal(readFileSync(join(tmp, "wiki", "topics", "alpha.md"), "utf8"), before);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an invalid mode is refused at load, not coerced", () => {
    const tmp = vault({ folder_tags: { mode: "auto" } });
    try {
      const r = run(tmp, ["lint"]);
      // An engine.json shape defect is a constitution failure (2).
      assert.equal(r.status, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("type and tag namespaces are independent", () => {
  it("a tag sharing a type name (even an archetype name) loads clean", () => {
    const tmp = vault(
      {},
      {
        topics: { description: "Topic pages." },
        note: { description: "Shares the type name." },
        reference: { description: "Shares an archetype name." },
      },
    );
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("duplicates WITHIN a namespace still fail (tag alias vs tag name)", () => {
    const tmp = vault(
      {},
      { topics: { description: "T." }, other: { description: "O.", aliases: ["topics"] } },
    );
    try {
      const r = run(tmp, ["lint"]);
      // A registry identity collision is a constitution failure (2).
      assert.equal(r.status, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
