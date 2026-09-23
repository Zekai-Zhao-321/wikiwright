#!/usr/bin/env node
// docs/cli.md §The envelope (stdout = one envelope; stderr = UX; parseArgs
// strict under the command registry; generated help) · JSON-only v1.
import { codeUnitCompare } from "@wikiwright/core";
import { parseInvocation, scanInvocation } from "./argv.ts";
import { bundleIdentity } from "./bundle.ts";
import { COMMANDS } from "./commands.ts";
import { readConnections } from "./connections.ts";
import { type BundleIdentity, type CommandResult, fail, ok } from "./envelope.ts";
import { declaredModulesOf, preloadModules } from "./moduleload.ts";
import {
  type CommandArgs,
  type CommandSpec,
  declaredRole,
  flagsOf,
  GLOBAL_FLAGS,
  ROLE_RANK,
  type Role,
} from "./spec.ts";

function emit(result: CommandResult): void {
  process.stdout.write(`${JSON.stringify(result.envelope, null, 2)}\n`);
  // docs/cli.md §The envelope: payload on stdout, UX on stderr — one writer each.
  if (result.stderr !== undefined) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exit;
}

/**
 * docs/cli.md §The envelope: one command's spec, from the same registry that
 * renders `schema` and the brief. Intercepted BEFORE parseInvocation — asking
 * for help must never itself be a usage error.
 */
function commandHelp(spec: CommandSpec): CommandResult {
  return ok(spec.name, {
    name: spec.name,
    role: spec.role,
    summary: spec.summary,
    positionals: spec.positionals,
    ...(spec.subcommands === undefined ? {} : { subcommands: [...spec.subcommands] }),
    flags: flagsOf(spec),
    examples: spec.examples,
    global_flags: GLOBAL_FLAGS,
  });
}

function helpResult(): CommandResult {
  const globals = GLOBAL_FLAGS.map((f) =>
    f.type === "string" ? ` [--${f.name} <value>]` : ` [--${f.name}]`,
  ).join("");
  return ok("help", {
    usage: `wikiwright <command> [arguments]${globals}`,
    commands: COMMANDS.map((c) => ({ name: c.name, role: c.role, summary: c.summary })),
    schema: "run `wikiwright schema` for the full generated registry",
  });
}

/**
 * docs/cli.md §The envelope: the bundle a vault verb read, on the envelope it
 * returned, ok or not. Computed after the verb, so it describes the state the
 * verb left. An identity the engine cannot read inside the vault (a file under
 * it resolves outside) is left off rather than half-stated; the reads that
 * refuse it are the same ones every verb makes.
 */
function withBundle(result: CommandResult, root: string): CommandResult {
  let bundle: BundleIdentity | undefined;
  try {
    bundle = bundleIdentity(root);
  } catch {
    return result;
  }
  if (bundle === undefined) return result;
  const metadata = { ...result.envelope.metadata, bundle };
  return { ...result, envelope: { ...result.envelope, metadata } };
}

type Target = { ok: true; args: CommandArgs } | { ok: false; result: CommandResult };

/**
 * docs/cli.md §bundles: `--bundle <name>` names the target by a connection in
 * this machine's registry, resolved here, before any module loads or the verb
 * runs, into the root `--root` would have named. Three refusals come first, each
 * before anything is read of the bundle: both flags at once (`one-target`), a
 * name no connection carries (`bundle-not-found`), and a verb that can write
 * aimed at an installed copy (`bundle-readonly`, `--dry-run` included, since a
 * dry run of a forbidden write is still a forbidden write). The refusal names
 * where a change to that copy goes instead. It is a guardrail on this CLI, not
 * filesystem isolation: `--root` names the same directory and is not refused.
 */
