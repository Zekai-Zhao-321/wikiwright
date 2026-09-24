// docs/cli.md §hook, docs/cli.md, docs/cli.md §move · docs/architecture.md §The invariants (
// every engine.json key names its consumer) (a closed
// set; unknown keys fail) · docs/extending.md §Declaring a module (the module packages a
// bundle loads) · docs/constitution.md §exports, §plugin (what a bundle exports as a
// skill, and the plugin manifests beside them).
import { z } from "zod";
import { PATH_REFUSALS, pathRefusal } from "../paths/index.ts";
import { parseEngineRange } from "../version/index.ts";
import type { RegistryIssue } from "./model.ts";

export type FolderTagMode = "off" | "validate" | "materialize-add-only";

export interface EngineConfig {
  content_roots?: string[];
  /** docs/cli.md §hook: the semver range the running engine must satisfy. */
  engine?: string;
  /** docs/cli.md: the commit-msg hook refuses a prefix outside this set. */
  commit_prefixes?: { prefixes: string[] };
  /** docs/cli.md §move: the closed set of justifications a move may state; undeclared ⇒ any non-empty reason. */
  move_reasons?: string[];
  field_sources?: { title?: "basename"; description?: "lede" };
  folder_tag_aliases?: Record<string, string>;
  folder_tags?: { mode: FolderTagMode };
  /** Roots holding evidence pages — body links into them are citations. */
  source_roots?: string[];
  /** The x- escape becomes a declared namespace set when a bundle wants it. */
  extensions?: { mode: "open" | "registered"; namespaces?: string[]; fields?: string[] };
  /**
   * docs/extending.md §Declaring a module: the module packages this bundle loads. Resolved
   * from the bundle's own `node_modules`, or, when `path` is declared, from
   * that bundle-relative directory and nowhere else; `version` is the RANGE the
   * bundle expects, and an installed version outside it is a load error.
   */
  modules?: { package: string; version?: string; path?: string }[];
  /** docs/constitution.md §exports: the read-only copies this bundle renders as skills. */
  exports?: ExportDeclaration[];
  /** docs/constitution.md §plugin: the plugin manifests written beside the exports. */
  plugin?: PluginDeclaration;
}

/** docs/constitution.md §exports: which pages an export carries. */
export type ExportSelect =
  | { kind: "all" }
  | { kind: "tag"; tags: string[] }
  | { kind: "directory"; directories: string[] };

/** docs/constitution.md §exports: where a problem with a copy is reported, as the bundle declares it. */
export interface ExportContribution {
  mode: "issues" | "pull-requests" | "local-folder" | "none";
  repository?: string;
  folder?: string;
}

/** docs/constitution.md §exports: one export, as `config/engine.json` spells it, no default applied. */
export interface ExportDeclaration {
  name?: string;
  select: ExportSelect;
  sources?: "exclude" | "include";
  output?: "skills" | "external";
  repository?: string;
  links?: "closed" | "cut";
  guide?: string;
  contribution: ExportContribution;
  skill?: string;
  license?: string;
}

/** docs/constitution.md §plugin: the three strings both plugin manifests carry. */
export interface PluginDeclaration {
  name: string;
  version: string;
  description: string;
}

/**
 * docs/constitution.md §exports: the Agent Skills name grammar — lower-case
 * letters and digits in hyphen-separated runs, at most 64 characters. An export's
 * name is its skill's name and its directory's.
 */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const SKILL_NAME_MAX = 64;

/** docs/constitution.md §exports: the prefix the engine's own skills are named under, refused to an export. */
export const RESERVED_SKILL_PREFIX = "wikiwright-";

/** Whether a string is a skill name: the grammar and the length. */
export function isSkillName(name: string): boolean {
  return name.length <= SKILL_NAME_MAX && SKILL_NAME.test(name);
}

/**
 * docs/constitution.md §exports: the name an export is known by — its declared
 * `name`, or, when it declares none, the bundle's label for an `all` selection
 * and `<label>-<selection>` otherwise, `<selection>` being the selected tags, or
 * the last segment of each selected directory, joined by hyphens in the order
 * declared. The label is the caller's: the basename of the bundle's real root.
 */
