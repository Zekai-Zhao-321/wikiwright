// docs/cli.md §The plugin and its hooks: the SessionStart hook. It reads the
// hook's JSON on stdin, asks the engine for the bundle skills installed in the
// skill directories (`bundles list`, which reads markers only: it executes no
// kit and hashes no page), and prints one line per copy — its name, the bundle
// it was cut from, the tier it was found in, and the action that fits how it
// was installed — then how a command names one. It prints no page content and
// no digest.
//
// It checks nothing remote. What an installer records names a ref and a tree,
// not the commit a copy came from, so "behind" cannot be computed from it
// without the installer's own comparison; the installer's update is that
// comparison, and the hook names it rather than guessing.
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

/** A value that names a repository: a URL, or an `owner/repository` pair. */
const REPOSITORY = /^(?:https?:\/\/\S+|[A-Za-z0-9][\w.-]*\/[\w.-]+)$/u;

/** A value that names a pin: a version tag, or a commit id. */
const PIN = /^(?:v?\d+(?:\.\d+)+(?:[-+][\w.-]+)?|[0-9a-f]{7,64})$/u;

/**
 * The action that fits how a copy was installed, read off what its installer
 * recorded: judged by the shape of each value, never by what it is compared to.
 */
function actionOf(row) {
  if (row.linked === true) {
    return "linked to a local checkout; the checkout's own gate keeps it current";
  }
  const entries = Object.entries(row.provenance ?? {});
  // A tree id names what was copied, not what it is held to.
  const pin = entries.find(([key, value]) => PIN.test(value) && !/tree/iu.test(key));
  if (pin !== undefined) return `pinned at ${pin[0]} ${pin[1]}`;
  if (entries.some(([key, value]) => REPOSITORY.test(value) || /repo/iu.test(key))) {
    return `update with \`gh skill update ${row.name}\``;
  }
  return "installed by hand; `gh skill install` makes it updatable";
}

function describe(row) {
  if (typeof row.bundle !== "string") {
    return `- ${row.name} (${row.tier}): not readable as a bundle skill, ${row.code}: ${row.reason}`;
  }
  const shadowed = typeof row.shadowed_by === "string" ? `; shadowed by ${row.shadowed_by}` : "";
  return `- ${row.name}: the bundle ${row.bundle}, ${row.tier} tier; ${actionOf(row)}${shadowed}`;
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  // The documented input is one JSON object; anything else is not a session start.
  if (input === null || typeof input !== "object" || Array.isArray(input)) return;
  const listed = wikiwright(["bundles", "list"]);
  if (listed?.ok !== true) return;
  const rows = listed.data?.bundles ?? [];
  if (rows.length === 0) return;
  const again = input.source === "compact" || input.source === "resume";
  const lines = [
    again
      ? "Re-establishing the installed wikiwright bundle skills from their current state:"
      : "Installed wikiwright bundle skills:",
    ...rows.map(describe),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the host's variable, named literally
    "A wikiwright command names one with --bundle <name>, or, from within its skill, with --root ${CLAUDE_SKILL_DIR}.",
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
