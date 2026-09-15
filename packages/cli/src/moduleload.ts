// docs/extending.md §Declaring a module, docs/extending.md §The determinism fixture, docs/extending.md §Adopting a new version
// docs/architecture.md §Directories (the shell owns fs; core stays pure) · docs/cli.md §trust (machine-local,
// content-hashed grants; deny by default, `git pull` can never grant).
//
// Loading a module a bundle declares. Every step below is a REFUSAL with a name,
// because a module the engine cannot vouch for must not be judged with: a bundle
// judged without a law it declares is judged under a different law than it
// believes.
//
// Nothing here reaches the network. Resolution is node's own, from the bundle's
// own `node_modules`, which is what a workspace link, a `file:` dependency and a
// locally packed tarball all produce. The trust grant's digest over every file
// of the package is the boundary; no lockfile is read.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  codeUnitCompare,
  type ModuleManifest,
  type PurityViolation,
  satisfiesEngineRange,
  scanPurity,
} from "@wikiwright/core";
import { ENGINE_VERSION } from "./envelope.ts";
import {
  type GrantScope,
  readTrustStore,
  sha256Of,
  type TrustVerdict,
  trustVerdict,
} from "./trust.ts";

/** docs/extending.md §Declaring a module: what `config/engine.json` declares. */
export interface ModuleDeclaration {
  /** The package name, resolved by node from the bundle's own `node_modules`. */
  package: string;
  /** The range the bundle expects; the resolved version must satisfy it. */
  version?: string;
}

/** One refusal, with everything a reader needs to act on it. */
export interface ModuleIssue {
  code:
    | "module-unresolved"
    | "module-malformed"
    | "module-version-mismatch"
    | "module-incompatible"
    | "module-untrusted"
    | "module-modified"
    | "module-scope-unresolved"
    | "module-impure"
    | "module-load-failed"
    | "module-fixture-missing"
    | "module-fixture-failed"
    | "module-nondeterministic";
  /** The declared package, always — a refusal that does not name one is useless. */
  package: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

/** What a loaded module contributed, and what it was pinned to. */
export interface LoadedModule {
  package: string;
  /** The installed package.json's version — the one a finding is attributed to. */
  version: string;
  /** sha256 over the module's own bytes — what the trust grant is pinned to. */
  digest: string;
  manifest: ModuleManifest;
  /** Where the module's determinism fixture lives, for the runner one layer up. */
  fixture: string;
  /** The scope whose grant approved this load; absent when `trust grant` skipped the gate. */
  authorizedBy?: GrantScope;
}

export interface ModuleLoadOutcome {
  loaded: LoadedModule[];
  issues: ModuleIssue[];
}

/**
 * docs/extending.md §Declaring a module: the package's own contract with the engine. A `wikiwright`
 * block, because a package.json without one is not a module and saying so is
 * better than guessing at an entry point.
 */
interface PackageContract {
  /** Path, relative to the package root, of the entry whose default export is the manifest. */
  module: string;
  /** Path of the determinism fixture. Required. */
  fixture: string;
  /** The engine range this module is built for. */
  engine?: string;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

/**
 * Node's own resolution, from the BUNDLE — never from the engine's own tree. A
 * module the engine can see and the bundle cannot is a module the bundle does
 * not depend on, and `docs/extending.md §A check` refuses a reference to one.
 */
function packageRoot(vaultRoot: string, name: string): string | undefined {
  const boundary = resolve(vaultRoot, "node_modules");
  const candidate = resolve(boundary, ...name.split("/"));
  if (!candidate.startsWith(boundary + sep)) return undefined;
  return existsSync(join(candidate, "package.json")) ? candidate : undefined;
}

const PACKAGE_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function isPackageVersion(value: unknown): value is string {
  return typeof value === "string" && PACKAGE_VERSION.test(value);
}

/** Every file in the package, excluding its own dependencies. */
function moduleFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
      // `node_modules` is the package's DEPENDENCY TREE, pinned by its
      // own lockfile rather than by this grant, and it is the only exclusion.
      // A dot-prefix used to be one too, and it was a hole: a package could name
      // `.hidden.mjs` as its entry, load it, and edit it afterwards without
      // moving the digest a single bit.
      if (entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      // A `file:` install links each file back into its source tree, so a link
      // is ordinary here; a link to a DIRECTORY still has to be walked rather
      // than read. `statSync` follows, `Dirent.isDirectory` does not.
      if (entry.isSymbolicLink()) {
        let directory = false;
        try {
          directory = statSync(path).isDirectory();
        } catch {
          // A broken link hashes as the read failure it is, below.
        }
        if (directory) {
          walk(path);
          continue;
        }
      }
      out.push(path);
    }
  };
  walk(root);
  return out.sort(codeUnitCompare);
}

