// docs/cli.md §gate: a registered prefix set refuses an unknown prefix with
// one line naming the valid set, through `gate --commit-msg` and through the
// documented commit-msg one-liner.
// e2e:commit_prefixes — the declared list in config/engine.json decides which
// commit messages the gate refuses.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeNoteBundle } from "./fixtures/note-bundle.ts";
import { BUN, runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

interface Run {
  status: number;
  stderr: string;
  envelope: Record<string, unknown>;
}

function run(cwd: string, args: string[]): Run {
  const r = runCli([CLI, ...args], { cwd, encoding: "utf8" });
  return {
    status: r.status ?? -1,
    stderr: r.stderr,
    envelope: JSON.parse(r.stdout) as Record<string, unknown>,
  };
}

/** A committed note bundle, `commit_prefixes` declared when given. */
function vault(commitPrefixes?: string[]): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-prefix-"));
  writeNoteBundle(
    tmp,
    ["Clean"],
    commitPrefixes === undefined ? {} : { commit_prefixes: commitPrefixes },
  );
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "spec: initial");
  return tmp;
}

function message(tmp: string, text: string): string {
  const path = join(tmp, "MSG");
  writeFileSync(path, `${text}\n`);
  return "MSG";
}

/** The commit-msg stage's `commit_prefixes` block. */
function prefixOf(r: Run): unknown {
  return (r.envelope["data"] as Record<string, unknown>)["commit_prefixes"];
}

const PREFIXES = ["spec", "test", "feat", "fix"];

/**
 * POSIX-only: these arms drive a real `git commit` through a `sh` hook and an
 * extensionless PATH launcher, neither of which means anything on Windows.
 */
const POSIX_ONLY = process.platform === "win32";

/** A `wikiwright` on PATH, as the documented one-liner expects. */
function shimPath(tmp: string): string {
  const bin = join(tmp, ".bin");
  mkdirSync(bin, { recursive: true });
  const launcher = join(bin, "wikiwright");
  writeFileSync(launcher, `#!/bin/sh\nexec ${BUN} ${CLI} "$@"\n`);
  chmodSync(launcher, 0o755);
  return `${bin}${delimiter}${process.env["PATH"] ?? ""}`;
}

/** docs/cli.md §gate's commit-msg one-liner, installed by hand as the docs say. */
function installCommitMsg(tmp: string): void {
  const hook = join(tmp, ".git", "hooks", "commit-msg");
  writeFileSync(hook, `#!/bin/sh\nexec wikiwright gate --root '${tmp}' --commit-msg "$1"\n`);
  chmodSync(hook, 0o755);
}

