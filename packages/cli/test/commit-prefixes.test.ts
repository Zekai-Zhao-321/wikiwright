// docs/cli.md: a registered prefix set refuses an unknown prefix with
// one line naming the valid set; `hook install` writes the commit-msg hook
// only when the key is declared.
// e2e:commit_prefixes — the declared set in config/engine.json decides which
// commit messages the hook refuses.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

interface Run {
  status: number;
  stderr: string;
  envelope: Record<string, unknown>;
}

function run(cwd: string, args: string[]): Run {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return {
    status: r.status ?? -1,
    stderr: r.stderr,
    envelope: JSON.parse(r.stdout) as Record<string, unknown>,
  };
}

function vault(commitPrefixes?: unknown): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-prefix-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  const engine: Record<string, unknown> = {
    content_roots: ["wiki"],
    folder_tags: { mode: "validate" },
  };
  if (commitPrefixes !== undefined) engine["commit_prefixes"] = commitPrefixes;
  writeFileSync(join(tmp, "config/engine.json"), JSON.stringify(engine));
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

const PREFIXES = ["spec", "test", "feat", "fix"];

/**
 * POSIX-only, like hook.test.ts: the arm drives a real `git commit`
 * through a `sh` hook and an extensionless PATH launcher, neither of which means
 * anything on Windows. The hook script itself runs under the bundled sh there.
 */
const POSIX_ONLY = process.platform === "win32";

/** A `wikiwright` on PATH — the "engine is present" arm of the hook contract. */
function shimPath(tmp: string): string {
  const bin = join(tmp, ".bin");
  mkdirSync(bin, { recursive: true });
  const launcher = join(bin, "wikiwright");
  writeFileSync(launcher, `#!/bin/sh\nexec ${process.execPath} ${CLI} "$@"\n`);
  chmodSync(launcher, 0o755);
  return `${bin}${delimiter}${process.env["PATH"] ?? ""}`;
}

describe("without the key the commit-msg gate judges nothing", () => {
  it("answers commit_prefixes: null and refuses no message", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["gate", "--commit-msg", message(tmp, "chore: tidy"), "--root", "."]);
      assert.equal(r.status, 0);
      assert.deepEqual(r.envelope["data"], { commit_prefixes: null });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("a registered prefix set refuses an unknown prefix (docs/cli.md)", () => {
  it("one line on stderr naming the valid set; a known prefix passes", () => {
    const tmp = vault({ prefixes: PREFIXES });
    try {
      const bad = run(tmp, ["gate", "--commit-msg", message(tmp, "chore: tidy"), "--root", "."]);
      assert.equal(bad.status, 5, JSON.stringify(bad.envelope));
      const stderrLines = bad.stderr.trim().split("\n");
      assert.equal(stderrLines.length, 1, `one line, not an envelope: ${bad.stderr}`);
      for (const prefix of PREFIXES) {
        assert.match(stderrLines[0] ?? "", new RegExp(prefix));
      }
      const good = run(tmp, ["gate", "--commit-msg", message(tmp, "fix: it"), "--root", "."]);
      assert.equal(good.status, 0, JSON.stringify(good.envelope));
      assert.equal(good.stderr, "");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("blocks a real commit through the installed commit-msg hook", () => {
    if (POSIX_ONLY) return;
    const tmp = vault({ prefixes: PREFIXES });
    try {
      const install = run(tmp, ["hook", "install", "--root", "."]);
      assert.equal(install.status, 0, JSON.stringify(install.envelope));
      assert.equal(existsSync(join(tmp, ".git/hooks/commit-msg")), true);

      const env = { ...process.env, PATH: shimPath(tmp) } as Record<string, string>;
      // An empty commit: the pre-commit gate has nothing to judge, so what
      // blocks here is the commit-msg hook and only the commit-msg hook.
      const blocked = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "chore: tidy"], {
        cwd: tmp,
        encoding: "utf8",
        env,
      });
      assert.notEqual(blocked.status, 0, "an unknown prefix blocks the commit");
      assert.match(blocked.stderr, /not registered/);
      assert.match(blocked.stderr, /spec/);

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
    const tmp = vault({ prefixes: ["docs", "fix"] });
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
        assert.deepEqual(r.envelope["data"], data);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("no opening is refused as none; an unregistered scoped word is refused as that word", () => {
    const tmp = vault({ prefixes: ["docs", "fix"] });
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

describe("the commit-msg gate in a linked worktree (docs/cli.md §hook)", () => {
  // docs/cli.md §hook — git passes the message path RELATIVE at a top level and
  // ABSOLUTE in a linked worktree. Joining the absolute form onto --root made
  // every commit in a linked worktree a message-not-found refusal, printed
  // nowhere because the hook discarded the verb's stdout. This repository runs
  // six linked worktrees.
  it("takes an absolute message path as given", () => {
    const tmp = vault({ prefixes: PREFIXES });
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
    const tmp = vault({ prefixes: PREFIXES });
    const linked = `${tmp}-wt`;
    try {
      const install = run(tmp, ["hook", "install", "--root", "."]);
      assert.equal(install.status, 0, JSON.stringify(install.envelope));
      // A linked worktree shares the common hooks directory, so the gate
      // installed above is the gate that runs here.
      git(tmp, "worktree", "add", "-q", "-b", "wt", linked);
      const env = { ...process.env, PATH: shimPath(tmp) } as Record<string, string>;

      const blocked = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "chore: tidy"], {
        cwd: linked,
        encoding: "utf8",
        env,
      });
      assert.notEqual(blocked.status, 0, "an unknown prefix blocks the commit");
      assert.match(blocked.stderr, /not registered/);

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
    const tmp = vault({ prefixes: PREFIXES });
    try {
      run(tmp, ["hook", "install", "--root", "."]);
      // Isolate the commit-msg hook: without this the pre-commit gate would
      // report the same constitution failure first.
      rmSync(join(tmp, ".git/hooks/pre-commit"));
      writeFileSync(
        join(tmp, "config/engine.json"),
        JSON.stringify({
          content_roots: ["wiki"],
          folder_tags: { mode: "validate" },
          commit_prefixes: { prefixes: PREFIXES },
          no_such_key: true,
        }),
      );
      const env = { ...process.env, PATH: shimPath(tmp) } as Record<string, string>;
      const blocked = spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "spec: ok"], {
        cwd: tmp,
        encoding: "utf8",
        env,
      });
      assert.notEqual(blocked.status, 0, "a broken constitution blocks the commit");
      assert.notEqual(blocked.stderr.trim(), "", "and never silently — the envelope is the reason");
      assert.match(blocked.stderr, /constitution|no_such_key/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("hook install and the message file (docs/cli.md)", () => {
  it("installs commit-msg only when the key is declared", () => {
    const without = vault();
    try {
      run(without, ["hook", "install", "--root", "."]);
      assert.equal(existsSync(join(without, ".git/hooks/commit-msg")), false);
    } finally {
      rmSync(without, { recursive: true, force: true });
    }
  });

  it("a missing message file is a not_found refusal, never a pass", () => {
    const tmp = vault({ prefixes: PREFIXES });
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
