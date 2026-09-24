// docs/constitution.md §exports, §plugin · docs/cli.md §check (the exports
// `check --write` renders) · docs/architecture.md §Directories.
//
// A bundle exports read-only copies of itself as skills: `config/engine.json`
// declares each one, and this module turns a declaration into the export the
// engine renders, its defaults applied. What a copy carries, byte for byte, is
// the plan's (below); what a declaration means is here, in one place, so the
// renderer, the comparison and the `export` verb read one answer.
import { type Dirent, existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import {
  buildNameIndex,
  codeUnitCompare,
  type ExportContribution,
  type ExportSelect,
  exportNameOf,
  type Finding,
  generateArtifacts,
  graphOf,
  type PageInput,
  type ParsedDoc,
  pathRefusal,
  resolveDescription,
  serializeArtifact,
  tagByName,
} from "@wikiwright/core";
import { BRIEF_PATH, briefOf } from "./brief.ts";
import { contentDigestOf, lawDigest } from "./bundle.ts";
import { ENGINE_VERSION } from "./envelope.ts";
import { gitReadBlobBytes, type IndexEntry } from "./git.ts";
import { generateOptionsFor, rootsOf, type VaultOk } from "./law.ts";
import { type ExportMarker, MARKER_PATH } from "./marker.ts";
import { moduleLocation } from "./moduleload.ts";
import { vaultReadAbsolute } from "./paths.ts";
import type { CommandSpec } from "./spec.ts";
import { CONSTITUTION_PATH, ENGINE_PATH } from "./vaultfiles.ts";

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

// ---------------------------------------------------------------------------
// the plan (docs/constitution.md §exports)

/** docs/constitution.md §exports: the generated skill text at a copy's root. */
export const SKILL_PATH = "SKILL.md";

/**
 * Where an export's bytes are read from: the working tree, or the git index
 * for the staged gate. A kit under `node_modules` is read from the working tree
 * whatever the source, as the loader reads it (`root`).
 */
export interface ExportSource {
  /** The bundle root on disk. */
  root: string;
  /** Every page of the state, parsed: the selection is made from these. */
  pages: readonly PageInput[];
  /** A vault-relative file's bytes. */
  read(rel: string): Buffer;
  /** Whether a vault-relative file is there. */
  exists(rel: string): boolean;
  /** Whether a vault-relative path is a symbolic link; a link is never followed. */
  isLink(rel: string): boolean;
  /**
   * Every file under a vault-relative directory, recursively, a link listed
   * and never followed, `.git` and `.obsidian` skipped. None when the
   * directory is not there.
   */
  list(dir: string): string[];
}

/** The names a listing never descends into: a repository's own state and an editor's. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([".git", ".obsidian"]);

/** docs/constitution.md §exports: the working tree at `root`, its pages already parsed. */
export function fsExportSource(root: string, pages: readonly PageInput[]): ExportSource {
  const read = (rel: string): Buffer => {
    try {
      return readFileSync(vaultReadAbsolute(root, rel));
    } catch (error) {
      // Paths are stored NFC; an NFD-preserving filesystem may spell the name
      // decomposed, as the page reader allows.
      const nfd = rel.normalize("NFD");
      if (nfd !== rel) return readFileSync(vaultReadAbsolute(root, nfd));
      throw error;
    }
  };
  const isLink = (rel: string): boolean => {
    try {
      return lstatSync(join(root, rel)).isSymbolicLink();
    } catch {
      return false;
    }
  };
  const list = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (rel: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(join(root, rel), { withFileTypes: true, encoding: "utf8" });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        const path = `${rel}/${entry.name.normalize("NFC")}`;
        if (entry.isDirectory()) walk(path);
        else out.push(path);
      }
    };
    walk(dir);
    return out.sort(codeUnitCompare);
  };
  return {
    root,
    pages,
    read,
    exists: (rel) => existsSync(join(root, rel)),
    isLink,
    list,
  };
}

