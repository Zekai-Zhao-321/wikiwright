// docs/cli.md §hook, docs/cli.md, docs/cli.md §move · docs/architecture.md §The invariants (
// every engine.json key names its consumer) (a closed
// set; unknown keys fail) · docs/extending.md §Declaring a module (the module packages a
// bundle loads).
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
   * by the package manager from the bundle's own `node_modules`; `version` is
   * the RANGE the bundle expects, and an installed version outside it is a load
   * error.
   */
  modules?: { package: string; version?: string }[];
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
        // A package name, not a path: a module is resolved by the package
        // manager, so the bundle names what it depends on and never where it
        // happens to sit (docs/extending.md §Declaring a module).
        package: z
          .string()
          .min(1)
          .regex(
            /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/u,
            "a module is named as an npm package (`name` or `@scope/name`)",
          ),
        version: z.string().min(1).optional(),
      }),
    )
    .optional(),
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
  // docs/extending.md §Declaring a module: the shell resolves, pins, trusts, scans and
  // loads each declared module before any vault is judged under it.
  modules: "loadDeclaredModules",
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
    config.modules = parsed.data.modules.map((m) =>
      m.version === undefined ? { package: m.package } : { package: m.package, version: m.version },
    );
  }
  if (parsed.data.commit_prefixes !== undefined) {
    config.commit_prefixes = { prefixes: parsed.data.commit_prefixes.prefixes };
  }
  if (parsed.data.move_reasons !== undefined) config.move_reasons = parsed.data.move_reasons;
  return { ok: true, config };
}
