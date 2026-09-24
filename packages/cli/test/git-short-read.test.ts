// docs/roadmap.md · docs/cli.md §Exit codes: a git answer cut short is refused
// by name as `git-short-read` (exit 1), never read as a shorter listing. Under
// load a runtime's synchronous spawn has handed back a child's stdout cut short
// with exit 0; these tests put a `git` on PATH that does the same to one
// command, and hold every verb that reads it to the refusal.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";
import { GitShortRead, terminated } from "../src/git.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

/** POSIX-only, like staged-gate-reads.test.ts: the cutting `git` is an `sh` launcher. */
const POSIX_ONLY = process.platform === "win32";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function page(title: string, body = ""): string {
  return `---\ntype: note\ntitle: ${title}\ndescription: ${title}.\ntags: []\n---\n\n# ${title}\n${body}`;
}

/** A one-type repository of four pages, committed, then two of them staged as modified. */
function repo(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-short-read-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki"));
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(documentOf({ types: { note: { extends: "concept", description: "A note." } } })),
  );
  writeFileSync(join(tmp, "config", "engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
  for (const name of ["Fern", "Moss", "Reed", "Sedge"]) {
    writeFileSync(join(tmp, "wiki", `${name}.md`), page(name));
  }
  git(tmp, "init", "-q", "-b", "main");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "base");
  writeFileSync(join(tmp, "wiki", "Fern.md"), page("Fern", "\nA second frond.\n"));
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "fern");
  writeFileSync(join(tmp, "wiki", "Moss.md"), page("Moss", "\nA staged line.\n"));
  writeFileSync(join(tmp, "wiki", "Reed.md"), page("Reed", "\nA staged line.\n"));
  git(tmp, "add", "-A");
  return tmp;
}

/**
 * A `git` on PATH that runs the real one and, for the one command whose argv
 * holds WW_CUT, prints its answer cut: without its last byte (`byte`), or only
 * its first line (`line`), with git's own exit status. Every other command
 * passes through untouched.
 */
function cuttingGit(tmp: string): string {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = join(tmp, ".bin");
  mkdirSync(bin);
  const held = join(tmp, "git.out");
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      'if [ -n "$WW_CUT" ]; then',
      '  case "$*" in',
      `    *"$WW_CUT"*)`,
      `      "${real}" "$@" > "${held}"`,
      "      status=$?",
      '      if [ "$WW_CUT_MODE" = line ]; then',
      `        head -n 1 "${held}"`,
      "      else",
      `        size=$(wc -c < "${held}" | tr -d ' ')`,
      `        if [ "$size" -gt 0 ]; then head -c $((size - 1)) "${held}"; fi`,
      "      fi",
      "      exit $status",
      "      ;;",
      "  esac",
      "fi",
      `exec "${real}" "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "git"), 0o755);
  return `${bin}${delimiter}${process.env["PATH"] ?? ""}`;
}

interface Run {
  status: number;
  envelope: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

function run(cwd: string, PATH: string, args: string[], cut?: string, mode = "byte"): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH, WW_CUT_MODE: mode };
  if (cut === undefined) delete env["WW_CUT"];
  else env["WW_CUT"] = cut;
  const r = spawnSync(CLI_RUNTIME, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8", env });
  let envelope: Record<string, unknown> = {};
  try {
    envelope = JSON.parse(r.stdout ?? "") as Record<string, unknown>;
  } catch {
    // Not an envelope; the assertion message prints it as it came.
  }
  return { status: r.status ?? -1, envelope, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function said(r: Run): string {
  return `exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;
}

/** The refusal: exit 1, `git-short-read`, and the git command named in its details. */
function assertShortRead(r: Run, command: string): void {
  assert.equal(r.status, 1, said(r));
  assert.equal(r.envelope["ok"], false, said(r));
  const error = r.envelope["error"] as {
    type: string;
    code: string;
    message: string;
    details: { command: string };
  };
  assert.equal(error.type, "internal", said(r));
  assert.equal(error.code, "git-short-read", said(r));
  assert.ok(error.details.command.startsWith(`git ${command}`), said(r));
  assert.match(error.message, /answered short/u, said(r));
}

