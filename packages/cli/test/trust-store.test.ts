// docs/extending.md §Trust: the machine-local store is read, changed and
// written as ONE operation under a lock beside it. Two maintainers granting at
// the same moment each keep the other's record; a lock no live process holds is
// broken rather than waited out.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { putGrant, readTrustStore, updateTrustStore, writeTrustStore } from "../src/trust.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CONFORMANCE = join(REPO_ROOT, "fixtures", "conformance");
const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const MODULE = "@wikiwright-fixture/probe";
// Canonical, because a grant is keyed by the vault's real path.
const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), "ww-trust-store-")));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

let serial = 0;
const fresh = (name: string): string => join(SCRATCH, `${name}-${++serial}`);

function storeFile(): string {
  const file = join(fresh("store"), "trust.json");
  mkdirSync(join(file, ".."), { recursive: true });
  return file;
}

/**
 * The conformance bundle with the fixture module installed as bytes. Whatever
 * a package manager has left in the shipped bundle's `node_modules` is left
 * behind: a link there resolves differently on another machine, and copying it
 * either carries the link into the copy or fails on one that dangles.
 */
function bundle(): string {
  const dir = fresh("bundle");
  cpSync(join(CONFORMANCE, "bundle-a"), dir, {
    recursive: true,
    dereference: true,
    filter: (src) => basename(src) !== "node_modules",
  });
  cpSync(join(CONFORMANCE, "module-fixture"), join(dir, "node_modules", ...MODULE.split("/")), {
    recursive: true,
    dereference: true,
  });
  return dir;
}

/** The in-process API reads the store path from the environment, as the verb does. */
function withStore<T>(file: string, run: () => T): T {
  const before = process.env["WIKIWRIGHT_TRUST_FILE"];
  process.env["WIKIWRIGHT_TRUST_FILE"] = file;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env["WIKIWRIGHT_TRUST_FILE"];
    else process.env["WIKIWRIGHT_TRUST_FILE"] = before;
  }
}

const grantOf = (vault: string, digit: string) => ({
  vault,
  path: `module:${MODULE}`,
  sha256: digit.repeat(64),
  granted: "2026-09-11",
});

const vaultsIn = (file: string): string[] =>
  (JSON.parse(readFileSync(file, "utf8")) as { grants: { vault?: string }[] }).grants
    .map((g) => g.vault ?? "")
    .sort();

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

/** One verb over a store this test owns; a non-zero exit is a verdict, not a failure. */
function cli(root: string, argv: readonly string[], store: string): Envelope {
  const r = spawnSync(process.execPath, [CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, WIKIWRIGHT_TRUST_FILE: store, WIKIWRIGHT_TODAY: "2026-09-11" },
  });
  try {
    return JSON.parse(r.stdout) as Envelope;
  } catch {
    throw new Error(`no envelope from ${argv.join(" ")}: ${r.stdout}${r.stderr}`);
  }
}

