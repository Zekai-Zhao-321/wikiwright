// docs/cli.md §bundles (connect a vault by name in this machine's registry,
// list the connections with the identity of each, remove one) · docs/cli.md
// §The dry-run law (the plan names the machine-local registry, absolute).
//
// A consumer verb that writes: the registry is machine-local and outside every
// vault, so connecting a bundle changes no bundle and grants nothing. It loads
// no law and no module — `list` is discovery, and a bundle whose modules this
// machine has not approved still lists, with its identity.
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { codeUnitCompare, isContentPath, PATH_REFUSALS, pathRefusal } from "@wikiwright/core";
import { bundleIdentity, contentRootsAt } from "../bundle.ts";
import {
  bundlesFilePath,
  type Connection,
  type ConnectionStore,
  KINDS,
  type Kind,
  NAME_PATTERN,
  readConnections,
  updateConnections,
} from "../connections.ts";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { vaultReadAbsolute } from "../paths.ts";
import { type CommandArgs, type CommandSpec, isDryRun, type Plan, planOf } from "../spec.ts";
import { StoreBusy } from "../storelock.ts";
import { CONSTITUTION_PATH } from "../vaultfiles.ts";

/** A connection as `list` prints it: the record, where it resolves, and what is there. */
interface Row {
  name: string;
  root: string;
  realpath: string | null;
  present: boolean;
  kind: Kind;
  feedback: string | null;
  guide: string | null;
  identity: {
    label: string;
    head: string | null;
    dirty: boolean | null;
    law: string;
    content: string;
  } | null;
}

function realpathOf(root: string): string | null {
  try {
    return realpathSync(root);
  } catch {
    return null;
  }
}

/**
 * docs/cli.md §bundles: one connection with the identity the envelope's bundle
 * block carries, read without loading the law. `identity` is null when the root
 * is not present, or when its identity cannot be read inside it.
 */
function rowOf(connection: Connection): Row {
  const realpath = realpathOf(connection.root);
  const present = realpath !== null && existsSync(join(connection.root, CONSTITUTION_PATH));
  let identity: Row["identity"] = null;
  if (present) {
    try {
      const bundle = bundleIdentity(connection.root);
      if (bundle !== undefined) {
        const { label, head, dirty, law, content } = bundle;
        identity = { label, head, dirty, law, content };
      }
    } catch {
      identity = null;
    }
  }
  return {
    name: connection.name,
    root: connection.root,
    realpath,
    present,
    kind: connection.kind,
    feedback: connection.feedback,
    guide: connection.guide,
    identity,
  };
}

function names(store: ConnectionStore): string[] {
  return store.bundles.map((b) => b.name).sort(codeUnitCompare);
}

function notFound(name: string, store: ConnectionStore): CommandResult {
  return fail("bundles", "not_found", "bundle-not-found", `no bundle is connected as "${name}"`, {
    details: { valid_values: names(store) },
    hint: "`bundles list` names every connection on this machine",
  });
}

/** A registry another process holds is a named refusal: run again once that write finishes. */
function storeBusy(error: unknown): CommandResult {
  if (!(error instanceof StoreBusy)) throw error;
  return fail("bundles", "conflict", "store-busy", error.message, {
    hint: "another wikiwright process is updating this machine's bundles registry; run the command again once it finishes",
  });
}

/** Why `connection` cannot join `store`: its name is taken, or its root is connected already. */
function conflictOf(
  store: ConnectionStore,
  connection: Connection,
  realpath: string,
): CommandResult | undefined {
  const named = store.bundles.find((b) => b.name === connection.name);
  if (named !== undefined) {
    return fail(
      "bundles",
      "conflict",
      "bundle-name-taken",
      `a bundle is already connected as "${connection.name}", at ${named.root}`,
      {
        details: { name: named.name, root: named.root },
        hint: "choose another name, or `bundles remove` the existing connection first",
      },
    );
  }
  const same = store.bundles.find((b) => realpathOf(b.root) === realpath);
  if (same !== undefined) {
    return fail(
      "bundles",
      "conflict",
      "bundle-root-registered",
      `${realpath} is already connected as "${same.name}"`,
      {
        details: { name: same.name, root: same.root, realpath },
        hint: "one root has one name on this machine; use the connected name",
      },
    );
  }
  return undefined;
}

