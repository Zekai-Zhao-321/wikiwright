// docs/cli.md §hook (the marker pre-commit gate, its bypass log, the chained
// script, and the commit-msg prefix hook a bundle's own declaration asks for)
// docs/architecture.md §Directories.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOOK_MARKER = "# installed by wikiwright";

/**
 * docs/cli.md §hook: the bypass, logged into the git dir — never a tracked file
 * the bypassed commit could not hold. It runs AFTER the chained script
 *: WIKIWRIGHT_BYPASS is an escape hatch for wikiwright's verdict,
 * and a bundle's own gate never opted into it. The reason is collapsed to one
 * TSV field, so text an operator types cannot split the record.
 */
function bypassGuard(): string[] {
  return [
    "git_dir=$(git rev-parse --git-dir)",
    'if [ -n "$WIKIWRIGHT_BYPASS" ]; then',
    '  author=$(git var GIT_AUTHOR_IDENT | sed "s/ [0-9]* [-+][0-9]*$//")',
    '  reason=$(printf "%s" "$WIKIWRIGHT_BYPASS" | tr "\\t\\n" "  ")',
    '  printf "%s\\t%s\\t%s\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$reason" "$author" \\',
    '    >> "$git_dir/wikiwright-bypass.log"',
    '  echo "wikiwright: gate bypassed — $reason (logged)" >&2',
    "  exit 0",
    "fi",
  ];
}

/**
 * A path becomes shell source exactly once, here: single-quoted with embedded
 * quotes escaped, so a path carrying a space, a `$` or a quote is run rather
 * than interpreted (docs/cli.md §hook).
 */
function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function engineAbsentGuard(): string[] {
  return [
    "if ! command -v wikiwright >/dev/null 2>&1; then",
    '  echo "wikiwright: engine not found — gate skipped this commit" >&2',
    "  exit 0",
    "fi",
  ];
}

export type HookOutcome =
  | { kind: "installed"; paths: string[] }
  | { kind: "foreign"; path: string }
  | { kind: "no-git" }
  | { kind: "chain-not-found"; path: string }
  | { kind: "chain-not-executable"; path: string };

/** Every outcome that is a refusal — the shape `hook`'s error mapping reads. */
export type HookRefusal = Exclude<HookOutcome, { kind: "installed" }>;

/**
 * docs/cli.md §The dry-run law: every refusal `installHook` makes BEFORE it
 * writes, and the hooks it would write when it makes none — with no write in
 * it. The dry run and the run answer from this one function, so
 * `hook install --dry-run` over a foreign pre-commit hook says `hook-exists`
 * exactly as the run does, rather than planning to overwrite it.
 */
export function inspectHook(
  root: string,
  options?: { chain?: string; commitPrefixes?: boolean },
): HookRefusal | { kind: "installed"; hooksDir: string; names: string[] } {
  // Linked worktrees have a .git FILE; resolve the hooks directory through git
  // plumbing (respects core.hooksPath too) instead of assuming a layout.
  let hooksDir: string;
  try {
    hooksDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-path", "hooks"], {
      cwd: root,
      encoding: "utf8",
      // Outside a work tree git says `fatal: not a git repository`; that answer
      // is the "no-git" return below, never a line beside a green envelope
      // (docs/cli.md §The envelope).
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return { kind: "no-git" };
  }
  const chain = options?.chain;
  if (chain !== undefined) {
    const chainPath = join(root, chain);
    if (!existsSync(chainPath)) return { kind: "chain-not-found", path: chain };
    // A chained script the shell cannot execute blocks every commit with exit
    // 126 (docs/cli.md §hook). Windows has no executable bit, so there is nothing to
    // check there — git-for-windows runs the hook's `sh` regardless of mode.
    if (process.platform !== "win32" && (statSync(chainPath).mode & 0o111) === 0) {
      return { kind: "chain-not-executable", path: chain };
    }
  }
  const names = ["pre-commit", ...(options?.commitPrefixes === true ? ["commit-msg"] : [])];
  for (const name of names) {
    const hookPath = join(hooksDir, name);
    if (existsSync(hookPath) && !readFileSync(hookPath, "utf8").includes(HOOK_MARKER)) {
      // A hook wikiwright did not write is someone else's gate — never clobber it.
      return { kind: "foreign", path: hookPath };
    }
  }
  return { kind: "installed", hooksDir, names };
}

