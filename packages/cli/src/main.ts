#!/usr/bin/env bun
// docs/cli.md §The envelope (stdout = one envelope; stderr = UX; parseArgs
// strict under the command registry; generated help) · JSON-only v1.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseInvocation, scanInvocation } from "./argv.ts";
import { ReplacementTargetRefused, replaceFile } from "./atomicwrite.ts";
import { COMMANDS } from "./commands.ts";
import {
  type CommandResult,
  ENVELOPE_MAX_BYTES,
  envelopeTooLarge,
  fail,
  ok,
  outPointer,
} from "./envelope.ts";
import {
  GitInconsistentRead,
  GitPlumbingFailed,
  GitShortRead,
  GitTimedOut,
  gitTimeoutSetting,
} from "./git.ts";
import { LinkedOutsideVault } from "./paths.ts";
import { type CommandSpec, commandSchema, flagsOf, GLOBAL_FLAGS, usageOf } from "./spec.ts";

/** Where an envelope goes: stdout, or the file `--out` names. */
interface Sink {
  out?: string;
  summary?: boolean;
}

/** The root the invocation names (`--root`, else the working directory), read before the verb. */
let invocationRoot: string | undefined = ".";

/** A path with its deepest existing ancestor resolved through every link. */
function realPathOf(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  try {
    return join(realpathSync(existing), ...rest);
  } catch {
    return resolve(path);
  }
}

/** The nearest bundle boundary: v4 engine.json, or the old constitution path for output safety. */
function bundleHolding(root: string): string | undefined {
  let dir = realPathOf(root);
  for (;;) {
    if (
      existsSync(join(dir, "config", "engine.json")) ||
      existsSync(join(dir, "config", "constitution.json"))
    )
      return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Early help and argv refusals have no selected law; keep output outside the enclosing checkout. */
function repositoryHolding(root: string): string | undefined {
  let dir = realPathOf(root);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * `--out` never writes inside the bundle the invocation reads: the envelope
 * would overwrite a page, a law file or a generated file by a path no
 * writing verb's checks see.
 */
function outInsideBundle(result: CommandResult, out: string): CommandResult | undefined {
  if (invocationRoot === undefined) return undefined;
  const bundle =
    result.envelope.metadata.bundle?.root ??
    result.outputProtected?.[0] ??
    bundleHolding(invocationRoot);
  const target = realPathOf(out);
  const inside = (root: string): boolean => target === root || target.startsWith(`${root}${sep}`);
  const realBundle = bundle === undefined ? undefined : realPathOf(bundle);
  if (realBundle !== undefined && inside(realBundle))
    return fail(
      result.envelope.metadata.command,
      "usage",
      "out-inside-bundle",
      `--out names "${out}", inside the bundle at ${realBundle}; the envelope is written only outside it`,
      {
        details: { out: target, bundle: realBundle, exit_code: result.exit },
        hint: "name a file outside the bundle, e.g. under the system's temporary directory",
      },
    );
  for (const library of result.outputProtected ?? []) {
    const real = realPathOf(library);
    if (real === realBundle || !inside(real)) continue;
    return fail(
      result.envelope.metadata.command,
      "usage",
      "out-inside-law",
      `--out names "${out}", inside an imported law directory; the envelope cannot replace law bytes`,
      {
        details: { out: target, library: real, exit_code: result.exit },
        hint: "name a file outside the bundle and its imported libraries",
      },
    );
  }
  if (result.outputProtectionComplete !== true) {
    const repository = repositoryHolding(invocationRoot);
    if (repository !== undefined && inside(repository))
      return fail(
        result.envelope.metadata.command,
        "usage",
        "out-inside-repository",
        `--out names "${out}", inside the enclosing repository before a law was selected`,
        {
          details: { out: target, repository, exit_code: result.exit },
          hint: "name an output file outside the repository",
        },
      );
  }
  return undefined;
}

function write(result: CommandResult, text: string): void {
  process.stdout.write(text);
  // docs/cli.md §The envelope: payload on stdout, UX on stderr — one writer each.
  if (result.stderr !== undefined) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exit;
}

/** A compact view over the same full check verdict; failures keep their error and exit. */
function summaryView(
  result: CommandResult,
  report?: { out: string; bytes: number },
): CommandResult | undefined {
  if (result.envelope.metadata.command !== "check") return undefined;
  const data = result.envelope.data as Record<string, unknown> | undefined;
  if (data?.["summary"] === undefined || data["pins"] === undefined) return undefined;
  const pins = data["pins"] as { counts?: unknown; citations?: unknown };
  const generated = data["generated"] as { written?: unknown } | undefined;
  const fixed = data["fixed"];
  const compact = {
    summary: data["summary"],
    scope: data["scope"],
    unevaluated: data["unevaluated"],
    pins: { counts: pins.counts, citations: pins.citations },
    generated: { written: generated?.written ?? [] },
    fixed_count: Array.isArray(fixed) ? fixed.length : 0,
    ...(report === undefined ? {} : { report }),
  };
  return { ...result, envelope: { ...result.envelope, data: compact } };
}

function emit(result: CommandResult, sink: Sink = {}): void {
  const text = `${JSON.stringify(result.envelope, null, 2)}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (sink.out !== undefined) {
    const rawOut = resolve(sink.out);
    try {
      if (lstatSync(rawOut).isSymbolicLink()) {
        const refused = fail(
          result.envelope.metadata.command,
          "usage",
          "out-linked-target",
          `--out names "${sink.out}", a symbolic link; name a regular file path`,
          { details: { out: rawOut, exit_code: result.exit } },
        );
        write(refused, `${JSON.stringify(refused.envelope, null, 2)}\n`);
        return;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        const refused = fail(
          result.envelope.metadata.command,
          "usage",
          "out-unwritable",
          `--out names "${sink.out}", and it cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
          { details: { out: rawOut, exit_code: result.exit } },
        );
        write(refused, `${JSON.stringify(refused.envelope, null, 2)}\n`);
        return;
      }
    }
    const out = realPathOf(rawOut);
    const inside = outInsideBundle(result, sink.out);
    if (inside !== undefined) {
      write(inside, `${JSON.stringify(inside.envelope, null, 2)}\n`);
      return;
    }
    try {
      replaceFile(out, text);
    } catch (e) {
      const refused = fail(
        result.envelope.metadata.command,
        "usage",
        "out-unwritable",
        `--out names "${sink.out}", and the envelope could not be written there: ${e instanceof Error ? e.message : String(e)}`,
        { details: { out, exit_code: result.exit } },
      );
      write(refused, `${JSON.stringify(refused.envelope, null, 2)}\n`);
      return;
    }
    const summary = sink.summary === true ? summaryView(result, { out, bytes }) : undefined;
    const summaryText =
      summary === undefined ? undefined : `${JSON.stringify(summary.envelope, null, 2)}\n`;
    write(
      result,
      summaryText === undefined
        ? outPointer(result, out, bytes)
        : Buffer.byteLength(summaryText, "utf8") <= ENVELOPE_MAX_BYTES
          ? summaryText
          : `${JSON.stringify(
              {
                ok: result.envelope.ok,
                command: result.envelope.metadata.command,
                exit_code: result.exit,
                bytes,
                out,
                summary_omitted: "stdout-bound",
              },
              null,
              2,
            )}\n`,
    );
    return;
  }
  const shown = sink.summary === true ? (summaryView(result) ?? result) : result;
  const shownText = shown === result ? text : `${JSON.stringify(shown.envelope, null, 2)}\n`;
  if (Buffer.byteLength(shownText, "utf8") > ENVELOPE_MAX_BYTES) {
    const refused = envelopeTooLarge(shown, Buffer.byteLength(shownText, "utf8"));
    write(refused, `${JSON.stringify(refused.envelope, null, 2)}\n`);
    return;
  }
  write(result, shownText);
}

