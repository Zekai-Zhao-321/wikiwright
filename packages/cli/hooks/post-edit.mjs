// docs/cli.md §The plugin and its hooks: the PostToolUse hook for Edit and
// Write. It reads the hook's JSON on stdin, takes `tool_input.file_path`, and
// when that file is a page of a connected bundle — under the connection's root
// and one of the content roots its config/engine.json declares — it tells the
// session what the edit means for that bundle: an installed copy is read only
// and a change goes to its feedback destination; a session whose role may not
// write the bundle is told so; otherwise the page is linted and every finding
// is named with its rule, line, message and route. A file outside every
// connection gets nothing.
//
// Plain Node, no dependencies, and no law loaded here: the content roots are
// read from engine.json directly, and the judging is the engine's. It inherits
// the environment. Whatever goes wrong it prints nothing and exits 0.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

/** One envelope from the engine, or undefined when there is none to read. */
function wikiwright(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 20_000 });
  if (r.error !== undefined || typeof r.stdout !== "string") return undefined;
  return JSON.parse(r.stdout);
}

/** The content roots a bundle's engine.json declares, read without loading its law. */
function contentRootsOf(root) {
  const engine = JSON.parse(readFileSync(join(root, "config", "engine.json"), "utf8"));
  const roots = engine?.content_roots;
  return Array.isArray(roots) ? roots.filter((r) => typeof r === "string") : [];
}

/**
 * The connection whose root holds the file and whose content roots hold its
 * path, with the page's vault path; the deepest root when roots nest.
 */
function pageOf(file, rows) {
  let best;
  for (const row of rows) {
    const root = row.realpath;
    if (typeof root !== "string" || !file.startsWith(root + sep)) continue;
    const rel = relative(root, file).split(sep).join("/");
    if (!rel.endsWith(".md")) continue;
    let roots;
    try {
      roots = contentRootsOf(root);
    } catch {
      continue;
    }
    if (!roots.some((contentRoot) => rel.startsWith(`${contentRoot}/`))) continue;
    if (best === undefined || root.length > best.row.realpath.length) best = { row, rel };
  }
  return best;
}

function routeOf(finding, name) {
  if (Array.isArray(finding.fix?.argv)) {
    return ` — fix: wikiwright ${finding.fix.argv.join(" ")} --bundle ${name}`;
  }
  if (typeof finding.queue === "string") return ` — queue: ${finding.queue}`;
  return "";
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const path = input?.tool_input?.file_path;
  if (typeof path !== "string") return;
  const file = realpathSync(path);
  const listed = wikiwright(["bundles", "list"]);
  if (listed?.ok !== true) return;
  const found = pageOf(
    file,
    (listed.data?.bundles ?? []).filter((row) => row.present === true),
  );
  if (found === undefined) return;
  const { row, rel } = found;
  const lines = [`wikiwright: ${rel} is a page of the bundle "${row.name}".`];
  if (row.kind === "installed") {
    lines.push(
      `It is in an installed copy, which is read only: a change to it goes, as a proposal, to ${
        typeof row.feedback === "string" ? row.feedback : "whoever maintains the bundle"
      }.`,
    );
  } else {
    const linted = wikiwright(["lint", "--page", rel, "--all", "--root", row.realpath]);
    if (linted === undefined) return;
    if (linted.error?.code === "role-forbidden") {
      lines.push("This session's role may not write this bundle.");
    } else if (Array.isArray(linted.data?.findings)) {
      const findings = linted.data.findings;
      lines.push(`${findings.length} finding(s) on the page:`);
      for (const f of findings) {
        const line = typeof f.line === "number" ? ` line ${f.line}` : "";
        lines.push(`- ${f.ruleId}${line}: ${f.message}${routeOf(f, row.name)}`);
      }
      lines.push(
        "This judged the working-tree page against the bundle's current law; it is not the staged gate's verdict.",
      );
    } else {
      lines.push(`The page could not be judged: ${linted.error?.code ?? "no envelope"}.`);
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: lines.join("\n") },
    })}\n`,
  );
}

try {
  main();
} catch {
  // Nothing: an edit is never followed by a hook's own failure.
}
process.exitCode = 0;
