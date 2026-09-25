// docs/extending.md §Declaring a module, docs/extending.md §The determinism fixture, docs/extending.md §Adopting a new version
// docs/architecture.md §Directories (the shell owns fs; core stays pure).
//
// Loading a module a bundle declares. Every step below is a REFUSAL with a name,
// because a module the engine cannot vouch for must not be judged with: a bundle
// judged without a law it declares is judged under a different law than it
// believes. Installing a module is the consent to run it; what the load adds
// is two proofs over the installed bytes, the purity scan and the determinism
// fixture, run before the module judges anything of the bundle's.
//
// Nothing here reaches the network. Resolution is node's own, from the bundle's
// own `node_modules`, which is what a workspace link, a `file:` dependency and a
// locally packed tarball all produce — or, when the declaration names a `path`,
// that directory of the bundle's and nothing else. The digest over every file of
// the package is what the law names and what the proofs are cached by; no
// lockfile is read.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  codeUnitCompare,
  type ModuleManifest,
  normalizeInput,
  PATH_REFUSALS,
  PURITY_SCAN_VERSION,
  type PurityViolation,
  pathRefusal,
  satisfiesEngineRange,
  scanPurity,
} from "@wikiwright/core";
import { ENGINE_VERSION } from "./envelope.ts";
import {
  type FixtureResult,
  type FixtureSubject,
  type FixtureVerdict,
  runModuleFixture,
} from "./modulefixture.ts";
import { sha256Of } from "./sha256.ts";

/** docs/extending.md §Declaring a module: what `config/engine.json` declares. */
export interface ModuleDeclaration {
  /** The package name, resolved from the bundle's own `node_modules` unless `path` is declared. */
  package: string;
  /** The range the bundle expects; the resolved version must satisfy it. */
  version?: string;
  /** A bundle-relative directory holding the package: authoritative, with no fallback. */
  path?: string;
}

