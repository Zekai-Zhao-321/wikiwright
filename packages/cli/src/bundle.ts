// docs/cli.md §The envelope (every envelope over a vault names the bundle it
// read: its label, where it is, the commit it sits at, whether it differs from
// that commit, and a digest of its law and of its content) · docs/cli.md §brief
// (the brief's header prints the law digest).
//
// Reads only. Nothing here writes, parses a page or loads a module: the
// module digests arrive from the preload that already ran, and the pages are
// read as bytes.
import { existsSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { loadEngineConfig, normalizeInput } from "@wikiwright/core";
import type { BundleIdentity } from "./envelope.ts";
import { gitCheckoutState } from "./git.ts";
import type { LoadedModule } from "./moduleload.ts";
import { sha256Of } from "./trust.ts";
import { CONSTITUTION_PATH, ENGINE_PATH, fsReader, readPageBytes, walkPages } from "./vaultio.ts";

/**
 * The law digest: sha256 over one line per input, in a fixed order — the
 * constitution's sha256, engine.json's (the empty text's when the file is
 * absent), then each loaded module's digest in declaration order. The texts
 * are the ones the loader reads, so a brief and an envelope rendered from the
 * same files print the same digest.
 */
export function lawDigest(
  constitution: string,
  engine: string | undefined,
  modules: readonly Pick<LoadedModule, "package" | "digest">[],
): string {
  const lines = [
    `${CONSTITUTION_PATH} ${sha256Of(constitution)}`,
    `${ENGINE_PATH} ${sha256Of(engine ?? "")}`,
    ...modules.map((module) => `module:${module.package} ${module.digest}`),
  ];
  return sha256Of(lines.join("\n"));
}

/**
 * The content digest: sha256 over one line per page under the content roots,
 * in the walk's code-unit order — the page's path and the sha256 of its bytes.
 * The bytes are read, never parsed, and git is not asked: an uncommitted edit
 * moves it.
 */
export function contentDigest(root: string, contentRoots: readonly string[]): string {
  const lines = walkPages(root, contentRoots).map(
    (path) => `${path} ${sha256Of(readPageBytes(root, path))}`,
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
 * holds no constitution. `modules` are the ones the entry point loaded before
 * the verb ran; a verb may empty the preload cache before it returns
 * (`modules plan` does), so they are captured by the caller rather than read
 * back here. A file that resolves outside the vault is thrown, as every read
 * of the vault throws it.
 */
export function bundleIdentity(
  root: string,
  modules: readonly Pick<LoadedModule, "package" | "digest">[],
): BundleIdentity | undefined {
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
    law: lawDigest(constitution, engine, modules),
    content: contentDigest(root, contentRootsOf(engine)),
  };
}
