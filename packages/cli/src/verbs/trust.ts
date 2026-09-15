// docs/cli.md §trust · this machine's content-hashed grants, for one vault or
// for one vault path in every linked worktree of one clone (D-006)
// docs/extending.md §Trust (a grant names a module package) · docs/architecture.md §Directories.

import { existsSync } from "node:fs";
import { codeUnitCompare } from "@wikiwright/core";
import { today } from "../clock.ts";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { runModuleFixture } from "../modulefixture.ts";
import { declaredModulesOf, loadDeclaredModules, moduleDigest } from "../moduleload.ts";
import { type CommandArgs, type CommandSpec, isDryRun, type Plan, planOf } from "../spec.ts";
import {
  dropGrant,
  dropRecord,
  dropWorktreeGrants,
  GRANT_SCOPES,
  type GrantScope,
  grantFor,
  isWorktreeGrant,
  putGrant,
  putWorktreeGrant,
  readTrustStore,
  recordId,
  TrustStoreBusy,
  trustFilePath,
  updateTrustStore,
  vaultKey,
  type WorktreeScope,
  worktreeGrantsFor,
  worktreeScopeOf,
} from "../trust.ts";

const MODULE_PREFIX = "module:";

/** `module:<package>` → `<package>`, or undefined when the name is not one. */
function moduleNameOf(grantPath: string | undefined): string | undefined {
  if (typeof grantPath !== "string" || !grantPath.startsWith(MODULE_PREFIX)) return undefined;
  const name = grantPath.slice(MODULE_PREFIX.length);
  return name.length === 0 ? undefined : name;
}

function scopeFlag(args: CommandArgs): GrantScope {
  return args.flags["scope"] === "worktrees" ? "worktrees" : "vault";
}

/** The worktree-scope target, in words a plan can print without asking git. */
const SHARED_TARGET = "this vault's path in every linked worktree of its repository";

/**
 * docs/cli.md §The dry-run law: the target is the MACHINE-LOCAL store, not the vault, so
 * the plan's path is absolute — a reader of the plan must be able to see that
 * the write lands outside the repository they are looking at.
 */
function planForTrust(args: CommandArgs): Plan {
  const [action, grantPath] = args.positionals;
  if (action !== "grant" && action !== "revoke") return planOf([]);
  const record = args.flags["record"];
  if (action === "revoke" && typeof record === "string" && record !== "") {
    return planOf([
      {
        kind: "write",
        path: trustFilePath(),
        summary: `revoke the record ${record} from this machine's store`,
      },
    ]);
  }
  if (moduleNameOf(grantPath) === undefined) return planOf([]);
  const shared = scopeFlag(args) === "worktrees";
  let summary: string;
  if (action === "grant") {
    summary = `grant ${grantPath} for ${shared ? SHARED_TARGET : "this vault"}, pinned to its current sha256`;
  } else {
    summary = shared
      ? `revoke every digest of ${grantPath} approved for ${SHARED_TARGET}`
      : `revoke the grant for ${grantPath} in this vault`;
  }
  return planOf([{ kind: "write", path: trustFilePath(), summary }]);
}

/**
 * A store another process holds is a named refusal, not an unexpected error:
 * the answer is to run again once that write finishes.
 */
function storeBusy(error: unknown): CommandResult {
  if (!(error instanceof TrustStoreBusy)) throw error;
  return fail("trust", "conflict", "store-busy", error.message, {
    hint: "another wikiwright process is updating this machine's trust store; run the command again once it finishes",
  });
}

/** One refusal for an identity the store does not hold, whoever asked. */
function noSuchRecord(record: string): CommandResult {
  return fail(
    "trust",
    "not_found",
    "grant-not-found",
    `this machine's store holds no record ${record}`,
    { hint: "`trust list --all` prints the identity of every record in the store" },
  );
}

function scopeUnresolved(error: unknown): CommandResult {
  return fail(
    "trust",
    "conflict",
    "scope-unresolved",
    `this vault's git worktree identity could not be read: ${error instanceof Error ? error.message : String(error)}`,
    {
      hint: "a worktree-scope grant is keyed by the git common directory of the vault's checkout; grant from inside that checkout, or grant this vault alone",
    },
  );
}