export function exportNameOf(declaration: ExportDeclaration, label: string): string {
  if (declaration.name !== undefined) return declaration.name;
  const select = declaration.select;
  if (select.kind === "all") return label;
  const parts =
    select.kind === "tag"
      ? select.tags
      : select.directories.map(
          (d) =>
            d
              .split("/")
              .filter((s) => s.length > 0)
              .pop() ?? d,
        );
  return [label, ...parts].join("-");
}

/**
 * docs/constitution.md §exports: the refusals an export's NAME earns once the
 * bundle's label is known — a derived name outside the grammar, the engine's
 * reserved prefix, and two exports under one name. The declared names' own
 * grammar is the schema's, before a label exists.
 */
export function exportNameIssues(
  declarations: readonly ExportDeclaration[],
  label: string,
): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const seen = new Map<string, number>();
  declarations.forEach((declaration, i) => {
    const name = exportNameOf(declaration, label);
    const where = `engine.exports.${i}.name`;
    if (declaration.name === undefined && !isSkillName(name)) {
      issues.push({
        code: "export-name-derived-invalid",
        where,
        message: `the name derived for this export, "${name}", is not a skill name (lower-case letters and digits in hyphen-separated runs, at most ${SKILL_NAME_MAX})`,
      });
      return;
    }
    if (name.startsWith(RESERVED_SKILL_PREFIX)) {
      issues.push({
        code: "export-name-reserved",
        where,
        message: `"${name}" begins with "${RESERVED_SKILL_PREFIX}", the prefix the engine's own skills are named under`,
      });
      return;
    }
    const first = seen.get(name);
    if (first !== undefined) {
      issues.push({
        code: "export-name-taken",
        where,
        message: `"${name}" is the name of export ${first} too; an export's name is its directory`,
      });
      return;
    }
    seen.set(name, i);
  });
  return issues;
}

/**
 * A declared root is a vault path, held to the one path law. `[".."]`
 * loaded before this and the walk climbed out of the vault — every `.md` beside
 * the bundle was linted under the bundle's own constitution, and `fix` would
 * have written to them.
 */
const RootArraySchema = z
  .array(
    z.string().superRefine((value, ctx) => {
      const refusal = pathRefusal(value);
      if (refusal === undefined) return;
      ctx.addIssue({
        code: "custom",
        message: `not a root inside the vault: it ${PATH_REFUSALS[refusal]}`,
      });
    }),
  )
  .min(1);

/** A vault path, held to the path law, with the message naming what it is. */
function vaultPathSchema(what: string) {
  return z.string().superRefine((value, ctx) => {
    const refusal = pathRefusal(value);
    if (refusal === undefined) return;
    ctx.addIssue({ code: "custom", message: `not ${what}: it ${PATH_REFUSALS[refusal]}` });
  });
}

/** docs/constitution.md §exports: an `https://` URL, the only scheme a repository is named by. */
const RepositorySchema = z
  .string()
  .regex(/^https:\/\/[^\s/]+\/\S*$/u, "a repository is an https:// URL");

/**
 * docs/constitution.md §exports. The shapes only: which paths lie under a
 * content root, which repository a mode needs and whether a name is reserved
 * are refused by name after the parse (`exportIssues`), where every issue can
 * carry its own code.
 */
const ExportSchema = z.strictObject({
  name: z
    .string()
    .max(SKILL_NAME_MAX)
    .regex(
      SKILL_NAME,
      "an export's name is a skill name: lower-case letters and digits in hyphen-separated runs",
    )
    .optional(),
  select: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("all") }),
    z.strictObject({ kind: z.literal("tag"), tags: z.array(z.string().min(1)).min(1) }),
    z.strictObject({
      kind: z.literal("directory"),
      directories: z.array(z.string()).min(1),
    }),
  ]),
  sources: z.enum(["exclude", "include"]).optional(),
  output: z.enum(["skills", "external"]).optional(),
  repository: RepositorySchema.optional(),
  links: z.enum(["closed", "cut"]).optional(),
  guide: vaultPathSchema("a page of the bundle").optional(),
  contribution: z.strictObject({
    mode: z.enum(["issues", "pull-requests", "local-folder", "none"]),
    repository: RepositorySchema.optional(),
    folder: z.string().optional(),
  }),
  skill: vaultPathSchema("a file of the bundle").optional(),
  license: z.string().min(1).optional(),
});

