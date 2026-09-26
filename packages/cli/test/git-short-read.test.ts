// docs/roadmap.md · docs/cli.md §Exit codes: a git answer cut short is refused
// by name as `git-short-read` (exit 1), never read as a shorter listing. Under
// load a runtime's synchronous spawn has handed back a child's stdout cut short
// with exit 0; these tests put a `git` on PATH that does the same to one
// command, and hold the verbs that read it — the gate over the index, check
// over the checkout's status — to the refusal.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GitShortRead, terminated } from "../src/git.ts";
import { spawnWithStdoutFile } from "../src/stdoutfile.ts";
import { notePage, writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

/** POSIX-only, like staged-gate-reads.test.ts: the cutting `git` is an `sh` launcher. */
const POSIX_ONLY = process.platform === "win32";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A one-type bundle of four notes, committed, then two of them staged as modified. */
function repo(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-short-read-"));
  writeNoteBundle(tmp, ["Fern", "Moss", "Reed", "Sedge"]);
  git(tmp, "init", "-q", "-b", "main");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "base");
  writeAt(tmp, "wiki/Fern.md", notePage("Fern", "\nA second frond.\n"));
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "fern");
  writeAt(tmp, "wiki/Moss.md", notePage("Moss", "\nA staged line.\n"));
  writeAt(tmp, "wiki/Reed.md", notePage("Reed", "\nA staged line.\n"));
  git(tmp, "add", "-A");
  return tmp;
}

/**
 * A `git` on PATH that runs the real one and, for the one command whose argv
 * holds WW_CUT, prints its answer cut: without its last byte (`byte`), or only
 * its first line (`line`), with git's own exit status — or, under `fail`, runs
 * nothing and exits 128 as a broken repository does. `exact` cuts the last
 * byte as `byte` does, but only of the command whose whole argv is WW_CUT, so
 * `cat-file --batch` is cut and `cat-file --batch-check` is not. The cuts that
 * leave a well-formed, shorter answer — the ones no terminator can see — are
 * `record` (without its last NUL-terminated record), `lastline` (without its
 * last line) and `empty` (nothing at all). `request` cuts the other way: git
 * gets its request without the last four bytes. Every other command passes
 * through untouched. The engine hands git a file for its stdout, so what the shim
 * prints is exactly what the engine reads.
 */
function cuttingGit(tmp: string): string {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = join(tmp, ".bin");
  mkdirSync(bin);
  const held = join(tmp, "git.out");
  const heldIn = join(tmp, "git.in");
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      'if [ -n "$WW_CUT" ]; then',
      '  case "$*" in',
      `    *"$WW_CUT"*)`,
      `      if [ "$WW_CUT_MODE" = exact ] && [ "$*" != "$WW_CUT" ]; then exec "${real}" "$@"; fi`,
      '      if [ "$WW_CUT_MODE" = request ]; then',
      `        cat > "${heldIn}"`,
      `        size=$(wc -c < "${heldIn}" | tr -d ' ')`,
      `        head -c $((size - 4)) "${heldIn}" | "${real}" "$@"`,
      "        exit $?",
      "      fi",
      '      if [ "$WW_CUT_MODE" = fail ]; then',
      "        echo 'fatal: this test refuses the command' >&2",
      "        exit 128",
      "      fi",
      `      "${real}" "$@" > "${held}"`,
      "      status=$?",
      '      if [ "$WW_CUT_MODE" = line ]; then',
      `        head -n 1 "${held}"`,
      '      elif [ "$WW_CUT_MODE" = lastline ]; then',
      `        sed '$d' "${held}"`,
      '      elif [ "$WW_CUT_MODE" = empty ]; then',
      "        :",
      '      elif [ "$WW_CUT_MODE" = record ]; then',
      `        size=$(wc -c < "${held}" | tr -d ' ')`,
      `        last=$(tr '\\000' '\\n' < "${held}" | tail -n 1 | wc -c | tr -d ' ')`,
      `        head -c $((size - last)) "${held}"`,
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
  const r = runCli([CLI, ...args, "--root", "."], { cwd, encoding: "utf8", env });
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
  beforeAll(() => {
    if (POSIX_ONLY) return;
    tmp = repo();
    PATH = cuttingGit(tmp);
  });
  afterAll(() => {
    if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
  });

  it("the untouched shim changes nothing: the gate judges the staged pages", () => {
    if (POSIX_ONLY) return;
    const r = run(tmp, PATH, ["gate"]);
    assert.equal(r.status, 0, said(r));
    const data = r.envelope["data"] as { summary: { pages: number } };
    assert.ok(data.summary.pages > 0, said(r));
  });

  it("the gate refuses a staged-change listing cut before its final NUL", () => {
    if (POSIX_ONLY) return;
    assertShortRead(
      run(tmp, PATH, ["gate"], "diff --cached --name-status"),
      "diff --cached --name-status -z",
    );
  });

  it("the gate reports a failed HEAD law read as git-unavailable", () => {
    if (POSIX_ONLY) return;
    const failed = run(tmp, PATH, ["gate"], "ls-tree -r -z --full-tree", "fail");
    assert.equal(failed.status, 4, said(failed));
    assert.equal((failed.envelope["error"] as { code: string }).code, "git-unavailable");
  });

  it("the gate refuses an index listing cut before its final NUL", () => {
    if (POSIX_ONLY) return;
    assertShortRead(run(tmp, PATH, ["gate"], "ls-files -s -z"), "ls-files -s -z");
  });

  it("the gate refuses a batch-check answer cut after its first line", () => {
    if (POSIX_ONLY) return;
    // Cut at a line: every line it kept is well formed, so only the count gives it away.
    assertShortRead(
      run(tmp, PATH, ["gate"], "cat-file --batch-check", "line"),
      "cat-file --batch-check",
    );
  });

  it("a cut status is refused by name instead of stating a clean checkout", () => {
    if (POSIX_ONLY) return;
    const whole = run(tmp, PATH, ["check"]);
    const bundle = (whole.envelope["metadata"] as { bundle?: { dirty: boolean } }).bundle;
    assert.equal(bundle?.dirty, true, said(whole));
    assertShortRead(run(tmp, PATH, ["check"], "status --porcelain=v2"), "status --porcelain=v2");
  });
});

