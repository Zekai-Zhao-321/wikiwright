// docs/cli.md §The plugin and its hooks: the SessionStart hook. It reads the
// hook's JSON on stdin, asks the engine for this machine's connected bundles,
// and prints one compact block of context naming each bundle that is present —
// its kind, its label, its head and whether it is dirty, and the page to read
// first — then how every command names a bundle. It prints no page content.
//
// Plain Node, no dependencies. It inherits the environment, so the registry
// and the session's role are the ones the engine would read.
// It asks for the full listing, not `--records`: each line names the bundle's
// label, its head and whether it is dirty, which only the identity carries.
// Whatever goes wrong — stdin that is not JSON, a binary that is missing, an
// envelope that is not one — it prints nothing and exits 0: a hook that fails
// must not stand between a session and its start.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

/** One envelope from the engine, or undefined when there is none to read. */
function wikiwright(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 20_000 });
  if (r.error !== undefined || typeof r.stdout !== "string") return undefined;
  return JSON.parse(r.stdout);
}

function describe(row) {
  const identity = row.identity;
  const head = typeof identity.head === "string" ? identity.head.slice(0, 12) : "no commit";
  const state =
    identity.dirty === true ? "dirty" : identity.dirty === false ? "clean" : "no repository";
  const guide = typeof row.guide === "string" ? `; read first: ${row.guide}` : "";
  return `- ${row.name} (${row.kind}): ${identity.label} at ${head}, ${state}${guide}`;
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  // The documented input is one JSON object; anything else is not a session start.
  if (input === null || typeof input !== "object" || Array.isArray(input)) return;
  const listed = wikiwright(["bundles", "list"]);
  if (listed?.ok !== true) return;
  const present = (listed.data?.bundles ?? []).filter(
    (row) => row.present === true && row.identity !== null,
  );
  if (present.length === 0) return;
  const again = input.source === "compact" || input.source === "resume";
  const lines = [
    again
      ? "Re-establishing the connected wikiwright bundles from their current state:"
      : "Connected wikiwright bundles:",
    ...present.map(describe),
    "Every wikiwright command takes --root <dir>, or --bundle <name> for a bundle skill installed in a skill directory; `wikiwright brief --root <dir>` prints that bundle's brief for the role this session declares in WIKIWRIGHT_ROLE, the writer's when it declares none.",
  ];
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") },
    })}\n`,
  );
}

try {
  main();
} catch {
  // Nothing: a start is never blocked by its context.
}
process.exitCode = 0;
