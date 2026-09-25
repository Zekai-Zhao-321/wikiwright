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
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../packages/cli/test/fixtures/runtime.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(REPO, "packages", "cli", "dist", "main.js");
const ORCHARD = join(REPO, "fixtures", "handbooks", "orchard");
const PAGE = "wiki/pruning-roses.md";
const TARGET = 70_000;

/** The CLI through a pipe: every byte it wrote, read only after it has had time to fill the buffer. */
async function piped(
  args: readonly string[],
  cwd: string,
): Promise<{ bytes: Buffer; status: number }> {
  const child = Bun.spawn({
    cmd: [process.execPath, CLI, ...args],
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
function filed(args: readonly string[], cwd: string): { bytes: Buffer; status: number } {
  const r = runCli([CLI, ...args], { cwd });
  return { bytes: r.stdout, status: r.status ?? -1 };
}

async function probe(args: readonly string[], cwd: string, status: number): Promise<Buffer> {
  const reference = filed(args, cwd);
  expect(reference.status).toBe(status);
  const through = await piped(args, cwd);
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
    const size = filed(["read", PAGE, "--root", root], REPO).bytes.length;
    if (size === TARGET) return;
    pad += TARGET - size;
  }
  throw new Error(`the page could not be padded to a ${TARGET}-byte envelope`);
});

afterAll(() => {
  rmSync(join(root, ".."), { recursive: true, force: true });
});

describe("the CLI's envelope arrives whole through a pipe", () => {
  it("a default envelope", async () => {
    const bytes = await probe(["version"], REPO, 0);
    expect(JSON.parse(bytes.toString("utf8")).ok).toBe(true);
  });

  it("an envelope of 70,000 bytes, past one pipe buffer", async () => {
    const bytes = await probe(["read", PAGE, "--root", root], REPO, 0);
    expect(bytes.length).toBe(TARGET);
  });

  it("an error envelope", async () => {
    const bytes = await probe(["check", "--root", join(root, "no-such-bundle")], REPO, 3);
    const envelope = JSON.parse(bytes.toString("utf8")) as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("vault-not-found");
  });
});
