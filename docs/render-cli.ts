// Renders the verb reference in docs/cli.md from the binary's own command
// registry (`wikiwright schema`), so the names and flags in the document are the
// binary's, byte for byte.
//
//   bun docs/render-cli.ts            print the generated block
//   bun docs/render-cli.ts --write    replace the block between the markers in docs/cli.md
//   bun docs/render-cli.ts --check    exit 1 when docs/cli.md's block is not what the binary renders
//
// The CLI runs under the Bun running this script (`process.execPath`), the one
// runtime the repository names, so nothing here needs Node on PATH. Its
// envelope comes back through a file it writes itself, never a pipe, as a
// test reads it (packages/cli/test/fixtures/runtime.ts).
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../packages/cli/dist/main.js", import.meta.url));
const DOC = fileURLToPath(new URL("./cli.md", import.meta.url));
const BEGIN = "<!-- generated: begin (bun docs/render-cli.ts --write) -->";
const END = "<!-- generated: end -->";

interface Flag {
  name: string;
  type: "string" | "boolean";
  summary: string;
  multiple?: true;
}
interface Command {
  name: string;
  role: string;
  summary: string;
  positionals: { name: string; required: boolean }[];
  subcommands?: string[];
  flags: Flag[];
  examples: string[];
  writes: boolean;
}
interface Schema {
  data: { global_flags: Flag[]; commands: Command[] };
}

function readSchema(): Schema {
  const scratch = mkdtempSync(join(tmpdir(), "wikiwright-render-cli-"));
  const outPath = join(scratch, "schema.json");
  try {
    const out = openSync(outPath, "wx", 0o600);
    let status: number | null;
    try {
      status = spawnSync(process.execPath, [BIN, "schema"], {
        stdio: ["ignore", out, "inherit"],
      }).status;
    } finally {
      closeSync(out);
    }
    if (status !== 0) throw new Error(`\`wikiwright schema\` exited ${String(status)}`);
    return JSON.parse(readFileSync(outPath, "utf8")) as Schema;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const schema = readSchema();

function usage(c: Command): string {
  const parts = [`wikiwright ${c.name}`];
  for (const p of c.positionals) {
    parts.push(
      p.name === "subcommand" && c.subcommands !== undefined
        ? `<${c.subcommands.join("|")}>`
        : p.required
          ? `<${p.name}>`
          : `[${p.name}]`,
    );
  }
  return parts.join(" ");
}

function flagRow(f: Flag): string {
  const form = f.type === "string" ? `--${f.name} <value>` : `--${f.name}`;
  const repeat = f.multiple === true ? " (repeatable)" : "";
  return `| \`${form}\`${repeat} | ${f.summary.replaceAll("|", "\\|")} |`;
}

const out: string[] = [BEGIN, ""];
out.push("Global flags, accepted by every verb:", "", "| Flag | Meaning |", "|---|---|");
for (const f of schema.data.global_flags) out.push(flagRow(f));
out.push("");
const commands = [...schema.data.commands].sort((a, b) => (a.name < b.name ? -1 : 1));
out.push("| Verb | Role | Writes | Summary |", "|---|---|---|---|");
for (const c of commands) {
  out.push(
    `| [\`${c.name}\`](#${c.name}) | ${c.role} | ${c.writes ? "yes" : "no"} | ${c.summary.replaceAll("|", "\\|")} |`,
  );
}
out.push("");
for (const c of commands) {
  out.push(`### ${c.name}`, "", `\`${usage(c)}\``, "", `${c.summary}`, "");
  out.push(`Role: \`${c.role}\`. Writes: ${c.writes ? "yes (accepts `--dry-run`)" : "no"}.`, "");
  if (c.flags.length > 0) {
    out.push("| Flag | Meaning |", "|---|---|");
    for (const f of c.flags) out.push(flagRow(f));
    out.push("");
  }
  out.push("```text", ...c.examples, "```", "");
}
out.push(END);
const block = out.join("\n");

const mode = process.argv[2];
if (mode === "--write" || mode === "--check") {
  const doc = readFileSync(DOC, "utf8");
  const start = doc.indexOf(BEGIN);
  const stop = doc.indexOf(END);
  if (start < 0 || stop < 0) throw new Error(`docs/cli.md carries no generated block markers`);
  const next = `${doc.slice(0, start)}${block}${doc.slice(stop + END.length)}`;
  if (mode === "--write") {
    writeFileSync(DOC, next);
  } else if (next !== doc) {
    console.error("docs/cli.md is behind the binary: run `bun docs/render-cli.ts --write`");
    process.exit(1);
  }
} else {
  process.stdout.write(`${block}\n`);
}