describe("the whole store is visible, and a record is revocable by its identity", () => {
  /** A store with one record for a vault that is here and one for a vault that is gone. */
  function storeWith(here: string): { file: string; gone: string } {
    const file = storeFile();
    const gone = join(SCRATCH, "removed-vault");
    writeFileSync(
      file,
      `${JSON.stringify({
        schema: "wikiwright/trust",
        schema_version: 2,
        grants: [grantOf(here, "a"), grantOf(gone, "b")],
      })}\n`,
    );
    return { file, gone };
  }

  it("lists every record with its identity and whether its path is still here", () => {
    const vault = bundle();
    const { file, gone } = storeWith(vault);
    const listed = cli(vault, ["trust", "list", "--all"], file);
    const records = (listed.data?.["records"] ?? []) as {
      record: string;
      vault?: string;
      keyed_path_present: boolean;
    }[];
    assert.equal(records.length, 2, JSON.stringify(listed));
    assert.deepEqual(
      records.map((r) => [r.vault, r.keyed_path_present]).sort(),
      [
        [gone, false],
        [vault, true],
      ].sort(),
    );
    assert.equal(new Set(records.map((r) => r.record)).size, 2, "two records share one identity");
    // The default listing is this vault's share of the store, as it always was.
    const mine = cli(vault, ["trust", "list"], file);
    const rows = (mine.data?.["grants"] ?? []) as unknown[];
    assert.equal(rows.length, 1, JSON.stringify(mine));
  });

  it("revokes a record whose vault is gone, from a root that holds no grant", () => {
    const vault = bundle();
    const other = bundle();
    const { file, gone } = storeWith(vault);
    const records = (cli(vault, ["trust", "list", "--all"], file).data?.["records"] ?? []) as {
      record: string;
      vault?: string;
    }[];
    const orphan = records.find((r) => r.vault === gone)?.record;
    assert.equal(typeof orphan, "string");
    // A dry run names the record and writes nothing.
    const before = readFileSync(file, "utf8");
    const planned = cli(other, ["trust", "revoke", "--record", String(orphan), "--dry-run"], file);
    const ops = (planned.data?.["ops"] ?? []) as { path: string; summary: string }[];
    assert.match(ops[0]?.summary ?? "", /revoke the record/u);
    assert.equal(readFileSync(file, "utf8"), before, "the dry run wrote the store");
    const revoked = cli(other, ["trust", "revoke", "--record", String(orphan)], file);
    assert.equal(revoked.ok, true, JSON.stringify(revoked));
    assert.equal(revoked.data?.["removed"], 1);
    assert.deepEqual(vaultsIn(file), [vault]);
  });

  it("refuses an identity the store does not hold in a dry run too", () => {
    const vault = bundle();
    const { file } = storeWith(vault);
    const before = readFileSync(file, "utf8");
    const planned = cli(vault, ["trust", "revoke", "--record", "0".repeat(12), "--dry-run"], file);
    assert.equal(planned.error?.["code"], "grant-not-found", JSON.stringify(planned));
    assert.equal(readFileSync(file, "utf8"), before);
  });

  it("refuses an identity the store does not hold, and names how to find one", () => {
    const vault = bundle();
    const { file } = storeWith(vault);
    const r = cli(vault, ["trust", "revoke", "--record", "0".repeat(12)], file);
    assert.equal(r.error?.["code"], "grant-not-found", JSON.stringify(r));
    assert.match(String(r.error?.["hint"]), /list --all/u);
    assert.equal(vaultsIn(file).length, 2, "a refused revocation changed the store");
  });

  it("refuses a record named beside a scope, a module, or another subcommand", () => {
    const vault = bundle();
    const { file } = storeWith(vault);
    for (const argv of [
      ["trust", "revoke", "--record", "abc123abc123", "--scope", "worktrees"],
      ["trust", "revoke", `module:${MODULE}`, "--record", "abc123abc123"],
      ["trust", "list", "--record", "abc123abc123"],
      ["trust", "grant", "--record", "abc123abc123"],
    ]) {
      const r = cli(vault, argv, file);
      assert.equal(r.error?.["code"], "invalid-arguments", JSON.stringify({ argv, r }));
    }
  });
});

