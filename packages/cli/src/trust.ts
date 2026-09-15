// docs/cli.md §trust (content-hashed machine-local grants: stored outside every
// repository, deny-by-default, editing revokes, `git pull` can never grant) ·
// docs/extending.md §Trust (a grant names a module package, `module:<name>`, is
// pinned to the sha256 over the package's own bytes, and covers one vault, or
// one vault path in every linked worktree of one clone — D-006).
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { replaceFile } from "./atomicwrite.ts";
import { gitWorktreeIdentity } from "./git.ts";

/** A grant for one vault, keyed by its real path: the record 0.1.0 wrote, in the same shape. */
export interface VaultGrant {
  vault: string;
  /** `module:<package>` — the one kind of grant the store holds. */
  path: string;
  sha256: string;
  granted: string;
}

/**
 * A grant for one vault path in every linked worktree of one clone. It carries
 * no `vault` field on purpose: an engine that predates scopes matches grants on
 * `vault` and keeps every record it does not match, so it neither honours this
 * record nor drops it.
 */
export interface WorktreeGrant {
  scope: "worktrees";
  common_dir: string;
  vault_path: string;
  path: string;
  sha256: string;
  granted: string;
}

export type TrustGrant = VaultGrant | WorktreeGrant;
export type GrantScope = "vault" | "worktrees";
export const GRANT_SCOPES: readonly GrantScope[] = ["vault", "worktrees"];

/** Where a worktree-scope grant applies: one clone's common directory and one vault path in it. */
export interface WorktreeScope {
  common_dir: string;
  vault_path: string;
}

interface TrustStore {
  schema: "wikiwright/trust";
  schema_version: 1 | 2;
  grants: TrustGrant[];
}

export function isWorktreeGrant(grant: TrustGrant): grant is WorktreeGrant {
  return "scope" in grant;
}

export function trustFilePath(): string {
  const override = process.env["WIKIWRIGHT_TRUST_FILE"];
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".config", "wikiwright", "trust.json");
}

/** The vault key: canonical absolute path. Moving the vault revokes — stated, not softened. */
export function vaultKey(root: string): string {
  return realpathSync(root);
}

export function sha256Of(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** One stored record, or why it is neither shape. A record that is both is refused, never guessed at. */
function recordOf(value: unknown): TrustGrant | string {
  if (typeof value !== "object" || value === null) return "is not an object";
  const record = value as Record<string, unknown>;
  if (typeof record["path"] !== "string" || typeof record["sha256"] !== "string") {
    return "names no module and digest";
  }
  const vaultShaped = "vault" in record;
  const worktreeShaped = "scope" in record || "common_dir" in record || "vault_path" in record;
  if (vaultShaped && worktreeShaped) return "carries both a vault and a worktree scope";
  if (vaultShaped) {
    return typeof record["vault"] === "string"
      ? (value as VaultGrant)
      : "has a vault that is not a path";
  }
  if (record["scope"] !== "worktrees") {
    return `has no vault and an unknown scope ${JSON.stringify(record["scope"] ?? null)}`;
  }
  if (typeof record["common_dir"] !== "string" || typeof record["vault_path"] !== "string") {
    return "is a worktree grant without its common directory and vault path";
  }
  return value as WorktreeGrant;
}

/**
 * The machine's store, both record shapes. Reading never rewrites it: a 0.1.0
 * store stays version 1 until a maintainer's grant or revoke writes it.
 */
export function readTrustStore(): TrustStore {
  const file = trustFilePath();
  if (!existsSync(file)) return { schema: "wikiwright/trust", schema_version: 2, grants: [] };
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    schema?: unknown;
    schema_version?: unknown;
    grants?: unknown;
  };
  if (parsed.schema !== "wikiwright/trust" || !Array.isArray(parsed.grants)) {
    throw new Error(`${file} is not a wikiwright trust store`);
  }
  const version = parsed.schema_version ?? 1;
  if (version !== 1 && version !== 2) {
    throw new Error(`${file} is trust store version ${String(version)}; this engine reads 1 and 2`);
  }
  const grants: TrustGrant[] = [];
  parsed.grants.forEach((value, i) => {
    const record = recordOf(value);
    if (typeof record === "string") throw new Error(`${file}: grant ${i} ${record}`);
    grants.push(record);
  });
  return { schema: "wikiwright/trust", schema_version: version, grants };
}

