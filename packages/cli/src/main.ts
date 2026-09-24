#!/usr/bin/env node
// docs/cli.md §The envelope (stdout = one envelope; stderr = UX; parseArgs
// strict under the command registry; generated help) · JSON-only v1.
import { isSkillName, SKILL_NAME, SKILL_NAME_MAX } from "@wikiwright/core";
import { parseInvocation, scanInvocation } from "./argv.ts";
import { bundleIdentity } from "./bundle.ts";
import { COMMANDS } from "./commands.ts";
import { MACHINE_LOCAL_WRITERS } from "./connections.ts";
import { resolveBundle } from "./discovery.ts";
import { type BundleIdentity, type CommandResult, fail, ok } from "./envelope.ts";
import { GitInconsistentRead, GitShortRead } from "./git.ts";
import { MARKER_PATH, markerAt } from "./marker.ts";
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
import { StoreMalformed } from "./storelock.ts";

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
function withBundle(
  result: CommandResult,
  root: string,
  shadowed: readonly { root: string; tier: string }[],
): CommandResult {
  let bundle: BundleIdentity | undefined;
  try {
    bundle = bundleIdentity(root);
  } catch {
    return result;
  }
  if (bundle === undefined) return result;
  // docs/cli.md §bundles: the copies of the same bundle a nearer one shadowed.
  if (shadowed.length > 0) bundle = { ...bundle, shadowed: [...shadowed] };
  const metadata = { ...result.envelope.metadata, bundle };
  return { ...result, envelope: { ...result.envelope, metadata } };
}

type Target =
  | { ok: true; args: CommandArgs; shadowed: { root: string; tier: string }[] }
  | { ok: false; result: CommandResult };

/**
 * docs/cli.md §Exit codes: what a thrown error becomes. A machine-local store
 * this engine cannot read — the bundles registry — is the state refusing the
 * operation, named by the store's own code with the file and the failing
 * record, from whichever verb reached it. A git answer
 * cut short is `git-short-read`; two git answers that disagree are
 * `git-inconsistent-read`. Anything else is the engine breaking.
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
  if (e instanceof GitInconsistentRead) {
    return fail(command, "internal", "git-inconsistent-read", e.message, {
      details: { commands: e.commands.map((c) => `git ${c}`) },
      hint: "two git answers about one state disagree; nothing was judged from them — run the command again",
    });
  }
  if (e instanceof StoreMalformed) {
    return fail(command, "conflict", e.code, e.message, {
      details: { file: e.file, ...(e.record === undefined ? {} : { record: e.record }) },
      hint: "the file is this machine's store, not a vault's; repair it or move it aside — the engine does not rewrite a store it cannot read",
    });
  }
  return fail(command, "internal", "unexpected-error", e instanceof Error ? e.message : String(e));
}

/**
 * docs/cli.md §bundles: `--bundle <name>` names the target by the name of a
 * bundle skill installed in the skill directories (`discovery.ts`), resolved
 * here, before any module loads or the verb runs, into the root `--root` would
 * have named. Each refusal comes before anything of the bundle is read: both
 * flags at once (`one-target`), a name outside the skill grammar
 * (`bundle-name-invalid`), a name nothing answers (`bundle-not-found`, with the
 * directories searched and the names the scan saw), and a name two different
 * bundles answer (`bundle-ambiguous`, with each candidate). A found copy is an
 * installed copy, read only: a verb that can write it is refused
 * (`bundle-readonly`, `--dry-run` included), except `bundles`, whose write is
 * this machine's registry (`MACHINE_LOCAL_WRITERS`).
 */
