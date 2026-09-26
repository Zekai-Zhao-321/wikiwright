// docs/architecture.md §Invariants (deterministic artifacts): what the engine
// reads from git does not depend on the caller's git configuration. The
// transport passes the caller's environment through, `GIT_CONFIG_COUNT`
// included, so these tests set `diff.relative=true` that way, as a user's
// global configuration would, and hold each diff the engine reads from a
// bundle in a directory of its repository to the answer it gives without it.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexState } from "../src/lawstate.ts";
import { writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

const RELATIVE = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "diff.relative",
  GIT_CONFIG_VALUE_0: "true",
};

const SOURCE_TYPE = `type: source
role: reference
description: A capture of a file in this repository.
fields:
  type: object
  properties:
    capture: { $ref: "#/$defs/pin" }
  required: [capture]
`;

let repo = "";
let bundle = "";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function commit(message: string): string {
  git(["add", "-A"]);
  git(["commit", "-qm", message]);
  return git(["rev-parse", "HEAD"]);
}

beforeAll(() => {
  // A repository holding a planting schedule, and a bundle in its `garden/`
  // directory whose source page covers the schedule, pinned before it moved;
  // then a page renamed and staged.
  repo = mkdtempSync(join(tmpdir(), "ww-git-config-"));
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "T"]);
  writeAt(repo, "beds/schedule.txt", "sow peas in March\n");
  const pin = commit("the schedule");
  bundle = join(repo, "garden");
  writeNoteBundle(bundle, ["Peas"]);
  writeAt(bundle, "constitution/types/source.yaml", SOURCE_TYPE);
  writeAt(
    bundle,
    "wiki/Schedule.md",
    `---\ntype: source\ntitle: Schedule\ncapture:\n  commit: ${pin}\n  origin: "."\n  covers: [beds/schedule.txt]\n---\n\n# Schedule\n\nCaptured.\n`,
  );
  commit("the bundle");
  writeAt(repo, "beds/schedule.txt", "sow peas in February\n");
  commit("the schedule moved");
  git(["mv", "garden/wiki/Peas.md", "garden/wiki/Sweet peas.md"]);
  git(["add", "-A"]);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

function staleTouched(env: Record<string, string>): unknown {
  const r = runCli([CLI, "check", "--all", "--root", bundle], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const findings = (JSON.parse(r.stdout) as { data: { findings: Record<string, unknown>[] } }).data
    .findings;
  return findings
    .filter((f) => f["rule"] === "pin-stale")
    .map((f) => [f["path"], (f["details"] as Record<string, unknown>)["touched"]]);
}

describe("git reads do not depend on diff.relative", () => {
  it("the covering diff names a covered path outside the bundle's directory", () => {
    const plain = staleTouched({});
    expect(plain).toEqual([["wiki/Schedule.md", ["beds/schedule.txt"]]]);
    expect(staleTouched(RELATIVE)).toEqual(plain);
  });

  it("the index's renames name paths from the bundle root", async () => {
    const saved = { ...process.env };
    try {
      const plain = await indexState(bundle);
      expect(plain.renames).toEqual([{ from: "wiki/Peas.md", to: "wiki/Sweet peas.md" }]);
      Object.assign(process.env, RELATIVE);
      const relative = await indexState(bundle);
      expect(relative.renames).toEqual(plain.renames);
    } finally {
      for (const key of Object.keys(RELATIVE)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