/** The hook scripts this build writes, by name: ONE renderer, read by the installer and by `check`. */
export function renderHooks(options?: {
  chain?: string;
  commitPrefixes?: boolean;
}): { name: string; content: string }[] {
  const chain = options?.chain;
  const script = (lines: string[]): string => `${lines.join("\n")}\n`;
  const hooks = [
    {
      name: "pre-commit",
      content: script([
        "#!/bin/sh",
        `${HOOK_MARKER} — the staged gate`,
        "root=$(git rev-parse --show-toplevel)",
        // The bundle's own gate runs FIRST — before the bypass, which is an
        // escape hatch for wikiwright's verdict alone — and its exit is the
        // hook's.
        ...(chain === undefined ? [] : [`"$root"/${shellQuote(chain)} || exit $?`]),
        ...bypassGuard(),
        ...engineAbsentGuard(),
        // Present: fail closed. The verb renders the refusal onto stderr — the
        // rule census, the error findings, and how to see the rest —
        // so the envelope on stdout is dropped rather than echoed: a 700-line
        // envelope with the coverage block is not what a refused commit reads.
        // A hook from an older build captured stdout and echoed it after the
        // verb's own summary, so a refused commit printed twice; `check` reports such a
        // hook as `hook-stale` until it is reinstalled.
        'wikiwright gate --root "$root" >/dev/null',
        'exit "$?"',
      ]),
    },
  ];
  if (options?.commitPrefixes === true) {
    hooks.push({
      name: "commit-msg",
      content: script([
        "#!/bin/sh",
        `${HOOK_MARKER} — the commit-message prefix policy`,
        "root=$(git rev-parse --show-toplevel)",
        ...bypassGuard(),
        ...engineAbsentGuard(),
        // The refusal is the verb's own stderr — one line naming the valid set
        // for a prefix, the code and message for any other non-zero exit: a
        // silent fail-closed is the mirror of the silent fail-open this
        // contract exists to prevent. The envelope stays on stdout, where a
        // machine reader expects it, and the hook drops it.
        'wikiwright gate --commit-msg "$1" --root "$root" >/dev/null',
        'exit "$?"',
      ]),
    });
  }
  return hooks;
}

/** The `--chain` an installed marker hook was written with, read back off its own line. */
export function chainOfInstalled(content: string): string | undefined {
  const match = /^"\$root"\/'((?:[^']|'\\'')*)' \|\| exit \$\?$/mu.exec(content);
  return match?.[1] === undefined ? undefined : match[1].split("'\\''").join("'");
}

export interface InstalledHook {
  name: string;
  path: string;
  /** Present, carrying this engine's marker, and byte-identical to what this build writes. */
  current: boolean;
  chain?: string;
}

/**
 * The marker hooks a repository carries, each compared with what THIS build
 * would write for the same options — the chain read back off the installed
 * script, the commit-msg hook by the bundle's own declaration. A hook another
 * build wrote reads `current: false`; a foreign hook, or none, is not listed:
 * neither is this engine's to judge.
 */
export function installedHooks(
  root: string,
  options?: { commitPrefixes?: boolean },
): InstalledHook[] {
  const inspection = inspectHook(root, options);
  if (inspection.kind !== "installed") return [];
  const out: InstalledHook[] = [];
  for (const name of inspection.names) {
    const hookPath = join(inspection.hooksDir, name);
    if (!existsSync(hookPath)) continue;
    const installed = readFileSync(hookPath, "utf8");
    if (!installed.includes(HOOK_MARKER)) continue;
    const chain = chainOfInstalled(installed);
    const rendered = renderHooks({
      ...(chain === undefined ? {} : { chain }),
      ...(options?.commitPrefixes === undefined ? {} : { commitPrefixes: options.commitPrefixes }),
    }).find((h) => h.name === name);
    const row: InstalledHook = {
      name,
      path: `.git/hooks/${name}`,
      current: rendered !== undefined && rendered.content === installed,
    };
    if (chain !== undefined) row.chain = chain;
    out.push(row);
  }
  return out;
}

/**
 * Writes the marker pre-commit (and, when the constitution declares
 * `commit_prefixes`, the commit-msg hook). Never clobbers a foreign hook: every
 * refusal is `inspectHook`'s, made before this function touches anything.
 */
export function installHook(
  root: string,
  options?: { chain?: string; commitPrefixes?: boolean },
): HookOutcome {
  const inspection = inspectHook(root, options);
  if (inspection.kind !== "installed") return inspection;
  const { hooksDir, names } = inspection;
  mkdirSync(hooksDir, { recursive: true });
  for (const hook of renderHooks(options)) {
    const hookPath = join(hooksDir, hook.name);
    writeFileSync(hookPath, hook.content, { mode: 0o755 });
    // `mode` only applies on creation; a reinstall over an existing file must
    // still end executable.
    chmodSync(hookPath, 0o755);
  }
  return { kind: "installed", paths: names.map((n) => `.git/hooks/${n}`) };
}
