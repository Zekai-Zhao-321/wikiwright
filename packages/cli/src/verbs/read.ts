// docs/cli.md §read (a page's sections, verbatim, with the page's digest, under
// a byte budget; the envelope's bundle block is the attribution) ·
// docs/architecture.md §Directories.
//
// A reader: it loads the law to know the page's type and the depth its
// sections are cut at, and writes nothing. The text it returns is the page's
// own bytes, line for line, never a rendering of them.
import {
  basenameOf,
  buildNameIndex,
  codeUnitCompare,
  type FieldSources,
  type Heading,
  normalizeIdentity,
  type PageInput,
  type ParsedDoc,
  parseDoc,
  resolveDescription,
  resolveTitle,
} from "@wikiwright/core";
import { pageDigest } from "../bundle.ts";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { generateOptionsFor, rootsOf } from "../law.ts";
import { contentPathRefusal } from "../paths.ts";
import type { CommandArgs, CommandSpec } from "../spec.ts";
import { loadVault, readPage, readPageBytes, walkPages } from "../vaultio.ts";

/** The section depth a type that declares none is cut at (docs/constitution.md §Sections). */
const DEFAULT_DEPTH = 2;

/** The position after each line ending the Markdown parser counts: CRLF, LF, or a lone CR. */
const LINE_END = /(?<=\r\n|\r(?!\n)|\n)/u;

/** How a `<page>` argument was matched, in the order the forms are tried. */
type ResolvedVia = "path" | "name" | "alias" | "title";
const FORMS: readonly ResolvedVia[] = ["path", "name", "alias", "title"];

interface Section {
  heading: string | null;
  address: string;
  /**
   * Which of a repeated heading's sections this is, 1-based in page order;
   * absent when the heading appears once on the page.
   */
  occurrence?: number;
  line: number;
  end_line: number;
  bytes: number;
  text: string;
}

/** A resolved page: its path, how it was named, and its parse when resolving it made one. */
interface Resolved {
  path: string;
  via: ResolvedVia;
  doc?: ParsedDoc;
}

/**
 * The page a `<page>` argument names: an exact vault path under a content root,
 * else a basename or an alias through the name index the judge builds, else a
 * page whose title has the same identity — the title as the manifest spells it,
 * derived under `field_sources` where the frontmatter carries none. A title
 * shared by two pages resolves to the first in path order, as the walk lists
 * them.
 *
 * The name forms read and parse every page, and the chosen page's parse is
 * returned with it, so it is not parsed again. A page the walk lists and no
 * read inside the vault reaches — a link out of it — is left out of the index
 * rather than ending the resolution of every other page, and is still named by
 * its basename, so the caller refuses it by name.
 */
function resolvePage(
  root: string,
  paths: readonly string[],
  wanted: string,
  fieldSources: FieldSources | undefined,
  parse: (text: string) => ParsedDoc,
): Resolved | undefined {
  const asPath = wanted.normalize("NFC");
  if (paths.includes(asPath)) return { path: asPath, via: "path" };
  const pages: PageInput[] = [];
  const unread: string[] = [];
  for (const path of [...paths].sort(codeUnitCompare)) {
    let text: string;
    try {
      text = readPage(root, path);
    } catch {
      unread.push(path);
      continue;
    }
    pages.push({ path, doc: parse(text) });
  }
  const docOf = (path: string): ParsedDoc | undefined => pages.find((p) => p.path === path)?.doc;
  const named = buildNameIndex(pages).resolve(wanted);
  if (named !== undefined) {
    const doc = docOf(named.path);
    return {
      path: named.path,
      via: named.viaAlias ? "alias" : "name",
      ...(doc === undefined ? {} : { doc }),
    };
  }
  const identity = normalizeIdentity(wanted);
  const linked = unread.find((path) => normalizeIdentity(basenameOf(path)) === identity);
  if (linked !== undefined) return { path: linked, via: "name" };
  for (const page of pages) {
    const title = resolveTitle(page.doc, page.path, fieldSources);
    if (title !== null && normalizeIdentity(title) === identity) {
      return { path: page.path, via: "title", doc: page.doc };
    }
  }
  return undefined;
}

/**
 * docs/cli.md §read: the page `wanted` names, its bytes and its one parse, or
 * the refusal: `invalid-path` for a page that resolves outside the vault, as
 * `lint --page` refuses it, and undefined when nothing answers. The bytes are
 * read once more for the digest and the sections; the parse is the
 * resolver's where it made one. `parse` is the parser, a parameter so a test
 * can count its calls.
 */
export function pageNamed(
  root: string,
  roots: readonly string[],
  wanted: string,
  fieldSources: FieldSources | undefined,
  parse: (text: string) => ParsedDoc = parseDoc,
):
  | { ok: true; path: string; via: ResolvedVia; bytes: Buffer; doc: ParsedDoc }
  | { ok: false; path: string; refusal: string }
  | undefined {
  const found = resolvePage(root, walkPages(root, roots), wanted, fieldSources, parse);
  if (found === undefined) return undefined;
  const refusal = contentPathRefusal(root, found.path, roots);
  if (refusal !== undefined) return { ok: false, path: found.path, refusal };
  const bytes = readPageBytes(root, found.path);
  return {
    ok: true,
    path: found.path,
    via: found.via,
    bytes,
    doc: found.doc ?? parse(bytes.toString("utf8")),
  };
}