function targetOf(spec: CommandSpec, args: CommandArgs): Target {
  const name = args.flags["bundle"];
  if (typeof name !== "string") return { ok: true, args };
  const root = args.flags["root"];
  if (typeof root === "string") {
    return {
      ok: false,
      result: fail(spec.name, "usage", "one-target", "--bundle and --root both name the target", {
        details: { bundle: name, root },
        hint: "pass one: --bundle names a connected bundle, --root names a directory",
      }),
    };
  }
  const store = readConnections();
  const connection = store.bundles.find((b) => b.name === name);
  if (connection === undefined) {
    return {
      ok: false,
      result: fail(
        spec.name,
        "not_found",
        "bundle-not-found",
        `no bundle is connected as "${name}"`,
        {
          details: { valid_values: store.bundles.map((b) => b.name).sort(codeUnitCompare) },
          hint: "`bundles list` names every connection on this machine",
        },
      ),
    };
  }
  if (connection.kind === "installed" && spec.writes) {
    return {
      ok: false,
      result: fail(
        spec.name,
        "usage",
        "bundle-readonly",
        `"${name}" is an installed copy, read only, and "${spec.name}" can write`,
        {
          details: { bundle: name, kind: connection.kind, feedback: connection.feedback },
          hint:
            connection.feedback === null
              ? "an installed copy is not changed in place; report the change to whoever maintains the bundle"
              : `an installed copy is not changed in place; report the change as details.feedback says: ${connection.feedback}`,
        },
      ),
    };
  }
  return { ok: true, args: { ...args, root: connection.root } };
}

async function runCommand(spec: CommandSpec, rest: string[]): Promise<CommandResult> {
  const parsed = parseInvocation(spec, rest, COMMANDS);
  if (!parsed.ok) return parsed.result;
  let target: Target;
  try {
    target = targetOf(spec, parsed.args);
  } catch (e) {
    // A registry that is not one is named by its path in the message.
    return fail(
      spec.name,
      "internal",
      "unexpected-error",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (!target.ok) return target.result;
  const { args } = target;
  let result: CommandResult;
  try {
    // docs/extending.md §Declaring a module: loading a module is the shell's one
    // asynchronous step, and it happens HERE — once, before the verb runs —
    // rather than making every verb's loader async for it. `loadVaultVia` reads
    // the outcome and refuses a bundle whose declared modules did not load, so
    // a verb that never reaches this line cannot be judged under a quieter law.
    // Only for a verb that reads the vault's law: `version` and `schema` answer
    // about the engine, and `trust` loads the one module it is about, itself.
    if (spec.needsVaultModules) {
      const declarations = declaredModulesOf(args.root);
      if (declarations.length > 0) await preloadModules(args.root, declarations);
    }
    result = await spec.run(args);
  } catch (e) {
    result = fail(
      spec.name,
      "internal",
      "unexpected-error",
      e instanceof Error ? e.message : String(e),
    );
  }
  // The same switch decides it: a verb that reads the vault's law names the
  // bundle it read, and one that answers about the engine names none.
  return spec.needsVaultModules ? withBundle(result, args.root) : result;
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
function roleRefusal(spec: CommandSpec, role: Role): CommandResult | undefined {
  const allowed = ROLE_RANK[role];
  const details: Record<string, unknown> = {
    role,
    valid_commands: COMMANDS.filter((c) => ROLE_RANK[c.role] <= allowed).map((c) => c.name),
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

const argv = process.argv.slice(2);
const commandName = argv[0];
if (commandName === undefined || commandName === "help" || commandName === "--help") {
  emit(helpResult());
} else {
  const resolvedName = VERSION_ALIASES.has(commandName) ? "version" : commandName;
  const spec = COMMANDS.find((c) => c.name === resolvedName);
  if (spec === undefined) {
    emit(
      fail("wikiwright", "usage", "unknown-command", `unknown command "${commandName}"`, {
        details: { valid_commands: COMMANDS.map((c) => c.name) },
      }),
    );
  } else {
    const role = currentRole();
    if (typeof role !== "string") {
      emit(
        fail("wikiwright", "usage", "role-unknown", `WIKIWRIGHT_ROLE is "${role.unknown}"`, {
          details: { valid_values: [...ROLES] },
        }),
      );
    } else {
      // Before --help and before parsing: a bounded caller cannot learn the
      // shape of a verb it may not run, and no maintainer path is reached.
      const rest = argv.slice(1);
      const scan = scanInvocation(spec, rest);
      const refusal = roleRefusal(spec, role);
      if (refusal !== undefined) emit(refusal);
      else if (scan.wantsHelp) emit(commandHelp(spec));
      else emit(await runCommand(spec, rest));
    }
  }
}
