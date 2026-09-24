// docs/concepts.md §Generated artifacts (
// filter flags, no DSL) · docs/architecture.md §Directories.

import {
  resolveVocabularyEntry,
  SEARCH_BANDS,
  type SearchBand,
  searchFiles,
  searchItems,
  searchPages,
  tagByName,
  tagsOf,
} from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { generateOptionsFor, rootsOf } from "../law.ts";
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
    { name: "all", type: "boolean", summary: "lift the result cap" },
    {
      name: "near",
      type: "boolean",
      summary: "add the advisory name:near candidate list (never changes ranks)",
    },
    {
      name: "items",
      type: "boolean",
      summary:
        "rank the grammar items themselves — claims, relations, entries — with their line, section and fields",
    },
    {
      name: "files",
      type: "boolean",
      summary: "every page with a match, by path with its reasons: unranked, uncapped",
    },
    {
      name: "band",
      type: "string",
      summary: "keep only the results of one band: identity | relevance",
    },
  ],
  examples: [
    "wikiwright search 张伟",
    "wikiwright search --tag reset",
    "wikiwright search parser --type subsystem",
    'wikiwright search "Zhang Wei" --near',
    'wikiwright search "aphids roses" --items',
    'wikiwright search "aphids codling" --files',
    "wikiwright search pruning-roses --band identity",
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
    const parsedLimit = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 20;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      return fail("search", "usage", "invalid-limit", "--limit must be a positive integer");
    }
    // `--all` lifts the cap; `caps.hit` then never fires.
    const limit = args.flags["all"] === true ? Number.MAX_SAFE_INTEGER : parsedLimit;
    const items = args.flags["items"] === true;
    if (items && query === undefined) {
      return fail("search", "usage", "missing-argument", "search --items needs a query", {
        details: { expected_positionals: ["query"] },
        hint: "an item has no name to filter by; the filter flags narrow the pages its items come from",
      });
    }
    const bandRaw = args.flags["band"];
    if (bandRaw !== undefined && !(SEARCH_BANDS as readonly unknown[]).includes(bandRaw)) {
      return fail(
        "search",
        "usage",
        "invalid-value",
        `--band must be one of ${SEARCH_BANDS.join(", ")}`,
        {
          details: { flag: "band", value: bandRaw, valid_values: [...SEARCH_BANDS] },
        },
      );
    }
    const band = bandRaw as SearchBand | undefined;
    const files = args.flags["files"] === true;
    // Items have no band and are not pages: `--items` stands alone.
    for (const [flag, set] of [
      ["files", files],
      ["band", band !== undefined],
    ] as const) {
      if (items && set) {
        return fail(
          "search",
          "usage",
          "invalid-arguments",
          `--${flag} is a page search's, and --items ranks items`,
          {
            details: { flag, conflicts_with: ["items"] },
          },
        );
      }
    }
    if (files && args.flags["near"] === true) {
      return fail(
        "search",
        "usage",
        "invalid-arguments",
        "--near ranks page names, and --files ranks nothing",
        {
          details: { flag: "near", conflicts_with: ["files"] },
        },
      );
    }
    if (items && args.flags["near"] === true) {
      return fail(
        "search",
        "usage",
        "invalid-arguments",
        "--near ranks page names, and an item has none",
        { details: { flag: "near", conflicts_with: ["items"] } },
      );
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
    const typeChains = new Map([...vault.registry.types].map(([name, t]) => [name, t.chain]));
    if (items && query !== undefined) {
      // docs/cli.md §search: the items the judge would see, under the bundle's
      // parse options; the filters keep the pages they come from.
      const sourceRoots = generateOptionsFor(vault)?.sourceRoots;
      return ok(
        "search",
        searchItems(pages, vault.registry, query, filters, limit, {
          fieldSources: vault.engine.field_sources,
          typeChains,
          parseOptions: sourceRoots === undefined ? undefined : { sourceRoots },
        }),
      );
    }
    if (files) {
      return ok(
        "search",
        searchFiles(pages, query, filters, {
          fieldSources: vault.engine.field_sources,
          typeChains,
          band,
        }),
      );
    }
    const outcome = searchPages(pages, query, filters, limit, {
      fieldSources: vault.engine.field_sources,
      typeChains,
      near: args.flags["near"] === true,
      band,
    });
    return ok("search", outcome);
  },
};
