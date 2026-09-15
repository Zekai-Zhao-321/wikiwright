// docs/cli.md §The envelope (one spec-driven registry generates help and
// schema, and every verb declares its role) · docs/cli.md §The dry-run law
// (`writes` and `plan` are members of the spec, so the registry answers "can
// this verb write") · docs/architecture.md §Directories (the vocabulary every
// verb module and the argv parser share).

import type { CommandResult } from "./envelope.ts";

export interface FlagSpec {
  name: string;
  type: "string" | "boolean";
  summary: string;
  /**
   * docs/cli.md §write: the flag may be repeated and arrives as a list.
   * `--not-any-of` is the first: naming the candidates a writer ruled out is a
   * list by nature, and a comma-joined string would put a parser between the
   * agent and the identity gate.
   */
  multiple?: true;
}

/**
 * The flags EVERY verb accepts — the one definition site. The
 * parser builds its options from this list and `schema` prints it as
 * `global_flags`, so the generated registry cannot omit a flag the binary
 * honors (`--root` was in schema's own examples while no command declared it).
 */
export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: "root", type: "string", summary: "vault root directory (default: current directory)" },
  // Every verb answers --help, so the global-flag law puts it here — the one
  // constant the parser is built from cannot omit a flag the binary accepts.
  // main.ts intercepts it before parsing; the declaration is what makes the
  // generated registry and the skill-invocation gate agree with the binary.
  {
    name: "help",
    type: "boolean",
    summary: "print this command's spec and exit",
  },
];

export interface PositionalSpec {
  name: string;
  required: boolean;
}

export interface CommandArgs {
  root: string;
  positionals: string[];
  flags: Record<string, string | boolean | (string | boolean)[] | undefined>;
  /**
   * The registry this invocation ran under. `schema` prints it and the brief is
   * rendered from it, and both used to import the array that imports them —
   * the shell's one cycle. It travels with the invocation instead, so the
   * registry reads the verbs and no verb reads the registry back.
   */
  commands: readonly CommandSpec[];
}

/** The one reader of a `multiple` flag, so a repeated flag has one shape. */
export function listFlag(args: CommandArgs, name: string): string[] {
  const value = args.flags[name];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

/**
 * docs/cli.md §The dry-run law: the closed set of things a plan can say it would do.
 * Closed, because a plan an agent has to read as prose is the four-shape
 * problem the law replaces.
 */
export type PlanOpKind = "create" | "write" | "append" | "copy" | "rename" | "delete";

export interface PlanOp {
  kind: PlanOpKind;
  /** Repo-relative inside the vault; absolute where the target is not (the
   * machine-local trust store, `.git/hooks`). */
  path: string;
  /**
   * docs/cli.md §The dry-run law: where the file LEFT, for the kinds that have
   * a source. One `path` can only name where a file arrives, so a rename read
   * through `ops` alone said nothing about the page that disappeared — measured
   * on `move`. A `delete` op beside the rename would have said the file is
   * destroyed, which is what the verb is careful never to do.
   */
  from?: string;
  summary: string;
}

/** What a writing verb would do. `wrote` is literally false — the type says so. */
export interface Plan {
  ops: PlanOp[];
  wrote: false;
}

/** The one constructor, so no verb writes `wrote: false` by hand and forgets. */
export function planOf(ops: PlanOp[]): Plan {
  return { ops, wrote: false };
}

/**
 * docs/cli.md §brief: the three bounds, ordered. A caller of rank R may call a
 * verb of rank ≤ R, so `consumer ⊂ writer ⊂ maintainer` and a verb declares the
 * LOWEST role that may run it. The writer bound exists because the ingest loop
 * is a real population with a real surface — nine verbs — and bounding it by
 * what a skill happens to print is not a bound (R-wm A10).
 */
export const ROLE_RANK = { consumer: 0, writer: 1, maintainer: 2 } as const;

export type Role = keyof typeof ROLE_RANK;

interface CommandBase {
  name: string;
  role: Role;
  summary: string;
  positionals: PositionalSpec[];
  /**
   * docs/cli.md §The envelope: the closed set of values the FIRST positional takes,
   * for a verb with subcommands. One table: the parser refuses a value outside
   * it (`unknown-subcommand`) or a missing one (`missing-argument`) before the
   * verb runs, and `--help`, `schema` and the brief render the same list.
   */
  subcommands?: readonly string[];
  flags: FlagSpec[];
  examples: string[];
  /**
   * docs/cli.md §The dry-run law: can this verb's `run`
   * write to the filesystem? REQUIRED, not optional — a verb allowed to stay
   * silent answers "reader" by default, which is the fail-open direction on the
   * one switch whose purpose is bounding. The meta-test (docs/architecture.md §The invariants) scans
   * each verb module for reachable writes and fails the build on a disagreement.
   */
  /**
   * docs/extending.md §Declaring a module: does this verb read the vault's own
   * law? The entry point preloads the modules `config/engine.json` declares
   * before a verb that does, so a bundle judged without a law it declares is
   * refused rather than judged under a quieter one; a verb that answers about
   * the engine rather than the vault loads no third-party code to do it.
   * REQUIRED, like `writes`: a verb allowed to stay silent would decide by
   * omission which law it is judged under. The meta-test holds each
   * declaration against what the verb's own imports reach.
   */
  needsVaultModules: boolean;
  run: (args: CommandArgs) => CommandResult | Promise<CommandResult>;
}

/**
 * docs/cli.md §The dry-run law: a writing verb answers `--dry-run` with the plan
 * it would apply, and a reader has nothing to plan. The pair is a union rather
 * than two independent fields, so `writes: true` without a `plan` does not
 * compile. The meta-test still scans each verb module for reachable writes,
 * which no type can do: this holds the declaration together, that holds the
 * declaration to the code.
 */
export type CommandSpec = CommandBase &
  ({ writes: true; plan: (args: CommandArgs) => Plan } | { writes: false; plan?: never });

/**
 * docs/cli.md §The dry-run law: the dry-run flag is RENDERED from the registry, never
 * declared by a verb. `--help`, `schema` and the argv parser are all built from
 * this one function, so a writer cannot advertise a dry run it does not accept
 * or accept one it does not advertise.
 */
export const DRY_RUN_FLAG: FlagSpec = {
  name: "dry-run",
  type: "boolean",
  summary: "report the plan — the ops this verb would apply — and write nothing",
};

export function flagsOf(spec: CommandSpec): FlagSpec[] {
  return spec.writes ? [...spec.flags, DRY_RUN_FLAG] : [...spec.flags];
}

/** The one reader of the flag, so `--dry-run` cannot mean two things. */
export function isDryRun(args: CommandArgs): boolean {
  return args.flags["dry-run"] === true;
}