/** docs/constitution.md §plugin: the manifests' three strings; the name is a skill name. */
const PluginSchema = z.strictObject({
  name: z
    .string()
    .max(SKILL_NAME_MAX)
    .regex(
      SKILL_NAME,
      "a plugin's name is a skill name: lower-case letters and digits in hyphen-separated runs",
    ),
  version: z.string().min(1),
  description: z.string().min(1),
});

/** Whether a vault path lies under one of the roots (the root itself included). */
function underRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

/**
 * docs/constitution.md §exports: the refusals a parsed export earns from the
 * rest of the config — a selected directory that is not a vault path under a
 * content root, an external export with no repository, a contribution whose
 * mode lacks what it needs or carries what it may not, and an explicit name
 * under the reserved prefix or taken twice. A derived name waits for the
 * bundle's label (`exportNameIssues`).
 */
function exportIssues(config: EngineConfig): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const roots = config.content_roots ?? [];
  const explicit = new Map<string, number>();
  (config.exports ?? []).forEach((declaration, i) => {
    const at = `engine.exports.${i}`;
    if (declaration.name !== undefined) {
      if (declaration.name.startsWith(RESERVED_SKILL_PREFIX)) {
        issues.push({
          code: "export-name-reserved",
          where: `${at}.name`,
          message: `"${declaration.name}" begins with "${RESERVED_SKILL_PREFIX}", the prefix the engine's own skills are named under`,
        });
      }
      const first = explicit.get(declaration.name);
      if (first !== undefined) {
        issues.push({
          code: "export-name-taken",
          where: `${at}.name`,
          message: `"${declaration.name}" is the name of export ${first} too; an export's name is its directory`,
        });
      } else {
        explicit.set(declaration.name, i);
      }
    }
    if (declaration.select.kind === "directory") {
      declaration.select.directories.forEach((directory, j) => {
        const refusal = pathRefusal(directory);
        if (refusal !== undefined || !underRoot(directory, roots)) {
          issues.push({
            code: "export-select-invalid",
            where: `${at}.select.directories.${j}`,
            message:
              refusal !== undefined
                ? `"${directory}" is not a vault path: it ${PATH_REFUSALS[refusal]}`
                : `"${directory}" is not under a content root (${roots.join(", ") || "none declared"})`,
          });
        }
      });
    }
    if (declaration.output === "external" && declaration.repository === undefined) {
      issues.push({
        code: "export-repository-required",
        where: `${at}.repository`,
        message:
          "an external export is installed from another repository, and names it: declare `repository`",
      });
    }
    const contribution = declaration.contribution;
    const where = `${at}.contribution`;
    const invalid = (message: string): void => {
      issues.push({ code: "export-contribution-invalid", where, message });
    };
    if (contribution.mode === "issues" || contribution.mode === "pull-requests") {
      if (contribution.repository === undefined && declaration.repository === undefined) {
        invalid(
          `mode "${contribution.mode}" reports to a repository: declare contribution.repository, or the export's repository`,
        );
      }
      if (contribution.folder !== undefined) {
        invalid(`mode "${contribution.mode}" takes no folder`);
      }
    } else if (contribution.mode === "local-folder") {
      if (contribution.repository !== undefined) {
        invalid('mode "local-folder" takes no repository: a local folder is where a report goes');
      }
      if (contribution.folder === undefined) {
        invalid('mode "local-folder" names its folder: declare contribution.folder');
      } else {
        const refusal = pathRefusal(contribution.folder);
        if (refusal !== undefined) {
          invalid(
            `contribution.folder "${contribution.folder}" is not a relative path: it ${PATH_REFUSALS[refusal]}`,
          );
        }
      }
    } else {
      if (contribution.repository !== undefined || contribution.folder !== undefined) {
        invalid('mode "none" takes no repository and no folder');
      }
    }
  });
  return issues;
}

/**
 * docs/extending.md §Declaring a module: a module's bundle-relative directory is a vault path
 * too, held to the same law as a root, so `"../kit"` or `"/opt/kit"` is refused
 * at load rather than read from outside the bundle.
 */