/**
 * docs/cli.md §read: the page's sections, cut at `depth` from the parsed
 * headings. The lead — from the line after the frontmatter to the line before
 * the first heading at that depth — comes first with `heading: null`; each
 * heading at that depth runs to the line before the next. Text is the source
 * lines themselves, line endings and trailing blank lines kept; only a byte
 * order mark before the first line is left out.
 *
 * A line ends where the parser's lines end — at CRLF, at LF, and at a CR that
 * no LF follows — so a heading's `line` indexes the same line here that it
 * does in `ParsedDoc.headings`, whatever mix of endings the page carries, and
 * each line keeps its own ending.
 *
 * A type may admit one heading more than once. The address stays
 * `<path>#<heading>`, so the sections of a heading that repeats — by the
 * identity `--section` matches on — each carry `occurrence`, 1-based in page
 * order, and a heading that appears once carries none.
 */
function sectionsOf(
  path: string,
  raw: string,
  firstLine: number,
  cuts: readonly Heading[],
): Section[] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text === "" ? [] : text.split(LINE_END);
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
  const leadEnd = (cuts[0]?.line ?? lines.length + 1) - 1;
  if (leadEnd >= firstLine) out.push(section(null, firstLine, leadEnd));
  cuts.forEach((cut, i) => {
    out.push(section(cut.text, cut.line, (cuts[i + 1]?.line ?? lines.length + 1) - 1));
  });
  const identityOf = (s: Section): string | null =>
    s.heading === null ? null : normalizeIdentity(s.heading);
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

/** `--budget`: a non-negative integer number of bytes, or none. */
function budgetOf(args: CommandArgs): { ok: true; budget: number | null } | { ok: false } {
  const raw = args.flags["budget"];
  if (raw === undefined) return { ok: true, budget: null };
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) return { ok: false };
  const budget = Number(raw);
  return Number.isSafeInteger(budget) ? { ok: true, budget } : { ok: false };
}

function run(args: CommandArgs): CommandResult {
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
  const vault = loadVault("read", args.root);
  if (!vault.ok) return vault.result;

  const fieldSources = generateOptionsFor(vault)?.fieldSources;
  const found = pageNamed(args.root, rootsOf(vault), wanted, fieldSources);
  if (found === undefined) {
    // What was tried, never what exists: a list of the pages that do would make
    // a refusal a way to enumerate the vault.
    return fail("read", "not_found", "page-not-found", `no page answers to "${wanted}"`, {
      details: { tried: [...FORMS] },
      hint: "`search` finds a page by any name form; `read` takes the path it returns",
    });
  }
  if (!found.ok) {
    return fail("read", "usage", "invalid-path", `${found.path} ${found.refusal}`, {
      details: { path: found.path },
    });
  }
  const { path, bytes, doc } = found;
  const raw = bytes.toString("utf8");
  const frontmatter = doc.frontmatter.value;
  const declared = frontmatter["type"];
  const typeName = typeof declared === "string" ? declared : null;
  const effective = typeName === null ? undefined : vault.registry.types.get(typeName);
  const depth = effective?.sections?.depth ?? DEFAULT_DEPTH;
  const cuts = doc.headings.filter((h) => h.depth === depth);
  const firstLine = doc.frontmatter.present ? doc.frontmatter.endLine + 1 : 1;
  const all = sectionsOf(path, raw, firstLine, cuts);

  // docs/cli.md §read: `--section` returns every section under that heading,
  // in page order, so a repeated heading's later occurrence — one a budget
  // omitted, say — is reached through the address it was listed under.
  const sectionFlag = args.flags["section"];
  let chosen = all;
  if (typeof sectionFlag === "string") {
    const identity = normalizeIdentity(sectionFlag);
    const matches = all.filter(
      (s) => s.heading !== null && normalizeIdentity(s.heading) === identity,
    );
    if (matches.length === 0) {
      return fail(
        "read",
        "not_found",
        "section-not-found",
        `${path} has no section "${sectionFlag}"`,
        {
          details: { valid_values: cuts.map((h) => h.text) },
          hint: `the page's sections are its level-${depth} headings, named in details.valid_values`,
        },
      );
    }
    chosen = matches;
  }

  // docs/cli.md §read: in page order while the running total stays within the
  // budget; the first section that would exceed it, and every later one, is
  // omitted with its address, so the caller can ask for it by `--section`.
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

  return ok("read", {
    page: {
      path,
      name: basenameOf(path),
      resolved_via: found.via,
      type: typeName,
      chain: effective?.chain ?? [],
      // The one effective page model the manifest renders: derived under
      // `field_sources` where the frontmatter is silent.
      title: resolveTitle(doc, path, fieldSources),
      description: resolveDescription(doc, fieldSources),
      status: frontmatter["status"] === "retired" ? "retired" : "active",
      // The content digest's line for this page holds the same value.
      digest: pageDigest(bytes),
      frontmatter,
    },
    sections,
    omitted,
    coverage: {
      sections: all.length,
      returned: sections.length,
      bytes_returned: used,
      budget: budget.budget,
    },
  });
}

export const readCommand: CommandSpec = {
  name: "read",
  role: "consumer",
  summary:
    "Return a page's sections verbatim, with its digest and the bundle it came from, under a byte budget.",
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
    "wikiwright read wiki/pruning-roses.md",
    "wikiwright read pruning-roses --section Steps",
    'wikiwright read "Pruning roses" --budget 800',
  ],
  writes: false,
  needsVaultModules: true,
  run,
};
