// docs/cli.md §The plugin and its hooks: the SessionStart hook. It reads the
// hook's JSON on stdin, asks the engine for the bundle skills installed in the
// skill directories (`bundles list`, which reads markers only: it executes no
// kit and hashes no page), and prints one compact block of context naming each
// — its name, the bundle it was cut from, and where it was found — then how
// every command names a bundle. It prints no page content and no digest.
//
// Plain Node, no dependencies. It inherits the environment, so the skill
// directories and the session's role are the ones the engine would read.
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
  return `- ${row.name}: the bundle ${row.bundle}, in the ${row.tier} skill directory ${row.root}`;
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  // The documented input is one JSON object; anything else is not a session start.
  if (input === null || typeof input !== "object" || Array.isArray(input)) return;
  const listed = wikiwright(["bundles", "list"]);
  if (listed?.ok !== true) return;
  const installed = (listed.data?.bundles ?? []).filter(
    (row) => typeof row.bundle === "string" && row.shadowed_by === null,
  );
  if (installed.length === 0) return;
  const again = input.source === "compact" || input.source === "resume";
  const lines = [
    again
      ? "Re-establishing the installed wikiwright bundle skills from their current state:"
      : "Installed wikiwright bundle skills:",
    ...installed.map(describe),
    "Every wikiwright command takes --bundle <name> for one of these, or --root <dir> for any bundle's directory; `wikiwright brief --bundle <name>` prints that bundle's brief for the role this session declares in WIKIWRIGHT_ROLE, the writer's when it declares none.",
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
