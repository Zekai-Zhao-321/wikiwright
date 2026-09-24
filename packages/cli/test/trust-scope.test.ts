// docs/cli.md §trust: a grant records exact module bytes for one vault, or,
// when a maintainer chooses the worktree scope, for one vault path in every
// linked worktree of one clone. The shared scope is keyed by the repository's
// git common directory and the vault's path inside its worktree, spelled as the
// filesystem spells it.
//
// The load no longer reads a grant: installing a module is the consent to run
// it, and the load proves the module's bytes itself. What stays here until the
// verb goes is the store the verb reads and writes.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { moduleDigest } from "../src/moduleload.ts";
import { scopeKeyFrom } from "../src/trust.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFORMANCE = join(REPO_ROOT, "fixtures", "conformance");
const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const MODULE = "@wikiwright-fixture/probe";
const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), "ww-trust-scope-")));

/** The shipped fixture's bytes, so a case that writes through to the tree fails by name. */
const SHIPPED = join(CONFORMANCE, "module-fixture", "index.js");
const SHIPPED_BEFORE = readFileSync(SHIPPED, "utf8");
after(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  assert.equal(
    readFileSync(SHIPPED, "utf8"),
    SHIPPED_BEFORE,
    "this suite wrote to the shipped fixture — a test may not write to the tree it tests",
  );
});

/** POSIX-only cases drive `sh` hooks and names Windows cannot spell. */
const WINDOWS = process.platform === "win32";
const SLOW = { timeout: 60_000 };

/** git's variables a hook exports; every git and CLI call here starts without them. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) {
    delete env[key];
  }
  return env;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: cleanEnv() }).trim();
}

/**
 * The conformance bundle with its module installed once; every case copies it.
 * The module is copied into `node_modules` as bytes, which is what installing a
 * `file:` dependency with no dependencies of its own lands. Run from a test
 * process, the package manager's install can leave a link back to the shipped
 * fixture, and editing one vault's module would then write the tree.
 */
const BASE = (() => {
  const dir = join(SCRATCH, "base");
  // Whatever a package manager left in the shipped bundle's `node_modules` is
  // left behind: a link there resolves differently on another machine, and
  // copying it either carries the link in or fails on one that dangles.
  cpSync(join(CONFORMANCE, "bundle-a"), dir, {
    recursive: true,
    dereference: true,
    filter: (src) => basename(src) !== "node_modules",
  });
  const manifest = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
    dependencies: Record<string, string>;
  };
  pkg.dependencies[MODULE] = `file:${join(CONFORMANCE, "module-fixture")}`;
  writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
  cpSync(join(CONFORMANCE, "module-fixture"), join(dir, "node_modules", ...MODULE.split("/")), {
    recursive: true,
    dereference: true,
  });
  return dir;
})();

let serial = 0;
const fresh = (name: string): string => join(SCRATCH, `${name}-${++serial}`);
const storeFile = (): string => join(fresh("trust"), "trust.json");

/** A repository holding the bundle at `vaultDir`, committed, its module installed and untracked. */
function repository(vaultDir = "vault"): { repo: string; vault: string } {
  const repo = fresh("repo");
  mkdirSync(repo, { recursive: true });
  cpSync(BASE, join(repo, vaultDir), { recursive: true, dereference: true });
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "seed");
  return { repo, vault: join(repo, vaultDir) };
}

/** A linked worktree of `repo`, with the module installed as a session's setup would. */
function worktree(repo: string, name: string, ...options: string[]): string {
  const path = fresh(name);
  git(repo, "worktree", "add", "-q", ...options, path);
  install(join(path, "vault"));
  return path;
}

function install(vault: string): void {
  cpSync(join(BASE, "node_modules"), join(vault, "node_modules"), {
    recursive: true,
    dereference: true,
  });
}

