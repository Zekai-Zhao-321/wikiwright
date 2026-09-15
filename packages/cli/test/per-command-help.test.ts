// docs/cli.md §The envelope (`<verb> --help` is rendered from the same
// registry as `schema`, exit 0; --help is intercepted before parsing; an unknown
// verb still exits 2) · every verb declares its role
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";
import { flagsOf } from "../src/spec.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

interface Run {
  status: number;
  envelope: {
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
}

function run(args: string[], env?: Record<string, string>): Run {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(env ?? {}) } as Record<string, string>,
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Run["envelope"] };
}

describe("per-command --help (docs/cli.md §The envelope)", () => {
  // One subprocess per verb, and the verb list grows: the budget is the WORK,
  // not the runner's five-second default. Nothing about the assertion changes —
  // a verb that fails to answer still fails, on any machine.
  it("every registered verb answers --help with ok and its own spec", { timeout: 120_000 }, () => {
    for (const command of COMMANDS) {
      const r = run([command.name, "--help"]);
      assert.equal(r.status, 0, `${command.name} --help: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.ok, true);
      const data = r.envelope.data ?? {};
      assert.equal(data["name"], command.name);
      assert.equal(data["role"], command.role);
      assert.equal(data["summary"], command.summary);
      // docs/cli.md §The dry-run law: help renders `flagsOf(spec)` — the verb's
      // own flags plus the registry's `--dry-run` when it writes — because the
      // parser is built from the same function. Comparing against `spec.flags`
      // would let the two drift in exactly the place the law forbids.
      assert.deepEqual(data["flags"], flagsOf(command));
      assert.deepEqual(data["positionals"], command.positionals);
      assert.deepEqual(data["examples"], command.examples);
      assert.equal(Array.isArray(data["global_flags"]), true, "the flags every verb accepts");
    }
  });

  it("--help never becomes a usage error, even beside flags the verb rejects", () => {
    const r = run(["lint", "--help", "--no-such-flag"]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
  });

  // docs/cli.md §The envelope — the interception uses the flag-aware
  // scan, so a string flag's VALUE is never a request for help and a bare `--`
  // ends the scan. A bare `includes("--help")` answered both, which turns a
  // usage error into a help page and a legitimate positional into one.
  it("a string flag's value is not a help request", () => {
    const r = run(["gate", "--commit-msg", "--help", "--root", FIXTURE]);
    assert.equal(r.envelope.data?.["flags"], undefined, "not the help envelope");
  });

  it("a bare -- ends the scan", () => {
    const r = run(["schema", "--", "--help"]);
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.["code"], "unexpected-argument");
  });

  it("an unknown verb still exits 2 — --help is not a way to make a typo succeed", () => {
    const r = run(["lintt", "--help"]);
    assert.equal(r.status, 2);
    assert.equal(r.envelope.error?.["code"], "unknown-command");
  });
});