/**
 * docs/cli.md §trust: what a grant is PINNED to is every file, and what the purity scan
 * READS is the executable ones. The two differ on purpose.
 *
 * A digest over the code alone was a hole: `package.json` names the entry, so
 * repointing `wikiwright.module` at another file already in the package runs
 * different code under an unchanged digest — a granted module, quietly swapped.
 * The fixture is data too, and a module whose expectation was edited is a module
 * whose proof was edited.
 */
const EXECUTABLE = /\.(?:js|mjs|cjs|ts|mts|cts)$/u;
const PORTABLE_ENTRY = /\.(?:js|mjs|cjs)$/u;

/**
 * The absolute path a package-internal specifier names, or `undefined`
 * when it leaves the package.
 *
 * `join(root, spec)` was the whole check, and `join` happily walks out:
 * `wikiwright.module: "../../../outside.mjs"` resolved, imported and RAN, with
 * its bytes in neither the digest nor the purity scan. Editing it afterwards
 * changed nothing a grant could see.
 *
 * The test is LEXICAL, and deliberately not `realpath`. A `file:` install links
 * each of a package's files at an absolute path back into its source tree, so
 * every legitimate local install would fail a realpath containment test — and
 * local installs are the whole of `docs/extending.md §Declaring a module`. What closes the hole is
 * not where a link points but whether the digest covers it: `moduleFiles` reads
 * THROUGH links, so a linked file's bytes are in the grant and editing them
 * revokes it. The caller asserts that membership, which is the property that
 * matters; this only refuses the paths that are not the package's to name.
 *
 * `./index.js` stays legal — a leading `./` is how package.json is written —
 * which is why this is a containment test and not `pathRefusal`.
 */
function insidePackage(root: string, spec: string): string | undefined {
  const base = resolve(root);
  const abs = resolve(base, spec);
  if (abs !== base && !abs.startsWith(base + sep)) return undefined;
  return existsSync(abs) ? abs : undefined;
}

function contractOf(packageJson: unknown): PackageContract | undefined {
  if (packageJson === null || typeof packageJson !== "object") return undefined;
  const block = (packageJson as { wikiwright?: unknown }).wikiwright;
  if (block === null || typeof block !== "object") return undefined;
  const record = block as Record<string, unknown>;
  if (typeof record["module"] !== "string" || typeof record["fixture"] !== "string") {
    return undefined;
  }
  const contract: PackageContract = { module: record["module"], fixture: record["fixture"] };
  if (typeof record["engine"] === "string") contract.engine = record["engine"];
  return contract;
}

export interface ModuleLoadOptions {
  /** The running engine's version; the module's declared range is checked against it. */
  engineVersion?: string;
  /**
   * Skip the machine-local trust gate. The ONE caller is `trust grant`, which
   * loads the module it is about to grant so its determinism fixture is proved
   * BEFORE the grant is written; every other load goes through the gate, and
   * the flag is named so a reader can see the exception in a diff.
   */
  beforeGrant?: boolean;
}

/**
 * docs/cli.md §trust: the approval is a maintainer's decision, and the refusal
 * names it without a command to run — the engine's hints are followed literally,
 * and a grant an agent writes to unblock itself approves code nobody read.
 * The message names the worktree scope only when git identity was read.
 */
function trustRefusal(
  name: string,
  digest: string,
  verdict: Exclude<TrustVerdict, { kind: "authorized" }>,
): ModuleIssue {
  if (verdict.kind === "scope-unresolved") {
    return {
      code: "module-scope-unresolved",
      package: name,
      message: `a worktree-scope grant for "${name}" could apply, and this vault's git identity could not be read: ${verdict.reason}`,
      hint: "A worktree-scope grant is matched by the git common directory of the vault's checkout; run inside that checkout, or a maintainer approves this vault alone.",
    };
  }
  const worktree = verdict.worktree === undefined ? {} : { worktree_scope: verdict.worktree };
  if (verdict.kind === "modified") {
    return {
      code: "module-modified",
      package: name,
      message: `"${name}" has changed since it was approved on this machine`,
      hint: "The installed digest differs from every digest approved for this vault. A maintainer must review the change and choose the approval scope.",
      details: {
        granted: verdict.approved[0],
        approved: verdict.approved,
        current: digest,
        ...worktree,
      },
    };
  }
  return {
    code: "module-untrusted",
    package: name,
    message:
      verdict.worktree === undefined
        ? `"${name}" has no trust grant for this vault on this machine`
        : `"${name}" has no trust grant for this vault, nor for "${verdict.worktree.vault_path}" in the worktrees of ${verdict.worktree.common_dir}`,
    hint: "This module's installed digest is not authorized for this vault. A maintainer must review the module and choose the approval scope; a grant is machine-local, and `git pull` can never write one.",
    ...(verdict.worktree === undefined ? {} : { details: worktree }),
  };
}

