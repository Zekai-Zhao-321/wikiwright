// docs/cli.md §bundles (the machine-local registry of connected bundles: a
// short name for a vault root, its kind and where a problem with it is
// reported) · docs/architecture.md §Directories.
//
// The registry is this machine's, like the trust store: by default under the
// home directory, outside every vault and every repository, and wherever
// `WIKIWRIGHT_BUNDLES_FILE` puts it otherwise — the environment is the
// caller's. It is updated under the trust store's lock. Connecting a bundle
// grants nothing: a connection names a root, and a verb run against it is
// judged exactly as `--root` would judge it.
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { codeUnitCompare } from "@wikiwright/core";
import { replaceFile } from "./atomicwrite.ts";
import { parseStoreFile, type StoreChange, StoreMalformed, updateStore } from "./storelock.ts";

/** The two kinds of connection: a checkout the caller may write to, or a copy that is read only. */
export const KINDS = ["maintained", "installed"] as const;
export type Kind = (typeof KINDS)[number];

/** One connection, in the order the registry file spells its keys. */
export interface Connection {
  name: string;
  /**
   * The root as it was given, made absolute; a record whose root is relative
   * is refused. Its real path is what identity compares.
   */
  root: string;
  kind: Kind;
  /** Where a problem with this bundle is reported, in the connector's words. */
  feedback: string | null;
  /** A vault-relative page to read first. */
  guide: string | null;
}

export interface ConnectionStore {
  schema: "wikiwright/bundles";
  schema_version: 1;
  bundles: Connection[];
}

/** A connection's name: lower-case letters, digits and hyphens, a letter or digit first, at most 64. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/**
 * The registry's path, absolute: an override is resolved against the working
 * directory once, here, so `bundles add --dry-run` never plans a relative path
 * and the registry named is one file whichever verb reads it.
 */
export function bundlesFilePath(): string {
  const override = process.env["WIKIWRIGHT_BUNDLES_FILE"];
  if (override !== undefined && override !== "") return resolve(override);
  return join(homedir(), ".config", "wikiwright", "bundles.json");
}

/** Where a root resolves, or the root itself when it does not resolve: what identifies a connection. */
function whereOf(root: string): string {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/** One stored record, or why it is not one. */
function connectionOf(value: unknown): Connection | string {
  if (typeof value !== "object" || value === null) return "is not an object";
  const record = value as Record<string, unknown>;
  const name = record["name"];
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) return "has no valid name";
  if (typeof record["root"] !== "string" || record["root"] === "") return "has no root";
  // `add` stores a root made absolute. A relative one — a file edited or
  // restored by hand — would name a different directory from every working
  // directory, so one name would answer for different bundles: it is refused,
  // never resolved against wherever the caller happens to be.
  if (!isAbsolute(record["root"])) return "has a root that is not an absolute path";
  if (!(KINDS as readonly unknown[]).includes(record["kind"])) {
    return `has the kind ${JSON.stringify(record["kind"] ?? null)}, not one of ${KINDS.join(", ")}`;
  }
  for (const key of ["feedback", "guide"] as const) {
    if (record[key] !== null && typeof record[key] !== "string") {
      return `has a ${key} that is neither text nor null`;
    }
  }
  return {
    name,
    root: record["root"],
    kind: record["kind"] as Kind,
    feedback: record["feedback"] as string | null,
    guide: record["guide"] as string | null,
  };
}

/** This machine's registry; an absent file is an empty one. A malformed file is thrown, by name. */
export function readConnections(): ConnectionStore {
  const file = bundlesFilePath();
  if (!existsSync(file)) return { schema: "wikiwright/bundles", schema_version: 1, bundles: [] };
  const parsed = (parseStoreFile(file, MALFORMED) ?? {}) as {
    schema?: unknown;
    schema_version?: unknown;
    bundles?: unknown;
  };
  if (parsed.schema !== "wikiwright/bundles" || !Array.isArray(parsed.bundles)) {
    throw new StoreMalformed(MALFORMED, file, `${file} is not a wikiwright bundles registry`);
  }
  if (parsed.schema_version !== 1) {
    throw new StoreMalformed(
      MALFORMED,
      file,
      `${file} is bundles registry version ${String(parsed.schema_version)}; this engine reads 1`,
    );
  }
  const bundles: Connection[] = [];
  const named = new Map<string, number>();
  const rooted = new Map<string, number>();
  parsed.bundles.forEach((value, i) => {
    const connection = connectionOf(value);
    if (typeof connection === "string") {
      throw new StoreMalformed(MALFORMED, file, `${file}: bundle ${i} ${connection}`, i);
    }
    // `add` refuses a taken name and a root connected twice, under the lock. A
    // registry restored or edited by hand can still hold either, and `--bundle`
    // would then answer with whichever came first: it is refused instead.
    const sameName = named.get(connection.name);
    if (sameName !== undefined) {
      throw new StoreMalformed(
        MALFORMED,
        file,
        `${file}: bundle ${i} has the name "${connection.name}" of bundle ${sameName}`,
        i,
      );
    }
    const where = whereOf(connection.root);
    const sameRoot = rooted.get(where);
    if (sameRoot !== undefined) {
      throw new StoreMalformed(
        MALFORMED,
        file,
        `${file}: bundle ${i} has the root of bundle ${sameRoot}, ${where}`,
        i,
      );
    }
    named.set(connection.name, i);
    rooted.set(where, i);
    bundles.push(connection);
  });
  return { schema: "wikiwright/bundles", schema_version: 1, bundles };
}

/** docs/cli.md §bundles: the refusal a registry this engine cannot read is named by. */
const MALFORMED = "bundles-registry-malformed";

/**
 * docs/cli.md §bundles: the verbs whose writes are this machine's stores — the
 * registry, the trust store — and not the vault or its repository.
 * `--bundle` naming an installed copy refuses every other writing verb
 * (`bundle-readonly`); these two are answered. The exemption is BY VERB, not by
 * where the store lies: the stores' paths are the environment's, and one set
 * to a file inside the copy is written there. Closed: the dry-run test holds
 * that each plans only absolute store paths, outside the vault when the stores
 * are, and that every other writing verb is refused.
 */
export const MACHINE_LOCAL_WRITERS: ReadonlySet<string> = new Set(["bundles", "trust"]);

/** The registry, sorted by name, so the file's bytes are a function of its connections. */
function writeConnections(store: ConnectionStore): void {
  const bundles = [...store.bundles].sort((a, b) => codeUnitCompare(a.name, b.name));
  replaceFile(bundlesFilePath(), `${JSON.stringify({ ...store, bundles }, null, 2)}\n`);
}

/**
 * Read, change and write the registry as one operation, under the lock every
 * machine-local store is updated under (`storelock.ts`).
 */
export function updateConnections<T>(
  change: (store: ConnectionStore) => StoreChange<ConnectionStore, T>,
): T {
  return updateStore(bundlesFilePath(), { read: readConnections, write: writeConnections }, change);
}
