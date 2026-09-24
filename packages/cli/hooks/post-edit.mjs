// docs/cli.md §The plugin and its hooks: the PostToolUse hook for Edit and
// Write. It reads the hook's JSON on stdin, takes `tool_input.file_path`, and
// when that file is a page of a connected bundle — under the connection's root
// and one of the content roots its config/engine.json declares — it tells the
// session what the edit means for that bundle: an installed copy is read only
// and a change goes to its feedback destination; a session whose role may not
// write the bundle is told so; otherwise the page is linted and every finding
// is named with its rule, line, message and route, and every pass the lint
// could not judge without a base is named too. A file outside every
// connection gets nothing.
//
// Plain Node, no dependencies, and no law loaded or config read here: the
// connections and their content roots are the engine's answer to `bundles
// list --records`, read inside each bundle as every verb reads it, and the
// judging is the engine's. It inherits the environment. Whatever goes wrong it
// prints nothing and exits 0.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

/** One envelope from the engine, or undefined when there is none to read. */
function wikiwright(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: 20_000 });
  if (r.error !== undefined || typeof r.stdout !== "string") return undefined;
  return JSON.parse(r.stdout);
}

/** JSON text as the engine reads it: a leading byte order mark is not part of it. */
function parseJson(text) {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/** The real path of a file, or undefined when it cannot be resolved. */
function realOf(path) {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * The page's vault path as the edit named it. The root is the first of the
 * edited path's own ancestors, walking up from the file, whose real path is
 * the record's; the path below it is kept LEXICALLY. So a root reached through
 * a link is found wherever the link sits, and every link below the root — a
 * content directory that links to another directory of the vault, a page that
 * is itself a link — keeps the name it was edited at, which is the path the
 * engine judges it at. Containment is the caller's separate check, on the
 * file's own real path.
 */
function vaultPathOf(file, row) {
  let ancestor = dirname(file);
  for (;;) {
    if (realOf(ancestor) === row.realpath) return relative(ancestor, file);
    const parent = dirname(ancestor);
    if (parent === ancestor) return undefined;
    ancestor = parent;
  }
}

/**
 * The connection whose root holds the file and whose content roots hold its
 * path, with the page's vault path; the deepest root when roots nest. The
 * path decides membership and the file's real path decides containment, as
 * the engine's path law does: a page linked out of the vault is no page of it.
 */
function pageOf(file, rows) {
  const real = realOf(file);
  if (real === undefined) return undefined;
  let best;
  for (const row of rows) {
    if (typeof row.realpath !== "string" || !Array.isArray(row.content_roots)) continue;
    if (!real.startsWith(row.realpath + sep)) continue;
    const found = vaultPathOf(file, row);
    if (found === undefined) continue;
    const rel = found.split(sep).join("/");
    if (!rel.endsWith(".md")) continue;
    if (!row.content_roots.some((contentRoot) => rel.startsWith(`${contentRoot}/`))) continue;
    if (best === undefined || row.realpath.length > best.row.realpath.length) best = { row, rel };
  }
  return best;
}

/**
 * One argument as a POSIX shell reads it back: bare when it holds only
 * characters no shell treats specially, otherwise in single quotes, a quote
 * inside written as '\''. A path with a space stays one argument.
 */
function shellWord(arg) {
  const word = String(arg);
  return /^[A-Za-z0-9_./:=@%+,-]+$/u.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

function routeOf(finding, root) {
  if (Array.isArray(finding.fix?.argv)) {
    // `--root`, not `--bundle`: a name resolves to an installed copy, which
    // refuses a write, and this is the bundle's own checkout.
    const argv = [...finding.fix.argv, "--root", root].map(shellWord).join(" ");
    return ` — fix: wikiwright ${argv}`;
  }
  if (typeof finding.queue === "string") return ` — queue: ${finding.queue}`;
  return "";
}

function main() {
  const input = parseJson(readFileSync(0, "utf8"));
  const path = input?.tool_input?.file_path;
  if (typeof path !== "string") return;
  // Absolute and normalized, as the edit named it: no link is followed yet.
  const file = resolve(path);
  // Routing needs the records and their content roots, not each bundle's
  // identity: no page of any bundle is read or hashed to decide where an edit
  // belongs.
  const listed = wikiwright(["bundles", "list", "--records"]);
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
        lines.push(`- ${f.ruleId}${line}: ${f.message}${routeOf(f, row.realpath)}`);
      }
      // A page linted alone has no base, so a transition law — an append-only
      // body, an append-only ledger — is not judged here. The lint names each
      // such pass; so does this, since "0 findings" would otherwise read as
      // "nothing to fix" for an edit the gate will refuse.
      const unevaluated = linted.data.unevaluated ?? {};
      const skipped = Object.keys(unevaluated).sort();
      for (const pass of skipped) {
        const skip = unevaluated[pass] ?? {};
        lines.push(`not evaluated here: ${pass} (${skip.count} declaration(s), ${skip.reason})`);
      }
      if (skipped.length > 0) {
        lines.push(
          "The staged gate judges these against HEAD, so an edit to an append-only body can pass here and be refused at commit.",
        );
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
