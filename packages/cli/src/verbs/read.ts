// v2 contracts §9.5: `read <page> [--section <heading>] [--budget <bytes>]` —
// as the old verb: a page named by its path, name, alias or title; its
// sections cut at its type's section depth, each the page's own lines
// verbatim with its address; a budget that returns sections in page order
// while they fit and lists the rest by address — plus `data.bytes`, the
// page's bytes digest (§7), and `data.status`, whether the page is due for
// reconsideration (status.ts).
//
// Ported from the old verb (legacy/read.ts): the name forms in their order
// (path, name, alias, title), the section cut and its lead, a repeated
// heading's `occurrence`, the budget, and every refusal (`missing-argument`,
// `invalid-value`, `page-not-found`, `section-not-found`). Changed: the page
// is read through the v2 state and its law, so the title a page answers to
// is the one `field_sources.title` derives and the type is the type
// document's (`ancestry` and `role` in place of `chain`); the page's digest
// is `data.bytes`, where it was `page.digest`.
import {
  basenameOf,
  bytesDigest,
  codeUnitCompare,
  jsonNumbers,
  normalizeIdentity,
  type ReadPage,
  readPages,
  type StateRead,
  titleOfPage,
} from "@wikiwright/core";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { fsState } from "../lawstate.ts";
import type { CommandArgs, CommandSpec } from "../spec.ts";
import { pageStatuses } from "../status.ts";
import { lawOf, stateRefusal, typeLawIdentity, withIdentity } from "../typelaw.ts";

const DEFAULT_DEPTH = 2;

type ResolvedVia = "path" | "name" | "alias" | "title";
const FORMS: readonly ResolvedVia[] = ["path", "name", "alias", "title"];

interface Section {
  heading: string | null;
  address: string;
  occurrence?: number;
  line: number;
  end_line: number;
  bytes: number;
  text: string;
}

/** The page a `<page>` argument names, in the order the forms are tried. */
function resolvePage(
  read: StateRead,
  wanted: string,
  titleFromBasename: boolean,
): { page: ReadPage; via: ResolvedVia } | undefined {
  const byPath = new Map(read.pages.map((p) => [p.path, p] as const));
  const asPath = byPath.get(wanted.normalize("NFC"));
  if (asPath !== undefined) return { page: asPath, via: "path" };
  const named = read.names.resolve(wanted);
  if (named !== undefined) {
    const page = byPath.get(named.path);
    if (page !== undefined) return { page, via: named.viaAlias ? "alias" : "name" };
  }
  const identity = normalizeIdentity(wanted);
  for (const named of [...read.named].sort((a, b) => codeUnitCompare(a.path, b.path))) {
    const title = titleOfPage(named, titleFromBasename);
    const page = byPath.get(named.path);
    if (page !== undefined && title !== null && normalizeIdentity(title) === identity)
      return { page, via: "title" };
  }
  return undefined;
}

/** The line each 1-based line of `text` starts and where the frontmatter's closing fence is. */
function linesOf(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const next = text.indexOf("\n", at);
    if (next < 0) {
      if (at < text.length) out.push(text.slice(at));
      return out;
    }
    out.push(text.slice(at, next + 1));
    at = next + 1;
  }
}

/** The first line after the frontmatter block, 1-based; 1 when there is none. */
function firstBodyLine(lines: readonly string[]): number {
  const bare = (l: string | undefined) => (l ?? "").replace(/\r?\n$/u, "").replace(/^﻿/u, "");
  if (bare(lines[0]) !== "---") return 1;
  for (let i = 1; i < lines.length; i += 1) if (bare(lines[i]) === "---") return i + 2;
  return 1;
}

/**
 * The page's sections cut at `depth`: the lead (from the line after the
 * frontmatter to the line before the first cut) with `heading: null`, then
 * each heading at that depth to the line before the next. The text is the
 * page's own lines, their endings kept; a byte order mark is left out.
 */
