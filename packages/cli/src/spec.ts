// docs/cli.md §The envelope (one spec-driven registry generates help and
// schema) · docs/cli.md §The dry-run law
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
  // v2 contracts §9: `--help --json` prints the verb's schema — the registry
  // row the `schema` verb printed — in place of that verb. Read by main.ts
  // beside `--help`; without it the flag changes nothing.
  {
    name: "json",
    type: "boolean",
    summary: "with --help: print the verb's schema, the registry row an agent reads",
  },
  // v2 contracts §9: no automatic spill. An envelope over 1 MiB is refused as
  // `envelope-too-large`; `--out <file>` takes the whole envelope instead, and
  // stdout carries a two-line pointer to it. Written by main.ts, which every
  // verb's envelope passes through.
  {
    name: "out",
    type: "string",
    summary: "write the whole envelope to this file and print a two-line pointer to it on stdout",
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
  /** Repo-relative inside the vault; absolute where the target is not
   * (`.git/hooks`, an `export --to` destination outside the vault). */
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

interface CommandBase {
  name: string;
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
  (
    | { writes: true; plan: (args: CommandArgs) => Plan | Promise<Plan> }
    | { writes: false; plan?: never }
  );

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

/** The usage line of one verb, from its spec. */
export function usageOf(spec: CommandSpec): string {
  const parts = [`wikiwright ${spec.name}`];
  for (const p of spec.positionals) {
    parts.push(
      p.name === "subcommand" && spec.subcommands !== undefined
        ? `<${spec.subcommands.join("|")}>`
        : p.required
          ? `<${p.name}>`
          : `[${p.name}]`,
    );
  }
  for (const f of flagsOf(spec))
    parts.push(f.type === "string" ? `[--${f.name} <v>]` : `[--${f.name}]`);
  return parts.join(" ");
}

/**
 * v2 contracts §9: `<verb> --help --json`, the verb's schema — the registry
 * row the `schema` verb printed, with whether the verb can write.
 */
export function commandSchema(spec: CommandSpec): Record<string, unknown> {
  return {
    name: spec.name,
    summary: spec.summary,
    positionals: spec.positionals,
    ...(spec.subcommands === undefined ? {} : { subcommands: [...spec.subcommands] }),
    flags: flagsOf(spec),
    examples: spec.examples,
    // docs/cli.md §The dry-run law: "can this verb write" is a registry
    // answer, not an inference from the presence of `--dry-run`.
    writes: spec.writes,
  };
}