describe("a cut git answer is refused as git-short-read (docs/roadmap.md)", () => {
  let tmp = "";
  let PATH = "";
  before(() => {
    if (POSIX_ONLY) return;
    tmp = repo();
    PATH = cuttingGit(tmp);
  });
  after(() => {
    if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
  });

  it("the untouched shim changes nothing: lint --staged judges both staged pages", () => {
    if (POSIX_ONLY) return;
    const r = run(tmp, PATH, ["lint", "--staged"]);
    assert.equal(r.status, 0, said(r));
    const data = r.envelope["data"] as { summary: { pages: number } };
    assert.ok(data.summary.pages > 0, said(r));
  });

  it("lint --staged refuses a staged-change listing cut before its final NUL", () => {
    if (POSIX_ONLY) return;
    assertShortRead(
      run(tmp, PATH, ["lint", "--staged"], "diff --cached --name-status"),
      "diff --cached --name-status -z",
    );
  });

  it("lint --staged refuses an index listing cut before its final NUL", () => {
    if (POSIX_ONLY) return;
    assertShortRead(run(tmp, PATH, ["lint", "--staged"], "ls-files -s -z"), "ls-files -s -z");
  });

  it("lint --staged refuses a batch-check answer cut after its first line", () => {
    if (POSIX_ONLY) return;
    // Cut at a line: every line it kept is well formed, so only the count gives it away.
    assertShortRead(
      run(tmp, PATH, ["lint", "--staged"], "cat-file --batch-check", "line"),
      "cat-file --batch-check",
    );
  });

  it("fix --staged refuses a cut staged read instead of fixing nothing", () => {
    if (POSIX_ONLY) return;
    const r = run(
      tmp,
      PATH,
      ["fix", "--rule", "folder-tags-present", "--staged", "--dry-run", "--expect", "any"],
      "ls-files -s -z",
    );
    assertShortRead(r, "ls-files -s -z");
  });

  it("lint --since refuses a cut commit walk instead of replaying fewer commits", () => {
    if (POSIX_ONLY) return;
    const base = git(tmp, "rev-list", "--max-parents=0", "HEAD");
    assertShortRead(
      run(tmp, PATH, ["lint", "--since", base], "rev-list --first-parent"),
      "rev-list",
    );
  });

  it("a cut status leaves the bundle block off instead of stating a clean checkout", () => {
    if (POSIX_ONLY) return;
    const whole = run(tmp, PATH, ["lint"]);
    assert.equal(whole.status, 0, said(whole));
    const bundle = (whole.envelope["metadata"] as { bundle?: { dirty: boolean } }).bundle;
    assert.equal(bundle?.dirty, true, said(whole));
    const cut = run(tmp, PATH, ["lint"], "status --porcelain=v2");
    assert.equal(cut.status, 0, said(cut));
    assert.equal((cut.envelope["metadata"] as { bundle?: unknown }).bundle, undefined, said(cut));
  });
});

describe("terminated: a git answer held to its terminator", () => {
  it("passes an empty answer, and one that ends in its terminator", () => {
    assert.equal(terminated(["ls-files", "-z"], "", "\0"), "");
    assert.equal(terminated(["ls-files", "-z"], "a.md\0b.md\0", "\0"), "a.md\0b.md\0");
    assert.equal(terminated(["rev-parse", "HEAD"], "abc\n", "\n", true), "abc\n");
  });

  it("refuses an answer that ends without its terminator, naming the command", () => {
    assert.throws(
      () => terminated(["ls-files", "-z"], "a.md\0b.m", "\0"),
      (e: unknown) =>
        e instanceof GitShortRead &&
        e.command === "ls-files -z" &&
        /does not end in NUL/u.test(e.message),
    );
    assert.throws(
      () => terminated(["rev-parse", "HEAD"], "ab", "\n"),
      (e: unknown) => e instanceof GitShortRead && /does not end in a newline/u.test(e.message),
    );
  });

  it("refuses no answer at all from a read that always answers", () => {
    assert.throws(
      () => terminated(["rev-parse", "HEAD"], "", "\n", true),
      (e: unknown) => e instanceof GitShortRead && /printed nothing/u.test(e.message),
    );
  });
});