/**
 * docs/cli.md §The envelope: one command's help — its usage line, summary,
 * flags and examples. Intercepted BEFORE parseInvocation — asking for help
 * must never itself be a usage error.
 */
function commandHelp(spec: CommandSpec): CommandResult {
  return ok(spec.name, {
    name: spec.name,
    summary: spec.summary,
    usage: usageOf(spec),
    positionals: spec.positionals,
    ...(spec.subcommands === undefined ? {} : { subcommands: [...spec.subcommands] }),
    flags: flagsOf(spec),
    examples: spec.examples,
    global_flags: GLOBAL_FLAGS,
  });
}

function helpResult(json: boolean): CommandResult {
  if (json) {
    // v2 contracts §9: the whole registry, every verb's schema, as `schema` printed it.
    return ok("help", { global_flags: GLOBAL_FLAGS, commands: COMMANDS.map(commandSchema) });
  }
  const globals = GLOBAL_FLAGS.map((f) =>
    f.type === "string" ? ` [--${f.name} <value>]` : ` [--${f.name}]`,
  ).join("");
  return ok("help", {
    usage: `wikiwright <command> [arguments]${globals}`,
    commands: COMMANDS.map((c) => ({ name: c.name, summary: c.summary })),
    schema:
      "run `wikiwright --help --json` for every verb's schema, or `wikiwright <command> --help --json` for one",
  });
}