describe("a store update reads what is there, not what was there", () => {
  it("keeps a grant that landed after an earlier read", () => {
    const file = storeFile();
    withStore(file, () => {
      // The snapshot a caller read before doing its slow work.
      const early = readTrustStore();
      assert.deepEqual(early.grants, []);
      // Another process grants in the meantime.
      writeTrustStore(putGrant(readTrustStore(), grantOf("/vaults/b", "b")));
      updateTrustStore((current) => ({
        store: putGrant(current, grantOf("/vaults/a", "a")),
        result: undefined,
      }));
      assert.deepEqual(vaultsIn(file), ["/vaults/a", "/vaults/b"]);
    });
  });

  it("writes nothing when the change asks for nothing", () => {
    const file = storeFile();
    withStore(file, () => {
      const answer = updateTrustStore(() => ({ result: "nothing to do" }));
      assert.equal(answer, "nothing to do");
      assert.equal(existsSync(file), false);
      assert.equal(existsSync(`${file}.lock`), false, "the lock outlived the update");
    });
  });

  it("breaks a lock whose process is gone from this machine", () => {
    const file = storeFile();
    withStore(file, () => {
      const lock = `${file}.lock`;
      // A process that has exited: its pid names nothing here any more.
      const gone = spawnSync(process.execPath, ["-e", ""]);
      writeFileSync(lock, `${JSON.stringify({ pid: gone.pid, host: hostname() })}\n`);
      updateTrustStore((current) => ({
        store: putGrant(current, grantOf("/vaults/a", "a")),
        result: undefined,
      }));
      assert.deepEqual(vaultsIn(file), ["/vaults/a"]);
      assert.equal(existsSync(lock), false);
    });
  });

  it("breaks a lock nobody ever claimed, once it is past the instant of writing it", () => {
    const file = storeFile();
    withStore(file, () => {
      const lock = `${file}.lock`;
      // The window between creating the lock file and naming its holder.
      writeFileSync(lock, "");
      const past = Date.now() / 1000 - 600;
      utimesSync(lock, past, past);
      updateTrustStore((current) => ({
        store: putGrant(current, grantOf("/vaults/a", "a")),
        result: undefined,
      }));
      assert.deepEqual(vaultsIn(file), ["/vaults/a"]);
    });
  });

  it("never takes a lock a running process holds, however old the lock is", () => {
    const file = storeFile();
    withStore(file, () => {
      const lock = `${file}.lock`;
      // This very process holds it, and the lock is an hour old: a grant that
      // digests a large package and runs its fixture can hold one that long,
      // and breaking it is how a revoked grant comes back.
      writeFileSync(lock, `${JSON.stringify({ pid: process.pid, host: hostname() })}\n`);
      const past = Date.now() / 1000 - 3600;
      utimesSync(lock, past, past);
      assert.throws(
        () =>
          updateTrustStore(
            (current) => ({
              store: putGrant(current, grantOf("/vaults/a", "a")),
              result: undefined,
            }),
            { waitMs: 150 },
          ),
        /is updating/u,
      );
      assert.equal(existsSync(file), false, "the store was written behind a live lock");
      assert.equal(existsSync(lock), true, "a live holder's lock was taken");
    });
  });

  it("reads a holder on another machine as one it cannot ask about", () => {
    const file = storeFile();
    withStore(file, () => {
      // A store on a shared home directory: a pid from another host means
      // nothing here, and a pid that happens to exist here is not that holder.
      writeFileSync(
        `${file}.lock`,
        `${JSON.stringify({ pid: process.pid, host: `${hostname()}-elsewhere` })}\n`,
      );
      assert.throws(
        () => updateTrustStore(() => ({ result: undefined }), { waitMs: 150 }),
        /is updating/u,
      );
    });
  });

  it("waits for a lock another process holds, then writes", () => {
    const file = storeFile();
    withStore(file, () => {
      const lock = `${file}.lock`;
      writeFileSync(lock, "1\n");
      const releaser = spawn(
        process.execPath,
        [
          "-e",
          `setTimeout(() => require("node:fs").rmSync(${JSON.stringify(lock)}, { force: true }), 400)`,
        ],
        { stdio: "ignore" },
      );
      releaser.unref();
      const started = Date.now();
      updateTrustStore((current) => ({
        store: putGrant(current, grantOf("/vaults/a", "a")),
        result: undefined,
      }));
      const waited = Date.now() - started;
      assert.deepEqual(vaultsIn(file), ["/vaults/a"]);
      assert.ok(waited >= 300, `the update did not wait for the lock (${String(waited)} ms)`);
    });
  });

  it("four grants running at once all land", { timeout: 60_000 }, async () => {
    const file = storeFile();
    const vaults = [bundle(), bundle(), bundle(), bundle()];
    const codes = await Promise.all(
      vaults.map(
        (root) =>
          new Promise<number>((resolve) => {
            const child = spawn(
              process.execPath,
              [CLI, "trust", "grant", `module:${MODULE}`, "--root", root],
              {
                env: {
                  ...process.env,
                  WIKIWRIGHT_TRUST_FILE: file,
                  WIKIWRIGHT_TODAY: "2026-09-11",
                },
                stdio: "ignore",
              },
            );
            child.on("exit", (code) => resolve(code ?? -1));
          }),
      ),
    );
    assert.deepEqual(codes, [0, 0, 0, 0]);
    assert.equal(
      vaultsIn(file).length,
      4,
      `only ${String(vaultsIn(file).length)} of 4 concurrent grants survived`,
    );
  });
});
