// The old registry's digests of a v1 bundle — its law over the constitution,
// engine.json and each installed module, and its content — which its loader
// (vaultio.ts) reads. The envelope's bundle block is the v2 one (typelaw.ts);
// these leave with the old registry in step 6.
//
// Reads only. Nothing here writes, parses a page or loads a module: a
// module's digest is read off its installed bytes, and the pages are read as
// bytes.
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { codeUnitCompare, loadEngineConfig, normalizeInput } from "@wikiwright/core";
import { type ModuleDeclaration, moduleDigest } from "./moduleload.ts";
import { sha256Of } from "./sha256.ts";
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
 * `node_modules` or at the bundle-relative path it declares, in declaration
 * order, with the digest the loader proves the module under. A declared
 * module that is not installed contributes no line.
 *
 * The law is what the bundle declares and has installed, whether or not its
 * modules load: a refused module still has bytes, and the refusal names the
 * law it refused. So the digest is the same on every machine that holds the
 * same bytes. The texts are the ones the loader reads, and the envelope and
 * the brief both call this, so the two print one digest. An export passes
 * `digestOf` to take a kit's digest from the bytes it carries — the index's,
 * for a kit declared by path under the staged gate — rather than the
 * working tree's.
 */
export function lawDigest(
  root: string,
  constitution: string,
  engine: string | undefined,
  declarations: readonly ModuleDeclaration[],
  digestOf: (declaration: ModuleDeclaration) => string | undefined = (declaration) =>
    moduleDigest(root, declaration)?.sha256,
): string {
  const lines = [
    `${CONSTITUTION_PATH} ${sha256Of(constitution)}`,
    `${ENGINE_PATH} ${sha256Of(engine ?? "")}`,
  ];
  for (const declaration of declarations) {
    const installed = digestOf(declaration);
    if (installed !== undefined) lines.push(`module:${declaration.package} ${installed}`);
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
  return contentDigestOf(
    walkPages(root, contentRoots).map((path) => ({ path, bytes: readPageBytes(root, path) })),
  );
}

/**
 * The content digest over a given page set, each page's path and bytes, in
 * code-unit order of path: what `contentDigest` computes over the pages under
 * the content roots, and what an export's marker records over the pages it
 * selected (docs/constitution.md §exports), so a copy that carries exactly
 * those pages recomputes the digest its marker names.
 */
export function contentDigestOf(pages: readonly { path: string; bytes: Buffer }[]): string {
  const lines = [...pages]
    .sort((a, b) => codeUnitCompare(a.path, b.path))
    .map((page) => `${page.path} ${pageDigest(page.bytes)}`);
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
 * The content roots of the bundle at `root`, its `config/engine.json` read
 * through the contained reader and parsed as the loader parses it, without
 * loading the law. `null` when the file cannot be read inside the vault — it
 * resolves outside, or the read fails — so a caller never routes by a config
 * the engine would refuse to read; none when the file is absent or declares
 * none the loader would accept.
 */
export function contentRootsAt(root: string): readonly string[] | null {
  let engine: string | undefined;
  try {
    const reader = fsReader(root);
    engine = reader.exists(ENGINE_PATH) ? reader.read(ENGINE_PATH) : undefined;
  } catch {
    return null;
  }
  return contentRootsOf(engine);
}

/** A v1 bundle's label: the basename of its root's real path, a name for a reader, not an identity. */
export function bundleLabel(root: string): string {
  return basename(realpathSync(root));
}