/** Change one byte of the installed module, so its digest moves and its fixture still passes. */
function edit(vault: string, note = "edited after the grant"): void {
  const entry = join(vault, "node_modules", "@wikiwright-fixture", "probe", "index.js");
  const real = realpathSync(entry);
  assert.equal(
    real.startsWith(realpathSync(CONFORMANCE)),
    false,
    `edit would write the shipped fixture through ${entry} -> ${real}`,
  );
  writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// ${note}\n`);
}

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

function cli(
  root: string,
  argv: readonly string[],
  store: string,
  env: NodeJS.ProcessEnv = {},
): { status: number; envelope: Envelope } {
  const r = spawnSync(CLI_RUNTIME, [CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...cleanEnv(), ...PINNED_CLOCK, WIKIWRIGHT_TRUST_FILE: store, ...env },
  });
  try {
    return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
  } catch {
    throw new Error(`no envelope from ${argv.join(" ")}: ${r.stdout}${r.stderr}`);
  }
}

function grant(root: string, store: string, scope?: "vault" | "worktrees"): Envelope {
  const argv = ["trust", "grant", `module:${MODULE}`, ...(scope ? ["--scope", scope] : [])];
  const r = cli(root, argv, store);
  assert.equal(r.envelope.ok, true, JSON.stringify(r.envelope));
  return r.envelope;
}

interface StoredGrant {
  vault?: string;
  scope?: string;
  common_dir?: string;
  vault_path?: string;
  path: string;
  sha256: string;
}

function stored(store: string): { schema_version: number; grants: StoredGrant[] } {
  return JSON.parse(readFileSync(store, "utf8")) as {
    schema_version: number;
    grants: StoredGrant[];
  };
}

describe("the vault scope is the grant this engine always had", () => {
  it("a vault grant is keyed by the vault's real path, in the 0.1.0 shape", SLOW, () => {
    const store = storeFile();
    const { vault } = repository();
    grant(vault, store);
    const [record] = stored(store).grants;
    assert.equal(record?.vault, realpathSync(vault));
    assert.equal("scope" in (record ?? {}), false, "a vault grant keeps the 0.1.0 shape");
  });

  it("a vault re-grant replaces its digest, as it always has", SLOW, () => {
    const store = storeFile();
    const { vault } = repository();
    grant(vault, store);
    edit(vault);
    grant(vault, store);
    const grants = stored(store).grants;
    assert.equal(grants.length, 1, JSON.stringify(grants));
  });
});

describe("a worktree-scope grant approves one vault path in every linked worktree of a clone", () => {
  it(
    "the store keys the scope by git common directory and vault path, with no vault field",
    SLOW,
    () => {
      const store = storeFile();
      const { repo, vault } = repository();
      grant(vault, store, "worktrees");
      const written = stored(store);
      assert.equal(written.schema_version, 2);
      const [record] = written.grants;
      assert.equal(record?.scope, "worktrees");
      assert.equal(record?.common_dir, realpathSync(join(repo, ".git")));
      assert.equal(record?.vault_path, "vault");
      assert.equal(
        "vault" in (record ?? {}),
        false,
        "an older engine must not read it as a vault grant",
      );
    },
  );
});

describe("a grant stays tied to exact bytes", () => {
  it(
    "a grant of changed bytes keeps the other version, and the listing tells them apart",
    SLOW,
    () => {
      const store = storeFile();
      const { repo, vault } = repository();
      grant(vault, store, "worktrees");
      const wt = worktree(repo, "wt");
      edit(join(wt, "vault"));
      grant(join(wt, "vault"), store, "worktrees");
      const listed = cli(vault, ["trust", "list"], store);
      const rows = (listed.envelope.data?.["grants"] ?? []) as { scope: string; status: string }[];
      assert.deepEqual(rows.map((r) => `${r.scope}:${r.status}`).sort(), [
        "worktrees:current",
        "worktrees:modified",
      ]);
    },
  );
});

