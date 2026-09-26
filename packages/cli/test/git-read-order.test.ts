// docs/architecture.md §Invariants (deterministic artifacts): reads the engine
// asks git for together report a failure in argument order, so the same input
// answers with the same envelope bytes whichever git child fails first. The
// gate reads the staged diff and the index listing side by side; under
// `Promise.all` the listing's failure reached the envelope when it settled
// first, the diff's otherwise.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const ORCHARD = fileURLToPath(new URL("../../../fixtures/v1/handbooks/orchard", import.meta.url));

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ww-read-order-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function gate(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const r = runCli([CLI, "gate", "--root", root], { env, encoding: "utf8" });
  // A git read that fails is `git-unavailable` (exit 4), its message git's own.
  expect(r.status).toBe(4);
  expect((JSON.parse(r.stdout) as { error: { code: string } }).error.code).toBe("git-unavailable");
  return r.stdout;
}

function messageOf(envelope: string): string {
  return (JSON.parse(envelope) as { error: { message: string } }).error.message;
}

describe("reads asked for together fail in argument order", () => {
  it("the gate over a bundle in no repository answers the same bytes every run", () => {
    const root = join(dir, "no-repository");
    cpSync(ORCHARD, root, { recursive: true });
    const first = gate(root);
    for (let run = 0; run < 7; run += 1) expect(gate(root)).toBe(first);
    // Both children fail there; the staged diff is asked for first.
    expect(messageOf(first)).toContain("git diff --cached");
  });

  it("the staged diff's failure is reported even when the listing's settles first", () => {
    // A `git` on PATH that fails both reads, the listing at once and the diff
    // after 300 ms, and passes every other command to the real git.
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "git"),
      [
        "#!/bin/sh",
        'if [ "$1" = diff ] && [ "$2" = --cached ]; then',
        "  sleep 0.3; echo 'fatal: the staged diff failed' >&2; exit 128",
        "fi",
        'if [ "$1" = ls-files ] && [ "$2" = -s ]; then',
        "  echo 'fatal: the index listing failed' >&2; exit 128",
        "fi",
        `exec '${real}' "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "git"), 0o755);
    const root = join(dir, "repository");
    cpSync(ORCHARD, root, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}` };
    const message = messageOf(gate(root, env));
    expect(message).toContain("the staged diff failed");
    expect(message).not.toContain("the index listing failed");
  });
});