/** An explicit write, the only thing that moves a store to version 2. */
export function writeTrustStore(store: TrustStore): void {
  replaceFile(trustFilePath(), `${JSON.stringify({ ...store, schema_version: 2 }, null, 2)}\n`);
}

/** The lock is a maintainer's write held for a moment; these bound the wait for it. */
const LOCK_WAIT_MS = 15_000;
const LOCK_POLL_MS = 20;
/**
 * How long a lock with no readable holder is given before it is treated as
 * abandoned. It covers only the instant between creating the lock file and
 * writing who holds it; age is not evidence about a holder that named itself.
 */
const LOCK_UNCLAIMED_MS = 2_000;

/** Another process holds the store; the caller is told so by name, never overwritten. */
export class TrustStoreBusy extends Error {}

/** A sleep with no runtime-specific API and no busy loop. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Who holds a lock: this machine's name for itself, and the process on it. */
interface LockHolder {
  pid: number;
  host: string;
}

function holderOf(lock: string): LockHolder | undefined {
  let text: string;
  try {
    text = readFileSync(lock, "utf8").trim();
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as { pid?: unknown; host?: unknown };
    if (typeof parsed.pid === "number" && typeof parsed.host === "string") {
      return { pid: parsed.pid, host: parsed.host };
    }
  } catch {
    // A 0.1.0 lock is the pid alone, and named no host.
  }
  const pid = Number.parseInt(text, 10);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid, host: hostname() } : undefined;
}

/**
 * Whether the process named by a lock is still running here. Signal 0 asks
 * without sending anything: it succeeds while the process exists, and EPERM
 * means it exists and belongs to someone else. A holder on another machine —
 * a store on a shared home directory — cannot be asked, and is treated as
 * alive: a pid means nothing there, and guessing would take a live lock.
 */
