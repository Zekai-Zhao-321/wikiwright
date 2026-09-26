// docs/cli.md §check: the citations a pinned page makes, read from its text.
// `check` holds each to the page's pin (pins.ts): its path must exist at the
// pin and its line inside the blob there. Kept from the old `freshness` verb,
// whose measurement `check` absorbed; the rest of that verb left with it.
import { codeUnitCompare } from "@wikiwright/core";

/**
 * What a page CITES, checked at its pin by `check` (pins.ts), and what it says
 * that cannot be read as a citation at all.
 *
 * A code span is a citation in one of four spellings, and nothing else is:
 *
 * - a repository path whose first segment is an entry at the root of the tree
 *   at the pin (`packages/cli/src/git.ts`), the root file included (`AGENTS.md`);
 * - that path with a line or a range (`packages/cli/src/git.ts:31`, `:31-44`);
 * - a bare file name, suffix included, that is the basename of exactly one
 *   FILE the page covers (`git.ts:31`) — two covered paths of that name are
 *   ambiguous and are reported rather than guessed at, a covered directory is
 *   no candidate, and a name with no suffix is prose: `skills` is a verb in a
 *   sentence far more often than it is a path;
 * - a line or range alone (`:31-44`), which names the nearest FILE cited before
 *   it on the page, and is reported when nothing is cited before it. A
 *   directory (`packages/cli/src/verbs/`) is a citation of its own and is not
 *   that file: a line does not live in a directory, and a page that names one
 *   in passing is still writing about the file it was reading.
 *
 * Each distinct path must exist at the pin, and a cited line must not exceed
 * the blob's line count. A range must count up from a first line, so `:0` and
 * `:12-3` are refused rather than read as line 12 or line 3. What this does NOT
 * check is whether those lines say what the prose says they say; a citation
 * that resolves is a citation whose file and lines are there.
 *
 * A code span is a backtick run closed by a run of the same length (CommonMark
 * §6.1), so a span that soft-wraps over a line break, and a fenced block, each
 * pair as one token — neither shifts the pairing of the spans after it. A
 * single-line matcher paired the closing backtick of a wrapped span with the
 * opening backtick of the next one, and read every span in the rest of the
 * paragraph as its gap; the citations there were never checked.
 */
const CODE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/gu;
const CITATION = /^(?<path>[^\s:]*)(?::(?<from>\d+)(?:-(?<to>\d+))?)?$/u;
const NOT_A_PATH = /[*{<$\s]|:\/\//u;

export interface Citation {
  path: string;
  line: number | null;
}

/** A span that reads as a citation and names nothing this page can resolve. */
export interface CitationProblem {
  /** The span as written, so the writer can find it. */
  token: string;
  reason: "unattached" | "ambiguous" | "malformed";
  /** For an ambiguous name, the covered paths it could mean. */
  candidates?: string[];
}

export interface CitationScan {
  citations: Citation[];
  problems: CitationProblem[];
}

/** The last path segment, for resolving a bare file name against `covers`. */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** The citations a page makes, deduplicated and in code-unit order, and its unreadable spans. */
export function citationsIn(
  source: string,
  topLevel: ReadonlySet<string>,
  covers: readonly string[] = [],
): CitationScan {
  const seen = new Map<string, Citation>();
  const problems: CitationProblem[] = [];
  const reported = new Set<string>();
  // The page's own reading order: a bare line names the path cited before it.
  let antecedent: string | undefined;
  for (const match of source.matchAll(CODE_SPAN)) {
    const token = match[2] ?? "";
    if (NOT_A_PATH.test(token)) continue;
    const parsed = CITATION.exec(token);
    if (parsed === null) continue;
    const raw = parsed.groups?.["path"] ?? "";
    const written = raw.replace(/\/+$/u, "");
    const fromRaw = parsed.groups?.["from"];
    const toRaw = parsed.groups?.["to"];
    const from = fromRaw === undefined ? null : Number.parseInt(fromRaw, 10);
    const to = toRaw === undefined ? null : Number.parseInt(toRaw, 10);
    const problem = (reason: CitationProblem["reason"], candidates?: string[]): void => {
      const key = `${reason}\u0000${token}`;
      if (reported.has(key)) return;
      reported.add(key);
      problems.push({ token, reason, ...(candidates === undefined ? {} : { candidates }) });
    };
    let path: string | undefined;
    if (written === "") {
      // A line alone. Nothing cited before it means it names no file.
      if (from === null) continue;
      if (antecedent === undefined) {
        problem("unattached");
        continue;
      }
      path = antecedent;
    } else if (topLevel.has(written.split("/")[0] ?? "")) {
      path = written;
    } else if (!written.includes("/") && written.includes(".")) {
      const matches = covers
        .filter((cover) => !cover.endsWith("/"))
        .filter((cover) => basename(cover) === written);
      const first = matches[0];
      if (first === undefined) continue;
      if (matches.length > 1) {
        problem("ambiguous", [...matches].sort(codeUnitCompare));
        continue;
      }
      path = first;
    } else {
      continue;
    }
    if (path === undefined || path.length === 0) continue;
    // A directory does not become the path a later bare line names.
    if (!raw.endsWith("/")) antecedent = path;
    // A range counts up from a first line; anything else is not one, and
    // reading `:12-3` as line 3 would check a line nobody cited.
    if (from !== null && (from < 1 || (to !== null && to < from))) {
      problem("malformed");
      continue;
    }
    const line = to ?? from;
    const key = `${path}\u0000${line ?? ""}`;
    if (!seen.has(key)) seen.set(key, { path, line });
  }
  const citations = [...seen.values()].sort((a, b) =>
    codeUnitCompare(`${a.path}\u0000${a.line ?? ""}`, `${b.path}\u0000${b.line ?? ""}`),
  );
  return { citations, problems };
}
