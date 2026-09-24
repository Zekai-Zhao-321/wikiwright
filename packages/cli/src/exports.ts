// docs/constitution.md §exports, §plugin · docs/cli.md §check (the exports
// `check --write` renders) · docs/architecture.md §Directories.
//
// A bundle exports read-only copies of itself as skills: `config/engine.json`
// declares each one, and this module turns a declaration into the export the
// engine renders, its defaults applied. What a copy carries, byte for byte, is
// the plan's (below); what a declaration means is here, in one place, so the
// renderer, the comparison and the `export` verb read one answer.
import {
  codeUnitCompare,
  type ExportContribution,
  type ExportSelect,
  exportNameOf,
  serializeArtifact,
} from "@wikiwright/core";
import type { VaultOk } from "./law.ts";

/** docs/constitution.md §exports: one export with every default applied. */
export interface ResolvedExport {
  /** Its position in `config/engine.json`'s `exports`, for a finding to point at. */
  index: number;
  /** The skill's name, and its directory's under `skills/`. */
  name: string;
  select: ExportSelect;
  sources: "exclude" | "include";
  output: "skills" | "external";
  /** The repository others install this export from; `null` when none is declared. */
  repository: string | null;
  links: "closed" | "cut";
  guide: string | null;
  /** The mode, with the export's repository filled in where the mode reports to one. */
  contribution: ExportContribution;
  skill: string | null;
  license: string | null;
  /** Where the export lands, relative to the root it is rendered under: `skills/<name>`. */
  destination: string;
}

/** docs/constitution.md §exports: the directory every export lands in, under its root. */
export const SKILLS_DIR = "skills";

/**
 * docs/constitution.md §exports: every export `config/engine.json` declares,
 * resolved — the name derived from the bundle's label where none is declared,
 * `sources: exclude`, `output: skills`, `links: closed`, no repository, and a
 * contribution that reports to a repository naming the export's when it names
 * none. In declaration order; a bundle that declares none has none.
 */
export function exportPlans(vault: VaultOk, label: string): ResolvedExport[] {
  return (vault.engine.exports ?? []).map((declaration, index) => {
    const name = exportNameOf(declaration, label);
    const repository = declaration.repository ?? null;
    const contribution: ExportContribution = { ...declaration.contribution };
    if (
      (contribution.mode === "issues" || contribution.mode === "pull-requests") &&
      contribution.repository === undefined &&
      repository !== null
    ) {
      contribution.repository = repository;
    }
    return {
      index,
      name,
      select: declaration.select,
      sources: declaration.sources ?? "exclude",
      output: declaration.output ?? "skills",
      repository,
      links: declaration.links ?? "closed",
      guide: declaration.guide ?? null,
      contribution,
      skill: declaration.skill ?? null,
      license: declaration.license ?? null,
      destination: `${SKILLS_DIR}/${name}`,
    };
  });
}

/** One file a plan writes: its path, relative to the root it lands under, and its bytes. */
export interface PlannedFile {
  path: string;
  bytes: Buffer;
}

/** docs/constitution.md §plugin: the schema the root `plugin.json` names. */
export const PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/** docs/constitution.md §plugin: the two manifests' paths, relative to the root they land under. */
export const PLUGIN_MANIFESTS = ["plugin.json", ".claude-plugin/plugin.json"] as const;

/**
 * docs/constitution.md §plugin: the plugin manifests a bundle that declares
 * `plugin` writes beside its exports — `plugin.json`, naming its schema, and
 * `.claude-plugin/plugin.json` — each the declared name, version and
 * description and nothing else: both hosts discover the skills under `skills/`,
 * so neither names them. None when the bundle declares no plugin.
 */
export function pluginManifests(vault: VaultOk): PlannedFile[] {
  const plugin = vault.engine.plugin;
  if (plugin === undefined) return [];
  const fields = { name: plugin.name, version: plugin.version, description: plugin.description };
  return [
    {
      path: PLUGIN_MANIFESTS[0],
      bytes: Buffer.from(serializeArtifact({ $schema: PLUGIN_SCHEMA, ...fields })),
    },
    { path: PLUGIN_MANIFESTS[1], bytes: Buffer.from(serializeArtifact(fields)) },
  ].sort((a, b) => codeUnitCompare(a.path, b.path));
}
