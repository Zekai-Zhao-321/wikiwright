// docs/cli.md §The envelope (constitution failures and page findings never blur:
// type `constitution` exits 2, type `findings` exits 5) (the closed
// exit taxonomy) · a malformed registry is exit 2, page violations 5.
//
// The one-code-one-meaning scan reads LITERAL sites, `fail(<command>,
// "<type>", "<code>", …)` spelled out in the shell's sources. A code handed to
// `fail` at runtime — a module issue's — is outside it.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { writeNoteBundle } from "./fixtures/note-bundle.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const CLI_SRC = fileURLToPath(new URL("../src/", import.meta.url));

interface Run {
  status: number;
  envelope: {
    ok?: boolean;
    error?: { type?: string; code?: string };
    data?: unknown;
  };
}

function run(cwd: string, args: string[]): Run {
  const r = runCli([CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Run["envelope"] };
}

/** A note type that extends nothing that exists: a law that does not load. */
const BAD_TYPE = "type: note\nrole: concept\ndescription: A note.\nextends: no-such-type\n";

/** A note bundle with one clean page; `engine` laid over its engine.json. */
function vault(engine: Record<string, unknown> = {}): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-exit-"));
  writeNoteBundle(tmp, ["Clean"], engine);
  return tmp;
}

/** Every verb that reads a bundle's working-tree law, as one invocation each; `write` from an empty draft directory under `tmp`. */
function lawReaders(tmp: string): string[][] {
  const drafts = join(tmp, "drafts");
  mkdirSync(drafts, { recursive: true });
  return [
    ["check"],
    ["search", "clean"],
    ["read", "Clean"],
    ["type", "list"],
    ["rule", "try", "--type", "note", "--expr", "true"],
    ["write", "--from", drafts],
  ];
}

describe("exit 2 vs exit 5 never blur (docs/cli.md §The envelope)", () => {
  it("a law that does not load exits 2 with type constitution under every verb that reads it", () => {
    const tmp = vault();
    try {
      writeFileSync(join(tmp, "constitution", "types", "note.yaml"), BAD_TYPE);
      for (const args of lawReaders(tmp)) {
        const r = run(tmp, args);
        assert.equal(r.status, 2, `${args[0]}: ${JSON.stringify(r.envelope)}`);
        assert.equal(r.envelope.error?.type, "constitution", `${args[0]} carries the type`);
        assert.equal(r.envelope.error?.code, "constitution-invalid");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an unknown engine.json key is a constitution failure, not a page verdict", () => {
    const tmp = vault({ no_such_key: true });
    try {
      const r = run(tmp, ["check"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.type, "constitution");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an engine.json that is not JSON is a constitution failure too", () => {
    const tmp = vault();
    try {
      writeFileSync(join(tmp, "config", "engine.json"), "{ not json");
      const r = run(tmp, ["check"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.type, "constitution");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a law that loads with a failing page still exits 5 with type findings", () => {
    const tmp = vault();
    try {
      writeFileSync(
        join(tmp, "wiki", "rogue.md"),
        "---\ntype: no-such-type\ntitle: Rogue\n---\n\n# Rogue\n",
      );
      const r = run(tmp, ["check"]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.type, "findings");
      const findings = (r.envelope.data as { findings: { rule: string; path: string }[] }).findings;
      assert.ok(findings.some((f) => f.rule === "type-unknown" && f.path === "wiki/rogue.md"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a directory with no engine.json is not_found (3) under every verb: absent is not malformed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-exit-"));
    try {
      for (const args of lawReaders(tmp)) {
        const r = run(tmp, args);
        assert.equal(r.status, 3, `${args[0]}: ${JSON.stringify(r.envelope)}`);
        assert.equal(r.envelope.error?.type, "not_found");
        assert.equal(r.envelope.error?.code, "bundle-not-found");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the gate over an index that holds no config/engine.json is bundle-not-found, exit 3", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-exit-"));
    try {
      writeNoteBundle(tmp, ["Clean"]);
      execFileSync("git", ["init", "-q"], { cwd: tmp });
      execFileSync("git", ["add", "wiki"], { cwd: tmp });
      const r = run(tmp, ["gate"]);
      assert.equal(r.status, 3, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.type, "not_found");
      assert.equal(r.envelope.error?.code, "bundle-not-found");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the gate names a missing or non-directory root as bundle-not-found", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-exit-"));
    try {
      const file = join(tmp, "not-a-directory");
      writeFileSync(file, "plain file\n");
      for (const root of [join(tmp, "missing"), file]) {
        const result = runCli([CLI, "gate", "--root", root], {
          cwd: tmp,
          encoding: "utf8",
          env: { ...process.env, ...PINNED_CLOCK },
        });
        const envelope = JSON.parse(result.stdout) as Run["envelope"];
        assert.equal(result.status, 3, result.stdout);
        assert.equal(envelope.error?.type, "not_found");
        assert.equal(envelope.error?.code, "bundle-not-found");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/** Every `fail(<command>, "<type>", "<code>", …)` the CLI's sources spell out. */
function refusals(): { file: string; type: string; code: string }[] {
  const out: { file: string; type: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(abs, "utf8");
        for (const m of text.matchAll(/\bfail\(\s*[^,()]+,\s*"([a-z_]+)",\s*"([^"]+)"/gu)) {
          out.push({ file: entry.name, type: m[1] ?? "", code: m[2] ?? "" });
        }
      }
    }
  };
  walk(CLI_SRC);
  return out;
}

describe("the error-code taxonomy: one code, one meaning (docs/cli.md §The envelope)", () => {
  it("every code is kebab-case, and maps to exactly one exit type across every verb", () => {
    const found = refusals();
    assert.equal(found.length > 40, true, `the scan found the refusal sites (${found.length})`);
    const typesOf = new Map<string, Set<string>>();
    for (const { file, type, code } of found) {
      assert.match(code, /^[a-z]+(-[a-z]+)*$/u, `${file}: code "${code}" is not kebab-case`);
      typesOf.set(code, new Set([...(typesOf.get(code) ?? []), type]));
    }
    for (const [code, types] of typesOf) {
      assert.equal(
        types.size,
        1,
        `code "${code}" is failed under ${[...types].join(" and ")} — one code, one meaning`,
      );
    }
  });
});

// v2 contracts §2: the law is read through no link. An engine.json linked
// out of the bundle is not read, and the law does not load.
describe("a config linked out of the bundle is not read (docs/cli.md §Exit codes)", () => {
  it("exits 2 as constitution from every verb that reads the law, naming config/engine.json", () => {
    const tmp = vault();
    const outside = mkdtempSync(join(tmpdir(), "ww-exit-outside-"));
    try {
      const engine = join(tmp, "config", "engine.json");
      writeFileSync(join(outside, "engine.json"), readFileSync(engine, "utf8"));
      rmSync(engine);
      symlinkSync(join(outside, "engine.json"), engine);
      for (const argv of lawReaders(tmp)) {
        const r = run(tmp, argv);
        assert.equal(r.status, 2, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
        assert.equal(r.envelope.error?.code, "constitution-invalid");
        const issues = (
          r.envelope.data as { issues: { code: string; where: string; message: string }[] }
        ).issues;
        assert.deepEqual(
          issues.map((i) => [i.code, i.where]),
          [["engine-invalid", "bundle:config/engine.json"]],
        );
        assert.match(issues[0]?.message ?? "", /symbolic link/u);
        assert.doesNotMatch(issues[0]?.message ?? "", /absent/u);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
