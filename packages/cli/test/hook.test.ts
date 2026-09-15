// docs/cli.md §hook (--chain runs first and propagates; fail-closed when the
// engine is present; loud fail-open when it is absent; the engine pin; the bypass
// log in the git dir; a foreign hook is never clobbered; the hooks directory is
// resolved through git plumbing, so a linked worktree installs too) · 07
// docs/cli.md (the gate is for agents) (install never destroys or
// disarms) · the staged gate.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function run(cwd: string, args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function errorOf(envelope: Record<string, unknown>): Record<string, unknown> {
  return (envelope["error"] ?? {}) as Record<string, unknown>;
}

function gitVault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-hook-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "initial");
  return tmp;
}

/** A `wikiwright` on PATH — the "engine is present" arm of the hook contract. */
function shimDir(tmp: string): string {
  const bin = join(tmp, ".bin");
  mkdirSync(bin, { recursive: true });
  const launcher = join(bin, "wikiwright");
  writeFileSync(launcher, `#!/bin/sh\nexec ${process.execPath} ${CLI} "$@"\n`);
  chmodSync(launcher, 0o755);
  return bin;
}

/**
 * The hook arms drive a real `git commit` through a POSIX `sh` hook and an
 * extensionless PATH launcher. On Windows neither the launcher lookup nor the
 * executable bit carries meaning, and `spawnSync("git", …)` under a POSIX PATH
 * string fails with ENOENT rather than the assertion under test — so these arms
 * are POSIX-only, as is the executable-bit case (git-for-windows runs hooks
 * regardless of mode). The hook SCRIPTS run under git-for-windows' bundled sh;
 * what is unportable is driving them from here.
 */
const POSIX_ONLY = process.platform === "win32";

function shimPath(tmp: string): string {
  return `${shimDir(tmp)}${delimiter}${process.env["PATH"] ?? ""}`;
}