describe("git identity is read only when the verb names the worktree scope", () => {
  /** A `git` on PATH that logs each argv, so a case can count identity lookups. */
  function countingGit(): { env: NodeJS.ProcessEnv; lookups: () => number } {
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const bin = fresh("bin");
    mkdirSync(bin, { recursive: true });
    const log = join(bin, "git.log");
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${real}" "$@"\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    const env = { PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}` };
    const lookups = (): number =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((l) => l.includes("--git-common-dir")).length
        : 0;
    return { env, lookups };
  }

  it("a lookup that is needed and fails is an explicit refusal, not a quieter answer", SLOW, () => {
    const store = storeFile();
    const outside = fresh("outside");
    cpSync(BASE, outside, { recursive: true, dereference: true });
    mkdirSync(join(store, ".."), { recursive: true });
    writeFileSync(
      store,
      `${JSON.stringify({
        schema: "wikiwright/trust",
        schema_version: 2,
        grants: [
          {
            scope: "worktrees",
            common_dir: join(SCRATCH, "nowhere", ".git"),
            vault_path: "vault",
            path: `module:${MODULE}`,
            sha256: "0".repeat(64),
            granted: "2026-09-04",
          },
        ],
      })}\n`,
    );
    const refused = cli(
      outside,
      ["trust", "grant", `module:${MODULE}`, "--scope", "worktrees"],
      store,
    );
    assert.equal(
      refused.envelope.error?.["code"],
      "scope-unresolved",
      JSON.stringify(refused.envelope),
    );
    grant(outside, store);
  });

  it("a verb that reads no vault law asks git nothing, worktree grant or not", SLOW, () => {
    if (WINDOWS) return;
    const store = storeFile();
    const { vault } = repository();
    grant(vault, store, "worktrees");
    const counted = countingGit();
    // `trust` declares needsVaultModules: false, so nothing preloads the
    // bundle's modules to answer it and no scope is resolved.
    const listed = cli(vault, ["trust", "list", "--scope", "vault"], store, counted.env);
    assert.equal(listed.envelope.ok, true, JSON.stringify(listed.envelope));
    assert.equal(counted.lookups(), 0, "a trust listing preloaded the vault's modules");
  });

  it("a missing module is refused before any scope is written", SLOW, () => {
    const store = storeFile();
    const { vault } = repository();
    const r = cli(vault, ["trust", "grant", "module:@nope/kit", "--scope", "worktrees"], store);
    assert.equal(r.envelope.error?.["code"], "module-not-found", JSON.stringify(r.envelope));
    assert.equal(existsSync(store), false);
  });

  it(
    "a listing that names the worktree scope refuses when git cannot read it; a vault listing asks none",
    SLOW,
    () => {
      if (WINDOWS) return;
      const store = storeFile();
      const outside = fresh("outside");
      cpSync(BASE, outside, { recursive: true, dereference: true });
      grant(outside, store);
      const named = cli(outside, ["trust", "list", "--scope", "worktrees"], store);
      assert.equal(
        named.envelope.error?.["code"],
        "scope-unresolved",
        JSON.stringify(named.envelope),
      );
      const { vault } = repository();
      grant(vault, store, "worktrees");
      // Without --scope, the listing reports the failure beside the vault grants it read.
      const unnamed = cli(outside, ["trust", "list"], store);
      assert.equal(unnamed.envelope.ok, true, JSON.stringify(unnamed.envelope));
      const data = unnamed.envelope.data as {
        grants: { scope: string }[];
        worktree_scope: { error?: string };
      };
      assert.deepEqual(
        data.grants.map((g) => g.scope),
        ["vault"],
      );
      assert.equal(typeof data.worktree_scope.error, "string");
      // A matching vault grant lets the declared module load without git before
      // the verb runs, so every lookup counted below is the listing's own.
      grant(vault, store);
      const counted = countingGit();
      const vaultOnly = cli(vault, ["trust", "list", "--scope", "vault"], store, counted.env);
      assert.equal(vaultOnly.envelope.ok, true, JSON.stringify(vaultOnly.envelope));
      assert.equal(vaultOnly.envelope.data?.["worktree_scope"], null);
      assert.equal(counted.lookups(), 0, "--scope vault never asks git");
      const shared = cli(vault, ["trust", "list", "--scope", "worktrees"], store, counted.env);
      const rows = (shared.envelope.data?.["grants"] ?? []) as { scope: string; status: string }[];
      assert.deepEqual(
        rows.map((r) => `${r.scope}:${r.status}`),
        ["worktrees:current"],
      );
      assert.equal(counted.lookups(), 1);
    },
  );
});