export const trustCommand: CommandSpec = {
  name: "trust",
  role: "maintainer",
  summary: "Grant, list, or revoke this machine's content-hashed module grants.",
  positionals: [
    { name: "subcommand", required: true },
    { name: "module", required: false },
  ],
  subcommands: ["grant", "list", "revoke"],
  flags: [
    {
      name: "scope",
      type: "string",
      summary:
        "vault (the default): this vault alone; worktrees: this vault's path in every linked worktree of its repository",
    },
    {
      name: "all",
      type: "boolean",
      summary:
        "list every record in this machine's store, not only the ones that apply to this vault",
    },
    {
      name: "record",
      type: "string",
      summary:
        "revoke exactly the record of this identity, as `list --all` prints it; it needs neither a vault nor a repository",
    },
  ],
  examples: [
    "wikiwright trust grant module:@acme/kit",
    "wikiwright trust grant module:@acme/kit --scope worktrees",
    "wikiwright trust list",
    "wikiwright trust list --all",
    "wikiwright trust revoke module:@acme/kit",
    "wikiwright trust revoke --record 4f9c1a2b3d5e",
  ],
  writes: true,
  needsVaultModules: false,
  plan: planForTrust,
  run: async (args) => {
    const [action, grantPath] = args.positionals;
    const rawScope = args.flags["scope"];
    if (rawScope !== undefined && !(GRANT_SCOPES as readonly unknown[]).includes(rawScope)) {
      return fail(
        "trust",
        "usage",
        "invalid-scope",
        `--scope must be one of ${GRANT_SCOPES.join(", ")}`,
        { details: { flag: "scope", valid_values: [...GRANT_SCOPES] } },
      );
    }
    const scope = scopeFlag(args);
    const recordFlag = args.flags["record"];
    const byRecord = typeof recordFlag === "string" && recordFlag !== "";
    if (byRecord && action !== "revoke") {
      return fail(
        "trust",
        "usage",
        "invalid-arguments",
        "--record names a record to revoke, and no other subcommand takes it",
        { details: { flag: "record", valid_with: ["revoke"] } },
      );
    }
    if (byRecord && (rawScope !== undefined || grantPath !== undefined)) {
      return fail(
        "trust",
        "usage",
        "invalid-arguments",
        "--record names one stored record, which carries its own scope and module",
        { details: { flag: "record", conflicts_with: ["scope", "module"] } },
      );
    }
    // A record revocation names the record, not a vault: the path the record is
    // keyed by may be gone, which is the one reason to name it that way.
    let vault = "";
    if (!byRecord) {
      try {
        vault = vaultKey(args.root);
      } catch {
        return fail("trust", "not_found", "root-not-found", `no directory at "${args.root}"`);
      }
    }
    const rank = (s: GrantScope): number => GRANT_SCOPES.indexOf(s);
    if (action === "list") {
      const store = readTrustStore();
      // The whole store, not this vault's share of it: a record keyed by a path
      // that is gone applies to nothing and can be named only by its identity,
      // so an inventory is the one place it is visible.
      if (args.flags["all"] === true) {
        const records = store.grants
          .map((grant) => {
            const shared = isWorktreeGrant(grant);
            return {
              record: recordId(grant),
              module: grant.path,
              scope: (shared ? "worktrees" : "vault") as GrantScope,
              ...(shared
                ? { common_dir: grant.common_dir, vault_path: grant.vault_path }
                : { vault: grant.vault }),
              sha256: grant.sha256,
              granted: grant.granted,
              keyed_path_present: existsSync(shared ? grant.common_dir : grant.vault),
            };
          })
          .filter((row) => rawScope === undefined || row.scope === scope)
          .sort(
            (a, b) =>
              codeUnitCompare(a.module, b.module) ||
              rank(a.scope) - rank(b.scope) ||
              codeUnitCompare(a.record, b.record),
          );
        if (isDryRun(args)) return ok("trust", planOf([]));
        return ok("trust", { store: trustFilePath(), vault, records });
      }
      // docs/extending.md §Trust: a grant is current while the installed package's
      // digest is the one it was pinned to — the same digest the loader reads.
      const digests = new Map<string, string | undefined>();
      const statusOf = (path: string, sha256: string): "current" | "modified" | "missing" => {
        const name = moduleNameOf(path);
        if (!digests.has(path)) {
          digests.set(path, name === undefined ? undefined : moduleDigest(args.root, name)?.sha256);
        }
        const installed = digests.get(path);
        if (installed === undefined) return "missing";
        return installed === sha256 ? "current" : "modified";
      };
      const rows: {
        path: string;
        scope: GrantScope;
        sha256: string;
        granted: string;
        status: string;
      }[] = [];
      for (const g of store.grants) {
        if (isWorktreeGrant(g) || g.vault !== vault) continue;
        rows.push({
          path: g.path,
          scope: "vault",
          sha256: g.sha256,
          granted: g.granted,
          status: statusOf(g.path, g.sha256),
        });
      }
      // The worktree scope is read when the listing names it, and otherwise
      // only when the store holds a worktree grant; `--scope vault` never asks
      // git. A listing that named the worktree scope and cannot read it is
      // refused, as a grant or a revoke is; the default listing reports the
      // failure beside the vault grants it read.
      let worktree: WorktreeScope | { error: string } | null = null;
      const asksShared =
        rawScope === "worktrees" || (rawScope === undefined && store.grants.some(isWorktreeGrant));
      if (asksShared) {
        try {
          worktree = worktreeScopeOf(args.root);
        } catch (error) {
          if (rawScope === "worktrees") return scopeUnresolved(error);
          worktree = { error: error instanceof Error ? error.message : String(error) };
        }
      }
      if (worktree !== null && !("error" in worktree)) {
        const shared = worktree;
        for (const g of store.grants) {
          if (!isWorktreeGrant(g) || g.common_dir !== shared.common_dir) continue;
          if (g.vault_path !== shared.vault_path) continue;
          rows.push({
            path: g.path,
            scope: "worktrees",
            sha256: g.sha256,
            granted: g.granted,
            status: statusOf(g.path, g.sha256),
          });
        }
      }
      const listed = rows
        .filter((r) => rawScope === undefined || r.scope === scope)
        .sort(
          (a, b) =>
            codeUnitCompare(a.path, b.path) ||
            rank(a.scope) - rank(b.scope) ||
            codeUnitCompare(a.granted, b.granted) ||
            codeUnitCompare(a.sha256, b.sha256),
        );
      // `trust list` writes nothing, and the flag is registry-rendered for the
      // whole verb — so it is ANSWERED with an empty plan rather than ignored.
      if (isDryRun(args)) return ok("trust", planOf([]));
      return ok("trust", {
        store: trustFilePath(),
        vault,
        worktree_scope: worktree,
        grants: listed,
      });
    }
    if (byRecord) {
      // The identity is checked BEFORE the dry run answers: a plan that names a
      // write the real run would refuse is a plan for something that cannot
      // happen. The authoritative lookup is still the one under the lock.
      const recorded = readTrustStore().grants.some((grant) => recordId(grant) === recordFlag);
      if (!recorded) return noSuchRecord(recordFlag);
      if (isDryRun(args)) return ok("trust", planForTrust(args));
      let removed: { module: string; scope: GrantScope } | undefined;
      try {
        removed = updateTrustStore((current) => {
          const found = current.grants.find((grant) => recordId(grant) === recordFlag);
          if (found === undefined) return { result: undefined };
          return {
            store: dropRecord(current, recordFlag),
            result: {
              module: found.path,
              scope: (isWorktreeGrant(found) ? "worktrees" : "vault") as GrantScope,
            },
          };
        });
      } catch (error) {
        return storeBusy(error);
      }
      if (removed === undefined) return noSuchRecord(recordFlag);
      return ok("trust", {
        revoked: removed.module,
        record: recordFlag,
        scope: removed.scope,
        removed: 1,
      });
    }
    // docs/extending.md §Trust: a MODULE is a package the bundle resolves, not
    // a file inside it, so it is named `module:<package>` and its digest is the
    // package's own bytes rather than one file's. A grant is machine-local, and
    // `git pull` can never write one.
    const name = moduleNameOf(grantPath);
    if (name === undefined) {
      return fail(
        "trust",
        "usage",
        "missing-argument",
        `trust ${action} requires module:<package>`,
      );
    }
    const key = `${MODULE_PREFIX}${name}`;
    let shared: WorktreeScope | undefined;
    if (scope === "worktrees") {
      try {
        shared = worktreeScopeOf(args.root);
      } catch (error) {
        return scopeUnresolved(error);
      }
    }
    if (action === "revoke") {
      const store = readTrustStore();
      if (shared === undefined) {
        if (grantFor(store, vault, key) === undefined) {
          return fail("trust", "not_found", "grant-not-found", `no grant for ${key}`);
        }
        // After the action vocabulary and the missing grant, and before the
        // machine-local write.
        if (isDryRun(args)) return ok("trust", planForTrust(args));
        let dropped: boolean;
        try {
          dropped = updateTrustStore((current) =>
            grantFor(current, vault, key) === undefined
              ? { result: false }
              : { store: dropGrant(current, vault, key), result: true },
          );
        } catch (error) {
          return storeBusy(error);
        }
        if (!dropped) return fail("trust", "not_found", "grant-not-found", `no grant for ${key}`);
        return ok("trust", { revoked: key, scope: "vault", vault });
      }
      const approved = worktreeGrantsFor(store, shared, key);
      if (approved.length === 0) {
        return fail(
          "trust",
          "not_found",
          "grant-not-found",
          `no worktree-scope grant for ${key} at "${shared.vault_path}" in the worktrees of ${shared.common_dir}`,
        );
      }
      if (isDryRun(args)) return ok("trust", planForTrust(args));
      // The installed digest is read BEFORE the store is written: a revocation
      // that has written must not then fail. A module whose bytes cannot be
      // read is approved by nothing.
      let installed: string | undefined;
      try {
        installed = moduleDigest(args.root, name)?.sha256;
      } catch {
        installed = undefined;
      }
      // What the envelope reports is read under the same lock as the write, so
      // it describes the store this revocation actually left behind.
      let outcome: { removed: number; surviving: string | undefined } | undefined;
      try {
        outcome = updateTrustStore((current) => {
          const applicable = worktreeGrantsFor(current, shared, key);
          if (applicable.length === 0) return { result: undefined };
          return {
            store: dropWorktreeGrants(current, shared, key),
            result: {
              removed: applicable.length,
              surviving: grantFor(current, vault, key)?.sha256,
            },
          };
        });
      } catch (error) {
        return storeBusy(error);
      }
      if (outcome === undefined) {
        return fail(
          "trust",
          "not_found",
          "grant-not-found",
          `no worktree-scope grant for ${key} at "${shared.vault_path}" in the worktrees of ${shared.common_dir}`,
        );
      }
      return ok("trust", {
        revoked: key,
        scope: "worktrees",
        worktree_scope: shared,
        removed: outcome.removed,
        still_authorized_by:
          outcome.surviving !== undefined &&
          installed !== undefined &&
          outcome.surviving === installed
            ? "vault"
            : null,
      });
    }
    const digest = moduleDigest(args.root, name);
    if (digest === undefined) {
      return fail(
        "trust",
        "not_found",
        "module-not-found",
        `"${name}" is not installed in this bundle`,
        { hint: "install the module (workspace, `file:` or a local tarball), then grant it" },
      );
    }
    if (digest.violations.length > 0) {
      // docs/extending.md §The determinism fixture: the purity scan runs BEFORE a grant, not only before
      // a load. Granting a module the engine would refuse anyway is a grant
      // that reads as approval and buys nothing.
      return fail(
        "trust",
        "findings",
        "module-impure",
        `"${name}" reaches for state a verdict may not depend on: ${digest.violations
          .slice(0, 3)
          .map((v) => `${v.file}:${v.line} ${v.reason}`)
          .join("; ")}`,
        { hint: "a module's verdict is a function of the page it is handed" },
      );
    }
    // docs/extending.md §The determinism fixture: the fixture runs ONCE, here, on the bytes the grant pins.
    // Every later load under this digest is the same proof, so a vault read does
    // not run it again; a module that fails its own fixture is not granted.
    const declaration = declaredModulesOf(args.root).find((d) => d.package === name) ?? {
      package: name,
    };
    const loaded = await loadDeclaredModules(args.root, [declaration], { beforeGrant: true });
    const issue = loaded.issues[0];
    if (issue !== undefined) {
      return fail("trust", "constitution", issue.code, issue.message, {
        ...(issue.hint === undefined ? {} : { hint: issue.hint }),
        data: { issues: loaded.issues },
      });
    }
    const module = loaded.loaded[0];
    if (module === undefined) {
      return fail("trust", "not_found", "module-not-found", `"${name}" did not load`);
    }
    const proved = runModuleFixture(module);
    if (!proved.ok) {
      return fail("trust", "constitution", "module-fixture-failed", proved.issue.message, {
        hint: "a module ships input bytes and the findings they must produce; a grant approves a module the engine proved on this machine",
        data: { issue: proved.issue },
      });
    }
    // After the missing module, the impurity and the fixture, and before the
    // machine-local write.
    if (isDryRun(args)) return ok("trust", planForTrust(args));
    const record = { path: key, sha256: digest.sha256, granted: today() };
    try {
      updateTrustStore((current) => ({
        store:
          shared === undefined
            ? putGrant(current, { vault, ...record })
            : putWorktreeGrant(current, {
                scope: "worktrees",
                common_dir: shared.common_dir,
                vault_path: shared.vault_path,
                ...record,
              }),
        result: undefined,
      }));
    } catch (error) {
      return storeBusy(error);
    }
    return ok("trust", {
      granted: key,
      scope,
      ...(shared === undefined ? { vault } : { worktree_scope: shared }),
      sha256: digest.sha256,
      files: digest.files.length,
      fixture: proved.result,
      statement:
        shared === undefined
          ? "granted module code runs inside the judge whenever this vault is judged; changing any of its files, or moving the vault, revokes"
          : `granted module code runs inside the judge whenever the vault at "${shared.vault_path}" in any linked worktree of ${shared.common_dir} is judged with exactly these bytes; changed bytes need their own approval, and moving the repository's common directory revokes`,
    });
  },
};
