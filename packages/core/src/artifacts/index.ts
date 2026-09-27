// v2 contracts §2 (`generated/` holds BRIEF.md, manifest.json, graph.json,
// tag-catalog.md and queue.md) · §9.1 (`check --write` regenerates them;
// queue.md is a function of law and content only).
//
// The generator of the four artifacts the kernel renders from one state read
// under one law; the brief is the shell's (it renders the command registry).
// Every artifact is byte-reproducible: code-unit order everywhere, two-space
// JSON with one trailing newline, no clock, no absolute path.
//
// Ported from the old generator (generate/index.ts): the graph as one list of
// nodes and one of edges (`tagged`, `wikilink`, `cites` for a body link into a
// source root, `supersedes` from `supersedes` and `superseded_by`), an edge a
// set member keyed by its ends, kind and label; the manifest's totals, counts
// by kind and label, and each page's depth-1 adjacency; the tag catalog's
// table. Changed: a relation record is an edge of kind `relation` with its
// label (the grammar is fixed, so no module contributes edges); the
// manifest's `archetype` and `chain` are the type's `role` and `ancestry`
// (§3, §5); the `x-` extension census left with the `x-` mount; the catalog's
// aliases column left with vocabulary entry aliases, and a retired entry
// names its successor. New: queue.md.
import { codeUnitCompare } from "../identity/index.ts";
import type { TypeLaw } from "../law/load.ts";
import type { StateRead } from "../verdict/judge.ts";
import { titleOf } from "../verdict/names.ts";
import type { VerdictFinding } from "../verdict/table.ts";

export interface TypeLawArtifact {
  path: string;
  content: string;
}

export interface TypeLawGraphEdge {
  from: string;
  /** A page path, or `tag:<name>`. */
  to: string;
  kind: "tagged" | "wikilink" | "cites" | "supersedes" | "relation";
  /** A relation's label; present exactly on a relation edge. */
  label?: string;
}

export interface TypeLawGraph {
  schema: "wikiwright/graph";
  nodes: Record<string, unknown>[];
  edges: TypeLawGraphEdge[];
}