const ModulePathSchema = z.string().superRefine((value, ctx) => {
  const refusal = pathRefusal(value);
  if (refusal === undefined) return;
  ctx.addIssue({
    code: "custom",
    message: `not a directory inside the bundle: it ${PATH_REFUSALS[refusal]}`,
  });
});

const EngineConfigSchema = z.strictObject({
  content_roots: RootArraySchema.optional(),
  // Validated at LOAD — a range the engine cannot parse would otherwise
  // be a pin that accepts every engine (accepted-but-inert, again).
  engine: z
    .string()
    .min(1)
    .refine((v) => parseEngineRange(v) !== undefined, {
      message:
        'not a range this engine parses: space-separated comparators (">=0.1.0 <0.2.0"), "^", "~", or an exact version',
    })
    .optional(),
  folder_tag_aliases: z.record(z.string().min(1), z.string().min(1)).optional(),
  folder_tags: z
    .strictObject({ mode: z.enum(["off", "validate", "materialize-add-only"]) })
    .optional(),
  source_roots: RootArraySchema.optional(),
  extensions: z
    .strictObject({
      mode: z.enum(["open", "registered"]),
      namespaces: z.array(z.string().min(1)).optional(),
      fields: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  // `prefixes` is required and non-empty: a registered set with no member
  // would refuse every commit.
  commit_prefixes: z.strictObject({ prefixes: z.array(z.string().min(1)).min(1) }).optional(),
  move_reasons: z.array(z.string().min(1)).min(1).optional(),
  modules: z
    .array(
      z.strictObject({
        // A package name, always: the bundle names what it depends on, and the
        // law digest and every refusal name the module by it (docs/extending.md
        // §Declaring a module). Where it sits is `path`'s to say, when declared.
        package: z
          .string()
          .min(1)
          .regex(
            /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/u,
            "a module is named as an npm package (`name` or `@scope/name`)",
          ),
        version: z.string().min(1).optional(),
        // Where the package lies when it is not installed under `node_modules`:
        // a directory of the bundle's own, such as a kit committed beside its
        // pages. Declared, it is the only place the module is read from.
        path: ModulePathSchema.optional(),
      }),
    )
    .optional(),
  exports: z.array(ExportSchema).optional(),
  plugin: PluginSchema.optional(),
  field_sources: z
    .strictObject({
      title: z.literal("basename").optional(),
      description: z.literal("lede").optional(),
    })
    .optional(),
});

/**
 * docs/architecture.md §The invariants: the schema is exported so the meta-test can
 * WALK it. A key added here without an `ENGINE_CONFIG_CONSUMERS` entry and an
 * `e2e:<key>` fixture is a red build in the same commit.
 */
export const ENGINE_CONFIG_SCHEMA = EngineConfigSchema;

/**
 * Every top-level engine.json key → the name of the exported function that
 * READS it (a list when more than one pass reads the key). Not documentation:
 * the meta-test resolves each name against the engine's own exports.
 */
export const ENGINE_CONFIG_CONSUMERS: Readonly<Record<string, string | readonly string[]>> = {
  content_roots: "rootsOf",
  engine: "checkEnginePin",
  field_sources: "generateOptionsFor",
  folder_tag_aliases: "lintOptionsFor",
  // Two readers, one declaration: `lintOptionsFor` reads the key,
  // and `judge` reads the mode back out of the loaded law to decide whether the
  // folder-tags fixer can execute `folder-tags-present` in THIS vault.
  folder_tags: ["lintOptionsFor", "judge"],
  // Two readers, one declaration: generation resolves evidence links under
  // these roots and the grammar reads a bare path as provenance.
  source_roots: ["generateOptionsFor", "lintOptionsFor"],
  extensions: "lintOptionsFor",
  commit_prefixes: "commitPrefixVerdict",
  move_reasons: "moveReasonsOf",
  // docs/extending.md §Declaring a module: the shell resolves, digests, scans, loads and
  // proves each declared module before any vault is judged under it.
  modules: "loadDeclaredModules",
  // docs/constitution.md §exports: the shell resolves each declaration, with its
  // defaults, into the export `check --write` and `export` render.
  exports: "exportPlans",
  // docs/constitution.md §plugin: the two manifests written beside the exports.
  plugin: "pluginManifests",
};

export type EngineConfigLoadResult =
  | { ok: true; config: EngineConfig }
  | { ok: false; issues: RegistryIssue[] };

/** Load config/engine.json: a closed set — unknown keys fail. */
export function loadEngineConfig(json: unknown): EngineConfigLoadResult {
  const parsed = EngineConfigSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: "schema-invalid",
        where: `engine.${i.path.join(".")}`,
        message: i.message,
      })),
    };
  }
  const config: EngineConfig = {};
  if (parsed.data.content_roots !== undefined) config.content_roots = parsed.data.content_roots;
  if (parsed.data.engine !== undefined) config.engine = parsed.data.engine;
  if (parsed.data.folder_tag_aliases !== undefined) {
    config.folder_tag_aliases = parsed.data.folder_tag_aliases;
  }
  if (parsed.data.field_sources !== undefined) {
    const fieldSources: EngineConfig["field_sources"] = {};
    if (parsed.data.field_sources.title !== undefined)
      fieldSources.title = parsed.data.field_sources.title;
    if (parsed.data.field_sources.description !== undefined) {
      fieldSources.description = parsed.data.field_sources.description;
    }
    config.field_sources = fieldSources;
  }
  if (parsed.data.folder_tags !== undefined) {
    config.folder_tags = { mode: parsed.data.folder_tags.mode };
  }
  if (parsed.data.source_roots !== undefined) config.source_roots = parsed.data.source_roots;
  if (parsed.data.extensions !== undefined) {
    const ext: NonNullable<EngineConfig["extensions"]> = { mode: parsed.data.extensions.mode };
    if (parsed.data.extensions.namespaces !== undefined)
      ext.namespaces = parsed.data.extensions.namespaces;
    if (parsed.data.extensions.fields !== undefined) ext.fields = parsed.data.extensions.fields;
    config.extensions = ext;
  }
  if (parsed.data.modules !== undefined) {
    config.modules = parsed.data.modules.map((m) => ({
      package: m.package,
      ...(m.version === undefined ? {} : { version: m.version }),
      ...(m.path === undefined ? {} : { path: m.path }),
    }));
  }
  if (parsed.data.commit_prefixes !== undefined) {
    config.commit_prefixes = { prefixes: parsed.data.commit_prefixes.prefixes };
  }
  if (parsed.data.move_reasons !== undefined) config.move_reasons = parsed.data.move_reasons;
  if (parsed.data.exports !== undefined) {
    config.exports = parsed.data.exports.map(exportDeclarationOf);
  }
  if (parsed.data.plugin !== undefined) {
    config.plugin = {
      name: parsed.data.plugin.name,
      version: parsed.data.plugin.version,
      description: parsed.data.plugin.description,
    };
  }
  const issues = exportIssues(config);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, config };
}

/** One parsed export, its absent keys left absent, never set to `undefined`. */
function exportDeclarationOf(raw: z.infer<typeof ExportSchema>): ExportDeclaration {
  const select: ExportSelect =
    raw.select.kind === "all"
      ? { kind: "all" }
      : raw.select.kind === "tag"
        ? { kind: "tag", tags: [...raw.select.tags] }
        : { kind: "directory", directories: [...raw.select.directories] };
  const contribution: ExportContribution = { mode: raw.contribution.mode };
  if (raw.contribution.repository !== undefined) {
    contribution.repository = raw.contribution.repository;
  }
  if (raw.contribution.folder !== undefined) contribution.folder = raw.contribution.folder;
  const out: ExportDeclaration = { select, contribution };
  if (raw.name !== undefined) out.name = raw.name;
  if (raw.sources !== undefined) out.sources = raw.sources;
  if (raw.output !== undefined) out.output = raw.output;
  if (raw.repository !== undefined) out.repository = raw.repository;
  if (raw.links !== undefined) out.links = raw.links;
  if (raw.guide !== undefined) out.guide = raw.guide;
  if (raw.skill !== undefined) out.skill = raw.skill;
  if (raw.license !== undefined) out.license = raw.license;
  return out;
}
