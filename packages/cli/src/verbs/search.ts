// v2 contracts §9.6: `search <query> [--items] [--files]` — as the old verb,
// and each result carries `status`, computed as `read` computes it
// (status.ts), for the pages returned only. The git work that adds is per
// page returned and per page it links: each one's pins measured against the
// local repository.
//
// Ported from the old verb (legacy/search.ts): the flags and their refusals,
// the ranked page search, `--files` and `--items`, over core's search (the
// tokenizer, BM25, the identity ladder, RRF fusion, `name:near`), which reads
// a page's text and frontmatter and no law. Changed: the pages are the v2
// state's; `--type` matches a type and every type below it through the type
// documents' ancestry; `--items` ranks the §4 records (a claim, a relation, a
// dated entry) of each grammar section, their fields the record's own; a tag
// alias no longer resolves (vocabulary entries have none).
import {
  codeUnitCompare,
  type ItemCandidate,
  type NamedPage,
  pageFilter,
  parseDoc,
  rankItemCandidates,
  readPages,
  SEARCH_BANDS,
  type SearchBand,
  type StateRead,
  searchFiles,
  searchPages,
} from "@wikiwright/core";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { fsState } from "../lawstate.ts";
import type { CommandArgs, CommandSpec } from "../spec.ts";
import { pageStatuses } from "../status.ts";
import { lawOf, stateRefusal, typeLawIdentity, withIdentity } from "../typelaw.ts";

/** The §4 records of every grammar section, as item candidates. */
function itemCandidates(read: StateRead): ItemCandidate[] {
  const out: ItemCandidate[] = [];
  for (const page of [...read.pages].sort((a, b) => codeUnitCompare(a.path, b.path))) {
    if (!page.read.ok) continue;
    const parsed = page.read.page;
    const retired = parsed.frontmatter["status"] === "retired";
    for (const occurrence of parsed.occurrences) {
      const grammar = occurrence.mode;
      if (grammar === "prose" || grammar === "unbound") continue;
      for (const item of occurrence.items) {
        const { raw, rationale, location, ...fields } = item;
        out.push({
          path: page.path,
          line: location.line,
          section: occurrence.heading,
          kind: item.kind,
          grammar,
          raw,
          rationale: rationale.map((text, i) => ({ line: location.line + i + 1, text })),
          fields: JSON.parse(JSON.stringify(fields)) as Record<string, unknown>,
          retired,
        });
      }
    }
  }
  return out;
}

async function run(args: CommandArgs): Promise<CommandResult> {
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
  const near = args.flags["near"] === true;
  for (const [flag, set] of [
    ["files", files],
    ["band", band !== undefined],
    ["near", near],
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
  if (files && near) {
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
  let state: Awaited<ReturnType<typeof fsState>>;
  try {
    state = await fsState(args.root);
  } catch (e) {
    const refused = stateRefusal("search", e);
    if (refused === undefined) throw e;
    return refused;
  }
  const loaded = lawOf("search", state);
  if (!loaded.ok) return loaded.result;
  const law = loaded.law;
  const identity = await typeLawIdentity(args.root, state, law);
  const read = readPages(state, law);
  const pages: NamedPage[] = [...state.pages].map(([path, bytes]) => ({
    path,
    doc: parseDoc(Buffer.from(bytes).toString("utf8")),
  }));
  const filters: Parameters<typeof searchPages>[2] = {};
  if (typeof type === "string") filters.type = type;
  if (typeof tag === "string") filters.tag = tag;
  if (typeof titleContains === "string") filters.titleContains = titleContains;
  const typeChains = new Map([...law.types].map(([name, t]) => [name, [name, ...t.ancestry]]));
  const fieldSources = law.engine.field_sources;
  const withStatus = async <T extends { path: string }>(rows: readonly T[]) => {
    const statuses = await pageStatuses(args.root, state, law, read, [
      ...new Set(rows.map((r) => r.path)),
    ]);
    return rows.map((row) => ({ ...row, status: statuses.get(row.path) }));
  };
  if (items && query !== undefined) {
    const keeps = pageFilter(filters, { fieldSources, typeChains });
    const kept = new Set(pages.filter(keeps).map((p) => p.path));
    const outcome = rankItemCandidates(itemCandidates(read), kept, query, limit, pages.length);
    return withIdentity(
      ok("search", { ...outcome, results: await withStatus(outcome.results) }),
      identity,
    );
  }
  if (files) {
    const outcome = searchFiles(pages, query, filters, { fieldSources, typeChains, band });
    return withIdentity(
      ok("search", { ...outcome, files: await withStatus(outcome.files) }),
      identity,
    );
  }
  const outcome = searchPages(pages, query, filters, limit, {
    fieldSources,
    typeChains,
    near,
    band,
  });
  return withIdentity(
    ok("search", { ...outcome, results: await withStatus(outcome.results) }),
    identity,
  );
}

export const searchCommand: CommandSpec = {
  name: "search",
  summary:
    "Deterministic lexical search with match reasons and a coverage block; each result carries its page's status.",
  positionals: [{ name: "query", required: false }],
  flags: [
    { name: "type", type: "string", summary: "restrict to one type and every type below it" },
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
        "rank the grammar records themselves — claims, relations, entries — with their line, section and fields",
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
    "wikiwright search basil",
    "wikiwright search --tag herbs",
    "wikiwright search bolts --type garden/planting",
    'wikiwright search "sweet basil" --near',
    'wikiwright search "thirty degrees" --items',
    'wikiwright search "herb bed" --files',
    "wikiwright search basil --band identity",
  ],
  writes: false,
  run,
};
