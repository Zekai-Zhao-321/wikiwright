// docs/cli.md §bundles (the machine-local registry of connected bundles: a
// short name for a vault root, its kind and where a problem with it is
// reported) · docs/architecture.md §Directories.
//
// The registry is outside every vault and outside every repository, like the
// trust store, and is updated under the same lock. Connecting a bundle grants
// nothing: a connection names a root, and a verb run against it is judged
// exactly as `--root` would judge it.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
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

export function bundlesFilePath(): string {
  const override = process.env["WIKIWRIGHT_BUNDLES_FILE"];
  if (override !== undefined && override !== "") return override;
  return join(homedir(), ".config", "wikiwright", "bundles.json");
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
  parsed.bundles.forEach((value, i) => {
    const connection = connectionOf(value);
    if (typeof connection === "string") {
      throw new StoreMalformed(MALFORMED, file, `${file}: bundle ${i} ${connection}`, i);
    }
    bundles.push(connection);
  });
  return { schema: "wikiwright/bundles", schema_version: 1, bundles };
}

/** docs/cli.md §bundles: the refusal a registry this engine cannot read is named by. */
const MALFORMED = "bundles-registry-malformed";

/**
 * docs/cli.md §bundles: the verbs whose writes land in this machine's stores,
 * outside every vault — the registry, the trust store — and not in the vault or
 * its repository. `--bundle` naming an installed copy refuses every other
 * writing verb (`bundle-readonly`); these two write nothing of the copy, so
 * they are answered. Closed: the dry-run test holds that each plans only
 * absolute paths outside the vault, and that every other writing verb is
 * refused.
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