describe("revocation and listing say which scope approves", () => {
  it(
    "a shared revocation removes every approved digest and says whether a vault grant still approves",
    SLOW,
    () => {
      const store = storeFile();
      const { repo, vault } = repository();
      grant(vault, store, "worktrees");
      const wt = worktree(repo, "wt");
      edit(join(wt, "vault"));
      grant(join(wt, "vault"), store, "worktrees");
      grant(vault, store);
      const revoked = cli(
        vault,
        ["trust", "revoke", `module:${MODULE}`, "--scope", "worktrees"],
        store,
      );
      assert.equal(revoked.envelope.ok, true, JSON.stringify(revoked.envelope));
      assert.equal(revoked.envelope.data?.["removed"], 2);
      assert.equal(revoked.envelope.data?.["still_authorized_by"], "vault");
      const again = cli(
        vault,
        ["trust", "revoke", `module:${MODULE}`, "--scope", "worktrees"],
        store,
      );
      assert.equal(again.envelope.error?.["code"], "grant-not-found");
    },
  );

  it(
    "a revocation that writes the store reports it, even when the module cannot be read",
    SLOW,
    () => {
      if (WINDOWS) return;
      const store = storeFile();
      const { vault } = repository();
      grant(vault, store, "worktrees");
      grant(vault, store);
      // The bundle stops declaring the module, so nothing loads it before the
      // verb runs, and a dangling link in the installed package leaves a digest
      // that can no longer be read: only the revocation itself reads it.
      const engine = join(vault, "config", "engine.json");
      const declared = JSON.parse(readFileSync(engine, "utf8")) as Record<string, unknown>;
      assert.notEqual(declared["modules"], undefined);
      delete declared["modules"];
      writeFileSync(engine, `${JSON.stringify(declared, null, 2)}\n`);
      const probe = join(vault, "node_modules", "@wikiwright-fixture", "probe");
      symlinkSync(fresh("nowhere"), join(probe, "dangling.js"));
      const before = readFileSync(store, "utf8");
      const revoked = cli(
        vault,
        ["trust", "revoke", `module:${MODULE}`, "--scope", "worktrees"],
        store,
      );
      const after = readFileSync(store, "utf8");
      assert.ok(
        revoked.envelope.ok || after === before,
        `the revocation failed after writing the store: ${JSON.stringify(revoked.envelope)}`,
      );
      assert.equal(revoked.envelope.ok, true, JSON.stringify(revoked.envelope));
      assert.equal(revoked.envelope.data?.["removed"], 1);
      assert.equal(revoked.envelope.data?.["still_authorized_by"], null);
      assert.deepEqual(
        stored(store).grants.map((g) => g.scope ?? "vault"),
        ["vault"],
      );
    },
  );

  it("trust list shows both scopes and the status of each against the installation", SLOW, () => {
    const store = storeFile();
    const { repo, vault } = repository();
    grant(vault, store);
    grant(vault, store, "worktrees");
    const listed = cli(vault, ["trust", "list"], store);
    const rows = (listed.envelope.data?.["grants"] ?? []) as { scope: string; status: string }[];
    assert.deepEqual(
      rows.map((r) => `${r.scope}:${r.status}`),
      ["vault:current", "worktrees:current"],
    );
    assert.deepEqual(listed.envelope.data?.["worktree_scope"], {
      common_dir: realpathSync(join(repo, ".git")),
      vault_path: "vault",
    });
  });

  it(
    "--dry-run for a worktree-scope grant or revoke writes nothing and names the scope",
    SLOW,
    () => {
      const store = storeFile();
      const { vault } = repository();
      grant(vault, store);
      const before = readFileSync(store, "utf8");
      for (const action of ["grant", "revoke"]) {
        if (action === "revoke") grant(vault, store, "worktrees");
        const snapshot = readFileSync(store, "utf8");
        const argv = ["trust", action, `module:${MODULE}`, "--scope", "worktrees", "--dry-run"];
        const planned = cli(vault, argv, store);
        assert.equal(planned.envelope.ok, true, JSON.stringify(planned.envelope));
        const ops = (planned.envelope.data?.["ops"] ?? []) as { path: string; summary: string }[];
        assert.equal(ops[0]?.path, store);
        assert.match(ops[0]?.summary ?? "", /linked worktree/u);
        assert.equal(readFileSync(store, "utf8"), snapshot, `${action} --dry-run wrote the store`);
      }
      assert.notEqual(before, "");
    },
  );

  it("an unknown scope is a usage error naming the valid ones", () => {
    const store = storeFile();
    const r = cli(BASE, ["trust", "grant", `module:${MODULE}`, "--scope", "everywhere"], store);
    assert.equal(r.envelope.error?.["code"], "invalid-scope", JSON.stringify(r.envelope));
    const details = (r.envelope.error?.["details"] ?? {}) as { valid_values?: string[] };
    assert.deepEqual(details.valid_values, ["vault", "worktrees"]);
  });
});

