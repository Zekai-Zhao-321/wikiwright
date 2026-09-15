// docs/cli.md §graph (the query over the graph: by kind, by label, by the type on
// either side, or the pages on one side that carry none — answered from the
// working tree through the same construction `check` compares against, never
// from the artifact on disk, so a drifted `generated/` cannot lie to it)
// docs/concepts.md §Generated artifacts · docs/architecture.md §Directories.

import {
  boundedLevenshtein,
  buildNameIndex,
  codeUnitCompare,
  type GraphEdge,
  graphOf,
  KERNEL_EDGE_KINDS,
  normalizeIdentity,
} from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { generateOptionsFor, rootsOf } from "../law.ts";
import { activeTypeNames, collectPages } from "../pages.ts";
import { type CommandSpec, listFlag } from "../spec.ts";
import { loadVault, walkPages } from "../vaultio.ts";

const DEFAULT_LIMIT = 100;

/** The names within three edits of an unknown one — a not_found that helps. */
function nearest(wanted: string, candidates: readonly string[]): string[] {
  const identity = normalizeIdentity(wanted);
  return candidates
    .map((name) => ({ name, distance: boundedLevenshtein(identity, normalizeIdentity(name), 3) }))
    .filter((c) => c.distance <= 3)
    .sort((a, b) => a.distance - b.distance || codeUnitCompare(a.name, b.name))
    .slice(0, 5)
    .map((c) => c.name);
}

