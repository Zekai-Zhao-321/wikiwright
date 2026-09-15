// docs/cli.md (manifest + catalogs; deterministic) · docs/cli.md §brief (generated files:
// one generator, deletable, byte-reproducible) · docs/architecture.md §Directories (canonical writer: declared
// key order, LF, trailing newline, no timestamps; ArtifactFile out)
// docs/concepts.md §Generated artifacts (labelled edges through the `edges` hook).
import { type FieldSources, resolveDescription, resolveTitle } from "../fields/index.ts";
import { parseSections } from "../grammar/index.ts";
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import { grammarBindings, parseOptionsOf } from "../lint/index.ts";
import { edgesOf } from "../modules/index.ts";
import { buildNameIndex, type NameIndex } from "../names/index.ts";
import type { ParsedDoc } from "../parse/index.ts";
import { type FlattenedRegistry, tagByName, tagsOf } from "../registry/index.ts";

export interface PageInput {
  path: string;
  doc: ParsedDoc;
}

export interface ArtifactFile {
  path: string;
  content: string;
}

/**
 * docs/concepts.md §Generated artifacts: the one serialization of a generated JSON artifact.
 * Two-space JSON with one trailing newline.
 */
export function serializeArtifact(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * docs/concepts.md §Generated artifacts: one edge of the typed graph. `kind` is a kernel edge
 * kind — `wikilink`, `tagged`, `cites`, `supersedes` — or the item kind of a
 * grammar whose `edges` hook contributed it; `label` is present exactly when a
 * module contributed the edge. No line: an edge is identity, not location, and
 * a line number would make every edit above a section change the artifact.
 */
export interface GraphEdge {
  from: string;
  /** A page path, or `tag:<name>`. */
  to: string;
  kind: string;
  label?: string;
}

export interface Graph {
  nodes: Array<Record<string, unknown>>;
  edges: GraphEdge[];
}

function stringsOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

/** Pure artifact generation: same inputs, same bytes, on every machine. */
export interface GenerateOptions {
  fieldSources?: FieldSources | undefined;
  /** Roots holding evidence pages — body links into them are citations. */
  sourceRoots?: readonly string[] | undefined;
}

/**
 * docs/concepts.md §Generated artifacts: the graph, as one list of nodes and one of edges. The
 * query verb and the drift comparison read this same construction, so an
 * artifact on disk can never answer a question the generator would not.
 *
 * Module edges come through the one parser the arms and the census use —
 * `grammarBindings` + `parseSections` under `parseOptionsOf` — and through the
 * `edges` hook of the grammar that owns each item's kind. The kernel learns no
 * label and no grammar name here: it resolves the target, drops what does not
 * resolve and what points at the page itself, and keys the edge by the item's
 * kind. Two identical lines are one edge: the graph is a set, the census counts
 * lines. Label spelling is grouped by identity and printed in the code-unit-
 * minimal form seen, the rule the vocabulary census already applies.
 */
export function graphOf(
  registry: FlattenedRegistry,
  pages: PageInput[],
  names: NameIndex = buildNameIndex(pages),
  options?: GenerateOptions,
): Graph {
  const sourceRoots = options?.sourceRoots ?? [];
  const nodes: Array<Record<string, unknown>> = pages.map((p) => ({
    id: p.path,
    kind: "page",
    type:
      typeof p.doc.frontmatter.value["type"] === "string" ? p.doc.frontmatter.value["type"] : null,
    title: resolveTitle(p.doc, p.path, options?.fieldSources),
  }));
  for (const tag of tagsOf(registry).entries.values()) {
    nodes.push({ id: `tag:${tag.name}`, kind: "tag" });
  }
  nodes.sort((a, b) => codeUnitCompare(String(a["id"]), String(b["id"])));

  const parseOptions = parseOptionsOf(
    options?.sourceRoots === undefined ? undefined : { sourceRoots: options.sourceRoots },
  );
  const edges: GraphEdge[] = [];
  for (const page of pages) {
    const fm = page.doc.frontmatter.value;
    for (const tag of stringsOf(fm["tags"])) {
      if (tagByName(registry, tag) !== undefined) {
        edges.push({ from: page.path, to: `tag:${tag}`, kind: "tagged" });
      }
    }
    for (const link of page.doc.wikilinks) {
      const entry = names.resolve(link.target);
      if (entry !== undefined && entry.path !== page.path) {
        // A body link into a declared source root IS a
        // citation — evidence references are typed, not generic links.
        const isSource = sourceRoots.some((root) => entry.path.startsWith(`${root}/`));
        edges.push({ from: page.path, to: entry.path, kind: isSource ? "cites" : "wikilink" });
      }
    }
    for (const target of stringsOf(fm["supersedes"])) {
      const entry = names.resolve(target);
      if (entry !== undefined) edges.push({ from: page.path, to: entry.path, kind: "supersedes" });
    }
    for (const successor of stringsOf(fm["superseded_by"])) {
      const entry = names.resolve(successor);
      if (entry !== undefined) edges.push({ from: entry.path, to: page.path, kind: "supersedes" });
    }
    const declaredType = stringOrNull(fm["type"]);
    const effective = declaredType === null ? undefined : registry.types.get(declaredType);
    if (effective === undefined) continue;
    const bindings = grammarBindings(effective, registry.modules);
    if (!bindings.some((b) => b.grammar !== "prose")) continue;
    for (const section of parseSections(page.doc, bindings, parseOptions).sections) {
      for (const item of section.items) {
        for (const { to, label } of edgesOf(item as never, registry.modules)) {
          const entry = names.resolve(to);
          if (entry === undefined || entry.path === page.path) continue;
          edges.push({ from: page.path, to: entry.path, kind: item.kind, label });
        }
      }
    }
  }

  const spelling = new Map<string, string>();
  for (const edge of edges) {
    if (edge.label === undefined) continue;
    const key = `${edge.kind}\0${normalizeIdentity(edge.label)}`;
    const seen = spelling.get(key);
    if (seen === undefined || codeUnitCompare(edge.label, seen) < 0) spelling.set(key, edge.label);
  }
  const seen = new Set<string>();
  const deduped: GraphEdge[] = [];
  for (const edge of edges) {
    const label =
      edge.label === undefined
        ? undefined
        : spelling.get(`${edge.kind}\0${normalizeIdentity(edge.label)}`);
    const key = `${edge.from}\0${edge.to}\0${edge.kind}\0${label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(label === undefined ? { ...edge } : { ...edge, label });
  }
  deduped.sort(
    (a, b) =>
      codeUnitCompare(a.from, b.from) ||
      codeUnitCompare(a.to, b.to) ||
      codeUnitCompare(a.kind, b.kind) ||
      codeUnitCompare(a.label ?? "", b.label ?? ""),
  );
  return { nodes, edges: deduped };
}

/** The adjacency of one page in one direction: kind → neighbours, or kind → label → neighbours. */
type Adjacency = Map<string, Map<string, Set<string>>>;

function addAdjacency(map: Map<string, Adjacency>, page: string, edge: GraphEdge, other: string) {
  const byKind = map.get(page) ?? new Map<string, Map<string, Set<string>>>();
  const byLabel = byKind.get(edge.kind) ?? new Map<string, Set<string>>();
  const list = byLabel.get(edge.label ?? "") ?? new Set<string>();
  list.add(other);
  byLabel.set(edge.label ?? "", list);
  byKind.set(edge.kind, byLabel);
  map.set(page, byKind);
}

/**
 * docs/concepts.md §Generated artifacts: a page's neighbours keyed by edge kind — and, under a
 * kind whose edges carry labels, by label. The manifest therefore tells a
 * consumer which shape to expect: `by_label` names exactly the kinds that nest.
 */
function adjacencyOf(
  adjacency: Adjacency | undefined,
  labelled: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (adjacency === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const kind of [...adjacency.keys()].sort(codeUnitCompare)) {
    const byLabel = adjacency.get(kind) ?? new Map<string, Set<string>>();
    if (labelled.has(kind)) {
      const nested: Record<string, string[]> = {};
      for (const label of [...byLabel.keys()].sort(codeUnitCompare)) {
        nested[label] = [...(byLabel.get(label) ?? [])].sort(codeUnitCompare);
      }
      out[kind] = nested;
    } else {
      out[kind] = [...(byLabel.get("") ?? [])].sort(codeUnitCompare);
    }
  }
  return out;
}

export function generateArtifacts(
  registry: FlattenedRegistry,
  pages: PageInput[],
  names: NameIndex = buildNameIndex(pages),
  options?: GenerateOptions,
): ArtifactFile[] {
  const sorted = [...pages].sort((a, b) => codeUnitCompare(a.path, b.path));
  const graphData = graphOf(registry, sorted, names, options);
  const { edges } = graphData;

  // docs/concepts.md §Generated artifacts: derived edge counts — by kind, and
  // under every labelled kind by label — plus depth-1 page adjacency so jq
  // covers the common graph asks. All derived; byte-determinism by construction.
  const kindCounts = new Map<string, number>();
  const labelCounts = new Map<string, Map<string, number>>();
  for (const edge of edges) {
    kindCounts.set(edge.kind, (kindCounts.get(edge.kind) ?? 0) + 1);
    if (edge.label === undefined) continue;
    const labels = labelCounts.get(edge.kind) ?? new Map<string, number>();
    labels.set(edge.label, (labels.get(edge.label) ?? 0) + 1);
    labelCounts.set(edge.kind, labels);
  }
  const by_kind: Record<string, number> = {};
  for (const kind of [...kindCounts.keys()].sort(codeUnitCompare)) {
    by_kind[kind] = kindCounts.get(kind) ?? 0;
  }
  const by_label: Record<string, Record<string, number>> = {};
  for (const kind of [...labelCounts.keys()].sort(codeUnitCompare)) {
    const labels = labelCounts.get(kind) ?? new Map<string, number>();
    const counts: Record<string, number> = {};
    for (const label of [...labels.keys()].sort(codeUnitCompare)) {
      counts[label] = labels.get(label) ?? 0;
    }
    by_label[kind] = counts;
  }
  const labelled = new Set(labelCounts.keys());
  const pageSet = new Set(sorted.map((p) => p.path));
  const outbound = new Map<string, Adjacency>();
  const inbound = new Map<string, Adjacency>();
  for (const edge of edges) {
    // Adjacency is page↔page only; tag nodes are not pages.
    if (!pageSet.has(edge.from) || !pageSet.has(edge.to)) continue;
    addAdjacency(outbound, edge.from, edge, edge.to);
    addAdjacency(inbound, edge.to, edge, edge.from);
  }

  // The extension census — what grew outside the declared schema, and
  // how much. Derived, so byte-determinism holds by construction.
  const extensionCounts: Record<string, number> = {};
  for (const p of sorted) {
    for (const key of p.doc.frontmatter.keys) {
      if (!key.key.startsWith("x-")) continue;
      extensionCounts[key.key] = (extensionCounts[key.key] ?? 0) + 1;
    }
  }
  const extensions: Record<string, number> = {};
  for (const key of Object.keys(extensionCounts).sort(codeUnitCompare)) {
    extensions[key] = extensionCounts[key] ?? 0;
  }

  const manifest = {
    schema: "wikiwright/manifest",
    totals: { pages: sorted.length, edges: edges.length },
    by_kind,
    by_label,
    extensions,
    pages: sorted.map((p) => {
      const fm = p.doc.frontmatter.value;
      const declaredType = stringOrNull(fm["type"]);
      const effective = declaredType === null ? undefined : registry.types.get(declaredType);
      const entry: Record<string, unknown> = {
        path: p.path,
        type: declaredType,
        // D11: nominal typing pays its retrieval dividend — ancestry travels
        // with the page so consumers filter by archetype or by any ancestor.
        archetype: effective?.archetype ?? null,
        chain: effective?.chain ?? [],
        title: resolveTitle(p.doc, p.path, options?.fieldSources),
        description: resolveDescription(p.doc, options?.fieldSources),
        tags: stringsOf(fm["tags"]),
      };
      const out = adjacencyOf(outbound.get(p.path), labelled);
      const into = adjacencyOf(inbound.get(p.path), labelled);
      if (out !== undefined) entry["outbound"] = out;
      if (into !== undefined) entry["inbound"] = into;
      return entry;
    }),
  };

  const cell = (s: string): string => s.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
  // The catalog row of an entry with no description carries its name: a
  // catalog line is never blank.
  const tagRows = [...tagsOf(registry).entries.values()]
    .sort((a, b) => codeUnitCompare(a.name, b.name))
    .map(
      (t) =>
        `| ${cell(t.name)} | ${cell(t.aliases.join(", "))} | ${cell(t.status)} | ${cell(t.description ?? t.name)} |`,
    );
  const catalog = [
    "# Tag catalog",
    "",
    "Generated file — do not edit; regenerate with `wikiwright check --write`.",
    "",
    "| tag | aliases | status | description |",
    "| --- | --- | --- | --- |",
    ...tagRows,
    "",
  ].join("\n");

  const graph = { schema: "wikiwright/graph", ...graphData };

  return [
    { path: "generated/graph.json", content: serializeArtifact(graph) },
    { path: "generated/manifest.json", content: serializeArtifact(manifest) },
    { path: "generated/tag-catalog.md", content: catalog },
  ];
}
