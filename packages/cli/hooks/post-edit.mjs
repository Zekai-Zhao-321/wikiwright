// docs/cli.md §The plugin and its hooks: the PostToolUse hook for Edit and
// Write. It reads the hook's JSON on stdin, takes `tool_input.file_path`, and
// finds the bundle the file belongs to by its ancestry: the nearest directory
// above the file's real path that holds `config/constitution.json`. None: it
// prints nothing. A root that holds `config/export.json` is an installed copy:
// it says so — the next update overwrites an edit there — and where a change
// goes instead, and lints nothing. Otherwise it lints the file as a page of
// that bundle, with `--root` that directory: every finding is named with its
// rule, line, message and route, and every pass the lint could not judge
// without a base is named too. A session whose role may not write the bundle
// is told so; a file the engine does not take for a page gets nothing.
//
// Plain Node, no dependencies, and no law loaded here: it reads a copy's
// marker to say where a change goes, and the judging is the engine's. It
// inherits the environment. Whatever goes wrong it prints nothing and exits 0.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

/** The nearest directory above `real` that holds a constitution, or undefined. */
function rootAbove(real) {
  let dir = dirname(real);
  for (;;) {
    if (existsSync(join(dir, "config", "constitution.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The page's vault path as the edit named it. The root is the first of the
 * edited path's own ancestors, walking up from the file, whose real path is
 * the root's; the path below it is kept LEXICALLY. So a root reached through
 * a link is found wherever the link sits, and every link below the root — a
 * content directory that links to another directory of the vault, a page that
 * is itself a link — keeps the name it was edited at, which is the path the
 * engine judges it at. A file reached from outside the root by a link is
 * named by its real path under the root.
 */
function vaultPathOf(file, root, real) {
  let ancestor = dirname(file);
  for (;;) {
    if (realOf(ancestor) === root) return relative(ancestor, file);
    const parent = dirname(ancestor);
    if (parent === ancestor) return relative(root, real);
    ancestor = parent;
  }
}

/** docs/cli.md §bundles: where a problem with a copy goes, in the words `bundle-readonly` uses. */
function contributionHint(marker) {
  const contribution = marker.contribution ?? {};
  const repository = contribution.repository ?? marker.source?.repository ?? "its repository";
  switch (contribution.mode) {
    case "issues":
      return `report at ${repository}/issues`;
    case "pull-requests":
      return `clone ${repository} and write there`;
    case "local-folder":
      return `write a proposal under ${contribution.folder ?? "the folder its SKILL.md names"}`;
    default:
      return "this copy takes no reports";
  }
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
    // refuses a write, and this is the bundle's own tree.
    const argv = [...finding.fix.argv, "--root", root].map(shellWord).join(" ");
    return ` — fix: wikiwright ${argv}`;
  }
  if (typeof finding.queue === "string") return ` — queue: ${finding.queue}`;
  return "";
}

function say(lines) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: lines.join("\n") },
    })}\n`,
  );
}

function main() {
  const input = parseJson(readFileSync(0, "utf8"));
  const path = input?.tool_input?.file_path;
  if (typeof path !== "string") return;
  // Absolute and normalized, as the edit named it; the ancestry is the real path's.
  const file = resolve(path);
  const real = realOf(file);
  if (real === undefined) return;
  const root = rootAbove(real);
  if (root === undefined) return;
  const markerPath = join(root, "config", "export.json");
  if (existsSync(markerPath)) {
    const marker = parseJson(readFileSync(markerPath, "utf8"));
    if (typeof marker?.bundle !== "string") return;
    say([
      `wikiwright: this is an installed copy of ${marker.bundle}; edits here are overwritten by the next update; ${contributionHint(marker)}.`,
    ]);
    return;
  }
  const rel = vaultPathOf(file, root, real).split(sep).join("/");
  if (!rel.endsWith(".md")) return;
  const linted = wikiwright(["lint", "--page", rel, "--all", "--root", root]);
  if (linted === undefined) return;
  // A file under the root that is no page of it: outside every content root,
  // or reached through a link out of the vault. The engine says so; so does
  // this, by saying nothing.
  if (linted.error?.code === "invalid-path") return;
  const label = linted.metadata?.bundle?.label ?? root.split(sep).at(-1);
  const lines = [`wikiwright: ${rel} is a page of the bundle "${label}".`];
  if (linted.error?.code === "role-forbidden") {
    lines.push("This session's role may not write this bundle.");
  } else if (Array.isArray(linted.data?.findings)) {
    const findings = linted.data.findings;
    lines.push(`${findings.length} finding(s) on the page:`);
    for (const f of findings) {
      const line = typeof f.line === "number" ? ` line ${f.line}` : "";
      lines.push(`- ${f.ruleId}${line}: ${f.message}${routeOf(f, root)}`);
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
  say(lines);
}

try {
  main();
} catch {
  // Nothing: an edit is never followed by a hook's own failure.
}
process.exitCode = 0;