describe("a batch stream cut inside an object is a short read by name (docs/roadmap.md)", () => {
  let tmp = "";
  let PATH = "";
  beforeAll(() => {
    if (POSIX_ONLY) return;
    tmp = repo();
    PATH = cuttingGit(tmp);
  });
  afterAll(() => {
    if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
  });

  // Every page ends in a newline, so the batch stream without its last byte
  // still ends in one: the terminator check passes it, and only the last
  // object's size says the stream stopped inside it.
  it("the gate refuses it as git-short-read, not as an engine error", () => {
    if (POSIX_ONLY) return;
    const r = run(tmp, PATH, ["gate"], "cat-file --batch", "exact");
    assertShortRead(r, "cat-file --batch");
    assert.match(String((r.envelope["error"] as { message: string }).message), /inside object/u);
  });
});

/** repo() with one more page staged as added, sorting last in the index: a type no law declares. */
function addedRepo(): string {
  const tmp = repo();
  writeAt(tmp, "wiki/Yarrow.md", "---\ntype: shrub\ntitle: Yarrow\n---\n\n# Yarrow\n");
  git(tmp, "add", "-A");
  return tmp;
}

/** A first commit staged but not yet made: the staged diff still lists every path. */
function unbornRepo(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-short-read-first-"));
  writeNoteBundle(tmp, ["Fern", "Moss", "Reed", "Sedge"]);
  git(tmp, "init", "-q", "-b", "main");
  git(tmp, "add", "-A");
  return tmp;
}

describe("the index cross-check before the first commit", () => {
  let tmp = "";
  let PATH = "";
  beforeAll(() => {
    if (POSIX_ONLY) return;
    tmp = unbornRepo();
    PATH = cuttingGit(tmp);
  });
  afterAll(() => {
    if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
  });

  it("refuses a well-formed index listing cut at a record boundary", () => {
    if (POSIX_ONLY) return;
    assert.equal(run(tmp, PATH, ["gate"]).status, 0);
    const cut = run(tmp, PATH, ["gate"], "ls-files -s -z", "record");
    assert.equal(cut.status, 1, said(cut));
    assert.equal((cut.envelope["error"] as { code: string }).code, "git-inconsistent-read");
  });
});