describe("the store keeps both record shapes, and an older engine reads it safely", () => {
  // 0.1.0's store functions, verbatim in behaviour (packages/cli/src/trust.ts at
  // 6b7b692): they match on `vault` and `path` and keep every record they do not
  // match. A worktree record must be invisible to them and survive their writes.
  type Old = { vault?: string; path: string; sha256: string; granted?: string };
  const oldGrantFor = (grants: Old[], vault: string, path: string): Old | undefined =>
    grants.find((g) => g.vault === vault && g.path === path);
  const oldPut = (grants: Old[], grant: Old): Old[] => [
    ...grants.filter((g) => !(g.vault === grant.vault && g.path === grant.path)),
    grant,
  ];
  const oldDrop = (grants: Old[], vault: string, path: string): Old[] =>
    grants.filter((g) => !(g.vault === vault && g.path === path));

  it("an older reader ignores worktree records and an older writer keeps them", SLOW, () => {
    const store = storeFile();
    const { vault } = repository();
    grant(vault, store, "worktrees");
    const shared = stored(store).grants;
    const key = realpathSync(vault);
    assert.equal(oldGrantFor(shared, key, `module:${MODULE}`), undefined);
    const afterPut = oldPut(shared, {
      vault: key,
      path: `module:${MODULE}`,
      sha256: "a".repeat(64),
    });
    const afterDrop = oldDrop(afterPut, key, `module:${MODULE}`);
    assert.deepEqual(afterDrop, shared, "the older writer round-trips the worktree record");
    writeFileSync(store, `${JSON.stringify({ ...stored(store), grants: afterPut })}\n`);
    const listed = cli(vault, ["trust", "list"], store);
    const rows = (listed.envelope.data?.["grants"] ?? []) as { scope: string; status: string }[];
    assert.deepEqual(
      rows.map((r) => `${r.scope}:${r.status}`),
      ["vault:modified", "worktrees:current"],
      "the newer reader reads both back",
    );
  });

  it("a record that is both shapes, or neither, is refused by name", () => {
    const store = storeFile();
    mkdirSync(join(store, ".."), { recursive: true });
    for (const record of [
      { vault: BASE, scope: "worktrees", common_dir: "/x/.git", vault_path: "vault" },
      { scope: "everywhere", common_dir: "/x/.git", vault_path: "vault" },
      { common_dir: "/x/.git" },
    ]) {
      writeFileSync(
        store,
        `${JSON.stringify({
          schema: "wikiwright/trust",
          schema_version: 2,
          grants: [{ ...record, path: `module:${MODULE}`, sha256: "0".repeat(64) }],
        })}\n`,
      );
      const r = cli(BASE, ["trust", "list"], store);
      assert.equal(r.envelope.ok, false, JSON.stringify(record));
      assert.match(String(r.envelope.error?.["message"]), /grant 0/u, JSON.stringify(r.envelope));
    }
  });
});

