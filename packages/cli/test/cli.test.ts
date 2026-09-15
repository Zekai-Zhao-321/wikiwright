// docs/cli.md §The envelope (envelopes, one command registry, generated help/
// schema; a zero-positional command names the flag a stray value belongs to) · 09
// docs/cli.md §schema (global_flags from the parser's one constant) (exit taxonomy:
// usage 2 · not_found 3 · conflict 4 · findings 5; JSON-only v1; extra positionals
// are usage) · docs/architecture.md §Directories (byte-deterministic output; byte-entry normalization — a BOM
// on a registry, a backslash in a filename).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseInvocation } from "../src/argv.ts";
import { COMMANDS } from "../src/commands.ts";
import { EXIT, fail, ok } from "../src/envelope.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

interface RunOutcome {
  status: number;
  stdout: string;
  envelope: Record<string, unknown>;
}

function run(args: string[], cwd?: string): RunOutcome {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    ...(cwd !== undefined ? { cwd } : {}),
  });
  const envelope = JSON.parse(r.stdout) as Record<string, unknown>;
  return { status: r.status ?? -1, stdout: r.stdout, envelope };
}

function errorOf(envelope: Record<string, unknown>): Record<string, unknown> {
  return (envelope["error"] ?? {}) as Record<string, unknown>;
}

describe("envelope unit layer", () => {
  it("closes the exit taxonomy at seven members", () => {
    // `constitution` joins the taxonomy at exit 2 — a distinct type over
    // an existing code, so exit-code consumers are unaffected.
    assert.deepEqual(EXIT, {
      ok: 0,
      internal: 1,
      usage: 2,
      constitution: 2,
      not_found: 3,
      conflict: 4,
      findings: 5,
      confirm_required: 10,
    });
  });

  it("builds ok and error envelopes with uniform shapes", () => {
    const good = ok("lint", { hello: 1 });
    assert.equal(good.envelope.ok, true);
    assert.equal(good.exit, 0);
    const bad = fail("lint", "usage", "unknown-flag", "no such flag", {
      hint: "run wikiwright schema",
    });
    assert.equal(bad.envelope.ok, false);
    assert.equal(bad.exit, 2);
    if (bad.envelope.ok) return;
    assert.equal(bad.envelope.error.exit_code, 2);
    assert.equal(bad.envelope.error.type, "usage");
  });
});

describe("process surface — routing and taxonomy", () => {
  it("returns generated schema for the whole command registry", () => {
    const r = run(["schema"]);
    assert.equal(r.status, 0);
    const data = r.envelope["data"] as { commands: Array<{ name: string; role: string }> };
    const names = data.commands.map((c) => c.name);
    for (const expected of ["lint", "new", "schema", "search", "type"]) {
      assert.equal(names.includes(expected), true, `schema lists ${expected}`);
    }
    // docs/cli.md §brief: three ordered bounds, not two.
    assert.equal(
      data.commands.every(
        (c) => c.role === "maintainer" || c.role === "writer" || c.role === "consumer",
      ),
      true,
    );
  });

  it("fails unknown commands as usage with the legal domain enumerated", () => {
    const r = run(["frobnicate"]);
    assert.equal(r.status, EXIT.usage);
    const details = errorOf(r.envelope)["details"] as { valid_commands?: string[] };
    assert.equal(details.valid_commands?.includes("lint"), true);
  });

  it("fails unknown flags as usage (parseArgs strict)", () => {
    const r = run(["lint", "--root", FIXTURE, "--no-such-flag"]);
    assert.equal(r.status, EXIT.usage);
    assert.equal(errorOf(r.envelope)["type"], "usage");
  });

  it("fails a missing vault as not_found", () => {
    const r = run(["lint", "--root", "/nonexistent/vault"]);
    assert.equal(r.status, EXIT.not_found);
  });
});

describe("build — a deprecation that states the difference (docs/cli.md)", () => {});

describe("lint — the gate", () => {
  it("exits 5 with findings still in data when error findings exist", () => {
    const r = run(["lint", "--root", FIXTURE]);
    assert.equal(r.status, EXIT.findings);
    assert.equal(r.envelope["ok"], false);
    const data = r.envelope["data"] as {
      findings: Array<{ ruleId: string; path: string }>;
      summary: { errors: number };
    };
    assert.equal(data.summary.errors > 0, true);
    assert.equal(
      data.findings.some((f) => f.path.includes("broken-case.md")),
      true,
    );
    assert.equal(errorOf(r.envelope)["type"], "findings");
  });

  it("exits 0 on a clean page", () => {
    const r = run(["lint", "--root", FIXTURE, "--page", "wiki/test-execution/warm-reset.md"]);
    assert.equal(r.status, 0);
    assert.equal(r.envelope["ok"], true);
  });

  it("is byte-deterministic across runs", () => {
    const a = spawnSync(process.execPath, [CLI, "lint", "--root", FIXTURE]);
    const b = spawnSync(process.execPath, [CLI, "lint", "--root", FIXTURE]);
    assert.equal(a.stdout.length > 0, true);
    assert.equal(a.stdout.equals(b.stdout), true);
  });
});