const stringFlag = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const graphCommand: CommandSpec = {
  name: "graph",
  role: "consumer",
  summary:
    "Query the graph's edges by kind, label and the type on either side — or list the pages on one side that carry none (coverage, derived).",
  positionals: [{ name: "subcommand", required: true }],
  subcommands: ["edges"],
  flags: [
    {
      name: "kind",
      type: "string",
      summary:
        "edge kind: wikilink, tagged, cites, supersedes, or a grammar's item kind; with --label it defaults to the one kind that carries labels",
    },
    {
      name: "label",
      type: "string",
      multiple: true,
      summary: "keep edges carrying any of these labels (repeatable)",
    },
    {
      name: "inbound",
      type: "string",
      summary: "keep edges whose target page's type chain includes this type",
    },
    {
      name: "outbound",
      type: "string",
      summary: "keep edges whose source page's type chain includes this type",
    },
    {
      name: "missing",
      type: "boolean",
      summary:
        "instead of the edges, list the pages on the named side (exactly one of --inbound / --outbound) that carry none of them: an inbound side lists the targets no selected edge reaches, an outbound side the sources that carry none",
    },
    { name: "limit", type: "string", summary: "cap the edges or missing array (default 100)" },
    { name: "all", type: "boolean", summary: "lift the cap" },
  ],
  examples: [
    "wikiwright graph edges --label implements --label diverges-from --inbound requirement --missing",
    "wikiwright graph edges --label mapped_in --outbound subsystem --missing",
    "wikiwright graph edges --kind relation --inbound source --missing",
    "wikiwright graph edges --label covers --outbound design-note",
  ],
  writes: false,
  needsVaultModules: true,
  run: (args) => {
    const kindFlag = stringFlag(args.flags["kind"]);
    const labels = listFlag(args, "label");
    const inbound = stringFlag(args.flags["inbound"]);
    const outbound = stringFlag(args.flags["outbound"]);
    const missing = args.flags["missing"] === true;
    // `--missing` enumerates ONE side: "requirements with no implements from an
    // rtl-module" is a one-sided query plus jq, because two-sided enumeration
    // needs a rule for which side is listed and every such rule is arbitrary.
    if (missing && (inbound === undefined) === (outbound === undefined)) {
      return fail("graph", "usage", "missing-side", "--missing enumerates one side; name it", {
        hint: "pass exactly one of --inbound <type> or --outbound <type> with --missing",
      });
    }
    const limitRaw = args.flags["limit"];
    const limit = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 0) {
      return fail("graph", "usage", "invalid-limit", "--limit must be a non-negative integer");
    }
    const vault = loadVault("graph", args.root);
    if (!vault.ok) return vault.result;
    const registry = vault.registry;
    for (const type of [inbound, outbound]) {
      if (type === undefined || registry.types.has(type)) continue;
      return fail("graph", "not_found", "unknown-type", `no registered type "${type}"`, {
        details: {
          valid_values: activeTypeNames(registry),
          nearest: nearest(type, activeTypeNames(registry)),
        },
        hint: "register the type in config/constitution.json through review, or pick one of details.valid_values",
      });
    }

    // The same construction `check --write` lands and `check` compares against
    //: one generation path, read here in memory.
    const pages = collectPages(args.root, walkPages(args.root, rootsOf(vault)));
    const graph = graphOf(registry, pages, buildNameIndex(pages), generateOptionsFor(vault));

    // A kind is known when an edge carries it, the kernel emits it, or a loaded
    // module registers it as an item kind — a registered-but-unwritten kind is a
    // legitimate empty answer, the same reading a registered label gets below.
    const kindsKnown = [
      ...new Set([
        ...graph.edges.map((e) => e.kind),
        ...KERNEL_EDGE_KINDS,
        ...vault.modules.kindOwner.keys(),
      ]),
    ].sort(codeUnitCompare);
    if (kindFlag !== undefined && !kindsKnown.includes(kindFlag)) {
      return fail("graph", "not_found", "unknown-kind", `no edge kind "${kindFlag}"`, {
        details: { valid_values: kindsKnown, nearest: nearest(kindFlag, kindsKnown) },
        hint: "the kinds are the kernel's four and every loaded grammar's item kinds; pick one of details.valid_values",
      });
    }
    let kind = kindFlag;
    if (kind === undefined && labels.length > 0) {
      // A derived default, from the vault's data and never from a module's name.
      const labelled = [
        ...new Set(graph.edges.filter((e) => e.label !== undefined).map((e) => e.kind)),
      ].sort(codeUnitCompare);
      if (labelled.length === 1) kind = labelled[0];
      if (labelled.length > 1) {
        return fail(
          "graph",
          "usage",
          "ambiguous-kind",
          `--label needs --kind here: ${labelled.join(", ")} all carry labels`,
          { details: { valid_values: labelled } },
        );
      }
    }
    // A label is known when an edge carries it or a loaded vocabulary registers
    // it: a registered-but-unused label is a legitimate empty answer, and an
    // unknown one is a not_found that names its neighbours — an empty answer
    // that could be a typo must explain itself.
    const labelsKnown = new Map<string, string>();
    for (const edge of graph.edges) {
      if (edge.label !== undefined) labelsKnown.set(normalizeIdentity(edge.label), edge.label);
    }
    for (const vocabulary of registry.vocabularies.values()) {
      for (const entry of vocabulary.entries.values()) {
        const identity = normalizeIdentity(entry.name);
        if (!labelsKnown.has(identity)) labelsKnown.set(identity, entry.name);
      }
    }
    const labelNames = [...labelsKnown.values()].sort(codeUnitCompare);
    for (const label of labels) {
      if (labelsKnown.has(normalizeIdentity(label))) continue;
      return fail("graph", "not_found", "unknown-label", `no edge carries the label "${label}"`, {
        details: { nearest: nearest(label, labelNames), valid_values: labelNames },
        hint: "a label is known when an edge carries it or a loaded vocabulary registers it; pick one of details.nearest",
      });
    }

    const chains = new Map<string, readonly string[]>();
    for (const page of pages) {
      const type = page.doc.frontmatter.value["type"];
      chains.set(
        page.path,
        typeof type === "string" ? (registry.types.get(type)?.chain ?? []) : [],
      );
    }
    const onSide =
      (type: string) =>
      (path: string): boolean =>
        chains.get(path)?.includes(type) === true;
    const labelIds = new Set(labels.map(normalizeIdentity));
    const edges = graph.edges.filter(
      (e) =>
        (kind === undefined || e.kind === kind) &&
        (labelIds.size === 0 ||
          (e.label !== undefined && labelIds.has(normalizeIdentity(e.label)))) &&
        (inbound === undefined || onSide(inbound)(e.to)) &&
        (outbound === undefined || onSide(outbound)(e.from)),
    );
    // `totals.pages` is the enumerated side — the side `--missing` names, else
    // the type filter given (inbound first) — so `missing / pages` is the
    // coverage number the bundle computed by hand.
    const sideType = inbound ?? outbound;
    const sidePages =
      sideType === undefined ? pages : pages.filter((p) => onSide(sideType)(p.path));
    const query = {
      kind: kind ?? null,
      labels,
      inbound: inbound ?? null,
      outbound: outbound ?? null,
      missing,
    };
    const cap = <T>(list: readonly T[]): { list: T[]; truncated: boolean } =>
      args.flags["all"] === true || list.length <= limit
        ? { list: [...list], truncated: false }
        : { list: list.slice(0, limit), truncated: true };
    if (!missing) {
      const capped = cap<GraphEdge>(edges);
      return ok("graph", {
        query,
        edges: capped.list,
        totals: { edges: edges.length, pages: sidePages.length },
        caps: { limit, truncated: capped.truncated },
      });
    }
    // docs/cli.md §graph: `missing` and the manifest's adjacency are two renderings of
    // one edge list, so they can never disagree.
    const side = inbound !== undefined ? "to" : "from";
    const covered = new Set(edges.map((e) => e[side]));
    const absent = sidePages
      .filter((p) => !covered.has(p.path))
      .map((p) => ({ path: p.path, type: chains.get(p.path)?.[0] ?? null }));
    const capped = cap(absent);
    return ok("graph", {
      query,
      // The side this answer enumerates, named — `target` for
      // `--inbound` (pages no selected edge reaches), `source` for
      // `--outbound` (pages that carry none) — so "carry" reads one way.
      side: side === "to" ? "target" : "source",
      missing: capped.list,
      totals: { edges: edges.length, pages: sidePages.length, missing: absent.length },
      caps: { limit, truncated: capped.truncated },
    });
  },
};