function holderIsRunning(holder: LockHolder): boolean {
  if (holder.host !== hostname()) return true;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Hold the store against other processes. The lock is a file created
 * exclusively beside it: whoever creates it owns the store until it is removed.
 *
 * A lock is broken only when the process that wrote it is gone from this
 * machine. Age is not evidence: a grant digests a package, scans it and runs
 * its determinism fixture, and a slow disk, a large module or a stopped
 * process can hold the lock past any interval worth waiting. Breaking a live
 * holder's lock is how two writers both write, and how a grant a maintainer
 * revoked comes back. A lock nobody has claimed yet — the instant between
 * creating the file and naming its holder — is given `LOCK_UNCLAIMED_MS` and
 * then treated as abandoned, since nothing else can ever say who holds it.
 */
function acquire(file: string, waitMs = LOCK_WAIT_MS): string {
  const lock = `${file}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      try {
        writeFileSync(fd, `${JSON.stringify({ pid: process.pid, host: hostname() })}\n`);
      } finally {
        closeSync(fd);
      }
      return lock;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = holderOf(lock);
    try {
      const unclaimed =
        holder === undefined && Date.now() - statSync(lock).mtimeMs > LOCK_UNCLAIMED_MS;
      if (unclaimed || (holder !== undefined && !holderIsRunning(holder))) {
        rmSync(lock, { force: true });
        continue;
      }
    } catch {
      // The holder released it between the two calls; the next attempt takes it.
    }
    if (Date.now() >= deadline) {
      throw new TrustStoreBusy(
        holder === undefined
          ? `another process is updating ${file}; its lock at ${lock} did not clear`
          : `process ${String(holder.pid)} on ${holder.host} is updating ${file}; its lock at ${lock} did not clear`,
      );
    }
    pause(LOCK_POLL_MS);
  }
}

export interface StoreChange<T> {
  /** The store to write, or absent to leave the file untouched. */
  store?: TrustStore;
  result: T;
}

/**
 * docs/extending.md §Trust: read, change and write the store as ONE operation.
 * The store is read AFTER the lock is held, so a change never lands on a
 * snapshot another process has already moved past: two maintainers granting at
 * the same moment each keep the other's record. A change that returns no store
 * writes nothing, and the lock is released whatever happens.
 */
export function updateTrustStore<T>(
  change: (store: TrustStore) => StoreChange<T>,
  options: { waitMs?: number } = {},
): T {
  const lock = acquire(trustFilePath(), options.waitMs);
  try {
    const outcome = change(readTrustStore());
    if (outcome.store !== undefined) writeTrustStore(outcome.store);
    return outcome.result;
  } finally {
    rmSync(lock, { force: true });
  }
}

export function grantFor(store: TrustStore, vault: string, path: string): VaultGrant | undefined {
  for (const grant of store.grants) {
    if (!isWorktreeGrant(grant) && grant.vault === vault && grant.path === path) return grant;
  }
  return undefined;
}

/** Record (or replace) one vault grant: a vault holds one approved digest per module, as it always has. */
export function putGrant(store: TrustStore, grant: VaultGrant): TrustStore {
  const grants = store.grants.filter(
    (g) => isWorktreeGrant(g) || !(g.vault === grant.vault && g.path === grant.path),
  );
  grants.push(grant);
  return { ...store, grants };
}

export function dropGrant(store: TrustStore, vault: string, path: string): TrustStore {
  return {
    ...store,
    grants: store.grants.filter(
      (g) => isWorktreeGrant(g) || !(g.vault === vault && g.path === path),
    ),
  };
}

function inScope(grant: WorktreeGrant, scope: WorktreeScope): boolean {
  return grant.common_dir === scope.common_dir && grant.vault_path === scope.vault_path;
}

/** Every digest a worktree scope approves for one module, oldest first. */
export function worktreeGrantsFor(
  store: TrustStore,
  scope: WorktreeScope,
  path: string,
): WorktreeGrant[] {
  return store.grants.filter(
    (g): g is WorktreeGrant => isWorktreeGrant(g) && g.path === path && inScope(g, scope),
  );
}

/**
 * Add one approved digest to a worktree scope. A scope may hold several, so
 * approving a module's update on one branch leaves another branch's approved
 * version standing; the same digest approved again replaces its own record.
 */
export function putWorktreeGrant(store: TrustStore, grant: WorktreeGrant): TrustStore {
  const grants = store.grants.filter(
    (g) =>
      !(
        isWorktreeGrant(g) &&
        inScope(g, grant) &&
        g.path === grant.path &&
        g.sha256 === grant.sha256
      ),
  );
  grants.push(grant);
  return { ...store, grants };
}

/**
 * A record's identity: its scope, the key it is filed under, the module and the
 * digest, hashed. It is what a revocation names when the path a record is keyed
 * by is gone — which is the one case where nothing else can name it — so
 * removing a record never requires its directory to exist.
 */
export function recordId(grant: TrustGrant): string {
  const key = isWorktreeGrant(grant)
    ? ["worktrees", grant.common_dir, grant.vault_path]
    : ["vault", grant.vault];
  return sha256Of(JSON.stringify([...key, grant.path, grant.sha256])).slice(0, 12);
}

/** Remove the one record with this identity, wherever it is keyed. */
export function dropRecord(store: TrustStore, id: string): TrustStore {
  return { ...store, grants: store.grants.filter((grant) => recordId(grant) !== id) };
}

/** Remove every digest a worktree scope approves for one module. */
export function dropWorktreeGrants(
  store: TrustStore,
  scope: WorktreeScope,
  path: string,
): TrustStore {
  return {
    ...store,
    grants: store.grants.filter(
      (g) => !(isWorktreeGrant(g) && g.path === path && inScope(g, scope)),
    ),
  };
}

/**
 * The key of a worktree scope from git's two answers, spelled as the filesystem
 * spells it: no Unicode normalization and no case folding, because two
 * directory names the filesystem keeps apart are two vaults, and approval of
 * one is not approval of the other. git prints `/` between segments; on
 * Windows `\` is a separator too and is converted, and elsewhere it is a
 * character a name may hold. The worktree's own top is `.`.
 */
export function scopeKeyFrom(
  commonDir: string,
  prefix: string,
  platform: NodeJS.Platform = process.platform,
): WorktreeScope {
  const spelled = platform === "win32" ? prefix.replaceAll("\\", "/") : prefix;
  const trimmed = spelled.endsWith("/") ? spelled.slice(0, -1) : spelled;
  return { common_dir: commonDir, vault_path: trimmed === "" ? "." : trimmed };
}

const SCOPES = new Map<string, WorktreeScope | Error>();

/**
 * The worktree scope of the vault at `root`, asked of git once per root per
 * process, so a verb that loads its modules twice spawns git once. A failure
 * is remembered as well, and thrown each time it is asked.
 */
export function worktreeScopeOf(root: string): WorktreeScope {
  const key = resolve(root);
  let known = SCOPES.get(key);
  if (known === undefined) {
    try {
      const { commonDir, prefix } = gitWorktreeIdentity(key);
      known = scopeKeyFrom(realpathSync(commonDir), prefix);
    } catch (error) {
      known = error instanceof Error ? error : new Error(String(error));
    }
    SCOPES.set(key, known);
  }
  if (known instanceof Error) throw known;
  return known;
}

export type TrustVerdict =
  | { kind: "authorized"; scope: GrantScope }
  | { kind: "modified"; approved: string[]; worktree?: WorktreeScope }
  | { kind: "untrusted"; worktree?: WorktreeScope }
  | { kind: "scope-unresolved"; reason: string };

/**
 * docs/cli.md §trust: whether this machine approves `digest` of the module
 * `path` for the vault at `root`. A matching digest in either scope approves.
 * The vault grant is read first and costs no git; git is asked for the
 * worktree scope only when the vault grant does not approve and some worktree
 * grant for this module exists. An applicable grant for other bytes is
 * `modified`, none is `untrusted`, and a worktree scope that was needed and
 * could not be read is its own refusal, never a quieter answer.
 */
export function trustVerdict(
  store: TrustStore,
  root: string,
  path: string,
  digest: string,
): TrustVerdict {
  let vault: string;
  try {
    vault = vaultKey(root);
  } catch {
    vault = resolve(root);
  }
  const vaultGrant = grantFor(store, vault, path);
  if (vaultGrant?.sha256 === digest) return { kind: "authorized", scope: "vault" };
  const anyShared = store.grants.some((g) => isWorktreeGrant(g) && g.path === path);
  if (!anyShared) {
    return vaultGrant === undefined
      ? { kind: "untrusted" }
      : { kind: "modified", approved: [vaultGrant.sha256] };
  }
  let scope: WorktreeScope;
  try {
    scope = worktreeScopeOf(root);
  } catch (error) {
    return {
      kind: "scope-unresolved",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const applicable = worktreeGrantsFor(store, scope, path);
  if (applicable.some((g) => g.sha256 === digest))
    return { kind: "authorized", scope: "worktrees" };
  const approved = [
    ...(vaultGrant === undefined ? [] : [vaultGrant.sha256]),
    ...applicable.map((g) => g.sha256),
  ];
  return approved.length > 0
    ? { kind: "modified", approved, worktree: scope }
    : { kind: "untrusted", worktree: scope };
}
