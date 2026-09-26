#!/usr/bin/env bun
// docs/cli.md §The envelope (stdout = one envelope; stderr = UX; parseArgs
// strict under the command registry; generated help) · JSON-only v1.
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseInvocation, scanInvocation } from "./argv.ts";
import { replaceFile } from "./atomicwrite.ts";
import { COMMANDS } from "./commands.ts";
import {
  type CommandResult,
  ENVELOPE_MAX_BYTES,
  envelopeTooLarge,
  fail,
  ok,
  outPointer,
} from "./envelope.ts";
import { GitInconsistentRead, GitShortRead, GitTimedOut, gitTimeoutSetting } from "./git.ts";
import { declaredModulesOf, preloadModules } from "./moduleload.ts";
import { LinkedOutsideVault } from "./paths.ts";
import {
  type CommandSpec,
  commandSchema,
  declaredRole,
  flagsOf,
  GLOBAL_FLAGS,
  ROLE_RANK,
  type Role,
  usageOf,
} from "./spec.ts";

/** Where an envelope goes: stdout, or the file `--out` names. */
interface Sink {
  out?: string;
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

/** The bundle holding `root`: it, or its nearest ancestor, carrying a config the engine reads. */
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

/**
 * `--out` never writes inside the bundle the invocation reads: the envelope
 * would overwrite a page, a law file or a generated file by a path no
 * writing verb's checks or `WIKIWRIGHT_ROLE`'s bound see.
 */
function outInsideBundle(result: CommandResult, out: string): CommandResult | undefined {
  if (invocationRoot === undefined) return undefined;
  const bundle = bundleHolding(invocationRoot);
  if (bundle === undefined) return undefined;
  const target = realPathOf(out);
  if (target !== bundle && !target.startsWith(`${bundle}${sep}`)) return undefined;
  return fail(
    result.envelope.metadata.command,
    "usage",
    "out-inside-bundle",
    `--out names "${out}", inside the bundle at ${bundle}; the envelope is written only outside it`,
    {
      details: { out: target, bundle, exit_code: result.exit },
      hint: "name a file outside the bundle, e.g. under the system's temporary directory",
    },
  );
}

function write(result: CommandResult, text: string): void {
  process.stdout.write(text);
  // docs/cli.md §The envelope: payload on stdout, UX on stderr — one writer each.
  if (result.stderr !== undefined) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exit;
}

function emit(result: CommandResult, sink: Sink = {}): void {
  const text = `${JSON.stringify(result.envelope, null, 2)}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  if (sink.out !== undefined) {
    const out = resolve(sink.out);
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
    write(result, outPointer(result, out, bytes));
    return;
  }
  if (bytes > ENVELOPE_MAX_BYTES) {
    const refused = envelopeTooLarge(result, bytes);
    write(refused, `${JSON.stringify(refused.envelope, null, 2)}\n`);
    return;
  }
  write(result, text);
}

/**
 * docs/cli.md §The envelope: one command's help — its usage line, summary,
 * flags and examples. Intercepted BEFORE parseInvocation — asking for help
 * must never itself be a usage error.
 */
function commandHelp(spec: CommandSpec): CommandResult {
  return ok(spec.name, {
    name: spec.name,
    role: spec.role,
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
    commands: COMMANDS.map((c) => ({ name: c.name, role: c.role, summary: c.summary })),
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
  let result: CommandResult;
  try {
    // docs/extending.md §Declaring a module: the declared modules load HERE —
    // once, before the verb runs — and `loadVaultVia` reads the outcome by root
    // and refuses a bundle whose declared modules did not load, so a verb that
    // never reaches this line cannot be judged under a quieter law.
    // Only for a verb that reads the vault's law: `version` and `schema` answer
    // about the engine.
    if (spec.needsVaultModules) {
      const declarations = declaredModulesOf(args.root);
      if (declarations.length > 0) await preloadModules(args.root, declarations);
    }
    result = await spec.run(args);
  } catch (e) {
    result = thrown(spec.name, e);
  }
  // Each verb names the bundle it read itself, from the state it judged.
  return result;
}

// The conventional spellings reach the `version` verb — one
// envelope shape, one implementation.
const VERSION_ALIASES = new Set(["--version", "-v"]);

const ROLES = Object.keys(ROLE_RANK) as readonly Role[];

/**
 * docs/cli.md §The envelope: the worker's tool policy, enforced by the binary
 * rather than by a skill's prose. An unrecognised value refuses — falling back
 * to `maintainer` would widen the surface exactly when the declaration was
 * wrong, which is a fail-open on the one switch whose purpose is bounding.
 */
function currentRole(): Role | { unknown: string } {
  const declared = declaredRole();
  if (declared === undefined) return "maintainer";
  return (ROLES as readonly string[]).includes(declared)
    ? (declared as Role)
    : { unknown: declared };
}

/**
 * docs/cli.md §brief: the bound is a rank comparison, so adding `writer` between
 * the two existing roles changed one function rather than every call site. The
 * refusal lists the verbs the CALLER's role may run — role-filtered, because a
 * list of everything is not an answer to "what may I do".
 */
function roleRefusal(
  spec: CommandSpec,
  role: Role,
  table: readonly CommandSpec[],
): CommandResult | undefined {
  const allowed = ROLE_RANK[role];
  const details: Record<string, unknown> = {
    role,
    valid_commands: table.filter((c) => ROLE_RANK[c.role] <= allowed).map((c) => c.name),
  };
  if (ROLE_RANK[spec.role] <= allowed) return undefined;
  return fail(
    spec.name,
    "usage",
    "role-forbidden",
    `"${spec.name}" is a ${spec.role} verb and WIKIWRIGHT_ROLE is ${role}`,
    {
      details,
      hint: `run it as the ${spec.role}, or use one of the verbs in details.valid_commands`,
    },
  );
}

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
    const role = currentRole();
    const gitTimeout = gitTimeoutSetting();
    if (typeof role !== "string") {
      emit(
        fail("wikiwright", "usage", "role-unknown", `WIKIWRIGHT_ROLE is "${role.unknown}"`, {
          details: { valid_values: [...ROLES] },
        }),
        sink,
      );
    } else if (typeof gitTimeout !== "number") {
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
    } else {
      // Before --help and before parsing: a bounded caller cannot learn the
      // shape of a verb it may not run, and no maintainer path is reached.
      const refusal = roleRefusal(spec, role, COMMANDS);
      if (refusal !== undefined) emit(refusal, sink);
      else if (sink.wantsHelp && sink.wantsJson) emit(ok(spec.name, commandSchema(spec)), sink);
      else if (sink.wantsHelp) emit(commandHelp(spec), sink);
      else emit(await runCommand(spec, rest, COMMANDS), sink);
    }
  }
}