function sectionsOf(
  path: string,
  raw: string,
  cuts: readonly { heading: string; line: number }[],
): Section[] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = linesOf(text);
  const section = (heading: string | null, line: number, end: number): Section => {
    const body = lines.slice(line - 1, end).join("");
    return {
      heading,
      address: heading === null ? path : `${path}#${heading}`,
      line,
      end_line: end,
      bytes: Buffer.byteLength(body, "utf8"),
      text: body,
    };
  };
  const out: Section[] = [];
  const first = firstBodyLine(lines);
  const leadEnd = (cuts[0]?.line ?? lines.length + 1) - 1;
  if (leadEnd >= first) out.push(section(null, first, leadEnd));
  cuts.forEach((cut, i) => {
    out.push(section(cut.heading, cut.line, (cuts[i + 1]?.line ?? lines.length + 1) - 1));
  });
  const identityOf = (s: Section) => (s.heading === null ? null : normalizeIdentity(s.heading));
  const total = new Map<string, number>();
  for (const s of out) {
    const id = identityOf(s);
    if (id !== null) total.set(id, (total.get(id) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return out.map((s) => {
    const id = identityOf(s);
    if (id === null || (total.get(id) ?? 0) < 2) return s;
    const occurrence = (seen.get(id) ?? 0) + 1;
    seen.set(id, occurrence);
    const { heading, address, ...rest } = s;
    return { heading, address, occurrence, ...rest };
  });
}

function budgetOf(args: CommandArgs): { ok: true; budget: number | null } | { ok: false } {
  const raw = args.flags["budget"];
  if (raw === undefined) return { ok: true, budget: null };
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) return { ok: false };
  const budget = Number(raw);
  return Number.isSafeInteger(budget) ? { ok: true, budget } : { ok: false };
}

async function run(args: CommandArgs): Promise<CommandResult> {
  const [wanted] = args.positionals;
  if (wanted === undefined || wanted === "") {
    return fail(
      "read",
      "usage",
      "missing-argument",
      "read needs a page: a path, a name or a title",
      {
        details: { expected_positionals: ["page"] },
      },
    );
  }
  const budget = budgetOf(args);
  if (!budget.ok) {
    return fail("read", "usage", "invalid-value", "--budget takes a whole number of bytes", {
      details: { flag: "budget", value: args.flags["budget"] },
    });
  }
  let state: Awaited<ReturnType<typeof fsState>>;
  try {
    state = await fsState(args.root);
  } catch (e) {
    const refused = stateRefusal("read", e);
    if (refused === undefined) throw e;
    return refused;
  }
  const loaded = lawOf("read", state, args.root);
  if (!loaded.ok) return loaded.result;
  const law = loaded.law;
  const identity = await typeLawIdentity(args.root, state, law);
  const read = readPages(state, law);
  const titleFromBasename = law.engine.field_sources.title === "basename";
  const found = resolvePage(read, wanted, titleFromBasename);
  if (found === undefined) {
    // What was tried, never what exists.
    return withIdentity(
      fail("read", "not_found", "page-not-found", `no page answers to "${wanted}"`, {
        details: { tried: [...FORMS] },
        hint: "`search` finds a page by any name form; `read` takes the path it returns",
      }),
      identity,
    );
  }
  const { page, via } = found;
  const bytes = state.pages.get(page.path) ?? new Uint8Array();
  const raw = Buffer.from(bytes).toString("utf8");
  const parsed = page.read.ok ? page.read.page : undefined;
  const type = parsed?.type;
  const depth = type?.sections?.depth ?? DEFAULT_DEPTH;
  const cuts = (parsed?.occurrences ?? [])
    .filter((o) => o.depth === depth)
    .map((o) => ({ heading: o.heading, line: o.location.line }));
  const all = sectionsOf(page.path, raw, cuts);
  let chosen = all;
  const sectionFlag = args.flags["section"];
  if (typeof sectionFlag === "string") {
    const want = normalizeIdentity(sectionFlag);
    const matches = all.filter((s) => s.heading !== null && normalizeIdentity(s.heading) === want);
    if (matches.length === 0) {
      return withIdentity(
        fail(
          "read",
          "not_found",
          "section-not-found",
          `${page.path} has no section "${sectionFlag}"`,
          {
            details: { valid_values: cuts.map((c) => c.heading) },
            hint: `the page's sections are its level-${depth} headings, named in details.valid_values`,
          },
        ),
        identity,
      );
    }
    chosen = matches;
  }
  const sections: Section[] = [];
  const omitted: (Omit<Section, "text"> & { reason: "budget" })[] = [];
  let used = 0;
  for (const section of chosen) {
    const fits = budget.budget === null || used + section.bytes <= budget.budget;
    if (fits && omitted.length === 0) {
      sections.push(section);
      used += section.bytes;
      continue;
    }
    const { text: _text, ...located } = section;
    omitted.push({ ...located, reason: "budget" });
  }
  const frontmatter = parsed?.frontmatter ?? {};
  const seenHeadings = new Map<string, number>();
  const regions = (parsed?.occurrences ?? []).map((occurrence) => {
    const index = seenHeadings.get(occurrence.heading) ?? 0;
    seenHeadings.set(occurrence.heading, index + 1);
    return {
      heading: occurrence.heading,
      occurrence: index,
      depth: occurrence.depth,
      path: occurrence.path,
      section_path: occurrence.sectionPath,
      policy: occurrence.policy,
      mode: occurrence.mode,
      explicit: occurrence.explicit,
      subtree_span: occurrence.location.span,
      direct_span: occurrence.directLocation.span,
      records: occurrence.items.length,
      malformed_items:
        parsed?.unparsed.filter(
          (item) => item.heading === occurrence.heading && item.occurrence === index,
        ).length ?? 0,
    };
  });
  const description = frontmatter["description"];
  const status = (await pageStatuses(args.root, state, law, read, [page.path])).get(page.path);
  return withIdentity(
    ok("read", {
      page: {
        path: page.path,
        name: basenameOf(page.path),
        resolved_via: via,
        type: typeof frontmatter["type"] === "string" ? frontmatter["type"] : null,
        role: type?.role ?? null,
        ancestry: type?.ancestry ?? [],
        title: titleOfPage({ path: page.path, frontmatter }, titleFromBasename),
        description: typeof description === "string" ? description : null,
        status: frontmatter["status"] === "retired" ? "retired" : "active",
        frontmatter: jsonNumbers(frontmatter),
      },
      bytes: bytesDigest(bytes),
      status,
      sections,
      regions,
      unbound_preamble: parsed === undefined ? null : parsed.preamble.trim() !== "",
      omitted,
      coverage: {
        sections: all.length,
        returned: sections.length,
        bytes_returned: used,
        budget: budget.budget,
      },
    }),
    identity,
  );
}

export const readCommand: CommandSpec = {
  name: "read",
  summary:
    "Return a page's sections verbatim under a byte budget, with its bytes digest and its status: stale pins, and the queue's unresolved rules.",
  positionals: [{ name: "page", required: true }],
  flags: [
    {
      name: "section",
      type: "string",
      summary: "return only the section under this heading, every one where it repeats",
    },
    {
      name: "budget",
      type: "string",
      summary: "the most bytes of section text to return; the rest are listed by address",
    },
  ],
  examples: [
    "wikiwright read wiki/Basil.md",
    "wikiwright read Basil --section History",
    'wikiwright read "Herb bed" --budget 800',
  ],
  writes: false,
  run,
};