function commit(
  tmp: string,
  message: string,
  options?: { path?: string; env?: Record<string, string> },
): { status: number; stdout: string; stderr: string } {
  const env: Record<string, string> = { ...process.env, ...(options?.env ?? {}) } as Record<
    string,
    string
  >;
  if (options?.path !== undefined) env["PATH"] = options.path;
  const r = spawnSync("git", ["commit", "-q", "-m", message], { cwd: tmp, encoding: "utf8", env });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function stageRoguePage(tmp: string): void {
  writeFileSync(
    join(tmp, "wiki/rogue.md"),
    "---\ntype: no-such-type\ntitle: Rogue\ndescription: x.\ntags: []\n---\n\n# Rogue\n",
  );
  git(tmp, "add", "wiki/rogue.md");
}

describe("hook install writes the marker gate (docs/cli.md §hook)", () => {
  it("the installed pre-commit runs `wikiwright gate`, not a second pipeline", () => {
    const tmp = gitVault();
    try {
      const r = run(tmp, ["hook", "install", "--root", "."]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const hook = readFileSync(join(tmp, ".git/hooks/pre-commit"), "utf8");
      assert.match(hook, /wikiwright gate/);
      assert.match(hook, /installed by wikiwright/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--chain runs the bundle's own gate first and propagates its exit", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      mkdirSync(join(tmp, "scripts/hooks"), { recursive: true });
      const chained = join(tmp, "scripts/hooks/pre-commit");
      writeFileSync(chained, '#!/bin/sh\necho "scrub ran" >&2\nexit 3\n');
      chmodSync(chained, 0o755);
      const r = run(tmp, ["hook", "install", "--chain", "scripts/hooks/pre-commit", "--root", "."]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));

      writeFileSync(join(tmp, "wiki/idea.md"), "---\ntype: hub\n---\n");
      git(tmp, "add", "-A");
      const c = commit(tmp, "note: chained", { path: shimPath(tmp) });
      assert.notEqual(c.status, 0, "the chained script's failure blocks the commit");
      assert.match(c.stderr, /scrub ran/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // docs/cli.md §hook — the bypass is an escape hatch for wikiwright's
  // verdict; the chained script is a gate the bundle wrote and never opted into
  // it. In the flagship bundle that script is the denylist scrub, so
  // bypass-first made an environment variable a secret-egress path.
  it("WIKIWRIGHT_BYPASS does not skip the chained gate", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      mkdirSync(join(tmp, "scripts/hooks"), { recursive: true });
      const chained = join(tmp, "scripts/hooks/pre-commit");
      writeFileSync(chained, '#!/bin/sh\necho "scrub ran" >&2\nexit 7\n');
      chmodSync(chained, 0o755);
      run(tmp, ["hook", "install", "--chain", "scripts/hooks/pre-commit", "--root", "."]);

      const c = commit(tmp, "note: bypassed", {
        path: shimPath(tmp),
        env: { WIKIWRIGHT_BYPASS: "release cut" },
      });
      assert.notEqual(c.status, 0, "the bundle's own gate still runs and still blocks");
      assert.match(c.stderr, /scrub ran/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a chain path with a space, a quote and a $ is run, not interpreted", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    const rel = "scripts/hooks/it's $HOME gate.sh";
    try {
      mkdirSync(join(tmp, "scripts/hooks"), { recursive: true });
      const chained = join(tmp, rel);
      writeFileSync(chained, '#!/bin/sh\necho "odd name ran" >&2\nexit 6\n');
      chmodSync(chained, 0o755);
      const r = run(tmp, ["hook", "install", "--chain", rel, "--root", "."]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));

      const c = commit(tmp, "note: odd", { path: shimPath(tmp) });
      assert.notEqual(c.status, 0);
      assert.match(c.stderr, /odd name ran/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a chain script that is not executable is refused at install", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      mkdirSync(join(tmp, "scripts/hooks"), { recursive: true });
      const chained = join(tmp, "scripts/hooks/pre-commit");
      writeFileSync(chained, "#!/bin/sh\nexit 0\n");
      chmodSync(chained, 0o644);
      const r = run(tmp, ["hook", "install", "--chain", "scripts/hooks/pre-commit", "--root", "."]);
      assert.equal(r.status, 4, JSON.stringify(r.envelope));
      assert.equal(errorOf(r.envelope)["code"], "chain-not-executable");
      assert.equal(
        existsSync(join(tmp, ".git/hooks/pre-commit")),
        false,
        "a hook that would exit 126 on every commit is not installed",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a foreign pre-commit hook is never clobbered", () => {
    const tmp = gitVault();
    try {
      const hookPath = join(tmp, ".git/hooks/pre-commit");
      writeFileSync(hookPath, "#!/bin/sh\n# someone else's gate\nexit 0\n");
      chmodSync(hookPath, 0o755);
      const r = run(tmp, ["hook", "install", "--root", "."]);
      assert.equal(r.status, 4, JSON.stringify(r.envelope));
      assert.equal(errorOf(r.envelope)["code"], "hook-exists");
      assert.match(readFileSync(hookPath, "utf8"), /someone else's gate/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reinstalls over its own hook and restores the executable bit", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      assert.equal(run(tmp, ["hook", "install", "--root", "."]).status, 0);
      const hookPath = join(tmp, ".git/hooks/pre-commit");
      chmodSync(hookPath, 0o644);
      assert.equal(run(tmp, ["hook", "install", "--root", "."]).status, 0);
      const mode = statSync(hookPath).mode;
      assert.equal((mode & 0o111) !== 0, true, "hook is executable after reinstall");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolves the hooks directory through git plumbing, so a linked worktree installs", () => {
    const base = mkdtempSync(join(tmpdir(), "ww-wt-"));
    try {
      const main = join(base, "main");
      mkdirSync(main);
      git(main, "init", "-q");
      git(main, "config", "user.email", "t@e.com");
      git(main, "config", "user.name", "T");
      git(main, "commit", "-q", "--allow-empty", "-m", "x");
      git(main, "worktree", "add", "../wt", "-b", "w");
      const wt = join(base, "wt");
      mkdirSync(join(wt, "config"), { recursive: true });
      writeFileSync(join(wt, "config", "constitution.json"), JSON.stringify(documentOf()));
      writeFileSync(join(wt, "config", "engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
      const r = run(wt, ["hook", "install", "--root", "."]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const hooksDir = git(wt, "rev-parse", "--path-format=absolute", "--git-path", "hooks").trim();
      const hook = readFileSync(join(hooksDir, "pre-commit"), "utf8");
      assert.equal(hook.includes("installed by wikiwright"), true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("the hook fails open loudly, and closed when it can (docs/cli.md §hook)", () => {
  it("no engine on PATH: one line on stderr, exit 0, the commit lands", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      run(tmp, ["hook", "install", "--root", "."]);
      stageRoguePage(tmp);
      // A PATH with no `wikiwright` — the fresh-clone case.
      const c = commit(tmp, "note: no engine", { path: "/usr/bin:/bin" });
      assert.equal(c.status, 0, `the commit must land: ${c.stderr}`);
      assert.match(c.stderr, /wikiwright: engine not found — gate skipped this commit/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // The two findings that blocked a commit sat on lines 200–230 of a
  // 700-line envelope whose coverage block listed 72 passes. The hook prints
  // the rule census and the error findings, then how to see the rest.
  it("engine present and the page fails: the commit is blocked, the summary on stderr", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      run(tmp, ["hook", "install", "--root", "."]);
      stageRoguePage(tmp);
      const c = commit(tmp, "note: rogue", { path: shimPath(tmp) });
      assert.notEqual(c.status, 0, "fail-closed when the engine is present");
      assert.match(c.stderr, /wikiwright gate: 1 error finding\(s\) block this commit/);
      assert.match(c.stderr, /by rule: unknown-type 1/);
      assert.match(c.stderr, /error unknown-type wiki\/rogue\.md:2 — unknown type "no-such-type"/);
      assert.match(c.stderr, /remediation: declare a registered type/);
      assert.match(c.stderr, /run `wikiwright gate --all` for the whole envelope/);
      // The whole of what `git commit` printed, both streams — the
      // summary once, the envelope never, on any stream.
      const printed = `${c.stdout}${c.stderr}`;
      assert.equal(printed.split("block this commit").length - 1, 1, printed);
      assert.equal(printed.includes("coverage"), false, "never the coverage block");
      assert.equal(printed.includes('"findings"'), false, "never the envelope");
      assert.equal(printed.includes('"ok"'), false, "never the envelope");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // The bundle's hook had been written by an older build, which captured
  // the verb's stdout and echoed it — so a refused commit printed the summary
  // AND the envelope. The engine now reports such a hook, and the reinstall
  // its argv names writes the current one.
  it("a marker hook another build wrote is hook-stale in check, and the argv reinstalls it", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      run(tmp, ["hook", "install", "--root", "."]);
      const hooksDir = git(
        tmp,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "hooks",
      ).trim();
      const hook = join(hooksDir, "pre-commit");
      const current = readFileSync(hook, "utf8");
      const old = current.replace(
        'wikiwright gate --root "$root" >/dev/null\nexit "$?"\n',
        'out=$(wikiwright gate --root "$root")\nstatus=$?\nif [ "$status" -ne 0 ]; then\n  printf "%s\\n" "$out" >&2\n  exit "$status"\nfi\nexit 0\n',
      );
      assert.notEqual(old, current, "the old form was substituted");
      writeFileSync(hook, old);
      stageRoguePage(tmp);
      const c = commit(tmp, "note: rogue", { path: shimPath(tmp) });
      assert.notEqual(c.status, 0);
      assert.equal(
        `${c.stdout}${c.stderr}`.includes('"findings"'),
        true,
        "the old hook echoes the envelope",
      );
      const check = run(tmp, ["check", "--root", "."]);
      const stale = (
        (check.envelope["data"] as { findings?: Record<string, unknown>[] })["findings"] ?? []
      ).find((f) => f["ruleId"] === "hook-stale");
      assert.notEqual(stale, undefined, JSON.stringify(check.envelope));
      assert.equal(stale?.["severity"], "warning");
      assert.equal(stale?.["path"], ".git/hooks/pre-commit");
      const argv = (stale?.["fix"] as { argv: string[] } | undefined)?.argv;
      assert.deepEqual(argv, ["hook", "install"]);
      const reinstall = run(tmp, [...(argv ?? []), "--root", "."]);
      assert.equal(reinstall.status, 0, JSON.stringify(reinstall.envelope));
      assert.equal(readFileSync(hook, "utf8"), current);
      const again = run(tmp, ["check", "--root", "."]);
      const findings =
        (again.envelope["data"] as { findings?: Record<string, unknown>[] })["findings"] ?? [];
      assert.equal(
        findings.some((f) => f["ruleId"] === "hook-stale"),
        false,
      );
      const c2 = commit(tmp, "note: rogue", { path: shimPath(tmp) });
      assert.equal(
        `${c2.stdout}${c2.stderr}`.includes('"findings"'),
        false,
        "the reinstalled hook drops the envelope",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a stale chained hook's argv keeps the chain", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      mkdirSync(join(tmp, "scripts"), { recursive: true });
      writeFileSync(join(tmp, "scripts", "scrub.sh"), "#!/bin/sh\necho scrub ran >&2\n");
      chmodSync(join(tmp, "scripts", "scrub.sh"), 0o755);
      run(tmp, ["hook", "install", "--chain", "scripts/scrub.sh", "--root", "."]);
      const hooksDir = git(
        tmp,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "hooks",
      ).trim();
      const hook = join(hooksDir, "pre-commit");
      writeFileSync(hook, readFileSync(hook, "utf8").replace(" >/dev/null\n", "\n"));
      const check = run(tmp, ["check", "--root", "."]);
      const stale = (
        (check.envelope["data"] as { findings?: Record<string, unknown>[] })["findings"] ?? []
      ).find((f) => f["ruleId"] === "hook-stale");
      assert.deepEqual((stale?.["fix"] as { argv: string[] } | undefined)?.argv, [
        "hook",
        "install",
        "--chain",
        "scripts/scrub.sh",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("WIKIWRIGHT_BYPASS logs one line into the git dir and lets the commit through", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      run(tmp, ["hook", "install", "--root", "."]);
      stageRoguePage(tmp);
      const c = commit(tmp, "note: bypass", {
        path: shimPath(tmp),
        env: { WIKIWRIGHT_BYPASS: "release cut, findings triaged in #412" },
      });
      assert.equal(c.status, 0, `bypass lets the commit through: ${c.stderr}`);
      const log = readFileSync(join(tmp, ".git/wikiwright-bypass.log"), "utf8");
      const line = log.trim().split("\n").at(-1) ?? "";
      const fields = line.split("\t");
      assert.equal(fields.length, 3, `three fields, tab-separated: ${JSON.stringify(line)}`);
      assert.match(fields[0] ?? "", /^\d{4}-\d{2}-\d{2}T/, "an ISO date");
      assert.equal(fields[1], "release cut, findings triaged in #412");
      assert.match(fields[2] ?? "", /Test/, "the commit author");
      assert.equal(
        existsSync(join(tmp, "wikiwright-bypass.log")),
        false,
        "never a tracked file — a bypassed commit cannot contain its own record",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // docs/cli.md §hook — the reason is one field. A tab typed into it
  // would otherwise split the record of the bypass it exists to preserve.
  it("a reason containing a tab stays one field", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      run(tmp, ["hook", "install", "--root", "."]);
      stageRoguePage(tmp);
      const c = commit(tmp, "note: bypass", {
        path: shimPath(tmp),
        env: { WIKIWRIGHT_BYPASS: "release\tcut\tby hand" },
      });
      assert.equal(c.status, 0, `bypass lets the commit through: ${c.stderr}`);
      const line = readFileSync(join(tmp, ".git/wikiwright-bypass.log"), "utf8").trim();
      assert.equal(line.split("\t").length, 3, `three fields: ${JSON.stringify(line)}`);
      assert.match(line, /release cut by hand/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the engine pin (docs/cli.md §hook, e2e:engine)", () => {
  function pin(tmp: string, range: unknown): void {
    writeFileSync(
      join(tmp, "config/engine.json"),
      JSON.stringify({ content_roots: ["wiki"], folder_tags: { mode: "validate" }, engine: range }),
    );
    git(tmp, "add", "config/engine.json");
  }

  it("a range the running engine satisfies gates normally", () => {
    const tmp = gitVault();
    try {
      pin(tmp, ">=0.1.0 <2.0.0");
      const r = run(tmp, ["gate", "--root", "."]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a range it does not satisfy refuses with engine-pin-mismatch, exit 2", () => {
    const tmp = gitVault();
    try {
      pin(tmp, ">=9.0.0");
      const r = run(tmp, ["gate", "--root", "."]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(errorOf(r.envelope)["code"], "engine-pin-mismatch");
      assert.equal(errorOf(r.envelope)["type"], "constitution");
      assert.match(String(errorOf(r.envelope)["message"]), /9\.0\.0/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the pin blocks the commit through the hook, not only the verb", () => {
    if (POSIX_ONLY) return;
    const tmp = gitVault();
    try {
      run(tmp, ["hook", "install", "--root", "."]);
      pin(tmp, "^9.0.0");
      const c = commit(tmp, "schema: pin", { path: shimPath(tmp) });
      assert.notEqual(c.status, 0);
      assert.match(c.stderr, /engine-pin-mismatch/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an unparseable range is a constitution failure at load, not a gate that accepts everything", () => {
    const tmp = gitVault();
    try {
      pin(tmp, "not a range");
      const r = run(tmp, ["lint", "--root", "."]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(errorOf(r.envelope)["type"], "constitution");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