/**
 * docs/extending.md §Declaring a module + docs/extending.md §The determinism fixture: resolve, pin, check compatibility, trust,
 * scan, load. Each step refuses by name, and a refused module contributes
 * nothing — there is no partial load, because a bundle judged under half its
 * declared law is judged under a law nobody wrote.
 */
export async function loadDeclaredModules(
  vaultRoot: string,
  declarations: readonly ModuleDeclaration[],
  options: ModuleLoadOptions = {},
): Promise<ModuleLoadOutcome> {
  const loaded: LoadedModule[] = [];
  const issues: ModuleIssue[] = [];
  const engineVersion = options.engineVersion ?? ENGINE_VERSION;
  const seen = new Set<string>();

  for (const declaration of declarations) {
    const name = declaration.package;
    if (seen.has(name)) {
      issues.push({
        code: "module-malformed",
        package: name,
        message: `"${name}" is declared twice in config/engine.json`,
        hint: "declare each module once; two declarations of one package are two laws with one name",
      });
      continue;
    }
    seen.add(name);

    const root = packageRoot(vaultRoot, name);
    if (root === undefined) {
      issues.push({
        code: "module-unresolved",
        package: name,
        message: `config/engine.json declares module "${name}", which this bundle does not have installed`,
        hint: "install it into this bundle's own node_modules — package.json names it as a workspace link or a `file:<path>` to the package, and the package manager's install lands it — and then a maintainer reviews it and chooses its approval scope",
      });
      continue;
    }

    let packageJson: unknown;
    try {
      packageJson = readJson(join(root, "package.json"));
    } catch (error) {
      issues.push({
        code: "module-malformed",
        package: name,
        message: `"${name}" has an unreadable package.json: ${String(error)}`,
      });
      continue;
    }
    const contract = contractOf(packageJson);
    if (contract === undefined) {
      issues.push({
        code: "module-malformed",
        package: name,
        message: `"${name}" declares no \`wikiwright\` block with a "module" entry and a "fixture"`,
        hint: 'add `"wikiwright": { "module": "./index.js", "fixture": "./fixture.json" }` to its package.json',
      });
      continue;
    }

    // docs/extending.md §Declaring a module: the version is the installed package's own, and the
    // bundle's declared range is checked against it. The trust grant pins the
    // BYTES (`moduleDigest`, package.json included), so a version this range
    // admits and a version a reviewer read are the same file.
    const claimedRaw = (packageJson as { version?: unknown }).version;
    if (!isPackageVersion(claimedRaw)) {
      issues.push({
        code: "module-malformed",
        package: name,
        message: `"${name}" states no semver version in its package.json (${String(claimedRaw)})`,
      });
      continue;
    }
    const version = claimedRaw;
    if (declaration.version !== undefined && !satisfiesEngineRange(version, declaration.version)) {
      issues.push({
        code: "module-version-mismatch",
        package: name,
        message: `config/engine.json asks for "${declaration.version}"; the installed package is ${version}`,
        details: { declared: declaration.version, installed: version },
      });
      continue;
    }
    if (contract.engine !== undefined && !satisfiesEngineRange(engineVersion, contract.engine)) {
      issues.push({
        code: "module-incompatible",
        package: name,
        message: `"${name}" is built for engine ${contract.engine}; this engine is ${engineVersion}`,
        details: { required: contract.engine, running: engineVersion },
      });
      continue;
    }

    // Resolve the two executable inputs lexically inside the
    // installation before scanning. The entry is passed into moduleDigest so it
    // is scanned regardless of suffix using the same bytes that feed the digest.
    const entry = insidePackage(root, contract.module);
    if (entry === undefined) {
      issues.push({
        code: "module-malformed",
        package: name,
        message: `"${name}" names an entry at "${contract.module}", which does not resolve to a file inside the package`,
        hint: "a module's entry is one of the files its grant is pinned to; a path that leaves the package is code no digest covers",
      });
      continue;
    }
    const fixture = insidePackage(root, contract.fixture);
    if (fixture === undefined) {
      issues.push({
        code: "module-fixture-missing",
        package: name,
        message: `"${name}" names a determinism fixture at "${contract.fixture}", which does not resolve to a file inside the package`,
        hint: "a module ships input bytes and the findings they must produce; the engine runs it before the module judges anything of yours",
      });
      continue;
    }

    // One definition of "the module's bytes": the trust grant, the purity scan
    // and the `modules list` row all read the same digest, so a grant cannot be
    // pinned to one reading and checked against another.
    const scanned = moduleDigest(vaultRoot, name, entry);
    if (scanned === undefined) {
      issues.push({
        code: "module-unresolved",
        package: name,
        message: `"${name}" resolved and then vanished while being read`,
      });
      continue;
    }
    const digest = scanned.sha256;

    const violations = scanned.violations;
    if (violations.length > 0) {
      issues.push({
        code: "module-impure",
        package: name,
        message: `"${name}" reaches for state a verdict may not depend on: ${violations
          .slice(0, 3)
          .map((v) => `${v.file}:${v.line} ${v.reason}`)
          .join("; ")}${violations.length > 3 ? ` (+${violations.length - 3} more)` : ""}`,
        hint: "a module's verdict is a function of the page it is handed; the clock, the environment, the filesystem and the machine's locale are not inputs",
        details: { violations },
      });
      continue;
    }

    // The entry and fixture are members of the exact file set the digest read.
    if (!scanned.files.includes(entry)) {
      issues.push({
        code: "module-malformed",
        package: name,
        message: `"${name}" names an entry at "${contract.module}", which the package digest does not cover`,
        details: { entry },
      });
      continue;
    }
    if (!scanned.files.includes(fixture)) {
      issues.push({
        code: "module-fixture-missing",
        package: name,
        message: `"${name}" names a determinism fixture at "${contract.fixture}", which the package digest does not cover`,
        details: { fixture },
      });
      continue;
    }
    if (!PORTABLE_ENTRY.test(entry)) {
      issues.push({
        code: "module-malformed",
        package: name,
        message: `"${name}" names an entry at "${contract.module}"; installed module entries use .js, .mjs or .cjs`,
      });
      continue;
    }

    // The purity scan runs BEFORE the trust gate, deliberately: an impure module
    // is refused whether or not a human approved it, because a grant is approval
    // of code a reader read and not permission to depend on the clock. Ordering
    // it the other way would have made "grant it and see" the way to find out.
    // docs/cli.md §trust: a matching digest in either scope approves (D-006).
    let authorizedBy: GrantScope | undefined;
    if (options.beforeGrant !== true) {
      const verdict = trustVerdict(readTrustStore(), vaultRoot, `module:${name}`, digest);
      if (verdict.kind !== "authorized") {
        issues.push(trustRefusal(name, digest, verdict));
        continue;
      }
      authorizedBy = verdict.scope;
    }

    let manifest: ModuleManifest;
    try {
      const imported = (await import(pathToFileURL(entry).href)) as { default?: unknown };
      const candidate = imported.default;
      // The one key a manifest must carry is `id`; every other key is
      // optional and its shape is judged by `loadModules`, which names it.
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        typeof (candidate as ModuleManifest).id !== "string"
      ) {
        throw new Error('its default export is not a module manifest (no string "id")');
      }
      manifest = candidate as ModuleManifest;
      // docs/extending.md §Declaring a module: a manifest may STATE its version, and it must then
      // agree with the package. Silently ignoring a stated one would make the
      // field accepted-but-inert; taking it instead of the package's would give
      // a reviewer two answers to "what version is this".
      if (manifest.version !== undefined && manifest.version !== version) {
        throw new Error(
          `its manifest states version ${manifest.version}; the package says ${version}`,
        );
      }
    } catch (error) {
      issues.push({
        code: "module-load-failed",
        package: name,
        message: `"${name}" failed to load: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    loaded.push({
      package: name,
      version,
      digest,
      // docs/extending.md §The determinism fixture: a finding's attribution reads the manifest's version,
      // and the installed package's is the one the grant digest covers.
      manifest: { ...manifest, version },
      fixture,
      ...(authorizedBy === undefined ? {} : { authorizedBy }),
    });
  }

  return { loaded, issues };
}

// ---------------------------------------------------------------------------
// the preload cache (docs/extending.md §Declaring a module)

/**
 * Loading a module is the shell's ONE asynchronous step — `import` is async and
 * `loadVault` is not. Rather than making every verb async for one step, the CLI
 * entry point performs it once, before dispatch, and stores the outcome here
 * keyed by the resolved vault root.
 *
 * The cache is what makes the failure CLOSED rather than quiet: `loadVaultVia`
 * asks for it whenever `config/engine.json` declares a module, and a bundle whose
 * modules were never preloaded is refused by name instead of being judged under
 * the standard library alone. A vault judged without a law it declares is judged
 * under a different law than it believes (docs/extending.md §Adopting a new version).
 */
const PRELOADED = new Map<string, ModuleLoadOutcome>();

export function preloadedModules(vaultRoot: string): ModuleLoadOutcome | undefined {
  return PRELOADED.get(resolve(vaultRoot));
}

/** Load every declared module and remember the outcome for this root. */
export async function preloadModules(
  vaultRoot: string,
  declarations: readonly ModuleDeclaration[],
  options: ModuleLoadOptions = {},
): Promise<ModuleLoadOutcome> {
  const outcome = await loadDeclaredModules(vaultRoot, declarations, options);
  PRELOADED.set(resolve(vaultRoot), outcome);
  return outcome;
}

/**
 * Plant an ALREADY-RESOLVED module set for a root. The one caller is
 * `modules plan`, which judges this bundle under a module set it does not yet
 * declare; every other path resolves from the root it plants for, and the
 * exception is named here so a reader meets it rather than finds it.
 */
export function plantPreloadedModules(vaultRoot: string, outcome: ModuleLoadOutcome): void {
  PRELOADED.set(resolve(vaultRoot), outcome);
}

/** Test-only: forget one root's outcome, so a case can load it again differently. */
export function forgetPreloadedModules(vaultRoot?: string): void {
  if (vaultRoot === undefined) PRELOADED.clear();
  else PRELOADED.delete(resolve(vaultRoot));
}

/**
 * docs/extending.md §Declaring a module: the declarations, read from a bundle's `config/engine.json`
 * without loading the rest of it. The entry point needs them before the vault
 * loads, and a malformed file is the vault loader's refusal to make, not this
 * function's — so it answers "none" and lets the loader speak.
 */
export function declaredModulesOf(vaultRoot: string): ModuleDeclaration[] {
  const file = join(resolve(vaultRoot), "config", "engine.json");
  if (!existsSync(file)) return [];
  try {
    return declaredModulesIn(readJson(file));
  } catch {
    return [];
  }
}

/** The declarations in an already-parsed engine.json — what `init` reads off a starter's bytes before they land. */
export function declaredModulesIn(engineJson: unknown): ModuleDeclaration[] {
  const parsed = engineJson as { modules?: unknown } | null;
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.modules)) return [];
  const out: ModuleDeclaration[] = [];
  for (const raw of parsed.modules) {
    if (raw === null || typeof raw !== "object") continue;
    const record = raw as { package?: unknown; version?: unknown };
    if (typeof record.package !== "string") continue;
    out.push(
      typeof record.version === "string"
        ? { package: record.package, version: record.version }
        : { package: record.package },
    );
  }
  return out;
}

/**
 * docs/cli.md §trust: what a module grant is pinned to — the sha256 over the
 * package's own executable bytes, plus the purity violations the grant would be
 * approving. Exposed so `trust grant` can refuse an impure module before writing
 * a grant that reads as approval and buys nothing.
 */
export function moduleDigest(
  vaultRoot: string,
  name: string,
  declaredEntry?: string,
):
  | { sha256: string; files: string[]; violations: (PurityViolation & { file: string })[] }
  | undefined {
  const root = packageRoot(vaultRoot, name);
  if (root === undefined) return undefined;
  let entry = declaredEntry;
  if (entry === undefined) {
    try {
      const contract = contractOf(readJson(join(root, "package.json")));
      if (contract !== undefined) entry = insidePackage(root, contract.module);
    } catch {
      // The loader reports the malformed package; known executable files are
      // still scanned so trust grant cannot approve ordinary impure code.
    }
  }
  const files = moduleFiles(root);
  const violations: (PurityViolation & { file: string })[] = [];
  const parts: string[] = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    parts.push(`${file.slice(root.length)} ${sha256Of(bytes)}`);
    if (file !== entry && !EXECUTABLE.test(file)) continue;
    for (const violation of scanPurity(bytes.toString("utf8"))) {
      violations.push({ ...violation, file: file.slice(root.length + 1) });
    }
  }
  return { sha256: sha256Of(parts.join("\n")), files, violations };
}