/** One export, planned: every file it holds, or none when a finding refuses it. */
export interface ExportPlan {
  export: ResolvedExport;
  /** Every file under the export's root, sorted; undefined when an error finding refuses the render. */
  files: PlannedFile[] | undefined;
  findings: Finding[];
  marker: ExportMarker;
}

export interface ExportInput {
  vault: VaultOk;
  source: ExportSource;
  declaration: ResolvedExport;
  /** The source bundle's label. */
  label: string;
  /** The verb registry, for the consumer's brief. */
  commands: readonly CommandSpec[];
  /**
   * The other exports the bundle declares, so a subset can name the export
   * that carries the whole bundle.
   */
  siblings?: readonly ResolvedExport[];
}

/** What a finding about an export says; its rule id and severity are written at the emit site. */
interface ExportFindingText {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  remediation: string;
  details?: Record<string, string | number | boolean>;
  /** Where it is reported; `config/engine.json`, the declaration, unless a rendered file is meant. */
  path?: string;
}

/** A finding about an export, reported with the export's name. */
export function exportFinding(declaration: { name: string }, text: ExportFindingText): Finding {
  return {
    ruleId: text.ruleId,
    severity: text.severity,
    path: text.path ?? ENGINE_PATH,
    message: `export "${declaration.name}": ${text.message}`,
    remediation: text.remediation,
    contributedBy: "engine",
    layer: "constitution",
    details: { export: declaration.name, ...(text.details ?? {}) },
  };
}

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
  return [];
}

/** Whether a vault path lies under one of the roots. */
function under(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path.startsWith(`${root}/`));
}

/** Whether a path has a segment the export never carries. */
function skippedPath(path: string): boolean {
  return path.split("/").some((segment) => SKIPPED_DIRECTORIES.has(segment));
}

/** A doc's lines with fences, the frontmatter and inline code blanked, for the image scan. */
function proseLines(doc: ParsedDoc): string[] {
  const lines = doc.source.split("\n");
  const blank = new Set<number>();
  if (doc.frontmatter.present) for (let i = 1; i <= doc.frontmatter.endLine; i += 1) blank.add(i);
  for (const fence of doc.fences) for (let i = fence.line; i <= fence.endLine; i += 1) blank.add(i);
  return lines.map((line, i) =>
    blank.has(i + 1) ? "" : line.replace(/(`+)[^`]*?\1/gu, (m) => " ".repeat(m.length)),
  );
}

/** `![alt](path "title")`: a Markdown image and the path it names. */
const IMAGE = /!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/gu;

/** A URL a page names that is not a path in the bundle: a scheme, a fragment, a protocol-relative host. */
const NOT_A_PATH = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu;

/** The target of every `![[…]]` on the page: an embed, where a plain `[[…]]` is a link. */
function embedTargets(doc: ParsedDoc): string[] {
  const lines = proseLines(doc);
  return doc.wikilinks
    .filter((link) => (lines[link.line - 1] ?? "").includes(`!${link.raw}`))
    .map((link) => link.target);
}

/** Whether an embed names a file rather than a page: its last segment has a suffix other than `.md`. */
function namesAFile(target: string): boolean {
  const last = target.split("/").pop() ?? target;
  return /\.[^./]+$/u.test(last) && !last.endsWith(".md");
}

/**
 * docs/constitution.md §exports: plan one export — every file its copy holds
 * and the findings that refuse or qualify it — from the source's pages and
 * files, never from the clock or the machine. The same inputs give the same
 * bytes. A plan an error finding refuses holds no files.
 */
