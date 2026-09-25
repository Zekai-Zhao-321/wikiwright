// The v2 contracts, section 11: the pipe probes. Every other test reads the
// CLI's stdout from a file; these read a pipe on purpose, as a caller that
// pipes `wikiwright` into another program does, and hold the envelope that
// arrives to the one the same invocation writes to a file: every byte, the
// closing newline, the exit status. The reader starts late, so the CLI meets
// a full pipe buffer (64 KiB on the platforms the gate runs on) and must
// wait for it to drain rather than exit with its envelope half written.
//
// Three envelopes: a default one (`version`), one of exactly 70,000 bytes
// (`read` of a synthetic gardening page padded to that size, past one pipe
// buffer), and an error envelope (`check` of a root that does not exist).
// Each is probed through `bun dist/main.js`, and through the compiled binary
// when `bun run binary` has left one at `dist/wikiwright`: the binary's piped
// envelope is held to its own filed one, so a binary older than the build is
// still probed for what it is.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, runCommand } from "../packages/cli/test/fixtures/runtime.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(REPO, "packages", "cli", "dist", "main.js");
const ORCHARD = join(REPO, "fixtures", "handbooks", "orchard");
const PAGE = "wiki/pruning-roses.md";
const TARGET = 70_000;
const BINARY = join(REPO, "dist", "wikiwright");

/** An executable the probes run: its command line before the verb's arguments. */
interface Engine {
  name: string;
  argv: readonly string[];
}

const SCRIPT: Engine = { name: "bun dist/main.js", argv: [process.execPath, CLI] };
const ENGINES: Engine[] = existsSync(BINARY)
  ? [SCRIPT, { name: "the binary", argv: [BINARY] }]
  : [SCRIPT];

/** The CLI through a pipe: every byte it wrote, read only after it has had time to fill the buffer. */
async function piped(
  engine: Engine,
  args: readonly string[],
  cwd: string,
): Promise<{ bytes: Buffer; status: number }> {
  const child = Bun.spawn({
    cmd: [...engine.argv, ...args],
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  await Bun.sleep(300);
  const bytes = Buffer.from(await new Response(child.stdout).arrayBuffer());
  return { bytes, status: await child.exited };
}

/** The same invocation with its stdout on a file: the reference. */
function filed(
  engine: Engine,
  args: readonly string[],
  cwd: string,
): { bytes: Buffer; status: number } {
  const [command = "", ...rest] = engine.argv;
  const r = runCommand(command, [...rest, ...args], { cwd });
  return { bytes: r.stdout, status: r.status ?? -1 };
}

async function probe(
  engine: Engine,
  args: readonly string[],
  cwd: string,
  status: number,
): Promise<Buffer> {
  const reference = filed(engine, args, cwd);
  expect(reference.status).toBe(status);
  const through = await piped(engine, args, cwd);
  expect(through.status).toBe(status);
  expect(through.bytes.length).toBe(reference.bytes.length);
  expect(through.bytes.equals(reference.bytes)).toBe(true);
  expect(through.bytes.at(-1)).toBe(0x0a);
  JSON.parse(through.bytes.toString("utf8"));
  return through.bytes;
}

let root = "";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "ww-pipe-"));
  root = join(dir, "orchard");
  cpSync(ORCHARD, root, { recursive: true });
  // Pad the page until `read` answers with exactly TARGET bytes: one line of
  // plain ASCII grows the envelope byte for byte, and the byte counts the
  // envelope reports grow by a digit now and then, so it converges in a few
  // steps.
  const page = join(root, PAGE);
  const base = readFileSync(page, "utf8");
  let pad = 0;
  for (let step = 0; step < 8; step += 1) {
    writeFileSync(page, `${base}\nMulch${"e".repeat(pad)}.\n`);
    const size = runCli([CLI, "read", PAGE, "--root", root], { cwd: REPO }).stdout.length;
    if (size === TARGET) return;
    pad += TARGET - size;
  }
  throw new Error(`the page could not be padded to a ${TARGET}-byte envelope`);
});

afterAll(() => {
  rmSync(join(root, ".."), { recursive: true, force: true });
});

describe.each(ENGINES)("$name: the envelope arrives whole through a pipe", (engine) => {
  it("a default envelope", async () => {
    const bytes = await probe(engine, ["version"], REPO, 0);
    expect(JSON.parse(bytes.toString("utf8")).ok).toBe(true);
  });

  it("an envelope of 70,000 bytes, past one pipe buffer", async () => {
    const bytes = await probe(engine, ["read", PAGE, "--root", root], REPO, 0);
    expect(bytes.length).toBe(TARGET);
  });

  it("an error envelope", async () => {
    const bytes = await probe(engine, ["check", "--root", join(root, "no-such-bundle")], REPO, 3);
    const envelope = JSON.parse(bytes.toString("utf8")) as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("vault-not-found");
  });
});
