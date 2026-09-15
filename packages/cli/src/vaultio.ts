// docs/architecture.md §Directories (the shell owns fs; core stays pure) · docs/architecture.md (zero-dep walking:
// readdir recursive + code-unit sort) · registry file locations.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  codeUnitCompare,
  type EngineConfig,
  type FlattenedRegistry,
  isContentPath,
  lintPage,
  loadConstitution,
  loadEngineConfig,
  loadModules,
  type ModuleRegistry,
  normalizeInput,
  PATH_REFUSALS,
  parseDoc,
  pathRefusal,
  type RegistryIssue,
  STANDARD_LIBRARY,
  standardLibrary,
} from "@wikiwright/core";
import { type CommandResult, fail } from "./envelope.ts";
import { type LoadedModule, preloadedModules } from "./moduleload.ts";
import { vaultReadAbsolute } from "./paths.ts";

export type VaultLoad =
  | {
      ok: true;
      registry: FlattenedRegistry;
      /** docs/extending.md §What a module registers: the one module set used to load and later judge this law. */
      modules: ModuleRegistry;
      /** docs/extending.md §Declaring a module: the declared modules, as resolved, pinned and proved. */
      loadedModules: readonly LoadedModule[];
      engine: EngineConfig;
    }
  | { ok: false; result: CommandResult };

/** How the loader reads config bytes: the working tree, or the git index (docs/cli.md §lint --staged). */
export interface VaultReader {
  exists(rel: string): boolean;
  read(rel: string): string;
}

export function fsReader(root: string): VaultReader {
  return {
    exists: (rel) => {
      const refusal = pathRefusal(rel);
      if (refusal !== undefined) {
        throw new Error(`refusing to read "${rel}": it ${PATH_REFUSALS[refusal]}`);
      }
      if (!existsSync(join(root, rel))) return false;
      vaultReadAbsolute(root, rel);
      return true;
    },
    read: (rel) => readFileSync(vaultReadAbsolute(root, rel), "utf8"),
  };
}

export interface VaultLoadOptions {
  /**
   * docs/extending.md §Declaring a module: the vault root, for the reader that does not
   * carry one. A module set is preloaded per root, so a loader reading the git
   * index or a past revision still asks for the modules of the WORKING TREE it
   * sits in — the law a bundle declares is the law at the root, and a replay
   * that loaded a different module set would judge two revisions under two laws.
   */
  root?: string;
}

export function loadVault(command: string, root: string, options?: VaultLoadOptions): VaultLoad {
  if (!existsSync(root)) {
    return {
      ok: false,
      result: fail(command, "not_found", "vault-not-found", `no vault at "${root}"`, {
        hint: "pass --root <path> pointing at a wikiwright vault",
      }),
    };
  }
  const loaded = loadVaultVia(command, fsReader(root), { ...options, root });
  if (!loaded.ok) return loaded;
  for (const contentRoot of loaded.engine.content_roots ?? []) {
    if (!existsSync(join(root, contentRoot))) continue;
    try {
      vaultReadAbsolute(root, contentRoot);
    } catch {
      return {
        ok: false,
        result: fail(
          command,
          "constitution",
          "content-root-outside",
          `content root "${contentRoot}" resolves outside the vault`,
        ),
      };
    }
  }
  return loaded;
}

/** docs/constitution.md §config/constitution.json: the one law a bundle is written in. */
export const CONSTITUTION_PATH = "config/constitution.json";

