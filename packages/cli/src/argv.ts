// docs/cli.md §The envelope (parseArgs strict under the command registry;
// usage errors carry the legal domain in `details` — prose is never load-bearing).
import { parseArgs } from "node:util";
import { type CommandResult, fail } from "./envelope.ts";
import { type CommandArgs, type CommandSpec, flagsOf, GLOBAL_FLAGS } from "./spec.ts";

export type InvocationParse =
  | { ok: true; args: CommandArgs }
  | { ok: false; result: CommandResult };

/**
 * A command with no positionals cannot have a quoting problem —
 * the stray value almost certainly belongs to one of its string flags, so
 * name them. The quoting hint is reserved for commands that take positionals,
 * where a split multi-word value is the likely mistake.
 */
function unexpectedArgumentHint(spec: CommandSpec): string {
  if (spec.positionals.length > 0) {
    return "quote multi-word values so they arrive as one argument";
  }
  const carriers = flagsOf(spec)
    .filter((f) => f.type === "string")
    .map((f) => `--${f.name}`);
  const base = `${spec.name} takes no positional arguments`;
  return carriers.length === 0
    ? base
    : `${base}; pass the value through a flag: ${carriers.join(", ")}`;
}

export interface ArgvScan {
  /** `--help` as a flag of its own — never as the value of a string flag. */
  wantsHelp: boolean;
}

/**
 * docs/cli.md §The envelope: the pre-parse read of argv for `--help`,
 * under the same flag declarations `parseArgs` is built from. A declared string
 * flag consumes the token after it and a bare `--` ends the scan, so a string
 * flag's VALUE is never read as a request for help.
 */
export function scanInvocation(spec: CommandSpec, rest: string[]): ArgvScan {
  const stringFlags = new Set<string>();
  for (const flag of [...GLOBAL_FLAGS, ...flagsOf(spec)]) {
    if (flag.type === "string") stringFlags.add(flag.name);
  }
  let wantsHelp = false;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "--") break;
    if (token === "--help") {
      wantsHelp = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      // `--name=value` carries its value inline; `--name value` does not.
      if (eq === -1 && stringFlags.has(token.slice(2))) i += 1;
    }
  }
  return { wantsHelp };
}

/**
 * The one place argv becomes CommandArgs. main.ts runs it; the skill drift
 * gate parses every documented invocation through it — so "documented" and
 * "legal" cannot silently diverge.
 */
export function parseInvocation(
  spec: CommandSpec,
  rest: string[],
  commands: readonly CommandSpec[],
): InvocationParse {
  const options: Record<string, { type: "string" | "boolean"; multiple?: true }> = {};
  for (const flag of GLOBAL_FLAGS) options[flag.name] = { type: flag.type };
  // docs/cli.md §The dry-run law: `flagsOf`, not `spec.flags` — the parser and the
  // generated help are built from the same list, so a writer's --dry-run is
  // accepted exactly where it is advertised.
  for (const flag of flagsOf(spec)) {
    options[flag.name] =
      flag.multiple === true ? { type: flag.type, multiple: true } : { type: flag.type };
  }
  let parsed: {
    values: Record<string, string | boolean | (string | boolean)[] | undefined>;
    positionals: string[];
  };
  // The legal flags, global and the verb's own, in `details` on every
  // argv refusal — an unknown or removed flag is refused by name with the set
  // it could have been, the way an unknown subcommand lists `valid_values`.
  const validFlags = [...GLOBAL_FLAGS, ...flagsOf(spec)].map((f) => `--${f.name}`);
  try {
    parsed = parseArgs({ args: rest, options, strict: true, allowPositionals: true });
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    const message = e instanceof Error ? e.message : String(e);
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const flag = /^Unknown option '([^']+)'/u.exec(message)?.[1] ?? "";
      return {
        ok: false,
        result: fail(spec.name, "usage", "unknown-flag", `"${spec.name}" has no flag ${flag}`, {
          details: { flag, valid_flags: validFlags },
          hint: "run `wikiwright schema` for every verb's flags",
        }),
      };
    }
    return {
      ok: false,
      result: fail(spec.name, "usage", "invalid-arguments", message, {
        details: { valid_flags: validFlags },
      }),
    };
  }
  if (parsed.positionals.length > spec.positionals.length) {
    // Silently dropping extras turns `search Some Hub` into a search for
    // "Some" — surface the mistake instead.
    const extras = parsed.positionals.slice(spec.positionals.length);
    return {
      ok: false,
      result: fail(
        spec.name,
        "usage",
        "unexpected-argument",
        `unexpected argument(s): ${extras.map((x) => JSON.stringify(x)).join(", ")}`,
        {
          details: { expected_positionals: spec.positionals.map((p) => p.name) },
          hint: unexpectedArgumentHint(spec),
        },
      ),
    };
  }
  // docs/cli.md §The envelope: a verb's subcommand vocabulary is the registry's, so a
  // typo and an omission are refused HERE, with the legal set, for every verb
  // that declares one — never once per verb in its own words.
  if (spec.subcommands !== undefined) {
    const sub = parsed.positionals[0];
    if (sub === undefined) {
      return {
        ok: false,
        result: fail(spec.name, "usage", "missing-argument", `${spec.name} requires a subcommand`, {
          details: { valid_values: [...spec.subcommands] },
        }),
      };
    }
    if (!spec.subcommands.includes(sub)) {
      return {
        ok: false,
        result: fail(spec.name, "usage", "unknown-subcommand", `unknown subcommand "${sub}"`, {
          details: { valid_values: [...spec.subcommands] },
        }),
      };
    }
  }
  const root = typeof parsed.values["root"] === "string" ? parsed.values["root"] : ".";
  return {
    ok: true,
    args: { root, positionals: parsed.positionals, flags: parsed.values, commands },
  };
}
