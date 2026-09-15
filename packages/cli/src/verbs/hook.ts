// docs/cli.md §hook (install the staged gate; never clobber a foreign hook,
// and say in the envelope when the gate fails open) · docs/architecture.md §Directories.

import { type CommandResult, fail, ok } from "../envelope.ts";
import { type HookRefusal, inspectHook, installHook } from "../hooks.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";
import { loadVault } from "../vaultio.ts";

function hookFailure(outcome: HookRefusal | { kind: "installed" }): CommandResult | undefined {
  if (outcome.kind === "no-git") {
    return fail("hook", "conflict", "not-a-git-repo", "no .git directory at the vault root");
  }
  if (outcome.kind === "chain-not-found") {
    return fail("hook", "not_found", "chain-not-found", `no script at "${outcome.path}" to chain`, {
      hint: "--chain takes a repo-relative path to an executable script",
    });
  }
  if (outcome.kind === "chain-not-executable") {
    return fail(
      "hook",
      "conflict",
      "chain-not-executable",
      `the script at "${outcome.path}" is not executable`,
      { hint: "chmod +x the chained script; a hook that cannot run it exits 126 on every commit" },
    );
  }
  if (outcome.kind === "foreign") {
    return fail(
      "hook",
      "conflict",
      "hook-exists",
      `a hook wikiwright did not install already exists: ${outcome.path}`,
      {
        hint: "add `wikiwright gate` to your existing hook, or pass --chain <your script> so wikiwright runs it first",
      },
    );
  }
  return undefined;
}

/** The options `installHook` takes, read once from the argv and the bundle. */
function hookOptions(args: CommandArgs): { chain?: string; commitPrefixes: boolean } {
  const vault = loadVault("hook", args.root);
  const options: { chain?: string; commitPrefixes: boolean } = {
    commitPrefixes: vault.ok && vault.engine.commit_prefixes !== undefined,
  };
  const chain = args.flags["chain"];
  if (typeof chain === "string" && chain.length > 0) options.chain = chain;
  return options;
}

/**
 * docs/cli.md §The dry-run law: one of the two verbs with the widest
 * blast radius and, until the law, no dry run at all. The plan names the
 * hook files by the path the installer prints.
 *
 * The hooks come from `inspectHook`, which is the installer's own
 * pre-write half — so a plan can neither name a hook the installer refuses to
 * write (a foreign pre-commit hook, a missing `--chain`) nor miss one it does.
 * The prose used to hedge ("never over a hook wikiwright did not write") while
 * the machine-readable `kind`/`path` said it would write; `docs/cli.md §The envelope`
 * says prose is never load-bearing.
 */
function planForHook(args: CommandArgs): Plan {
  const [sub] = args.positionals;
  if (sub !== "install") return planOf([]);
  const options = hookOptions(args);
  const inspection = inspectHook(args.root, options);
  if (inspection.kind !== "installed") return planOf([]);
  const chained = options.chain === undefined ? "" : `, chaining ${options.chain}`;
  const ops: PlanOp[] = inspection.names.map((name) => ({
    kind: "write" as const,
    path: `.git/hooks/${name}`,
    summary:
      name === "pre-commit"
        ? `the staged gate${chained}`
        : "the commit-prefix policy the bundle declares",
  }));
  return planOf(ops);
}

export const hookCommand: CommandSpec = {
  name: "hook",
  role: "maintainer",
  summary: "Install the marker pre-commit gate (and the commit-msg prefix hook when declared).",
  positionals: [{ name: "subcommand", required: true }],
  subcommands: ["install"],
  flags: [
    {
      name: "chain",
      type: "string",
      summary: "repo-relative script the hook runs first, propagating its exit",
    },
  ],
  examples: ["wikiwright hook install", "wikiwright hook install --chain scripts/hooks/pre-commit"],
  writes: true,
  needsVaultModules: true,
  plan: planForHook,
  run: (args) => {
    const vault = loadVault("hook", args.root);
    if (!vault.ok) return vault.result;
    const options = hookOptions(args);
    const chain = options.chain;
    // After the subcommand vocabulary and every refusal the installer makes
    // before it writes, and before the write itself.
    const refusal = hookFailure(inspectHook(args.root, options));
    if (refusal !== undefined) return refusal;
    if (isDryRun(args)) return ok("hook", planForHook(args));
    const outcome = installHook(args.root, options);
    const failure = hookFailure(outcome);
    if (failure !== undefined) return failure;
    const data: Record<string, unknown> = {
      paths: outcome.kind === "installed" ? outcome.paths : [],
      // The hook's own contract, said in the envelope: an agent reading this
      // should not have to open the script to learn when it does not block.
      fail_open: "when the wikiwright binary is absent (one line on stderr, exit 0)",
      fail_closed: "any non-zero exit of `wikiwright gate` when the binary is present",
    };
    if (typeof chain === "string" && chain.length > 0) data["chain"] = chain;
    return ok("hook", data);
  },
};