/** A flag's text, or null when absent or empty. */
function textFlag(args: CommandArgs, name: string): string | null {
  const value = args.flags[name];
  return typeof value === "string" && value !== "" ? value : null;
}

/** The connection `add` would record, or the refusal the real run would reach before writing. */
function connectionOf(
  args: CommandArgs,
): { ok: true; connection: Connection; realpath: string } | { ok: false; result: CommandResult } {
  const target = args.positionals[1];
  if (target === undefined) {
    return {
      ok: false,
      result: fail("bundles", "usage", "missing-argument", "`bundles add` needs a vault root", {
        details: { expected_positionals: ["subcommand", "target"] },
      }),
    };
  }
  const name = args.flags["name"];
  if (typeof name !== "string") {
    return {
      ok: false,
      result: fail("bundles", "usage", "missing-argument", "`bundles add` needs --name", {
        details: { flag: "name" },
      }),
    };
  }
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      result: fail("bundles", "usage", "bundle-name-invalid", `"${name}" is not a bundle name`, {
        details: { name, pattern: NAME_PATTERN.source },
        hint: "lower-case letters, digits and hyphens, a letter or digit first, at most 64 characters",
      }),
    };
  }
  const rawKind = args.flags["kind"];
  if (rawKind !== undefined && !(KINDS as readonly unknown[]).includes(rawKind)) {
    return {
      ok: false,
      result: fail(
        "bundles",
        "usage",
        "invalid-kind",
        `--kind must be one of ${KINDS.join(", ")}`,
        {
          details: { flag: "kind", valid_values: [...KINDS] },
        },
      ),
    };
  }
  const root = resolve(target);
  if (!existsSync(join(root, CONSTITUTION_PATH))) {
    return {
      ok: false,
      result: fail("bundles", "not_found", "vault-not-found", `no vault at "${target}"`, {
        hint: `a bundle's root is the directory that holds ${CONSTITUTION_PATH}`,
      }),
    };
  }
  const guide = textFlag(args, "guide");
  if (guide !== null) {
    const refusal = pathRefusal(guide);
    let found = false;
    if (refusal === undefined) {
      try {
        found = statSync(vaultReadAbsolute(root, guide)).isFile();
      } catch {
        found = false;
      }
    }
    if (!found) {
      return {
        ok: false,
        result: fail(
          "bundles",
          "not_found",
          "guide-not-found",
          refusal === undefined
            ? `--guide "${guide}" names no file under ${root}`
            : `--guide "${guide}" is not a vault path: it ${PATH_REFUSALS[refusal]}`,
          { hint: "--guide is a page's path relative to the bundle's root" },
        ),
      };
    }
    // The guide is what a consumer is told to read first, and `read` returns
    // a Markdown page under a content root and nothing else; a file that is
    // not one would be advertised at every session start and never open.
    const roots = contentRootsAt(root) ?? [];
    if (!isContentPath(guide, roots)) {
      return {
        ok: false,
        result: fail(
          "bundles",
          "usage",
          "guide-not-a-page",
          `--guide "${guide}" is not a page: a guide is a .md file under a content root`,
          {
            details: { guide, content_roots: [...roots] },
            hint: "name a page `read` can return: a Markdown file under one of details.content_roots, as config/engine.json declares them",
          },
        ),
      };
    }
  }
  return {
    ok: true,
    connection: {
      name,
      root,
      kind: (rawKind as Kind | undefined) ?? "maintained",
      feedback: textFlag(args, "feedback"),
      guide,
    },
    realpath: realpathSync(root),
  };
}

/**
 * docs/cli.md §The dry-run law: the registry is machine-local, so the plan's
 * path is absolute — a reader of the plan sees that the write lands outside
 * every vault. `list` writes nothing and plans nothing.
 */
function planForBundles(args: CommandArgs): Plan {
  const [action, target] = args.positionals;
  const file = bundlesFilePath();
  const kind = existsSync(file) ? ("write" as const) : ("create" as const);
  if (action === "add" && target !== undefined) {
    const name = String(args.flags["name"] ?? "");
    return planOf([
      { kind, path: file, summary: `connect ${resolve(target)} as "${name}" on this machine` },
    ]);
  }
  if (action === "remove" && target !== undefined) {
    return planOf([
      { kind: "write", path: file, summary: `remove the connection "${target}" from this machine` },
    ]);
  }
  return planOf([]);
}