describe("two git answers that disagree are git-inconsistent-read (docs/roadmap.md)", () => {
  let tmp = "";
  let PATH = "";
  beforeAll(() => {
    if (POSIX_ONLY) return;
    tmp = addedRepo();
    PATH = cuttingGit(tmp);
  });
  afterAll(() => {
    if (tmp !== "") rmSync(tmp, { recursive: true, force: true });
  });

  function assertInconsistent(r: Run, command: string): void {
    assert.equal(r.status, 1, said(r));
    const error = r.envelope["error"] as {
      type: string;
      code: string;
      details: { commands: string[] };
    };
    assert.equal(error.type, "internal", said(r));
    assert.equal(error.code, "git-inconsistent-read", said(r));
    assert.ok(
      error.details.commands.some((c) => c.startsWith(`git ${command}`)),
      said(r),
    );
  }

  it("the whole index fails the added page's unknown type", () => {
    if (POSIX_ONLY) return;
    const r = run(tmp, PATH, ["gate"]);
    assert.equal(r.status, 5, said(r));
    const findings = (r.envelope["data"] as { findings: Array<{ rule: string; path: string }> })
      .findings;
    assert.ok(
      findings.some((f) => f.path === "wiki/Yarrow.md" && f.rule === "type-unknown"),
      said(r),
    );
  });

  it("an index listing cut before its last record, while the diff names that page, is refused", () => {
    if (POSIX_ONLY) return;
    // The listing still ends in NUL: well formed, one record short, and judged
    // it would be a clean index without the failing page.
    assertInconsistent(run(tmp, PATH, ["gate"], "ls-files -s -z", "record"), "ls-files");
  });

  it("an empty index listing, while the diff names pages, is refused", () => {
    if (POSIX_ONLY) return;
    assertInconsistent(run(tmp, PATH, ["gate"], "ls-files -s -z", "empty"), "ls-files");
  });

  it("a batch request cut inside its last path is refused, not read as a page HEAD never held", () => {
    if (POSIX_ONLY) return;
    // git answers the shortened path `missing` and exits 0; by position that
    // row would be the whole path's, a base of nothing.
    assertInconsistent(
      run(tmp, PATH, ["gate"], "cat-file --batch-check", "request"),
      "cat-file --batch-check",
    );
  });
});

describe("spawnWithStdoutFile: the child writes its answer to its own file", () => {
  const leftovers = (): string[] =>
    readdirSync(tmpdir()).filter(
      (n) =>
        n.startsWith(`wikiwright-stdout-${process.pid}-`) ||
        n.startsWith(`wikiwright-stdin-${process.pid}-`),
    );

  it("returns every byte the child wrote, its status and its stderr, and removes the file", async () => {
    if (POSIX_ONLY) return;
    const body = "Tie the canes in autumn.\n".repeat(4000);
    const r = await spawnWithStdoutFile(
      "sh",
      ["-c", 'cat; printf "%s" "$BODY"; echo tail; echo warned >&2; exit 3'],
      { cwd: tmpdir(), input: "from stdin\n", env: { ...process.env, BODY: body } },
    );
    assert.equal(r.status, 3);
    assert.equal(r.stdout.toString("utf8"), `from stdin\n${body}tail\n`);
    assert.equal(r.stderr, "warned\n");
    assert.equal(r.error, undefined);
    assert.deepEqual(leftovers(), []);
  });

  it("hands the request to the child as a file, not a pipe", async () => {
    const r = await spawnWithStdoutFile(
      process.execPath,
      ["-e", "process.exit(require('node:fs').fstatSync(0).isFile() ? 0 : 7)"],
      { cwd: tmpdir(), input: "HEAD:./wiki/Fern.md\n" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(leftovers(), []);
  });

  it("a command that cannot be spawned is an error, and still leaves no file", async () => {
    for (const input of [undefined, "a request\n"]) {
      const r = await spawnWithStdoutFile("wikiwright-no-such-command", [], {
        cwd: tmpdir(),
        input,
      });
      assert.notEqual(r.error, undefined);
      assert.deepEqual(leftovers(), []);
    }
  });

  it("a child stopped by the timeout is an error, and leaves no file", async () => {
    if (POSIX_ONLY) return;
    const r = await spawnWithStdoutFile("sh", ["-c", "cat > /dev/null; sleep 5"], {
      cwd: tmpdir(),
      input: "a request\n",
      timeout: 200,
    });
    assert.equal((r.error as NodeJS.ErrnoException | undefined)?.code, "ETIMEDOUT");
    assert.equal(r.signal, "SIGKILL");
    assert.deepEqual(leftovers(), []);
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
