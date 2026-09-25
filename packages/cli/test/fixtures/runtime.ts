import { tmpdir } from "node:os";
import { join } from "node:path";

// The runtime a test runs the engine's CLI under. `tools/run-suite.ts` sets
// WIKIWRIGHT_CLI_RUNTIME to the `node` on PATH when the suite runs under Bun, so
// the gate exercises the engine under the runtime it ships for; under the node
// runner this resolves to Node anyway.
//
// Why: on 2026-09-24, under CPU load, Bun 1.3.11's synchronous spawn handed back
// a child's stdout cut short with exit 0 and nothing on stderr — 7 of 900 calls
// in a stress run, where Node lost none of 3,600 — and the engine's git reads
// took the cut answers as shorter listings (docs/roadmap.md). A test that means
// to run the CLI under Bun names `bun` itself.
export const CLI_RUNTIME = process.env["WIKIWRIGHT_CLI_RUNTIME"] ?? process.execPath;

// No test probes a real machine's system skill directory: whatever the
// caller's environment names, the CLI a test spawns reads a directory under
// os.tmpdir() that nothing creates. Every spawn inherits it through
// process.env; a case that means another passes it in its own spawn.
process.env["WIKIWRIGHT_SYSTEM_SKILL_DIR"] = join(tmpdir(), "ww-no-system-skills");