describe("without the key the commit-msg gate holds no prefix", () => {
  it("answers commit_prefixes: null and refuses no message", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["gate", "--commit-msg", message(tmp, "chore: tidy"), "--root", "."]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      assert.equal(prefixOf(r), null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("a registered prefix set refuses an unknown prefix (docs/cli.md §gate)", () => {
  it("one line on stderr naming the valid set; a known prefix passes", () => {
    const tmp = vault(PREFIXES);
    try {
      const bad = run(tmp, ["gate", "--commit-msg", message(tmp, "chore: tidy"), "--root", "."]);
      assert.equal(bad.status, 5, JSON.stringify(bad.envelope));
      assert.equal(bad.stderr.trim().split("\n").length, 1);
      assert.match(bad.stderr, /use one of: feat, fix, spec, test/u);
      const good = run(tmp, ["gate", "--commit-msg", message(tmp, "spec: ok"), "--root", "."]);
      assert.equal(good.status, 0, JSON.stringify(good.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("blocks a real commit through the documented commit-msg one-liner", () => {
    if (POSIX_ONLY) return;
    const tmp = vault(PREFIXES);
    try {
      installCommitMsg(tmp);
      const env = { ...process.env, PATH: shimPath(tmp) } as Record<string, string>;
      const blocked = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "chore: tidy"], {
        cwd: tmp,
        encoding: "utf8",
        env,
      });
      assert.notEqual(blocked.status, 0, "an unknown prefix blocks the commit");
      assert.match(blocked.stderr, /not registered/u);
      const allowed = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "spec: ok"], {
        cwd: tmp,
        encoding: "utf8",
        env,
      });
      assert.equal(allowed.status, 0, `a registered prefix commits: ${allowed.stderr}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("a Conventional Commits scope and breaking marker carry the prefix (docs/cli.md §gate)", () => {
  it("docs(wiki):, fix!: and fix(cli)!: pass; the envelope carries scope and breaking", () => {
    const tmp = vault(["docs", "fix"]);
    try {
      const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
        [
          "docs(wiki): update the reference page",
          { prefix: "docs", scope: "wiki", breaking: false, known: true },
        ],
        ["fix!: drop the old flag", { prefix: "fix", breaking: true, known: true }],
        [
          "fix(cli)!: drop the old flag",
          { prefix: "fix", scope: "cli", breaking: true, known: true },
        ],
      ];
      for (const [text, data] of cases) {
        const r = run(tmp, ["gate", "--commit-msg", message(tmp, text), "--root", "."]);
        assert.equal(r.status, 0, JSON.stringify(r.envelope));
        assert.equal(r.stderr, "");
        assert.deepEqual(prefixOf(r), data);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("no opening is refused as none; an unregistered scoped word is refused as that word", () => {
    const tmp = vault(["docs", "fix"]);
    try {
      const none = run(tmp, [
        "gate",
        "--commit-msg",
        message(tmp, "update the page"),
        "--root",
        ".",
      ]);
      assert.equal(none.status, 5, JSON.stringify(none.envelope));
      assert.match(none.stderr, /opens with no "<prefix>:"/u);
      assert.match(none.stderr, /use one of: docs, fix/u);
      const error = (none.envelope["error"] ?? {}) as Record<string, unknown>;
      assert.equal(error["code"], "commit-prefix");
      assert.deepEqual(error["details"], { prefix: "none", valid_values: ["docs", "fix"] });

      const scoped = run(tmp, [
        "gate",
        "--commit-msg",
        message(tmp, "chore(wiki): tidy"),
        "--root",
        ".",
      ]);
      assert.equal(scoped.status, 5, JSON.stringify(scoped.envelope));
      assert.match(scoped.stderr, /prefix "chore" is not registered/u);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the commit-msg gate in a linked worktree (docs/cli.md §gate)", () => {
  // git passes the message path RELATIVE at a top level and ABSOLUTE in a
  // linked worktree; joining the absolute form onto --root made every commit
  // in a linked worktree a message-not-found refusal.
  it("takes an absolute message path as given", () => {
    const tmp = vault(PREFIXES);
    try {
      message(tmp, "chore: tidy");
      const r = run(tmp, ["gate", "--commit-msg", join(tmp, "MSG"), "--root", "."]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      const error = (r.envelope["error"] ?? {}) as Record<string, unknown>;
      assert.equal(error["code"], "commit-prefix");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("blocks the unregistered prefix and passes the registered one", () => {
    if (POSIX_ONLY) return;
    const tmp = vault(PREFIXES);
    const linked = `${tmp}-wt`;
    try {
      // A linked worktree shares the common hooks directory, so the hook
      // installed here is the one that runs there.
      installCommitMsg(tmp);
      git(tmp, "worktree", "add", "-q", "-b", "wt", linked);
      const env = { ...process.env, PATH: shimPath(tmp) } as Record<string, string>;
      const blocked = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "chore: tidy"], {
        cwd: linked,
        encoding: "utf8",
        env,
      });
      assert.notEqual(blocked.status, 0, "an unknown prefix blocks the commit");
      assert.match(blocked.stderr, /not registered/u);
      const allowed = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "spec: ok"], {
        cwd: linked,
        encoding: "utf8",
        env,
      });
      assert.equal(allowed.status, 0, `a registered prefix commits: ${allowed.stderr}`);
    } finally {
      rmSync(linked, { recursive: true, force: true });
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a failure that is not a prefix refusal still reaches the operator", () => {
    if (POSIX_ONLY) return;
    const tmp = vault(PREFIXES);
    try {
      installCommitMsg(tmp);
      writeNoteBundle(tmp, [], { commit_prefixes: PREFIXES, no_such_key: true });
      git(tmp, "add", "-A");
      const env = { ...process.env, PATH: shimPath(tmp) } as Record<string, string>;
      const blocked = spawnSync("git", ["commit", "-q", "-m", "spec: ok"], {
        cwd: tmp,
        encoding: "utf8",
        env,
      });
      assert.notEqual(blocked.status, 0, "a law that does not load blocks the commit");
      assert.notEqual(blocked.stderr.trim(), "", "and never silently: the refusal is the reason");
      assert.match(blocked.stderr, /constitution-invalid|engine-invalid/u);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the message file (docs/cli.md §gate)", () => {
  it("a missing message file is a not_found refusal, never a pass", () => {
    const tmp = vault(PREFIXES);
    try {
      const r = run(tmp, ["gate", "--commit-msg", "NOPE", "--root", "."]);
      assert.equal(r.status, 3, JSON.stringify(r.envelope));
      const error = (r.envelope["error"] ?? {}) as Record<string, unknown>;
      assert.equal(error["code"], "message-not-found");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