export function loadVaultVia(
  command: string,
  reader: VaultReader,
  options?: VaultLoadOptions,
): VaultLoad {
  if (!reader.exists(CONSTITUTION_PATH)) {
    return {
      ok: false,
      result: fail(
        command,
        "not_found",
        "registry-not-found",
        `missing constitution: ${CONSTITUTION_PATH}`,
        { hint: "a vault carries config/constitution.json; `wikiwright init` scaffolds one" },
      ),
    };
  }
  let constitutionJson: unknown;
  try {
    constitutionJson = JSON.parse(normalizeInput(reader.read(CONSTITUTION_PATH)).text);
  } catch (e) {
    return {
      ok: false,
      result: fail(
        command,
        "constitution",
        "registry-unparseable",
        `registry JSON failed to parse: ${String(e)}`,
      ),
    };
  }
  // config/engine.json: a closed set; unknown keys fail
  // loudly. Loaded FIRST because the modules it declares compose the registry
  // the constitution is validated under.
  let engine: EngineConfig = {};
  const enginePath = "config/engine.json";
  if (reader.exists(enginePath)) {
    let engineJson: unknown;
    try {
      engineJson = JSON.parse(normalizeInput(reader.read(enginePath)).text);
    } catch (e) {
      return {
        ok: false,
        result: fail(
          command,
          "constitution",
          "registry-unparseable",
          `engine.json failed to parse: ${String(e)}`,
        ),
      };
    }
    const loadedEngine = loadEngineConfig(engineJson);
    if (!loadedEngine.ok) {
      return {
        ok: false,
        result: fail(
          command,
          "constitution",
          "constitution-invalid",
          `config/engine.json has ${loadedEngine.issues.length} validation issue(s)`,
          { data: { issues: loadedEngine.issues } },
        ),
      };
    }
    engine = loadedEngine.config;
  }
  // docs/extending.md §What a module registers: compose once. The bundle's declared modules are validated under
  // one registry and never reconstructed differently by the judge.
  //
  // docs/extending.md §Adopting a new version: a declared module that did not load is a
  // REFUSAL, not a quieter law. Loading is the shell's one async step and it
  // happens at the entry point (`preloadModules`); a bundle that declares one
  // and whose preload never ran is told so by name rather than judged under the
  // standard library alone.
  const declared = engine.modules ?? [];
  let modules: ModuleRegistry;
  let loadedModules: readonly LoadedModule[] = [];
  if (declared.length === 0) {
    modules = standardLibrary();
  } else {
    const outcome = options?.root === undefined ? undefined : preloadedModules(options.root);
    if (outcome === undefined) {
      return {
        ok: false,
        result: fail(
          command,
          "constitution",
          "module-not-loaded",
          `config/engine.json declares ${declared.length} module(s); they were not loaded before this vault was read`,
          {
            hint: "run the CLI from its entry point, which loads declared modules before dispatch",
            data: { modules: declared.map((m) => m.package) },
          },
        ),
      };
    }
    if (outcome.issues.length > 0) {
      const first = outcome.issues[0];
      return {
        ok: false,
        result: fail(
          command,
          "constitution",
          first?.code ?? "module-unresolved",
          `${outcome.issues.length} declared module(s) did not load: ${outcome.issues
            .map((i) => `${i.package} (${i.code})`)
            .join(", ")}`,
          {
            ...(first?.hint === undefined ? {} : { hint: first.hint }),
            data: { issues: outcome.issues },
          },
        ),
      };
    }
    // docs/extending.md §The determinism fixture: every module here passed the trust gate, and the grant
    // that admitted it was written only after its determinism fixture passed on
    // these exact bytes (`trust grant`). A load under the granted digest is the
    // same proof; it is not run again on every read.
    const composed = loadModules([...STANDARD_LIBRARY, ...outcome.loaded.map((m) => m.manifest)]);
    if (!composed.ok) {
      return {
        ok: false,
        result: fail(
          command,
          "constitution",
          "module-conflict",
          `the declared modules collide: ${composed.conflicts
            .map((c) => `${c.kind} "${c.id}" (${c.claimants.join(" and ")})`)
            .join(", ")}`,
          {
            hint: "two modules declaring one identifier is a load error, raised before any module code runs",
            data: { conflicts: composed.conflicts },
          },
        ),
      };
    }
    modules = composed.registry;
    loadedModules = outcome.loaded;
  }

  // The engine has NO content-roots default. A bundle says which
  // directories hold its pages, and a bundle that does not say is a bundle the
  // engine would have to guess about.
  if (engine.content_roots === undefined) {
    return {
      ok: false,
      result: fail(
        command,
        "constitution",
        "content-roots-required",
        "config/engine.json declares no content_roots; a bundle says which directories hold its pages",
        { hint: 'add `"content_roots": ["wiki"]` (or your own roots) to config/engine.json' },
      ),
    };
  }
  const constitution = loadConstitution(constitutionJson, modules);
  if (!constitution.ok) {
    return { ok: false, result: invalidConstitution(command, constitution.issues) };
  }
  const loaded = { registry: constitution.registry, modules };

  // A declared template or golden example is a contract
  // evaluated continuously — it must exist, name its own type, and (for an
  // example) satisfy that type's rules. A template that lies is worse than
  // no template.
  const missingDeclared: Array<{ code: string; where: string; message: string }> = [];
  for (const [name, effective] of loaded.registry.types) {
    for (const [label, declared] of [
      ["template", effective.template],
      ["example", effective.example],
    ] as const) {
      if (declared === undefined) continue;
      // docs/extending.md §What a module registers: a module-contributed template is
      // BYTES the engine already holds, under a namespaced name — there is no
      // file for it to be missing, and a bundle that declares its own path still
      // meets this check unchanged.
      if (modules.templates.has(declared.value)) continue;
      const refusal = pathRefusal(declared.value);
      if (refusal !== undefined) {
        missingDeclared.push({
          code: "template-path-invalid",
          where: `type:${name} (${label})`,
          message: `"${declared.value}" is not a vault path: it ${PATH_REFUSALS[refusal]}`,
        });
        continue;
      }
      try {
        if (!reader.exists(declared.value)) {
          missingDeclared.push({
            code: "template-missing",
            where: `type:${name} (${label})`,
            message: `declared file does not exist: ${declared.value}`,
          });
          continue;
        }
      } catch {
        missingDeclared.push({
          code: "template-path-invalid",
          where: `type:${name} (${label})`,
          message: `"${declared.value}" resolves outside the vault`,
        });
        continue;
      }
      if (label !== "example") continue;
      let exampleText: string;
      try {
        exampleText = reader.read(declared.value);
      } catch {
        missingDeclared.push({
          code: "template-path-invalid",
          where: `type:${name} (${label})`,
          message: `"${declared.value}" could not be read inside the vault`,
        });
        continue;
      }
      const exampleDoc = parseDoc(normalizeInput(exampleText).text);
      const declaredType = exampleDoc.frontmatter.value["type"];
      if (declaredType !== name) {
        missingDeclared.push({
          code: "template-invalid",
          where: `type:${name} (example)`,
          message: `${declared.value}: declares type ${JSON.stringify(declaredType)}, not "${name}"`,
        });
        continue;
      }
      const exampleFindings = lintPage({
        path: declared.value,
        doc: exampleDoc,
        registry: loaded.registry,
      }).filter((f) => f.severity === "error");
      if (exampleFindings.length > 0) {
        missingDeclared.push({
          code: "template-invalid",
          where: `type:${name} (example)`,
          message: `${declared.value}: fails its own contract — ${exampleFindings[0]?.message ?? ""}`,
        });
      }
    }
  }
  if (missingDeclared.length > 0) {
    return {
      ok: false,
      result: fail(
        command,
        "constitution",
        "constitution-invalid",
        `${missingDeclared.length} declared template/example file(s) missing`,
        {
          data: {
            issues: missingDeclared.map((m) => ({
              code: m.code,
              where: m.where,
              message: m.message,
            })),
          },
        },
      ),
    };
  }

  return {
    ok: true,
    registry: loaded.registry,
    modules: loaded.modules,
    loadedModules,
    engine,
  };
}