describe("extra positionals are a usage error (docs/cli.md §The envelope)", () => {
  it("rejects an unquoted multi-word search instead of answering the wrong query", () => {
    const r = run(["search", "Some", "Hub", "--root", FIXTURE]);
    assert.equal(r.status, EXIT.usage);
    assert.equal(errorOf(r.envelope)["type"], "usage");
    assert.equal(errorOf(r.envelope)["code"], "unexpected-argument");
    assert.match(String(errorOf(r.envelope)["hint"]), /quote multi-word/);
  });

  it("rejects stray positionals on zero-positional commands", () => {
    assert.equal(run(["check", "stray", "--root", FIXTURE]).status, EXIT.usage);
  });

  it("a zero-positional command names the flag a stray value belongs to, not a quoting bug", () => {
    const r = run(["lint", "--explain", "meta/charter.md", "--root", FIXTURE]);
    assert.equal(r.status, EXIT.usage, JSON.stringify(r.envelope));
    const err = errorOf(r.envelope);
    assert.equal(err["code"], "unexpected-argument");
    const hint = String(err["hint"]);
    assert.match(hint, /no positional/);
    assert.match(hint, /--page/);
    assert.doesNotMatch(hint, /quote multi-word/);
    const details = err["details"] as { expected_positionals: string[] };
    assert.deepEqual(details.expected_positionals, []);
  });
});

interface GlobalFlag {
  name: string;
  type: "string" | "boolean";
  summary: string;
}

describe("schema declares the global flags the parser accepts (docs/cli.md §schema)", () => {
  function globalFlagsFromSchema(): GlobalFlag[] {
    const schema = run(["schema"]);
    assert.equal(schema.status, 0);
    const flags = (schema.envelope["data"] as Record<string, unknown>)["global_flags"];
    assert.equal(Array.isArray(flags), true, "schema carries a top-level global_flags");
    return flags as GlobalFlag[];
  }

  it("global_flags names every flag the binary accepts on every verb", () => {
    // The registry adds --help to the same constant: the law is that global_flags
    // comes from the ONE constant the parser is built from, so a flag every
    // verb answers must appear here or the generated registry lies.
    assert.deepEqual(globalFlagsFromSchema(), [
      {
        name: "root",
        type: "string",
        summary: "vault root directory (default: current directory)",
      },
      {
        name: "help",
        type: "boolean",
        summary: "print this command's spec and exit",
      },
    ]);
  });

  it("every global flag parses for every command; an undeclared flag for none", () => {
    const flags = globalFlagsFromSchema();
    for (const spec of COMMANDS) {
      // A verb with subcommands takes its first one, so the flag is judged on
      // an invocation the parser would otherwise accept.
      const lead = spec.subcommands === undefined ? [] : [spec.subcommands[0] ?? ""];
      for (const flag of flags) {
        const argv = flag.type === "string" ? [`--${flag.name}`, "somewhere"] : [`--${flag.name}`];
        const parsed = parseInvocation(spec, [...lead, ...argv], COMMANDS);
        assert.equal(parsed.ok, true, `${spec.name} accepts --${flag.name}`);
        if (parsed.ok && flag.name === "root") assert.equal(parsed.args.root, "somewhere");
      }
      const bogus = parseInvocation(spec, [...lead, "--no-such-global-flag"], COMMANDS);
      assert.equal(bogus.ok, false, `${spec.name} rejects an undeclared flag`);
    }
  });
});

describe("byte-entry normalization (docs/architecture.md §Directories)", () => {
  it("loads a registry saved with a UTF-8 BOM", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-cli-"));
    try {
      cpSync(FIXTURE, tmp, { recursive: true });
      const p = join(tmp, "config/constitution.json");
      writeFileSync(p, `\ufeff${readFileSync(p, "utf8")}`);
      assert.equal(run(["type", "list", "--root", tmp]).status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("survives a POSIX filename containing a backslash", () => {
    // POSIX-only fixture: a backslash IS the separator on Windows, so this
    // filename cannot exist there (which is exactly why walkPages branches).
    if (process.platform === "win32") return;
    const tmp = mkdtempSync(join(tmpdir(), "ww-cli-"));
    try {
      cpSync(FIXTURE, tmp, { recursive: true });
      writeFileSync(
        join(tmp, "wiki/a\\b.md"),
        "---\ntype: concept\ntitle: Backslash page\ndescription: x.\ntags: []\n---\n\n# Backslash page\n",
      );
      const r = run(["lint", "--root", tmp]);
      assert.notEqual(r.status, EXIT.internal, "whole-vault commands must not crash");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("an unknown flag is refused with the verb's flags listed (docs/cli.md §The envelope)", () => {
  it("names the flag and lists valid_flags — global and the verb's own — on every verb", () => {
    for (const [verb, flag] of [
      ["lint", "--staged-only"],
      ["write", "--batch"],
      ["init", "--keep"],
    ] as const) {
      const r = run([verb, flag]);
      assert.equal(r.status, 2, `${verb} ${flag}: ${JSON.stringify(r.envelope)}`);
      const error = r.envelope["error"] as {
        code: string;
        details: { flag: string; valid_flags: string[] };
      };
      assert.equal(error.code, "unknown-flag");
      assert.equal(error.details.flag, flag);
      assert.equal(error.details.valid_flags.includes("--root"), true, "the global flags");
      assert.equal(error.details.valid_flags.includes("--help"), true);
    }
    const write = (
      run(["write", "--batch"]).envelope["error"] as {
        details: { valid_flags: string[] };
      }
    ).details.valid_flags;
    assert.equal(write.includes("--from"), true, "the verb's own flags");
    assert.equal(write.includes("--dry-run"), true, "and the rendered dry-run flag of a writer");
    assert.equal(write.includes("--staged"), false, "not another verb's");
  });

  it("a flag missing its value is invalid-arguments, still with valid_flags", () => {
    const r = run(["lint", "--page"]);
    assert.equal(r.status, 2);
    const error = r.envelope["error"] as { code: string; details: { valid_flags: string[] } };
    assert.equal(error.code, "invalid-arguments");
    assert.equal(error.details.valid_flags.includes("--page"), true);
  });
});
