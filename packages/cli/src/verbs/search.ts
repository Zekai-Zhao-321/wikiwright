// docs/concepts.md §Generated artifacts (
// filter flags, no DSL) · docs/architecture.md §Directories.

import { resolveVocabularyEntry, searchPages, tagByName, tagsOf } from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { rootsOf } from "../law.ts";
import { collectPages } from "../pages.ts";
import type { CommandSpec } from "../spec.ts";
import { loadVault, walkPages } from "../vaultio.ts";

export const searchCommand: CommandSpec = {
  name: "search",
  role: "consumer",
  summary: "Deterministic lexical search with match reasons and a coverage block.",
  positionals: [{ name: "query", required: false }],
  flags: [
    { name: "type", type: "string", summary: "restrict to one type" },
    { name: "tag", type: "string", summary: "restrict to pages carrying a tag" },
    { name: "title-contains", type: "string", summary: "restrict by title substring" },
    { name: "limit", type: "string", summary: "result cap (default 20)" },
    {
      name: "near",
      type: "boolean",
      summary: "add the advisory name:near candidate list (never changes ranks)",
    },
  ],
  examples: [
    "wikiwright search 张伟",
    "wikiwright search --tag reset",
    "wikiwright search parser --type subsystem",
    'wikiwright search "Zhang Wei" --near',
  ],
  writes: false,
  needsVaultModules: true,
  run: (args) => {
    const vault = loadVault("search", args.root);
    if (!vault.ok) return vault.result;
    // An empty query string is not a query (docs/cli.md §search): `""` is a
    // substring of every string, so running the ladder on it returned every page
    // stamped `title:contains` + `body:phrase` under a nine-tier coverage block
    // — an absence-shaped lie reached from the other side.
    const [rawQuery] = args.positionals;
    const query = rawQuery === "" ? undefined : rawQuery;
    const type = args.flags["type"];
    const tag = args.flags["tag"];
    const titleContains = args.flags["title-contains"];
    if (
      query === undefined &&
      type === undefined &&
      tag === undefined &&
      titleContains === undefined
    ) {
      return fail(
        "search",
        "usage",
        "missing-argument",
        "search needs a query or at least one filter",
        {
          details: { flags: ["--type", "--tag", "--title-contains"] },
        },
      );
    }
    const limitRaw = args.flags["limit"];
    const limit = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 20;
    if (!Number.isInteger(limit) || limit < 1) {
      return fail("search", "usage", "invalid-limit", "--limit must be a positive integer");
    }
    const filters: Parameters<typeof searchPages>[2] = {};
    if (typeof type === "string") filters.type = type;
    if (typeof tag === "string") filters.tag = tag;
    if (typeof titleContains === "string") filters.titleContains = titleContains;
    const pages = collectPages(args.root, walkPages(args.root, rootsOf(vault)));
    if (typeof filters.tag === "string" && tagByName(vault.registry, filters.tag) === undefined) {
      // --tag accepts aliases and resolves them to the canonical tag (P0 #7).
      const resolved = resolveVocabularyEntry(tagsOf(vault.registry), filters.tag);
      if (resolved?.alias === true) filters.tag = resolved.entry.name;
    }
    const outcome = searchPages(pages, query, filters, limit, {
      fieldSources: vault.engine.field_sources,
      typeChains: new Map([...vault.registry.types].map(([name, t]) => [name, t.chain])),
      near: args.flags["near"] === true,
    });
    return ok("search", outcome);
  },
};
