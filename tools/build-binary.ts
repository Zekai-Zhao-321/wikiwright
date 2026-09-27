// The v2 contracts, section 11: the `binary` script. After `bun run build`,
// compiles the CLI into one standalone executable with Bun's compiler, the
// build stamp compiled in, so the binary names the build it was cut from
// (`version`) with no file beside it.
//
//   bun tools/build-binary.ts [--outfile <path>]
//
// The default output is `dist/wikiwright` at the repository root (ignored,
// never committed). The flags: `--compile --bytecode --format=esm`, and
// `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`, so the binary
// reads no `.env` and no `bunfig.toml` from the directory it runs in: what it
// answers depends on its argv and the bundle, not on files beside the caller.
// `--define WIKIWRIGHT_BUILD_INFO=<the stamp's JSON, as a string literal>`
// carries the stamp `tools/write-build-info.ts` wrote (buildinfo.ts reads it).
// Nothing else the package ships is compiled in: inside the binary
// `import.meta.url` names Bun's embedded file system (`/$bunfs/`), not this
// checkout, so no shipped file resolves, on this machine or any other. The
// verbs that read one, `init` (the starters) and `skills`, refuse there as
// `shipped-files-absent`; `check` compares no installed skill; `version`
// reports no checkout (docs/roadmap.md §The compiled binary).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const STAMP = fileURLToPath(new URL("../packages/cli/dist/build-info.json", import.meta.url));
const ENTRY = fileURLToPath(new URL("../packages/cli/src/main.ts", import.meta.url));

const at = process.argv.indexOf("--outfile");
const outfile = resolve(at < 0 ? `${REPO}dist/wikiwright` : (process.argv[at + 1] ?? ""));

if (!existsSync(STAMP)) {
  process.stderr.write("build-binary: no build stamp; run `bun run build` first\n");
  process.exit(2);
}
const stamp = JSON.stringify(JSON.parse(readFileSync(STAMP, "utf8")));
mkdirSync(dirname(outfile), { recursive: true });

// The compiler's own output is a report for a person, not an answer this
// script reads, so it goes to this process's stdio as it is. It runs in a
// scratch directory of its own: Bun 1.3.11 leaves a copy of its runtime,
// `.<hex>-00000000.bun-build`, in the directory it compiles from, and that
// directory is removed after.
const scratch = mkdtempSync(`${tmpdir()}/wikiwright-binary-`);
const r = spawnSync(
  process.execPath,
  [
    "build",
    "--compile",
    "--bytecode",
    "--format=esm",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--define",
    `WIKIWRIGHT_BUILD_INFO=${JSON.stringify(stamp)}`,
    ENTRY,
    "--outfile",
    outfile,
  ],
  { cwd: scratch, stdio: "inherit" },
);
rmSync(scratch, { recursive: true, force: true });
process.exit(r.status ?? 1);
