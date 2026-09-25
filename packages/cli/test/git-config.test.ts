// docs/architecture.md §Invariants (deterministic artifacts): what the engine
// reads from git does not depend on the caller's git configuration. The
// transport passes the caller's environment through, `GIT_CONFIG_COUNT`
// included, so these tests set `diff.relative=true` that way, as a user's
// global configuration would, and hold each diff the engine reads from a
// vault in a directory of its repository to the answer it gives without it.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { revisionState } from "../src/state.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

const RELATIVE = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "diff.relative",
  GIT_CONFIG_VALUE_0: "true",
};

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: { tags: { mode: "registered", entries: {} } },
  types: {
    source: {
      extends: "reference",
      description: "A captured source: origin, pinned commit, the paths it covers.",
      fields: {
        locator: { kind: "string", required: true },
        commit: { kind: "pin", origin: "locator", covers: "covers", required: true },
        covers: { kind: "list", item: { kind: "string" } },
      },
    },
    note: { extends: "concept", description: "A note." },
  },
};

let repo = "";
let vault = "";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function commit(message: string): string {
  git(["add", "-A"]);
  git(["commit", "-qm", message]);
  return git(["rev-parse", "HEAD"]);
}

beforeAll(() => {
  // A repository holding a planting schedule, and a vault in its `garden/`
  // directory whose source page covers the schedule, pinned before it moved.
  repo = mkdtempSync(join(tmpdir(), "ww-git-config-"));
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "T"]);
  write(repo, "beds/schedule.txt", "sow peas in March\n");
  const pin = commit("the schedule");
  vault = join(repo, "garden");
  write(vault, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
  write(vault, "config/engine.json", `${JSON.stringify({ content_roots: ["wiki", "raw"] })}\n`);
  write(
    vault,
    "raw/Schedule.md",
    `---\ntype: source\ntitle: Schedule\ndescription: The planting schedule.\ntags: []\nlocator: "."\ncommit: ${pin}\ncovers: ["beds/schedule.txt"]\n---\n\n# Schedule\n\nCaptured.\n`,
  );
  write(
    vault,
    "wiki/Peas.md",
    "---\ntype: note\ntitle: Peas\ndescription: Peas.\ntags: []\n---\n\n# Peas\n\nSown early.\n",
  );
  commit("the vault");
  write(repo, "beds/schedule.txt", "sow peas in February\n");
  commit("the schedule moved");
  git(["mv", "garden/wiki/Peas.md", "garden/wiki/Sweet peas.md"]);
  commit("a page renamed");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

function freshness(env: Record<string, string>): { state: unknown; touched: unknown } {
  const r = runCli([CLI, "freshness", "--root", vault], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  const entry = (JSON.parse(r.stdout) as { data: { entries: Record<string, unknown>[] } }).data
    .entries[0];
  return { state: entry?.["state"], touched: entry?.["covering_touched"] };
}

describe("git reads do not depend on diff.relative", () => {
  it("the covering diff names a covered path outside the vault's directory", () => {
    const plain = freshness({});
    expect(plain).toEqual({ state: "stale", touched: ["beds/schedule.txt"] });
    expect(freshness(RELATIVE)).toEqual(plain);
  });

  it("a revision's renames name paths from the vault root", async () => {
    const saved = { ...process.env };
    try {
      const plain = await revisionState(vault, "HEAD", undefined, ["wiki", "raw"]);
      expect(plain.renames).toEqual([{ from: "wiki/Peas.md", to: "wiki/Sweet peas.md" }]);
      Object.assign(process.env, RELATIVE);
      const relative = await revisionState(vault, "HEAD", undefined, ["wiki", "raw"]);
      expect(relative.renames).toEqual(plain.renames);
    } finally {
      for (const key of Object.keys(RELATIVE)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