/** One refusal, with everything a reader needs to act on it. */
export interface ModuleIssue {
  code:
    | "module-unresolved"
    | "module-malformed"
    | "module-version-mismatch"
    | "module-incompatible"
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
  /** sha256 over every file of the package — what the law names and the proofs are cached by. */
  digest: string;
  manifest: ModuleManifest;
  /** Where the module's determinism fixture lives. */
  fixture: string;
  /** What the determinism fixture judged on these bytes, in this process, before the module was admitted. */
  fixtureResult: FixtureResult;
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
 * docs/extending.md §Declaring a module: where a declaration says its package lies, spelled
 * relative to the bundle — the declared `path`, or `node_modules/<package>`.
 * What `modules list` prints as a module's resolved path.
 */
export function moduleLocation(declaration: ModuleDeclaration): string {
  return declaration.path ?? `node_modules/${declaration.package}`;
}

/** Where a declared module's package lies, or the refusal that says why it does not. */
type Resolution = { ok: true; root: string } | { ok: false; issue: ModuleIssue };

/**
 * docs/extending.md §Declaring a module: the ONE resolver of a declaration to a package directory,
 * read by the loader, the digest and so the law digest, and `modules list`.
 *
 * Without a `path`, node's own resolution, from the BUNDLE — never from the
 * engine's own tree. A module the engine can see and the bundle cannot is a
 * module the bundle does not depend on, and `docs/extending.md §A check`
 * refuses a reference to one.
 *
 * With a `path`, that directory and no other: an explicit location that fell
 * back to `node_modules` would judge a bundle with a module it did not name.
 * The path is held to the vault path law, as the schema holds it, and the
 * directory's real path must lie inside the bundle's: a link that leaves the
 * bundle is a module the bundle does not carry.
 */
function resolveModule(vaultRoot: string, declaration: ModuleDeclaration): Resolution {
  const name = declaration.package;
  const declared = declaration.path;
  if (declared === undefined) {
    const boundary = resolve(vaultRoot, "node_modules");
    const candidate = resolve(boundary, ...name.split("/"));
    if (candidate.startsWith(boundary + sep) && existsSync(join(candidate, "package.json"))) {
      return { ok: true, root: candidate };
    }
    return {
      ok: false,
      issue: {
        code: "module-unresolved",
        package: name,
        message: `config/engine.json declares module "${name}", which this bundle does not have installed`,
        hint: "install it into this bundle's own node_modules — package.json names it as a workspace link or a `file:<path>` to the package, and the package manager's install lands it; it loads on first use and is proved then",
      },
    };
  }
  const refusal = pathRefusal(declared);
  if (refusal !== undefined) {
    return {
      ok: false,
      issue: {
        code: "module-malformed",
        package: name,
        message: `config/engine.json declares module "${name}" at "${declared}", which is not a directory inside the bundle: it ${PATH_REFUSALS[refusal]}`,
        hint: "a declared path is relative to the bundle root, with no leading `/` and no `..` segment",
        details: { path: declared },
      },
    };
  }
  const candidate = resolve(vaultRoot, ...declared.split("/"));
  let directory = false;
  try {
    directory = statSync(candidate).isDirectory();
  } catch {
    // Nothing there: unresolved, below.
  }
  if (!directory) {
    return {
      ok: false,
      issue: {
        code: "module-unresolved",
        package: name,
        message: `config/engine.json declares module "${name}" at "${declared}", where this bundle has no directory`,
        hint: "a declared path is the only place the module is read from; put the package's directory there, or declare where it is",
        details: { path: declared },
      },
    };
  }
  const bundle = realpathSync(vaultRoot);
  const real = realpathSync(candidate);
  if (!real.startsWith(bundle + sep)) {
    return {
      ok: false,
      issue: {
        code: "module-malformed",
        package: name,
        message: `config/engine.json declares module "${name}" at "${declared}", which resolves outside the bundle, to "${real}"`,
        hint: "a module declared by path is one the bundle carries; a link that leaves the bundle names a directory the bundle does not hold",
        details: { path: declared, resolved: real },
      },
    };
  }
  return { ok: true, root: candidate };
}

const PACKAGE_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function isPackageVersion(value: unknown): value is string {
  return typeof value === "string" && PACKAGE_VERSION.test(value);
}

/**
 * docs/extending.md §Loading a module: the files a module is — what its digest
 * covers and what an export carries of it, one list for both. Every lexical
 * path under the package root, relative to it, read through links; the
 * package's own `node_modules` is the one exclusion. A directory reached by
 * two lexical paths is listed under both, since a package may name either; a
 * link back to a directory above it is a cycle and is not walked again.
 */
export function moduleInventory(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string, chain: ReadonlySet<string>): void => {
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (chain.has(real)) return;
    const inner = new Set(chain).add(real);
    for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
      // `node_modules` is the package's DEPENDENCY TREE, pinned by its
      // own lockfile rather than by this digest, and it is the only exclusion.
      // A dot-prefix used to be one too, and it was a hole: a package could name
      // `.hidden.mjs` as its entry, load it, and edit it afterwards without
      // moving the digest a single bit.
      if (entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      const at = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path, at, inner);
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
          // A broken link hashes as the read failure it is.
        }
        if (directory) {
          walk(path, at, inner);
          continue;
        }
      }
      out.push(at);
    }
  };
  walk(root, "", new Set());
  return out.sort(codeUnitCompare);
}

/**
 * A module's digest over its files, each a path relative to the package root
 * and its bytes: sha256 over one line per file, `/<path> <sha256 of bytes>`,
 * in code-unit order of path. `moduleDigest` computes it over the installed
 * package; an export computes it over the bytes it carries.
 */
export function moduleDigestOf(files: readonly { path: string; bytes: Buffer }[]): string {
  return sha256Of(
    [...files]
      .sort((a, b) => codeUnitCompare(a.path, b.path))
      .map((file) => `/${file.path} ${sha256Of(file.bytes)}`)
      .join("\n"),
  );
}

/**
 * What the digest COVERS is every file, and what the purity scan READS is the
 * executable ones. The two differ on purpose.
 *
 * A digest over the code alone was a hole: `package.json` names the entry, so
 * repointing `wikiwright.module` at another file already in the package runs
 * different code under an unchanged digest — a proved module, quietly swapped.
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
 * changed nothing the digest could see.
 *
 * The test is LEXICAL, and deliberately not `realpath`. A `file:` install links
 * each of a package's files at an absolute path back into its source tree, so
 * every legitimate local install would fail a realpath containment test — and
 * local installs are the whole of `docs/extending.md §Declaring a module`. What closes the hole is
 * not where a link points but whether the digest covers it: `moduleInventory` reads
 * THROUGH links, so a linked file's bytes are in the digest and editing them
 * moves it. The caller asserts that membership, which is the property that
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
}

/**
 * The fixture's refusal as the load reports it. A fixture that could not be
 * read, loaded or composed carries no hint of its own, and a refusal that
 * says what a fixture is tells its reader what to repair.
 */