function serialize(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function frontmatterOf(read: StateRead["pages"][number]): Record<string, unknown> {
  return read.read.ok ? read.read.page.frontmatter : {};
}

function typeNameOf(fm: Record<string, unknown>): string | null {
  const declared = fm["type"];
  return typeof declared === "string" && declared !== "" ? declared : null;
}

/** §7: the graph every page and registered tag is a node of, and every resolved link an edge. */
export function typeLawGraph(law: TypeLaw, read: StateRead): TypeLawGraph {
  const titleFromBasename = law.engine.field_sources.title === "basename";
  const pages = [...read.pages].sort((a, b) => codeUnitCompare(a.path, b.path));
  const tags = law.vocabularies.get("tags");
  const nodes: Record<string, unknown>[] = pages.map((page) => {
    const fm = frontmatterOf(page);
    return {
      id: page.path,
      kind: "page",
      type: typeNameOf(fm),
      title: titleOf({ path: page.path, frontmatter: fm }, titleFromBasename),
    };
  });
  for (const tag of tags?.entries.keys() ?? []) nodes.push({ id: `tag:${tag}`, kind: "tag" });
  nodes.sort((a, b) => codeUnitCompare(String(a["id"]), String(b["id"])));

  const sourceRoots = law.engine.source_roots;
  const edges: TypeLawGraphEdge[] = [];
  for (const page of pages) {
    if (!page.read.ok) continue;
    const parsed = page.read.page;
    const fm = parsed.frontmatter;
    for (const tag of strings(fm["tags"])) {
      if (tags?.entries.has(tag) === true)
        edges.push({ from: page.path, to: `tag:${tag}`, kind: "tagged" });
    }
    for (const link of parsed.links) {
      const entry = read.names.resolve(link.target);
      if (entry === undefined || entry.path === page.path) continue;
      const cites = sourceRoots.some((root) => entry.path.startsWith(`${root}/`));
      edges.push({ from: page.path, to: entry.path, kind: cites ? "cites" : "wikilink" });
    }
    for (const target of strings(fm["supersedes"])) {
      const entry = read.names.resolve(target);
      if (entry !== undefined && entry.path !== page.path)
        edges.push({ from: page.path, to: entry.path, kind: "supersedes" });
    }
    for (const successor of strings(fm["superseded_by"])) {
      const entry = read.names.resolve(successor);
      if (entry !== undefined && entry.path !== page.path)
        edges.push({ from: entry.path, to: page.path, kind: "supersedes" });
    }
    for (const occurrence of parsed.occurrences) {
      for (const item of occurrence.items) {
        if (item.kind !== "relation" || item.target.path === null) continue;
        if (item.target.path === page.path) continue;
        edges.push({ from: page.path, to: item.target.path, kind: "relation", label: item.label });
      }
    }
  }
  const seen = new Set<string>();
  const unique = edges.filter((edge) => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${edge.label ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort(
    (a, b) =>
      codeUnitCompare(a.from, b.from) ||
      codeUnitCompare(a.to, b.to) ||
      codeUnitCompare(a.kind, b.kind) ||
      codeUnitCompare(a.label ?? "", b.label ?? ""),
  );
  return { schema: "wikiwright/graph", nodes, edges: unique };
}

type Adjacency = Map<string, Map<string, Set<string>>>;

function adjacent(
  map: Map<string, Adjacency>,
  page: string,
  edge: TypeLawGraphEdge,
  other: string,
) {
  const byKind = map.get(page) ?? new Map<string, Map<string, Set<string>>>();
  const byLabel = byKind.get(edge.kind) ?? new Map<string, Set<string>>();
  const set = byLabel.get(edge.label ?? "") ?? new Set<string>();
  set.add(other);
  byLabel.set(edge.label ?? "", set);
  byKind.set(edge.kind, byLabel);
  map.set(page, byKind);
}

/** A page's neighbours by kind — and, under `relation`, by label. */
function adjacencyOf(adjacency: Adjacency | undefined): Record<string, unknown> | undefined {
  if (adjacency === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const kind of [...adjacency.keys()].sort(codeUnitCompare)) {
    const byLabel = adjacency.get(kind) ?? new Map<string, Set<string>>();
    if (kind === "relation") {
      const nested: Record<string, string[]> = {};
      for (const label of [...byLabel.keys()].sort(codeUnitCompare))
        nested[label] = [...(byLabel.get(label) ?? [])].sort(codeUnitCompare);
      out[kind] = nested;
    } else out[kind] = [...(byLabel.get("") ?? [])].sort(codeUnitCompare);
  }
  return out;
}

function counted(values: Iterable<string>): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const out: Record<string, number> = {};
  for (const key of [...counts.keys()].sort(codeUnitCompare)) out[key] = counts.get(key) ?? 0;
  return out;
}

/** The manifest: every page with its type, role, ancestry, title, tags and neighbours. */
export function typeLawManifest(
  law: TypeLaw,
  read: StateRead,
  graph: TypeLawGraph,
): Record<string, unknown> {
  const titleFromBasename = law.engine.field_sources.title === "basename";
  const pages = [...read.pages].sort((a, b) => codeUnitCompare(a.path, b.path));
  const pageSet = new Set(pages.map((p) => p.path));
  const outbound = new Map<string, Adjacency>();
  const inbound = new Map<string, Adjacency>();
  for (const edge of graph.edges) {
    if (!pageSet.has(edge.from) || !pageSet.has(edge.to)) continue;
    adjacent(outbound, edge.from, edge, edge.to);
    adjacent(inbound, edge.to, edge, edge.from);
  }
  const relationLabels = graph.edges.flatMap((e) => (e.label === undefined ? [] : [e.label]));
  return {
    schema: "wikiwright/manifest",
    totals: { pages: pages.length, edges: graph.edges.length },
    by_kind: counted(graph.edges.map((e) => e.kind)),
    by_label: relationLabels.length === 0 ? {} : { relation: counted(relationLabels) },
    pages: pages.map((page) => {
      const fm = frontmatterOf(page);
      const type = page.read.ok ? page.read.page.type : undefined;
      const description = fm["description"];
      const entry: Record<string, unknown> = {
        path: page.path,
        type: typeNameOf(fm),
        role: type?.role ?? null,
        ancestry: type?.ancestry ?? [],
        title: titleOf({ path: page.path, frontmatter: fm }, titleFromBasename),
        description: typeof description === "string" ? description : null,
        tags: strings(fm["tags"]),
        status: fm["status"] === "retired" ? "retired" : "active",
      };
      const out = adjacencyOf(outbound.get(page.path));
      const into = adjacencyOf(inbound.get(page.path));
      if (out !== undefined) entry["outbound"] = out;
      if (into !== undefined) entry["inbound"] = into;
      return entry;
    }),
  };
}

const GENERATED_LINE = "Generated file — do not edit; regenerate with `wikiwright check --write`.";

/** A Markdown table cell: a pipe escaped, a line break a space. */
export function tableCell(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll(/\r?\n/gu, " ");
}

/** The bundle's `tags` vocabulary as a table: each entry, and each retired one with its successor. */
export function typeLawTagCatalog(law: TypeLaw): string {
  const tags = law.vocabularies.get("tags");
  const rows: string[] = [];
  const names = [
    ...[...(tags?.entries.keys() ?? [])].map((name) => ({ name, retired: false })),
    ...[...(tags?.retired.keys() ?? [])].map((name) => ({ name, retired: true })),
  ].sort((a, b) => codeUnitCompare(a.name, b.name));
  for (const { name, retired } of names) {
    if (retired) {
      const successor = tags?.retired.get(name)?.successor;
      rows.push(
        `| ${tableCell(name)} | retired | ${successor === undefined ? "" : tableCell(successor)} | |`,
      );
    } else {
      const description = tags?.entries.get(name)?.description ?? name;
      rows.push(`| ${tableCell(name)} | active | | ${tableCell(description)} |`);
    }
  }
  return [
    "# Tag catalog",
    "",
    GENERATED_LINE,
    "",
    tags === undefined
      ? "This bundle declares no `tags` vocabulary."
      : `The \`tags\` vocabulary (${tags.mode}).`,
    "",
    "| tag | status | successor | description |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** Where a queued finding sits, as queue.md writes it. */
function where(finding: VerdictFinding): string {
  const at = finding.location;
  return at.kind === "page"
    ? "page"
    : `${tableCell(at.heading)} #${at.occurrence}, line ${at.line}`;
}

/** The two digests queue.md records, which `read` compares with the current ones. */
export interface QueueDigests {
  law: string;
  content: string;
}

export const QUEUE_PATH = "generated/queue.md";

/**
 * §9.1 queue.md: every queued finding of a judge run with no base over the
 * state — a function of the law and the content only — with the law and
 * content digests it was cut from. A finding a verb judged beside the judge
 * (git, the generated files) is never written here, and a fix-routed or info
 * finding is not a queue item.
 */
export function typeLawQueue(findings: readonly VerdictFinding[], digests: QueueDigests): string {
  const rows = findings
    .filter((f) => f.queue !== undefined)
    .map(
      (f) =>
        `| ${tableCell(f.path)} | ${tableCell(f.rule)} | ${f.severity} | ${f.queue ?? ""} | ${where(f)} | ${tableCell(f.message)} |`,
    );
  return [
    "# Queue",
    "",
    GENERATED_LINE,
    "",
    "The queued findings of this bundle's pages under its law, judged with no base: a",
    "function of the law and the content only. What `check` reads from git (pins,",
    "citations) is reported live and never written here.",
    "",
    `Law digest: \`${digests.law}\``,
    `Content digest: \`${digests.content}\``,
    "",
    `${rows.length} finding(s).`,
    "",
    "| path | rule | severity | lane | location | message |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** One row of queue.md, as `read` needs it: the page and the rule. */
export interface QueueRow {
  path: string;
  rule: string;
}

/** Split a table row on its unescaped pipes. */
function cells(line: string): string[] | undefined {
  if (!line.startsWith("| ") || !line.endsWith(" |")) return undefined;
  const out: string[] = [];
  let cell = "";
  for (let i = 2; i < line.length - 2; i += 1) {
    const ch = line[i] ?? "";
    if (ch === "\\" && i + 1 < line.length - 2) {
      cell += line[i + 1] ?? "";
      i += 1;
    } else if (ch === "|" && line[i - 1] === " " && line[i + 1] === " ") {
      out.push(cell.trimEnd());
      cell = "";
      i += 1;
    } else cell += ch;
  }
  out.push(cell.trimEnd());
  return out;
}

/**
 * queue.md read back: its two digests and its rows, or undefined when the
 * file is not one `typeLawQueue` wrote.
 */
export function parseTypeLawQueue(
  text: string,
): { digests: QueueDigests; rows: QueueRow[] } | undefined {
  const law = /^Law digest: `([0-9a-f]{64})`$/mu.exec(text)?.[1];
  const content = /^Content digest: `([0-9a-f]{64})`$/mu.exec(text)?.[1];
  if (law === undefined || content === undefined) return undefined;
  const lines = text.split("\n");
  const header = lines.indexOf("| path | rule | severity | lane | location | message |");
  if (header === -1) return undefined;
  const rows: QueueRow[] = [];
  for (const line of lines.slice(header + 2)) {
    if (line === "") break;
    const row = cells(line);
    if (row === undefined || row.length < 2) return undefined;
    rows.push({ path: row[0] ?? "", rule: row[1] ?? "" });
  }
  return { digests: { law, content }, rows };
}

/** The four kernel artifacts of a state under its law, in path order. */
export function typeLawArtifacts(
  law: TypeLaw,
  read: StateRead,
  queueFindings: readonly VerdictFinding[],
  digests: QueueDigests,
): TypeLawArtifact[] {
  const graph = typeLawGraph(law, read);
  return [
    { path: "generated/graph.json", content: serialize(graph) },
    { path: "generated/manifest.json", content: serialize(typeLawManifest(law, read, graph)) },
    { path: QUEUE_PATH, content: typeLawQueue(queueFindings, digests) },
    { path: "generated/tag-catalog.md", content: typeLawTagCatalog(law) },
  ];
}
