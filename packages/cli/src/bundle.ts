// docs/cli.md §The envelope (every envelope over a vault names the bundle it
// read: its label, where it is, the commit it sits at, whether it differs from
// that commit, and a digest of its law and of its content) · docs/cli.md §brief
// (the brief's header prints the law digest).
//
// Reads only. Nothing here writes, parses a page or loads a module: a
// module's digest is read off its installed bytes, and the pages are read as
// bytes.
import { existsSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { loadEngineConfig, normalizeInput } from "@wikiwright/core";
import type { BundleIdentity } from "./envelope.ts";
import { gitCheckoutState } from "./git.ts";
import { declaredModulesOf, type ModuleDeclaration, moduleDigest } from "./moduleload.ts";
import { sha256Of } from "./trust.ts";
import {
  CONSTITUTION_PATH,
  ENGINE_PATH,
  fsReader,
  readPageBytes,
  walkPages,
} from "./vaultfiles.ts";

/**
 * The law digest: sha256 over one line per input, in a fixed order — the
 * constitution's sha256, engine.json's (the empty text's when the file is
 * absent), then one line per declared module installed under the bundle's
 * `node_modules`, in declaration order, with the digest a trust grant pins. A
 * declared module that is not installed contributes no line.
 *
 * Trust does not enter. The law is what the bundle declares and has
 * installed; a grant decides whether this machine will judge under it, and
 * does not change what it is. So the digest is the same on every machine that
 * holds the same bytes, and the same before a grant and after it. The texts
 * are the ones the loader reads, and the envelope and the brief both call
 * this, so the two print one digest.
 */
export function lawDigest(
  root: string,
  constitution: string,
  engine: string | undefined,
  declarations: readonly ModuleDeclaration[],
): string {
  const lines = [
    `${CONSTITUTION_PATH} ${sha256Of(constitution)}`,
    `${ENGINE_PATH} ${sha256Of(engine ?? "")}`,
  ];
  for (const declaration of declarations) {
    const installed = moduleDigest(root, declaration.package);
    if (installed !== undefined) lines.push(`module:${declaration.package} ${installed.sha256}`);
  }
  return sha256Of(lines.join("\n"));
}

/**
 * One page's digest: sha256 over its raw bytes. The content digest's line for
 * a page holds it, and `read` reports it as `page.digest`, so the two are one
 * value by construction.
 */
export function pageDigest(bytes: Buffer): string {
  return sha256Of(bytes);
}

/**
 * The content digest: sha256 over one line per page under the content roots,
 * in the walk's code-unit order — the page's path and its `pageDigest`. The
 * bytes are read, never parsed, and git is not asked: an uncommitted edit
 * moves it.
 */
export function contentDigest(root: string, contentRoots: readonly string[]): string {
  const lines = walkPages(root, contentRoots).map(
    (path) => `${path} ${pageDigest(readPageBytes(root, path))}`,
  );
  return sha256Of(lines.join("\n"));
}

/**
 * The content roots engine.json declares, read without loading the law. A
 * file the loader would refuse declares none, and the content digest is then
 * the digest of no pages.
 */
function contentRootsOf(engine: string | undefined): readonly string[] {
  if (engine === undefined) return [];
  try {
    const loaded = loadEngineConfig(JSON.parse(normalizeInput(engine).text));
    return loaded.ok ? (loaded.config.content_roots ?? []) : [];
  } catch {
    return [];
  }
}

/**
 * docs/cli.md §The envelope: the bundle at `root`, or undefined when the root
 * holds no constitution. It loads nothing and asks no trust store, so it
 * answers the same for a bundle whose modules this machine has not approved.
 * A file that resolves outside the vault is thrown, as every read of the vault
 * throws it.
 */
export function bundleIdentity(root: string): BundleIdentity | undefined {
  if (!existsSync(join(root, CONSTITUTION_PATH))) return undefined;
  const real = realpathSync(root);
  const reader = fsReader(root);
  const constitution = reader.read(CONSTITUTION_PATH);
  const engine = reader.exists(ENGINE_PATH) ? reader.read(ENGINE_PATH) : undefined;
  const checkout = gitCheckoutState(real);
  return {
    label: basename(real),
    root: real,
    head: checkout?.head ?? null,
    dirty: checkout?.dirty ?? null,
    law: lawDigest(root, constitution, engine, declaredModulesOf(root)),
    content: contentDigest(root, contentRootsOf(engine)),
  };
}