function invalidConstitution(command: string, issues: readonly RegistryIssue[]): CommandResult {
  return fail(
    command,
    "constitution",
    "constitution-invalid",
    `the constitution has ${issues.length} validation issue(s)`,
    { data: { issues } },
  );
}

/** All markdown pages under the content roots, repo-relative POSIX paths, code-unit sorted. */
export function walkPages(root: string, roots: readonly string[]): string[] {
  const pages: string[] = [];
  for (const contentRoot of roots) {
    const base = join(root, contentRoot);
    if (!existsSync(base)) continue;
    const containedRoot = vaultReadAbsolute(root, contentRoot);
    for (const entry of readdirSync(containedRoot, { recursive: true, encoding: "utf8" })) {
      // Backslash is a directory separator only on Windows; on POSIX it is a
      // legal filename character.
      const sepFixed = process.platform === "win32" ? entry.replaceAll("\\", "/") : entry;
      // Paths are stored NFC so artifacts are byte-stable across filesystems
      //; readPage falls back to the NFD form for on-disk lookup.
      const rel = sepFixed.normalize("NFC");
      if (!rel.endsWith(".md")) continue;
      const path = `${contentRoot}/${rel}`;
      // The walk may not produce a path the law refuses, or the two
      // state constructors disagree — the working tree would judge a page the
      // git index filters out, and `docs/architecture.md §How a verdict is produced`'s whole point is that they cannot.
      // On POSIX the only names this reaches are the ones carrying a backslash
      // or a control character, which are exactly the names that would have two
      // identities on two filesystems.
      if (!isContentPath(path, roots)) continue;
      // The walk decides shape; containment is decided where the bytes are
      // read (`readPage`), once per page, so a page symlinked out of the vault
      // is refused by the read every consumer of this list performs.
      pages.push(path);
    }
  }
  pages.sort(codeUnitCompare);
  return pages;
}

export function readPage(root: string, relPath: string): string {
  try {
    return readFileSync(vaultReadAbsolute(root, relPath), "utf8");
  } catch (e) {
    // Walk stores NFC paths; on NFD-preserving filesystems the on-disk name may
    // be the decomposed form (normalization seam).
    const nfd = relPath.normalize("NFD");
    if (nfd !== relPath) return readFileSync(vaultReadAbsolute(root, nfd), "utf8");
    throw e;
  }
}
