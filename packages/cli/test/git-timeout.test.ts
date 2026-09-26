// docs/cli.md §Exit codes, §Environment: every git read carries a timeout —
// `WIKIWRIGHT_GIT_TIMEOUT_MS`, 60,000 ms when unset — and a git child that
// overruns it is killed and refused by name as `git-timeout` (exit 1), never
// waited for. Before, no git read passed a timeout, so a hung git held a pool
// slot and the verb waited for as long as it hung. The hung git here is a
// `git` on PATH that sleeps in place of one command and runs the real git
// for every other.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_TIMEOUT_DEFAULT_MS, GitTimedOut, gitRun, gitTimeoutSetting } from "../src/git.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const ORCHARD = fileURLToPath(new URL("../../../fixtures/v1/handbooks/orchard", import.meta.url));
const POSIX = process.platform !== "win32";

let dir = "";
let bundle = "";
/** PATH with the hanging `git` first. */
let hangingPath = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ww-git-timeout-"));
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = join(dir, "bin");
  mkdirSync(bin);
  // The staged diff hangs, printing its process id first; the rest is git.
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      'if [ "$1" = diff ] && [ "$2" = --cached ]; then',
      `  echo $$ > '${join(dir, "hung.pid")}'`,
      "  exec sleep 30",
      "fi",
      `exec '${real}' "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "git"), 0o755);
  hangingPath = `${bin}${delimiter}${process.env["PATH"] ?? ""}`;
  bundle = join(dir, "orchard");
  cpSync(ORCHARD, bundle, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: bundle });
  execFileSync("git", ["add", "-A"], { cwd: bundle });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function gate(env: Record<string, string>) {
  const started = performance.now();
  const r = runCli([CLI, "gate", "--root", bundle], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  const envelope = JSON.parse(r.stdout) as {
    ok: boolean;
    error: { code: string; type: string; details?: Record<string, unknown> };
  };
  return { status: r.status, envelope, elapsed: performance.now() - started };
}

describe("every git read carries a timeout", () => {
  it("the default is 60,000 ms, and the variable replaces it", () => {
    const saved = process.env["WIKIWRIGHT_GIT_TIMEOUT_MS"];
    try {
      delete process.env["WIKIWRIGHT_GIT_TIMEOUT_MS"];
      expect(gitTimeoutSetting()).toBe(GIT_TIMEOUT_DEFAULT_MS);
      expect(GIT_TIMEOUT_DEFAULT_MS).toBe(60_000);
      process.env["WIKIWRIGHT_GIT_TIMEOUT_MS"] = "";
      expect(gitTimeoutSetting()).toBe(GIT_TIMEOUT_DEFAULT_MS);
      process.env["WIKIWRIGHT_GIT_TIMEOUT_MS"] = "250";
      expect(gitTimeoutSetting()).toBe(250);
      for (const bad of ["0", "-1", "1.5", "1e3", " 250", "2147483648", "soon"]) {
        process.env["WIKIWRIGHT_GIT_TIMEOUT_MS"] = bad;
        expect(gitTimeoutSetting()).toEqual({ invalid: bad });
      }
    } finally {
      if (saved === undefined) delete process.env["WIKIWRIGHT_GIT_TIMEOUT_MS"];
      else process.env["WIKIWRIGHT_GIT_TIMEOUT_MS"] = saved;
    }
  });

  it("gitRun kills a git that overruns and answers a GitTimedOut", async () => {
    if (!POSIX) return;
    const started = performance.now();
    const r = await gitRun(bundle, ["diff", "--cached"], {
      env: { ...process.env, PATH: hangingPath },
      timeout: 300,
    });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(r.error).toBeInstanceOf(GitTimedOut);
    expect((r.error as GitTimedOut).command).toBe("diff --cached");
    expect(r.signal).toBe("SIGKILL");
  }, 30_000);

  it("the gate over a hung git is refused as git-timeout, exit 1, the child killed", () => {
    if (!POSIX) return;
    const r = gate({ PATH: hangingPath, WIKIWRIGHT_GIT_TIMEOUT_MS: "300" });
    expect(r.elapsed).toBeLessThan(10_000);
    expect(r.status).toBe(1);
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.code).toBe("git-timeout");
    expect(r.envelope.error.type).toBe("internal");
    expect(r.envelope.error.details?.["timeout_ms"]).toBe(300);
    expect(String(r.envelope.error.details?.["command"])).toStartWith("git diff --cached");
    const pid = Number.parseInt(readFileSync(join(dir, "hung.pid"), "utf8"), 10);
    expect(() => process.kill(pid, 0)).toThrow();
  }, 30_000);

  it("a value that is not a timeout is refused before any verb runs", () => {
    for (const bad of ["0", "soon"]) {
      const r = gate({ WIKIWRIGHT_GIT_TIMEOUT_MS: bad });
      expect(r.status).toBe(2);
      expect(r.envelope.error.code).toBe("git-timeout-invalid");
      expect(r.envelope.error.type).toBe("usage");
    }
  });
});
