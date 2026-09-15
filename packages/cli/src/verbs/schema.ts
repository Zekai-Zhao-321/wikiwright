// docs/cli.md §The envelope (the generated registry, printed from
// the same array `--help` and the skill-invocation gate read) · docs/architecture.md §Directories.

// The registry travels with the invocation, so this prints the verbs without
// importing the array that imports it.
import { ok } from "../envelope.ts";
import { type CommandSpec, flagsOf, GLOBAL_FLAGS } from "../spec.ts";

export const schemaCommand: CommandSpec = {
  name: "schema",
  role: "consumer",
  summary: "Print the generated command registry: names, roles, flags, examples.",
  positionals: [],
  flags: [],
  examples: ["wikiwright schema"],
  writes: false,
  needsVaultModules: false,
  run: (args) =>
    ok("schema", {
      global_flags: GLOBAL_FLAGS,
      commands: args.commands.map((c) => ({
        name: c.name,
        role: c.role,
        summary: c.summary,
        positionals: c.positionals,
        ...(c.subcommands === undefined ? {} : { subcommands: [...c.subcommands] }),
        flags: flagsOf(c),
        examples: c.examples,
        // docs/cli.md §The dry-run law law 4: "can this verb write" is a
        // registry answer, not an inference from the presence of `--dry-run` —
        // which is what an agent had to do before, on the one axis whose whole
        // purpose is bounding.
        writes: c.writes,
      })),
    }),
};
