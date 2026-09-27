// The v2 contracts, section 11: the `binary` script. The compiled executable
// is built under os.tmpdir() through the script's own tool
// (`tools/build-binary.ts`) and must answer as `bun dist/main.js` does, byte
// for byte: `--help`, a verb's `--help`, and a `check` envelope over a copy
// of a gardening handbook. `version` names the build the binary was cut from,
// the stamp compiled in, with no file beside it, and no checkout to report.
// No verb reads a file the package ships beside its code, so the binary
// answers every verb the script does.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, runCommand } from "../packages/cli/test/fixtures/runtime.ts";
import { buildBinary } from "./fixtures/binary.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(REPO, "packages", "cli", "dist", "main.js");
const ORCHARD = join(REPO, "fixtures", "handbooks", "orchard");

let dir = "";
let binary = "";
let bundle = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ww-binary-"));
  binary = join(dir, "wikiwright");
  bundle = join(dir, "orchard");
  cpSync(ORCHARD, bundle, { recursive: true });
  buildBinary(binary);
}, 120_000);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function both(args: readonly string[]): { compiled: string; script: string } {
  const compiled = runCommand(binary, args, { cwd: REPO, encoding: "utf8" });
  const script = runCli([CLI, ...args], { cwd: REPO, encoding: "utf8" });
  expect(compiled.status).toBe(script.status);
  return { compiled: compiled.stdout, script: script.stdout };
}

describe("the compiled binary answers as bun dist/main.js does", () => {
  it("--help, byte for byte", () => {
    const { compiled, script } = both(["--help"]);
    expect(compiled.length > 0).toBe(true);
    expect(compiled).toBe(script);
  });

  it("a verb's --help, byte for byte", () => {
    const { compiled, script } = both(["check", "--help"]);
    expect(compiled).toBe(script);
  });

  it("a check envelope, byte for byte", () => {
    const { compiled, script } = both(["check", "--all", "--root", bundle]);
    expect(JSON.parse(compiled).metadata.command).toBe("check");
    expect(compiled).toBe(script);
  });

  it("version names the build it was cut from, compiled in, and no checkout", () => {
    const compiled = JSON.parse(both(["version"]).compiled) as {
      data: {
        commit: string | null;
        dirty: boolean | null;
        source: string;
        checkout_commit: string | null;
        checkout_dirty: boolean | null;
      };
    };
    const script = JSON.parse(both(["version"]).script) as typeof compiled;
    expect(compiled.data.source).toBe("build-info");
    expect(compiled.data.commit).toBe(script.data.commit);
    expect(compiled.data.dirty).toBe(script.data.dirty);
    // The binary's code sits in no checkout, so it reports none.
    expect(compiled.data.checkout_commit).toBeNull();
    expect(compiled.data.checkout_dirty).toBeNull();
  });
});