const FIXTURE_HINT =
  "a module ships input bytes and the findings they must produce; the engine runs it before the module judges anything of yours";

/**
 * The determinism fixtures already run in this process, by what they proved:
 * the digest of the module's bytes (the fixture's own bytes among them), the
 * scanner version, and the declared name the outcome is reported under. Not
 * by root and entry: two bundles that install the same bytes share one proof.
 *
 * Invocation-local, never persisted. The fixture composes the standard
 * library and runs the judge, so its outcome is a function of this engine as
 * well as of the module's bytes, and a cache that outlived the process would
 * have to key on the engine too (docs/roadmap.md).
 */
const FIXTURE_VERDICTS = new Map<string, FixtureVerdict>();
let fixtureRuns = 0;

/** Test-only: how many determinism fixtures this process has run, cached ones not counted. */
export function fixtureRunCount(): number {
  return fixtureRuns;
}

function provedFixture(digest: string, module: FixtureSubject): FixtureVerdict {
  const key = `${digest}\u0000${String(PURITY_SCAN_VERSION)}\u0000${module.package}`;
  const known = FIXTURE_VERDICTS.get(key);
  if (known !== undefined) return known;
  fixtureRuns += 1;
  const verdict = runModuleFixture(module);
  FIXTURE_VERDICTS.set(key, verdict);
  return verdict;
}

/**
 * docs/extending.md §Declaring a module + docs/extending.md §The determinism fixture: resolve, pin, check compatibility,
 * scan, load, prove. Each step refuses by name, and a refused module contributes
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

    const resolved = resolveModule(vaultRoot, declaration);
    if (!resolved.ok) {
      issues.push(resolved.issue);
      continue;
    }
    const root = resolved.root;

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
    // bundle's declared range is checked against it. The digest covers the
    // BYTES (`moduleDigest`, package.json included), so the version the law
    // names and the version that judged are the same file.
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

    // Resolve the two executable inputs lexically inside the installation
    // before scanning. `moduleDigest` resolves the entry from the same
    // package.json, so it is scanned regardless of suffix using the same bytes
    // that feed the digest.
    const entry = insidePackage(root, contract.module);
    if (entry === undefined) {
      issues.push({
        code: "module-malformed",
        package: name,
        message: `"${name}" names an entry at "${contract.module}", which does not resolve to a file inside the package`,
        hint: "a module's entry is one of the files its digest covers; a path that leaves the package is code no digest covers",
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

    // One definition of "the module's bytes": the law digest, the purity scan,
    // the fixture's cache and the `modules list` row all read the same digest,
    // so a proof cannot be taken of one reading and reported for another.
    const scanned = moduleDigest(vaultRoot, declaration);
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

    // docs/extending.md §The determinism fixture: a finding's attribution reads the manifest's version,
    // and the installed package's is the one the digest covers.
    const stated = { ...manifest, version };

    // docs/extending.md §The determinism fixture: the module is proved on these bytes, in this
    // process, before any bundle is judged with it — once per digest, however
    // many bundles or loads ask. A module that does not reproduce its own
    // findings is refused like any other step, and contributes nothing.
    const proved = provedFixture(digest, { package: name, manifest: stated, fixture });
    if (!proved.ok) {
      issues.push(
        proved.issue.hint === undefined ? { ...proved.issue, hint: FIXTURE_HINT } : proved.issue,
      );
      continue;
    }

    loaded.push({
      package: name,
      version,
      digest,
      manifest: stated,
      fixture,
      fixtureResult: proved.result,
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
 * keyed by the resolved vault root: an outcome is a bundle's declarations
 * loaded, which `loadVaultVia` looks up by the root it reads. The proofs inside
 * it are cached by digest, beside the loader.
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
    return declaredModulesInText(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/**
 * The declarations in engine.json's text, parsed as the vault loader parses
 * it: `normalizeInput` first, so a byte order mark the loader accepts declares
 * the same modules here. A second convention was how a config the loader read
 * declared no module to the preload and none to the law digest. Text that does
 * not parse declares none; the loader refuses it by name.
 */