function targetOf(spec: CommandSpec, args: CommandArgs): Target {
  const name = args.flags["bundle"];
  if (typeof name !== "string") return { ok: true, args, shadowed: [] };
  const root = args.flags["root"];
  if (typeof root === "string") {
    return {
      ok: false,
      result: fail(spec.name, "usage", "one-target", "--bundle and --root both name the target", {
        details: { bundle: name, root },
        hint: "pass one: --bundle names an installed bundle skill, --root names a directory",
      }),
    };
  }
  if (!isSkillName(name)) {
    return {
      ok: false,
      result: fail(spec.name, "usage", "bundle-name-invalid", `"${name}" is not a bundle name`, {
        details: { name, pattern: SKILL_NAME.source, max_length: SKILL_NAME_MAX },
        hint: "a bundle is named as its skill is: lower-case letters and digits in hyphen-separated runs, at most 64 characters",
      }),
    };
  }
  const resolution = resolveBundle(name);
  const skipped = resolution.skipped.map(({ root: at, tier, reason }) => ({
    root: at,
    tier,
    reason,
  }));
  if (resolution.kind === "none") {
    return {
      ok: false,
      result: fail(
        spec.name,
        "not_found",
        "bundle-not-found",
        `no bundle skill named "${name}" is installed in the skill directories`,
        {
          details: { searched: resolution.searched, names: resolution.names, skipped },
          hint: "details.names are the bundle skills the scan saw; --root names a directory the scan does not reach",
        },
      ),
    };
  }
  if (resolution.kind === "ambiguous") {
    return {
      ok: false,
      result: fail(
        spec.name,
        "usage",
        "bundle-ambiguous",
        `${resolution.candidates.length} different bundles are installed as "${name}"`,
        {
          details: {
            candidates: resolution.candidates.map((c) => ({
              root: c.root,
              tier: c.tier,
              repository: c.marker.source.repository,
            })),
            skipped,
          },
          hint: "name the copy you mean with --root <one of details.candidates' roots>",
        },
      ),
    };
  }
  const chosen = resolution.chosen;
  if (spec.writes && !MACHINE_LOCAL_WRITERS.has(spec.name)) {
    return {
      ok: false,
      result: fail(
        spec.name,
        "usage",
        "bundle-readonly",
        `"${name}" is an installed copy, read only, and "${spec.name}" can write`,
        {
          details: { bundle: name, root: chosen.root },
          hint: "an installed copy is not changed in place; its SKILL.md says where a problem with it is reported",
        },
      ),
    };
  }
  return {
    ok: true,
    args: { ...args, root: chosen.root },
    shadowed: resolution.shadowed.map((c) => ({ root: c.root, tier: c.tier })),
  };
}

async function runCommand(spec: CommandSpec, rest: string[]): Promise<CommandResult> {
  const parsed = parseInvocation(spec, rest, COMMANDS);
  if (!parsed.ok) return parsed.result;
  let target: Target;
  try {
    target = targetOf(spec, parsed.args);
  } catch (e) {
    return thrown(spec.name, e);
  }
  if (!target.ok) return target.result;
  const { args, shadowed } = target;
  // docs/cli.md §The envelope: a root that carries a marker is a copy, and a
  // copy is read under the identity its marker gives it. A marker that is not
  // one is refused before any module preloads or the verb reads a page, as a
  // config the loader cannot read is: the copy is not loaded.
  if (spec.needsVaultModules) {
    const marker = markerAt(args.root);
    if (marker.kind === "invalid") {
      return fail(
        spec.name,
        "conflict",
        "export-marker-invalid",
        `${MARKER_PATH} is not an export's marker: ${marker.reason}`,
        {
          details: { path: MARKER_PATH, reason: marker.reason },
          hint: "the file is written by `check --write` or `export`; install the copy again from its source, or remove the file if this root is not a copy",
        },
      );
    }
  }
  let result: CommandResult;
  try {
    // docs/extending.md §Declaring a module: loading a module is the shell's one
    // asynchronous step, and it happens HERE — once, before the verb runs —
    // rather than making every verb's loader async for it. `loadVaultVia` reads
    // the outcome and refuses a bundle whose declared modules did not load, so
    // a verb that never reaches this line cannot be judged under a quieter law.
    // Only for a verb that reads the vault's law: `version` and `schema` answer
    // about the engine, and `bundles` about this machine's registry.
    if (spec.needsVaultModules) {
      const declarations = declaredModulesOf(args.root);
      if (declarations.length > 0) await preloadModules(args.root, declarations);
    }
    result = await spec.run(args);
  } catch (e) {
    result = thrown(spec.name, e);
  }
  // The same switch decides it: a verb that reads the vault's law names the
  // bundle it read, and one that answers about the engine names none.
  return spec.needsVaultModules ? withBundle(result, args.root, shadowed) : result;
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