export function planExport(input: ExportInput): ExportPlan {
  const { vault, source, declaration, label } = input;
  const roots = rootsOf(vault);
  const sourceRoots = vault.engine.source_roots ?? [];
  const findings: Finding[] = [];
  const allPages = source.pages.filter((page) => !skippedPath(page.path));
  const byPath = new Map(allPages.map((page) => [page.path, page] as const));

  // 1. The selection.
  const select = declaration.select;
  if (select.kind === "tag") {
    for (const tag of select.tags) {
      if (tagByName(vault.registry, tag) !== undefined) continue;
      findings.push(
        exportFinding(declaration, {
          ruleId: "export-tag-unknown",
          severity: "error",
          message: `selects the tag "${tag}", which the tags vocabulary does not register`,
          remediation:
            "select a registered tag, or register it in the constitution's tags vocabulary",
          details: { tag },
        }),
      );
    }
  }
  const chosen = allPages.filter((page) => {
    if (select.kind === "all") return true;
    if (select.kind === "tag") {
      const tags = stringsOf(page.doc.frontmatter.value["tags"]);
      return tags.some((tag) => select.tags.includes(tag));
    }
    return select.directories.some((dir) => page.path.startsWith(`${dir}/`));
  });
  // The source roots' files travel with `sources: include` and are left out
  // otherwise, a page under a source root included: the roots stay declared in
  // the copy's config, so a citation to one parses the same there.
  const selected = new Set(
    chosen.filter((page) => !under(page.path, sourceRoots)).map((page) => page.path),
  );
  if (declaration.sources === "include") {
    for (const page of allPages) if (under(page.path, sourceRoots)) selected.add(page.path);
  }
  // The templates and examples the loader validates travel at their declared
  // paths, and an example that is a page under a content root travels as one
  // of the copy's pages: the loader refuses a copy without it.
  const declaredFiles = new Set<string>();
  for (const type of vault.registry.types.values()) {
    for (const file of [type.template?.value, type.example?.value]) {
      if (file === undefined || vault.modules.templates.has(file)) continue;
      declaredFiles.add(file);
      if (byPath.has(file)) selected.add(file);
    }
  }
  const pages = [...selected]
    .sort(codeUnitCompare)
    .map((path) => byPath.get(path))
    .filter((page): page is PageInput => page !== undefined);

  // 2. The guide and the maintainer's fragment.
  if (declaration.guide !== null && !selected.has(declaration.guide)) {
    findings.push(
      exportFinding(declaration, {
        ruleId: "export-guide-outside",
        severity: "error",
        message: `its guide "${declaration.guide}" is not a page it selects`,
        remediation: "name a guide among the export's pages, or widen the selection",
        details: { guide: declaration.guide },
      }),
    );
  }
  let fragment: string | undefined;
  if (declaration.skill !== null) {
    const skill = declaration.skill;
    if (under(skill, roots) || !source.exists(skill)) {
      findings.push(
        exportFinding(declaration, {
          ruleId: "export-skill-invalid",
          severity: "error",
          message: under(skill, roots)
            ? `its skill fragment "${skill}" lies under a content root, where it would be a page`
            : `its skill fragment "${skill}" does not exist`,
          remediation:
            "keep the fragment in a file outside every content root, and name it by its path",
          details: { skill },
        }),
      );
    } else {
      fragment = source.read(skill).toString("utf8");
    }
  }

  // 3. The links a selected page makes to a page left out, counted in the
  // SOURCE, before the copy's graph is regenerated without them.
  const names = buildNameIndex([...allPages]);
  const graph = graphOf(vault.registry, [...allPages], names, generateOptionsFor(vault));
  let cutLinks = 0;
  let cutCitations = 0;
  const cutTargets = new Set<string>();
  for (const edge of graph.edges) {
    if (!selected.has(edge.from) || edge.to.startsWith("tag:") || selected.has(edge.to)) continue;
    if (edge.kind === "cites") cutCitations += 1;
    else cutLinks += 1;
    cutTargets.add(edge.to);
  }
  if (declaration.links === "closed" && cutLinks + cutCitations > 0) {
    const first = [...cutTargets].sort(codeUnitCompare).slice(0, 10);
    findings.push(
      exportFinding(declaration, {
        ruleId: "export-not-closed",
        severity: "warning",
        message: `its pages link to ${cutTargets.size} page(s) it does not carry: ${first.join(", ")}`,
        remediation:
          'select the linked pages too, or declare `"links": "cut"` to carry the counts instead',
        details: { links: cutLinks, citations: cutCitations },
      }),
    );
  }

  // 4. The files the copy carries beside its pages.
  const files = new Map<string, Buffer | undefined>();
  const linked: string[] = [];
  const carry = (path: string, from: ExportSource = source): void => {
    if (files.has(path)) return;
    if (from.isLink(path)) {
      linked.push(path);
      files.set(path, undefined);
      return;
    }
    try {
      files.set(path, from.read(path));
    } catch (error) {
      // A file reached through a linked directory resolves outside the
      // bundle, and the reader refuses it: it is a link as surely as one named.
      if (!(error instanceof Error) || !error.message.includes("resolves outside")) throw error;
      linked.push(path);
      files.set(path, undefined);
    }
  };
  for (const page of pages) carry(page.path);
  carry(CONSTITUTION_PATH);
  if (source.exists(ENGINE_PATH)) carry(ENGINE_PATH);
  for (const file of [...declaredFiles].sort(codeUnitCompare)) carry(file);
  if (declaration.sources === "include") {
    for (const root of sourceRoots) for (const file of source.list(root)) carry(file);
  }
  // Attachments: an embed that names a file, resolved by name under the
  // content roots, and a Markdown image, resolved against its page.
  let cutAttachments = 0;
  let contentFiles: string[] | undefined;
  const filesNamed = (name: string): string[] => {
    contentFiles ??= roots.flatMap((root) => source.list(root));
    return contentFiles.filter((file) => (file.split("/").pop() ?? "") === name);
  };
  for (const page of pages) {
    const found: (string | undefined)[] = [];
    for (const target of embedTargets(page.doc)) {
      if (!namesAFile(target)) continue;
      if (target.includes("/")) {
        const path = posix.normalize(target);
        found.push(
          pathRefusal(path) === undefined && under(path, roots) && source.exists(path)
            ? path
            : undefined,
        );
      } else {
        const matches = filesNamed(target);
        found.push(matches.length === 1 ? matches[0] : undefined);
      }
    }
    for (const line of proseLines(page.doc)) {
      for (const match of line.matchAll(IMAGE)) {
        const raw = match[1] ?? "";
        if (NOT_A_PATH.test(raw)) continue;
        let decoded = raw.split(/[?#]/u)[0] ?? raw;
        try {
          decoded = decodeURI(decoded);
        } catch {
          // A malformed escape names no file; it is counted below.
        }
        const path = decoded.startsWith("/")
          ? undefined
          : posix.normalize(posix.join(posix.dirname(page.path), decoded));
        found.push(
          path !== undefined &&
            pathRefusal(path) === undefined &&
            under(path, roots) &&
            !path.endsWith(".md") &&
            source.exists(path)
            ? path
            : undefined,
        );
      }
    }
    for (const path of found) {
      if (path === undefined) cutAttachments += 1;
      else carry(path);
    }
  }
  // The kits: each declared module's whole directory at the location it is
  // declared at, its own dependencies left out as the digest leaves them. A
  // kit under node_modules is read from the working tree, as the loader reads it.
  const tree = fsExportSource(source.root, []);
  for (const module of vault.engine.modules ?? []) {
    const location = moduleLocation(module);
    const from = module.path === undefined ? tree : source;
    if (from.isLink(location)) {
      linked.push(location);
      continue;
    }
    for (const file of from.list(location)) {
      if (
        file
          .slice(location.length + 1)
          .split("/")
          .includes("node_modules")
      )
        continue;
      carry(file, from);
    }
  }
  if (linked.length > 0) {
    const first = [...new Set(linked)].sort(codeUnitCompare).slice(0, 10);
    findings.push(
      exportFinding(declaration, {
        ruleId: "export-symlink",
        severity: "error",
        message: `it would carry ${linked.length} symbolic link(s), and a copy holds bytes, never a link: ${first.join(", ")}`,
        remediation: "replace each link with the file it points at, or leave it out of the export",
        details: { links: linked.length },
      }),
    );
  }

  // 5. The marker.
  const content = contentDigestOf(
    pages.map((page) => ({
      path: page.path,
      bytes: files.get(page.path) ?? source.read(page.path),
    })),
  );
  const law = lawDigest(
    source.root,
    vault.lawText.constitution,
    vault.lawText.engine,
    vault.engine.modules ?? [],
  );
  const marker: ExportMarker = {
    schema: "wikiwright/export",
    version: 1,
    name: declaration.name,
    bundle: label,
    select: declaration.select,
    sources: declaration.sources,
    output: declaration.output,
    links: declaration.links,
    cut: { links: cutLinks, citations: cutCitations, attachments: cutAttachments },
    pages: pages.length,
    source: { repository: declaration.repository, law, content },
    contribution: declaration.contribution,
    guide: declaration.guide,
    license: declaration.license,
    engine: ENGINE_VERSION,
  };

  if (findings.some((finding) => finding.severity === "error")) {
    return { export: declaration, files: undefined, findings, marker };
  }

  // 6. The generated artifacts over the selection, and the consumer's brief.
  const generated = generateArtifacts(
    vault.registry,
    pages,
    buildNameIndex(pages),
    generateOptionsFor(vault),
  );
  const out = new Map<string, Buffer>();
  for (const [path, bytes] of files) if (bytes !== undefined) out.set(path, bytes);
  for (const artifact of generated) out.set(artifact.path, Buffer.from(artifact.content));
  out.set(
    BRIEF_PATH,
    Buffer.from(
      briefOf(source.root, vault, pages, "consumer", input.commands, {
        name: declaration.name,
        bundle: label,
      }),
    ),
  );
  out.set(MARKER_PATH, Buffer.from(serializeArtifact(marker)));
  out.set(
    SKILL_PATH,
    Buffer.from(
      skillText({
        declaration,
        marker,
        pages,
        vault,
        fragment,
        whole: (input.siblings ?? []).find(
          (other) => other.select.kind === "all" && other.name !== declaration.name,
        ),
      }),
    ),
  );
  const planned = [...out.entries()]
    .map(([path, bytes]) => ({ path, bytes }))
    .sort((a, b) => codeUnitCompare(a.path, b.path));
  return { export: declaration, files: planned, findings, marker };
}

/** The most characters a skill's description may hold. */
const DESCRIPTION_MAX = 1024;

/** A description cut to the limit at a word, never inside one. */
function truncated(text: string): string {
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The selection, as a sentence opens with it. */
function selectionWords(select: ExportSelect): string {
  const quoted = (items: readonly string[]): string =>
    items.map((item) => `\`${item}\``).join(items.length === 2 ? " or " : ", ");
  if (select.kind === "all") return "Every page of the bundle";
  if (select.kind === "tag") return `The pages tagged ${quoted(select.tags)}`;
  return `The pages under ${quoted(select.directories)}`;
}

/** docs/constitution.md §exports: where a problem with the copy is reported, in words. */
function contributionWords(contribution: ExportContribution, content: string): string {
  switch (contribution.mode) {
    case "issues":
      return `Report a problem with a page as an issue at ${contribution.repository ?? ""}: name the page's path, the content digest \`${content}\` and what you observed.`;
    case "pull-requests":
      return `A change to this bundle is a pull request against ${contribution.repository ?? ""}: clone it and follow that repository's own rules.`;
    case "local-folder":
      return `Report a problem as a note in \`${contribution.folder ?? ""}\`, relative to the source bundle's root: the folder its maintainer reads.`;
    default:
      return "This bundle takes no reports: read it as it is.";
  }
}

/** A fragment's text without its frontmatter, trimmed. */
function fragmentBody(text: string): string {
  const normalized = text.replace(/^﻿/u, "").replaceAll("\r\n", "\n");
  const match = /^---\n[\s\S]*?\n---\n/u.exec(normalized);
  return (match === null ? normalized : normalized.slice(match[0].length)).trim();
}

/**
 * docs/constitution.md §exports: the bundle's skill text — frontmatter a host
 * reads, then a body that says what the copy is, what it needs, where to start
 * and where a problem goes. The mechanics every bundle shares are the
 * `wikiwright-consume` skill's, and this names it rather than repeat it.
 */
function skillText(input: {
  declaration: ResolvedExport;
  marker: ExportMarker;
  pages: readonly PageInput[];
  vault: VaultOk;
  fragment: string | undefined;
  whole: ResolvedExport | undefined;
}): string {
  const { declaration, marker, pages, vault } = input;
  const types = new Set(
    pages
      .map((page) => page.doc.frontmatter.value["type"])
      .filter((type): type is string => typeof type === "string"),
  );
  const guidePage = pages.find((page) => page.path === declaration.guide);
  const fallback = `the bundle ${marker.bundle}, ${selectionWords(declaration.select).toLowerCase()}`;
  const about =
    guidePage === undefined
      ? fallback
      : (resolveDescription(guidePage.doc, vault.engine.field_sources) ?? fallback);
  const description = truncated(
    `wikiwright bundle: ${about.replace(/\s+/gu, " ").trim()} — ${plural(pages.length, "page", "pages")}, ${plural(types.size, "type", "types")}`,
  );
  const partial = declaration.select.kind !== "all";
  const lines = [
    "---",
    `name: ${declaration.name}`,
    `description: ${JSON.stringify(description)}`,
    ...(declaration.license === null ? [] : [`license: ${JSON.stringify(declaration.license)}`]),
    "metadata:",
    `  wikiwright-bundle: ${JSON.stringify(marker.bundle)}`,
    `  wikiwright-law: ${JSON.stringify(marker.source.law)}`,
    `  wikiwright-content: ${JSON.stringify(marker.source.content)}`,
    `  wikiwright-contribution: ${JSON.stringify(marker.contribution.mode)}`,
    "---",
    "",
    `# ${declaration.name}`,
    "",
    `This directory is a wikiwright bundle: a read-only copy of the bundle \`${marker.bundle}\`,`,
    // The host's variable, spelled literally: the skill text names it, and the
    // host substitutes it.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal the host expands
    "exported as a skill. `${CLAUDE_SKILL_DIR}` is this directory; pass it as `--root`",
    "to every command, and never edit a file under it.",
    "",
    "## Before you read it",
    "",
    `It needs the wikiwright engine at ${marker.engine} or later, and the \`wikiwright-consume\``,
    "skill, which ships in the engine's repository under `packages/cli/skills/`; no",
    "command installs either yet. Run `wikiwright version`, and read that skill even",
    "when the engine answers: how to read a bundle, cite it and report on it is there.",
    "",
    "## What it holds",
    "",
    `${selectionWords(declaration.select)}: ${plural(marker.pages, "page", "pages")} of ${plural(types.size, "type", "types")}.`,
    ...(declaration.guide === null ? [] : [`Read \`${declaration.guide}\` first.`]),
    ...(partial
      ? [
          "",
          `This is a partial copy: ${plural(marker.cut.links, "link", "links")} and ${plural(marker.cut.citations, "citation", "citations")} to pages it does not`,
          "carry were cut, so `check` over it means nothing.",
          input.whole === undefined
            ? "The bundle exports no whole copy."
            : `The whole bundle is the export \`${input.whole.name}\`.`,
        ]
      : []),
    "",
    "Search this directory rather than the whole project: a repository that holds",
    "the bundle holds each exported page twice.",
    "",
    "## Reporting a problem",
    "",
    `${contributionWords(declaration.contribution, marker.source.content)} Never edit this copy.`,
    "",
  ];
  if (input.fragment !== undefined) {
    lines.push("## From the maintainer", "", fragmentBody(input.fragment), "");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// the exports under the bundle's own root (docs/cli.md §check)

/** docs/constitution.md §exports: the git mode of a symbolic link. */
const LINK_MODE = "120000";

/**
 * docs/cli.md §gate: the git index at `root` as an export's source — each
 * staged file's bytes, read in one batch the first time one is asked for, a
 * link known by its mode and never read. A kit under `node_modules` is not in
 * the index; the plan reads it from the working tree, as the preload does.
 */
export function indexExportSource(
  root: string,
  pages: readonly PageInput[],
  entries: readonly IndexEntry[],
): ExportSource {
  const byPath = new Map(
    entries.filter((entry) => entry.stage === 0).map((entry) => [entry.path, entry] as const),
  );
  let blobs: Map<string, Buffer> | undefined;
  const read = (rel: string): Buffer => {
    const entry = byPath.get(rel);
    if (entry === undefined) throw new Error(`the index holds no "${rel}"`);
    blobs ??= gitReadBlobBytes(
      root,
      [...byPath.values()].filter((e) => e.mode !== LINK_MODE).map((e) => e.blob),
    );
    const bytes = blobs.get(entry.blob);
    if (bytes === undefined)
      throw new Error(`the index names blob ${entry.blob} for "${rel}" and git did not return it`);
    return bytes;
  };
  return {
    root,
    pages,
    read,
    exists: (rel) => byPath.has(rel),
    isLink: (rel) => byPath.get(rel)?.mode === LINK_MODE,
    list: (dir) =>
      [...byPath.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && !skippedPath(path))
        .sort(codeUnitCompare),
  };
}

/** docs/cli.md §check: the exports rendered under the bundle's own root, planned. */
export interface RepositoryExports {
  /** Each `output: skills` export whose destination is valid, planned. */
  plans: ExportPlan[];
  /** Every destination this bundle owns under its root: `skills/<name>` per such export. */
  destinations: string[];
  /** The plugin manifests, when `plugin` is declared, at the bundle's root. */
  manifests: PlannedFile[];
  /** The plans' findings, and the destinations and orphans judged beside them. */
  findings: Finding[];
}

/**
 * docs/cli.md §check: the exports a bundle renders into its own `skills/` —
 * every `output: skills` export, planned from `source`, the plugin manifests
 * when declared, and the findings about them: each plan's, a destination that
 * lies in a content root (`export-destination-invalid`), and a `skills/<name>`
 * holding a marker no declaration names (`export-orphan`, never removed). A
 * root that carries a marker is itself a copy, and a copy renders nothing.
 */
export function repositoryExports(input: {
  vault: VaultOk;
  source: ExportSource;
  label: string;
  commands: readonly CommandSpec[];
}): RepositoryExports {
  const { vault, source } = input;
  const none: RepositoryExports = { plans: [], destinations: [], manifests: [], findings: [] };
  if (source.exists(MARKER_PATH)) return none;
  const roots = rootsOf(vault);
  const declared = exportPlans(vault, input.label);
  const findings: Finding[] = [];
  const plans: ExportPlan[] = [];
  const destinations: string[] = [];
  for (const declaration of declared) {
    if (declaration.output !== "skills") continue;
    const dest = declaration.destination;
    if (under(dest, roots) || roots.some((root) => root === dest || root.startsWith(`${dest}/`))) {
      findings.push(
        exportFinding(declaration, {
          ruleId: "export-destination-invalid",
          severity: "error",
          message: `its destination "${dest}" lies in a content root, where its files would be pages`,
          remediation: "rename the export, or move the content root out of `skills/`",
          details: { destination: dest },
        }),
      );
      continue;
    }
    destinations.push(dest);
    const plan = planExport({
      vault,
      source,
      declaration,
      label: input.label,
      commands: input.commands,
      siblings: declared,
    });
    plans.push(plan);
    findings.push(...plan.findings);
  }
  const names = new Set(declared.map((d) => d.name));
  const orphans = new Set<string>();
  for (const path of source.list(SKILLS_DIR)) {
    const parts = path.split("/");
    const name = parts[1];
    if (name === undefined || parts.slice(2).join("/") !== MARKER_PATH) continue;
    if (!names.has(name)) orphans.add(name);
  }
  for (const name of [...orphans].sort(codeUnitCompare)) {
    findings.push(
      exportFinding(
        { name },
        {
          ruleId: "export-orphan",
          severity: "warning",
          path: `${SKILLS_DIR}/${name}`,
          message: `"${SKILLS_DIR}/${name}" holds an export's marker, and config/engine.json declares no export of that name`,
          remediation:
            "declare the export again, or remove the directory: the engine never removes it",
        },
      ),
    );
  }
  return { plans, destinations, manifests: pluginManifests(vault), findings };
}

/** One file of a rendered export against its plan. */
export interface ExportDifference {
  path: string;
  kind: "missing" | "extra" | "changed";
}

/** docs/cli.md §check: every file the plans write that `source` holds otherwise, and every file it holds that they do not. */
export function exportDifferences(
  exports: RepositoryExports,
  source: ExportSource,
): Map<string, ExportDifference[]> {
  const out = new Map<string, ExportDifference[]>();
  const compare = (key: string, planned: Map<string, Buffer>, present: readonly string[]): void => {
    const differences: ExportDifference[] = [];
    for (const [path, bytes] of planned) {
      if (!source.exists(path)) differences.push({ path, kind: "missing" });
      else if (source.isLink(path) || !source.read(path).equals(bytes)) {
        differences.push({ path, kind: "changed" });
      }
    }
    for (const path of present) if (!planned.has(path)) differences.push({ path, kind: "extra" });
    differences.sort((a, b) => codeUnitCompare(a.path, b.path));
    if (differences.length > 0) out.set(key, differences);
  };
  for (const plan of exports.plans) {
    if (plan.files === undefined) continue;
    const dest = plan.export.destination;
    compare(
      dest,
      new Map(plan.files.map((file) => [`${dest}/${file.path}`, file.bytes] as const)),
      source.list(dest),
    );
  }
  if (exports.manifests.length > 0) {
    compare(
      "plugin",
      new Map(exports.manifests.map((file) => [file.path, file.bytes] as const)),
      [],
    );
  }
  return out;
}

/**
 * docs/cli.md §check: `export-stale`, one finding per rendered export or for
 * the plugin manifests, naming the first ten files that differ from a fresh
 * plan and how each differs; `check --write` renders them again.
 */
export function exportStaleFindings(
  exports: RepositoryExports,
  source: ExportSource,
  where: "tree" | "index" = "tree",
): Finding[] {
  const findings: Finding[] = [];
  for (const [key, differences] of exportDifferences(exports, source)) {
    const listed = differences
      .slice(0, 10)
      .map((d) => `${d.path} (${d.kind})`)
      .join(", ");
    const more = differences.length > 10 ? ` and ${differences.length - 10} more` : "";
    findings.push(
      exportFinding(
        { name: key === "plugin" ? "plugin" : key.slice(SKILLS_DIR.length + 1) },
        {
          ruleId: "export-stale",
          severity: "error",
          path: key === "plugin" ? PLUGIN_MANIFESTS[0] : key,
          message: `${where === "index" ? "the staged copy" : "the rendered copy"} differs from a fresh render: ${listed}${more}`,
          remediation:
            where === "index"
              ? "run `wikiwright check --write` while the working tree holds what is being staged, then stage the rendered copy with it"
              : "run `wikiwright check --write`",
          details: { files: differences.length },
        },
      ),
    );
  }
  return findings;
}

/** docs/cli.md §gate: whether the index tracks any rendered export or manifest, and so whether the gate judges them. */
export function exportsTracked(exports: RepositoryExports, source: ExportSource): boolean {
  return (
    exports.destinations.some((dest) => source.list(dest).length > 0) ||
    exports.manifests.some((file) => source.exists(file.path))
  );
}

/** docs/cli.md §check: the rule ids the exports' passes emit, named to the judge as run. */
export const EXPORT_PASSES: readonly string[] = [
  "export-stale",
  "export-orphan",
  "export-not-closed",
  "export-tag-unknown",
  "export-guide-outside",
  "export-skill-invalid",
  "export-destination-invalid",
  "export-symlink",
];