/**
 * docs/cli.md §Exit codes: what a thrown error becomes. A vault path that
 * resolves outside the vault — a config linked out of it, say — is
 * `linked-outside-vault`. A git answer cut short is `git-short-read`; two git
 * answers that disagree are `git-inconsistent-read`; a git child killed for
 * overrunning its timeout is `git-timeout`. Anything else is the engine
 * breaking.
 */
function thrown(command: string, e: unknown): CommandResult {
  if (e instanceof GitPlumbingFailed) {
    return fail(command, "conflict", "git-unavailable", e.message, {
      details: { command: `git ${e.command}` },
      hint: "git plumbing failed; nothing was judged — inspect the repository and run the command again",
    });
  }
  // A git answer cut short, or contradicted by another, is the plumbing
  // failing, refused by name: never read as a smaller answer, and never a
  // quieter verdict (docs/roadmap.md).
  if (e instanceof GitShortRead) {
    return fail(command, "internal", "git-short-read", e.message, {
      details: { command: `git ${e.command}` },
      hint: "git's answer ended before its terminator; nothing was judged from it — run the command again",
    });
  }
  if (e instanceof GitTimedOut) {
    return fail(command, "internal", "git-timeout", e.message, {
      details: { command: `git ${e.command}`, timeout_ms: e.timeoutMs },
      hint: "git did not answer in time and was killed; nothing was judged — run the command again, or raise WIKIWRIGHT_GIT_TIMEOUT_MS",
    });
  }
  if (e instanceof LinkedOutsideVault) {
    return fail(command, "conflict", "linked-outside-vault", e.message, {
      details: { path: e.path },
      hint: "a vault reads and writes only inside itself; replace the link with the file it names, inside the vault",
    });
  }
  if (e instanceof ReplacementTargetRefused) {
    return fail(command, "conflict", "replacement-target-refused", e.message, {
      details: { path: e.path, kind: e.kind },
      hint: "remove the obstructing directory or link, then run the command again",
    });
  }
  if (e instanceof GitInconsistentRead) {
    return fail(command, "internal", "git-inconsistent-read", e.message, {
      details: { commands: e.commands.map((c) => `git ${c}`) },
      hint: "two git answers about one state disagree; nothing was judged from them — run the command again",
    });
  }
  return fail(command, "internal", "unexpected-error", e instanceof Error ? e.message : String(e));
}

async function runCommand(
  spec: CommandSpec,
  rest: string[],
  table: readonly CommandSpec[],
): Promise<CommandResult> {
  const parsed = parseInvocation(spec, rest, table);
  if (!parsed.ok) return parsed.result;
  const { args } = parsed;
  // Each verb names the bundle it read itself, from the state it judged.
  try {
    return await spec.run(args);
  } catch (e) {
    return thrown(spec.name, e);
  }
}

// The conventional spellings reach the `version` verb — one
// envelope shape, one implementation.
const VERSION_ALIASES = new Set(["--version", "-v"]);

/**
 * The root an invocation names, read before its verb is chosen: `--root`'s
 * value, or the working directory.
 */
function rootOf(rest: readonly string[]): string {
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "--") break;
    if (token.startsWith("--root=")) return token.slice("--root=".length);
    if (token === "--root") return rest[i + 1] ?? ".";
  }
  return ".";
}

const argv = process.argv.slice(2);
const commandName = argv[0];
if (commandName === undefined || commandName === "help" || commandName === "--help") {
  invocationRoot = rootOf(argv.slice(1));
  const scan = scanInvocation(undefined, argv.slice(1));
  emit(helpResult(scan.wantsJson), scan);
} else {
  const resolvedName = VERSION_ALIASES.has(commandName) ? "version" : commandName;
  const rest = argv.slice(1);
  invocationRoot = rootOf(rest);
  const spec = COMMANDS.find((c) => c.name === resolvedName);
  const sink = scanInvocation(spec, rest);
  if (spec === undefined) {
    emit(
      fail("wikiwright", "usage", "unknown-command", `unknown command "${commandName}"`, {
        details: { valid_commands: COMMANDS.map((c) => c.name) },
      }),
      sink,
    );
  } else {
    const gitTimeout = gitTimeoutSetting();
    if (typeof gitTimeout !== "number") {
      emit(
        fail(
          "wikiwright",
          "usage",
          "git-timeout-invalid",
          `WIKIWRIGHT_GIT_TIMEOUT_MS is "${gitTimeout.invalid}"`,
          {
            hint: "a whole number of milliseconds from 1 to 2147483647, or unset for the default of 60000",
          },
        ),
        sink,
      );
    } else if (sink.wantsHelp && sink.wantsJson) emit(ok(spec.name, commandSchema(spec)), sink);
    else if (sink.wantsHelp) emit(commandHelp(spec), sink);
    else emit(await runCommand(spec, rest, COMMANDS), sink);
  }
}
