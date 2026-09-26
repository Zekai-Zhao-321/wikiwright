// v2 contracts §9: the envelope's bound and its two global flags. No automatic
// spill: an envelope over 1 MiB is refused as `envelope-too-large` (exit 2)
// with a hint naming `--out <file>`; `--out` takes the whole envelope and
// leaves a two-line pointer on stdout, the exit code the envelope's own.
// `--help --json` prints a verb's schema, and the top-level `--help --json`
// every verb's, in place of the `schema` verb. Every file under os.tmpdir().
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";
import { ENVELOPE_MAX_BYTES } from "../src/envelope.ts";
import { commandSchema, flagsOf } from "../src/spec.ts";
import { cleanBundles, gardenBundle } from "./fixtures/garden-cli.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const ORCHARD = fileURLToPath(new URL("../../../fixtures/handbooks/orchard", import.meta.url));
const PAGE = "wiki/pruning-roses.md";

let dir = "";
let root = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ww-envelope-"));
  root = join(dir, "orchard");
  cpSync(ORCHARD, root, { recursive: true });
  // One page past the bound: `read` returns its text whole, so the envelope
  // is larger than the page.
  const page = join(root, PAGE);
  writeFileSync(page, `${readFileSync(page, "utf8")}\n${"Mulch the roots. ".repeat(70_000)}\n`);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  cleanBundles();
});

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; exit_code: number; hint?: string; details?: Record<string, unknown> };
  metadata: { command: string; bundle?: Record<string, unknown> };
}

function run(args: readonly string[]): { status: number; stdout: string } {
  const r = runCli([CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout };
}

describe("an envelope over 1 MiB (v2 contracts §9)", () => {
  it("is refused as envelope-too-large, exit 2, with a hint naming --out", () => {
    const r = run(["read", PAGE, "--root", root]);
    expect(r.status).toBe(2);
    expect(Buffer.byteLength(r.stdout)).toBeLessThan(ENVELOPE_MAX_BYTES);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.ok).toBe(false);
    expect(envelope.error?.code).toBe("envelope-too-large");
    expect(envelope.error?.exit_code).toBe(2);
    expect(envelope.error?.hint).toContain("--out <file>");
    expect(envelope.error?.details?.["limit"]).toBe(ENVELOPE_MAX_BYTES);
    expect(envelope.error?.details?.["bytes"] as number).toBeGreaterThan(ENVELOPE_MAX_BYTES);
    // The refusal names the verb and the bundle it read, and drops the data.
    expect(envelope.metadata.command).toBe("read");
    expect(envelope.metadata.bundle).toBeDefined();
    expect(envelope.data).toBeUndefined();
  });

  it("goes whole to the file --out names, and stdout carries a two-line pointer", () => {
    const out = join(dir, "read.json");
    const r = run(["read", PAGE, "--root", root, "--out", out]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")).toHaveLength(3); // two lines and the final newline
    const pointer = JSON.parse(r.stdout) as Record<string, unknown>;
    const whole = readFileSync(out, "utf8");
    expect(pointer).toEqual({
      ok: true,
      command: "read",
      exit_code: 0,
      bytes: Buffer.byteLength(whole),
      out,
    });
    const envelope = JSON.parse(whole) as Envelope;
    expect(envelope.ok).toBe(true);
    expect(Buffer.byteLength(whole)).toBeGreaterThan(ENVELOPE_MAX_BYTES);
  });
});

describe("--out (v2 contracts §9)", () => {
  it("keeps the envelope's exit code, and takes a small envelope too", () => {
    const out = join(dir, "missing.json");
    const r = run(["read", "no-such-page", "--root", root, "--out", out]);
    expect(r.status).toBe(3);
    const pointer = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(pointer["ok"]).toBe(false);
    expect(pointer["exit_code"]).toBe(3);
    expect((JSON.parse(readFileSync(out, "utf8")) as Envelope).error?.code).toBe("page-not-found");
  });

  it("names a file it cannot write as out-unwritable, on stdout", () => {
    const out = join(dir, "no-such-directory", "x", "read.json");
    writeFileSync(join(dir, "no-such-directory"), "a file, not a directory\n");
    const r = run(["version", "--out", out]);
    expect(r.status).toBe(2);
    const envelope = JSON.parse(r.stdout) as Envelope;
    expect(envelope.error?.code).toBe("out-unwritable");
    expect(envelope.error?.details?.["exit_code"]).toBe(0);
  });

  it("is accepted by every verb, as a global flag", () => {
    for (const command of COMMANDS) {
      const r = run([command.name, "--help", "--out", join(dir, `${command.name}-help.json`)]);
      expect(r.status).toBe(0);
    }
  }, 120_000);
});

describe("--help --json (v2 contracts §9)", () => {
  it("prints each verb's schema, and --help alone its usage", () => {
    const garden = gardenBundle();
    for (const command of COMMANDS.filter((c) => ["read", "check", "version"].includes(c.name))) {
      const schema = JSON.parse(
        run([command.name, "--help", "--json", "--root", garden]).stdout,
      ) as Envelope;
      expect(schema.data).toEqual(commandSchema(command));
      expect(schema.data?.["writes"]).toBe(command.writes);
      const help = JSON.parse(run([command.name, "--help", "--root", garden]).stdout) as Envelope;
      expect(String(help.data?.["usage"])).toStartWith(`wikiwright ${command.name}`);
      expect(help.data?.["flags"]).toEqual(flagsOf(command));
      expect(help.data?.["examples"]).toEqual(command.examples);
    }
  });

  it("at the top level prints every verb's schema", () => {
    const envelope = JSON.parse(run(["--help", "--json"]).stdout) as Envelope;
    const commands = envelope.data?.["commands"] as Record<string, unknown>[];
    expect(commands).toEqual(COMMANDS.map(commandSchema));
    const flags = (envelope.data?.["global_flags"] ?? []) as { name: string }[];
    const names = flags.map((f) => f.name);
    expect(names).toContain("out");
    expect(names).toContain("json");
  });
});
