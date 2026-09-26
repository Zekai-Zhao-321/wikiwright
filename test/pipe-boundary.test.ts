// The v2 contracts, section 11: the pipe probes. Every other test reads the
// CLI's stdout from a file; these read an operating-system pipe on purpose, as
// `wikiwright … | jq` does, and hold the envelope that comes out of it to the
// one the same invocation writes to a file: every byte, the closing newline,
// the exit status.
//
// The pipe is the shell's (`sh -c 'cli | reader'`), created by pipe(2), whose
// buffer is 64 KiB on the platforms the gate runs on. Bun.spawn's own "pipe"
// is not one: on macOS it is a socket that buffered more than 500 KB, so a
// CLI that called process.exit() right after writing a 70,000-byte envelope
// passed a probe read through it while a real pipe cut the envelope at 65,536
// bytes. The reader starts late: it waits until the CLI has exited or
// READER_WAIT_MS have passed, so a CLI with more than one buffer to write
// meets a full pipe and must wait for it to drain, and a CLI that exits with
// its envelope half written has exited before anything was read. The CLI's
// exit status goes to a side file, since the shell's is the reader's.
//
// The probe is proven able to fail: a writer that calls process.exit() after
// a 70,000-byte write comes out of it short, and the same writer setting
// process.exitCode comes out whole.
//
// Four envelopes: a default one (`version`), one of exactly 70,000 bytes
// (`read` of a synthetic gardening page padded to that size, past one pipe
// buffer), the `envelope-too-large` refusal (`read` of a page padded past the
// 1 MiB bound, §9), and an error envelope (`check` of a root that does not
// exist).
// Each is probed through `bun dist/main.js` and through the compiled binary,
// built for this run under os.tmpdir().
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, runCommand } from "../packages/cli/test/fixtures/runtime.ts";
import { buildBinary } from "./fixtures/binary.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(REPO, "packages", "cli", "dist", "main.js");
const ORCHARD = join(REPO, "fixtures", "handbooks", "orchard");
const PAGE = "wiki/pruning-roses.md";
const TARGET = 70_000;
/** How long the reader waits for a CLI that has not exited before it starts reading. */
const READER_WAIT_MS = 1_500;
const POSIX = process.platform !== "win32";

/** An executable the probes run: its command line before the verb's arguments. */
interface Engine {
  name: string;
  argv: () => readonly string[];
}

let dir = "";
let root = "";
let large = "";
let binary = "";

const ENGINES: Engine[] = [
  { name: "bun dist/main.js", argv: () => [process.execPath, CLI] },
  { name: "the binary", argv: () => [binary] },
];

/**
 * `argv` with its stdout through a shell pipe, read by a reader that starts
 * late; what the reader passes on lands on a file, and the command's own exit
 * status on another.
 */
function piped(argv: readonly string[], cwd: string): { bytes: Buffer; status: number } {
  const status = join(mkdtempSync(join(dir, "status-")), "status");
  const ticks = Math.ceil(READER_WAIT_MS / 50);
  const script = [
    '{ "$@" 2>/dev/null; echo $? > "$WW_PROBE_STATUS"; }',
    "|",
    `{ i=0; while [ ! -s "$WW_PROBE_STATUS" ] && [ $i -lt ${ticks} ]; do sleep 0.05; i=$((i+1)); done; cat; }`,
  ].join(" ");
  const r = runCommand("sh", ["-c", script, "sh", ...argv], {
    cwd,
    env: { ...process.env, WW_PROBE_STATUS: status },
  });
  expect(r.status).toBe(0);
  return { bytes: r.stdout, status: Number.parseInt(readFileSync(status, "utf8"), 10) };
}

/** The same invocation with its stdout on a file: the reference. */
function filed(argv: readonly string[], cwd: string): { bytes: Buffer; status: number } {
  const [command = "", ...rest] = argv;
  const r = runCommand(command, rest, { cwd });
  return { bytes: r.stdout, status: r.status ?? -1 };
}

function probe(engine: Engine, args: readonly string[], cwd: string, status: number): Buffer {
  const argv = [...engine.argv(), ...args];
  const reference = filed(argv, cwd);
  expect(reference.status).toBe(status);
  const through = piped(argv, cwd);
  expect(through.status).toBe(status);
  expect(through.bytes.length).toBe(reference.bytes.length);
  expect(through.bytes.equals(reference.bytes)).toBe(true);
  expect(through.bytes.at(-1)).toBe(0x0a);
  JSON.parse(through.bytes.toString("utf8"));
  return through.bytes;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ww-pipe-"));
  binary = join(dir, "wikiwright");
  if (POSIX) buildBinary(binary);
  root = join(dir, "orchard");
  cpSync(ORCHARD, root, { recursive: true });
  large = join(dir, "large");
  cpSync(ORCHARD, large, { recursive: true });
  writeFileSync(
    join(large, PAGE),
    `---\ntype: procedure-page\n---\n${"Mulch. ".repeat(160_000)}\n`,
  );
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
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the probe fails a CLI that exits with its envelope half written", () => {
  function writer(ending: "exit" | "exitCode"): string {
    const path = join(dir, `writer-${ending}.ts`);
    writeFileSync(
      path,
      [
        `process.stdout.write(\`\${"x".repeat(${TARGET - 1})}\\n\`);`,
        ending === "exit" ? "process.exit(0);" : "process.exitCode = 0;",
        "",
      ].join("\n"),
    );
    return path;
  }

  it("process.exit() after a 70,000-byte write comes out of the pipe short", () => {
    if (!POSIX) return;
    const through = piped([process.execPath, writer("exit")], dir);
    expect(through.status).toBe(0);
    expect(through.bytes.length).toBeLessThan(TARGET);
  });

  it("process.exitCode after the same write comes out whole", () => {
    if (!POSIX) return;
    const through = piped([process.execPath, writer("exitCode")], dir);
    expect(through.status).toBe(0);
    expect(through.bytes.length).toBe(TARGET);
  });
});

describe.each(ENGINES)("$name: the envelope arrives whole through a pipe", (engine) => {
  it("a default envelope", () => {
    if (!POSIX) return;
    const bytes = probe(engine, ["version"], REPO, 0);
    expect(JSON.parse(bytes.toString("utf8")).ok).toBe(true);
  });

  it("an envelope of 70,000 bytes, past one pipe buffer", () => {
    if (!POSIX) return;
    const bytes = probe(engine, ["read", PAGE, "--root", root], REPO, 0);
    expect(bytes.length).toBe(TARGET);
  });

  it("the envelope-too-large refusal of an envelope past 1 MiB", () => {
    if (!POSIX) return;
    const bytes = probe(engine, ["read", PAGE, "--root", large], REPO, 2);
    const envelope = JSON.parse(bytes.toString("utf8")) as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("envelope-too-large");
  });

  it("an error envelope", () => {
    if (!POSIX) return;
    const bytes = probe(engine, ["check", "--root", join(root, "no-such-bundle")], REPO, 3);
    const envelope = JSON.parse(bytes.toString("utf8")) as { ok: boolean; error: { code: string } };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("vault-not-found");
  });
});