describe("the key keeps the path as the filesystem spells it", () => {
  it("no Unicode normalization, and only the platform's own separator is converted", () => {
    const nfc = "vault-é/";
    const nfd = "vault-é/";
    assert.notDeepEqual(
      scopeKeyFrom("/c/.git", nfc, "linux"),
      scopeKeyFrom("/c/.git", nfd, "linux"),
    );
    assert.equal(scopeKeyFrom("/c/.git", nfd, "darwin").vault_path, "vault-é");
    assert.equal(scopeKeyFrom("/c/.git", "vault\\nested/", "linux").vault_path, "vault\\nested");
    assert.equal(scopeKeyFrom("/c/.git", "vault\\nested/", "win32").vault_path, "vault/nested");
    assert.equal(scopeKeyFrom("/c/.git", "", "linux").vault_path, ".");
  });

  it("a backslash in a directory name is not a separator on POSIX", SLOW, () => {
    if (WINDOWS) return;
    // The key is read through `trust list`, which resolves the worktree scope
    // without importing the module: node's loader refuses a file URL holding an
    // encoded backslash, so under node no module loads from such a directory,
    // and a grant, which loads the module to run its fixture, is not possible.
    // The record is written into this test's own store instead.
    const store = storeFile();
    const { repo } = repository("vault\\nested");
    mkdirSync(join(repo, "vault"), { recursive: true });
    cpSync(BASE, join(repo, "vault", "nested"), { recursive: true, dereference: true });
    const backslashed = join(repo, "vault\\nested");
    const digest = moduleDigest(backslashed, { package: MODULE })?.sha256;
    assert.equal(typeof digest, "string");
    mkdirSync(join(store, ".."), { recursive: true });
    writeFileSync(
      store,
      JSON.stringify({
        schema: "wikiwright/trust",
        schema_version: 2,
        grants: [
          {
            scope: "worktrees",
            common_dir: realpathSync(join(repo, ".git")),
            vault_path: "vault\\nested",
            path: `module:${MODULE}`,
            sha256: digest,
            granted: "2026-01-01",
          },
        ],
      }),
    );
    const listed = (root: string) =>
      cli(root, ["trust", "list"], store).envelope.data as {
        worktree_scope: { vault_path: string };
        grants: { scope: string; status: string }[];
      };
    const own = listed(backslashed);
    assert.equal(own.worktree_scope.vault_path, "vault\\nested");
    assert.deepEqual(
      own.grants.map((g) => `${g.scope}:${g.status}`),
      ["worktrees:current"],
    );
    const other = listed(join(repo, "vault", "nested"));
    assert.equal(other.worktree_scope.vault_path, "vault/nested");
    assert.deepEqual(other.grants, []);
  });

  it("a newline in a path leaves no worktree identity, never a shorter path's", SLOW, () => {
    if (WINDOWS) return;
    const store = storeFile();
    const { repo, vault } = repository();
    grant(vault, store, "worktrees");
    // git prints each answer of the identity query on its own line, and a
    // newline in a path verbatim: `vault\nx` once read as `vault`.
    const below = join(repo, "vault\nx");
    cpSync(BASE, below, { recursive: true, dereference: true });
    const refused = cli(
      below,
      ["trust", "grant", `module:${MODULE}`, "--scope", "worktrees"],
      store,
    );
    assert.equal(
      refused.envelope.error?.["code"],
      "scope-unresolved",
      JSON.stringify(refused.envelope),
    );
  });
});