function add(args: CommandArgs): CommandResult {
  const built = connectionOf(args);
  if (!built.ok) return built.result;
  const { connection, realpath } = built;
  // Checked BEFORE the dry run answers, so a plan never names a write the real
  // run would refuse; the authoritative check is the one under the lock.
  const conflict = conflictOf(readConnections(), connection, realpath);
  if (conflict !== undefined) return conflict;
  if (isDryRun(args)) return ok("bundles", planForBundles(args));
  let refused: CommandResult | undefined;
  try {
    refused = updateConnections((store) => {
      const late = conflictOf(store, connection, realpath);
      if (late !== undefined) return { result: late };
      return { store: { ...store, bundles: [...store.bundles, connection] }, result: undefined };
    });
  } catch (error) {
    return storeBusy(error);
  }
  if (refused !== undefined) return refused;
  return ok("bundles", { registry: bundlesFilePath(), added: rowOf(connection) });
}

function remove(args: CommandArgs): CommandResult {
  const name = args.positionals[1];
  if (name === undefined) {
    return fail("bundles", "usage", "missing-argument", "`bundles remove` needs a bundle name", {
      details: { expected_positionals: ["subcommand", "target"] },
    });
  }
  const current = readConnections();
  if (!current.bundles.some((b) => b.name === name)) return notFound(name, current);
  if (isDryRun(args)) return ok("bundles", planForBundles(args));
  let outcome: { removed: Connection } | { missing: ConnectionStore };
  try {
    outcome = updateConnections<{ removed: Connection } | { missing: ConnectionStore }>((store) => {
      const found = store.bundles.find((b) => b.name === name);
      if (found === undefined) return { result: { missing: store } };
      return {
        store: { ...store, bundles: store.bundles.filter((b) => b.name !== name) },
        result: { removed: found },
      };
    });
  } catch (error) {
    return storeBusy(error);
  }
  if ("missing" in outcome) return notFound(name, outcome.missing);
  return ok("bundles", {
    registry: bundlesFilePath(),
    removed: { name, root: outcome.removed.root },
  });
}

export const bundlesCommand: CommandSpec = {
  name: "bundles",
  role: "consumer",
  summary:
    "Connect a vault by name in this machine's registry, list the connections with their identity, or remove one.",
  positionals: [
    { name: "subcommand", required: true },
    { name: "target", required: false },
  ],
  subcommands: ["add", "list", "remove"],
  flags: [
    { name: "name", type: "string", summary: "with `add`: the name the bundle is connected as" },
    {
      name: "kind",
      type: "string",
      summary: "with `add`: maintained (the default) | installed, a copy that is read only",
    },
    {
      name: "feedback",
      type: "string",
      summary: "with `add`: where a problem with this bundle is reported",
    },
    {
      name: "guide",
      type: "string",
      summary:
        "with `add`: the page to read first, a page under a content root, relative to the bundle's root",
    },
  ],
  examples: [
    "wikiwright bundles list",
    "wikiwright bundles add ../handbooks/orchard --name orchard --guide wiki/start-here.md",
    'wikiwright bundles add /srv/handbooks/allotment --name allotment --kind installed --feedback "send a proposal to the handbook\'s maintainers"',
    "wikiwright bundles remove allotment",
  ],
  writes: true,
  needsVaultModules: false,
  plan: planForBundles,
  run: (args) => {
    const [action] = args.positionals;
    if (action === "add") return add(args);
    if (action === "remove") return remove(args);
    // `list` writes nothing, and the flag is registry-rendered for the whole
    // verb — so it is ANSWERED with an empty plan rather than ignored.
    if (isDryRun(args)) return ok("bundles", planOf([]));
    const rows = [...readConnections().bundles]
      .sort((a, b) => codeUnitCompare(a.name, b.name))
      .map((connection) => rowOf(connection));
    return ok("bundles", { registry: bundlesFilePath(), bundles: rows });
  },
};