export function declaredModulesInText(text: string): ModuleDeclaration[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizeInput(text).text);
  } catch {
    return [];
  }
  return declaredModulesIn(parsed);
}

/** The declarations in an already-parsed engine.json — what `init` reads off a starter's bytes before they land. */
export function declaredModulesIn(engineJson: unknown): ModuleDeclaration[] {
  const parsed = engineJson as { modules?: unknown } | null;
  if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.modules)) return [];
  const out: ModuleDeclaration[] = [];
  for (const raw of parsed.modules) {
    if (raw === null || typeof raw !== "object") continue;
    const record = raw as { package?: unknown; version?: unknown; path?: unknown };
    if (typeof record.package !== "string") continue;
    out.push({
      package: record.package,
      ...(typeof record.version === "string" ? { version: record.version } : {}),
      ...(typeof record.path === "string" ? { path: record.path } : {}),
    });
  }
  return out;
}

export interface ModuleDigest {
  sha256: string;
  files: string[];
  violations: (PurityViolation & { file: string })[];
}

/** One reading of a package's bytes: the digest over them and the files it covers. */
interface ModuleReading {
  sha256: string;
  files: string[];
  /** The entry package.json names, scanned whatever its suffix; absent when it names none. */
  entry: string | undefined;
}

/**
 * One reading of a package per process. The preload, the brief's law digest
 * and the envelope's each ask for the same package's digest, and each read and
 * hashed every file of it. Keyed by the resolved package root, since bytes are
 * read where they lie; what is proved of them is keyed by their digest, below.
 * Invocation-local: nothing outlives the process, so no state is kept between
 * runs (docs/roadmap.md §Every run parses the whole corpus), and no verb writes
 * a module's files while it runs.
 */
const READINGS = new Map<string, ModuleReading>();

/**
 * The purity scan of a package, by the digest of its bytes and the scanner
 * version: the digest covers every file and the package.json that names the
 * entry, so equal digests scan equally, and a new rule is a new version.
 */
const SCANS = new Map<string, ModuleDigest["violations"]>();

/** The entry the package's own package.json names, resolved inside it, or undefined. */
function entryOf(root: string): string | undefined {
  try {
    const contract = contractOf(readJson(join(root, "package.json")));
    return contract === undefined ? undefined : insidePackage(root, contract.module);
  } catch {
    // The loader reports the malformed package; the known executable files
    // are still scanned.
    return undefined;
  }
}

/**
 * The sha256 over every file of an installed package, the files it covers,
 * and the purity violations in its executable ones. The law digest names it,
 * the loader proves the module under it, and `modules list` reports it.
 * Undefined when the declaration resolves to no package.
 */
export function moduleDigest(
  vaultRoot: string,
  declaration: ModuleDeclaration,
): ModuleDigest | undefined {
  const resolved = resolveModule(vaultRoot, declaration);
  if (!resolved.ok) return undefined;
  const root = resolved.root;
  let reading = READINGS.get(root);
  let read: Map<string, Buffer> | undefined;
  if (reading === undefined) {
    const entry = entryOf(root);
    const inventory = moduleInventory(root);
    const files = inventory.map((rel) => join(root, rel));
    read = new Map();
    const contents: { path: string; bytes: Buffer }[] = [];
    for (const [k, rel] of inventory.entries()) {
      const file = files[k] as string;
      const bytes = readFileSync(file);
      read.set(file, bytes);
      contents.push({ path: rel, bytes });
    }
    reading = { sha256: moduleDigestOf(contents), files, entry };
    READINGS.set(root, reading);
  }
  const scanKey = `${reading.sha256}\u0000${String(PURITY_SCAN_VERSION)}`;
  let violations = SCANS.get(scanKey);
  if (violations === undefined) {
    violations = [];
    for (const file of reading.files) {
      if (file !== reading.entry && !EXECUTABLE.test(file)) continue;
      const bytes = read?.get(file) ?? readFileSync(file);
      for (const violation of scanPurity(bytes.toString("utf8"))) {
        violations.push({ ...violation, file: file.slice(root.length + 1) });
      }
    }
    SCANS.set(scanKey, violations);
  }
  return { sha256: reading.sha256, files: reading.files, violations };
}
