// docs/cli.md §check: the citations a pinned page makes, read from its text.
// `check` holds each to the page's pin (pins.ts): its path must exist at the
// pin and its line inside the blob there. Kept from the old `freshness` verb,
// whose measurement `check` absorbed; the rest of that verb left with it.
import { codeUnitCompare, pathRefusal } from "@wikiwright/core";

/**
 * What a page cites inside one pin's declared covers, checked at that pin by
 * `check` (pins.ts), and what it says there that cannot be read as a citation.
 *
 * A code span is a citation in one of four spellings, and nothing else is:
 *
 * - a repository path whose first segment is an entry at the root of the tree
 *   at the pin (`packages/cli/src/git.ts`), the root file included (`AGENTS.md`);
 *   a slash-ended directory or slash-separated file name is also recognized
 *   when its top-level segment is missing, so it can be reported unresolved;
 * - that path with a line or a range (`packages/cli/src/git.ts:31`, `:31-44`);
 * - a bare file name, suffix included, that is the basename of exactly one
 *   blob the pin covers (`git.ts:31`) — two covered paths of that name are
 *   ambiguous and are reported rather than guessed at, a covered directory is
 *   no candidate, and a name with no suffix is prose: `skills` is a verb in a
 *   sentence far more often than it is a path;
 * - a line or range alone (`:31-44`), which names the nearest covered file
 *   cited before it, and is reported when there is no preceding file context.
 *   A foreign file changes that context to out-of-scope: its following bare
 *   lines are not assigned back to an older covered file. A covered directory
 *   does not replace an earlier covered file context.
 *
 * Covers define scope: a blob owns its exact path, a tree owns descendants
 * whether or not its spelling ends in `/`, and `.` owns the whole tree.
 * Other code spans are unverified prose for this pin, not resolved citations.
 * Each distinct covered path must exist at the pin, and a cited line must not exceed
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

/** The object kind actually held at the pin, not inferred from path spelling. */
export interface CitationCover {
  path: string;
  kind: "blob" | "tree";
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
  /** Path-shaped spans outside this pin's covers, including their bare lines. */
  outside_scope: number;
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
  covers: readonly CitationCover[] = [],
): CitationScan {
  const seen = new Map<string, Citation>();
  const problems: CitationProblem[] = [];
  const reported = new Set<string>();
  const owns = (path: string): boolean =>
    covers.some(
      (cover) =>
        cover.path === "." ||
        (cover.kind === "blob"
          ? path === cover.path
          : path === cover.path || path.startsWith(`${cover.path}/`)),
    );
  // A foreign file stops later bare lines from falling back to an older owned file.
  let antecedent: { kind: "owned"; path: string } | { kind: "outside" } | undefined;
  let outsideScope = 0;
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
      if (antecedent.kind === "outside") {
        outsideScope += 1;
        continue;
      }
      path = antecedent.path;
    } else if (
      topLevel.has(written.split("/")[0] ?? "") ||
      raw.endsWith("/") ||
      (written.includes("/") && basename(written).includes("."))
    ) {
      if (pathRefusal(written) !== undefined) {
        antecedent = { kind: "outside" };
        outsideScope += 1;
        continue;
      }
      path = written;
    } else if (!written.includes("/") && written.includes(".")) {
      const matches = covers
        .filter((cover) => cover.kind === "blob")
        .filter((cover) => basename(cover.path) === written)
        .map((cover) => cover.path);
      const first = matches[0];
      if (first === undefined) continue;
      if (matches.length > 1) {
        antecedent = { kind: "outside" };
        problem("ambiguous", [...matches].sort(codeUnitCompare));
        continue;
      }
      path ??= first;
    } else {
      continue;
    }
    if (path === undefined || path.length === 0) continue;
    if (!owns(path)) {
      antecedent = { kind: "outside" };
      outsideScope += 1;
      continue;
    }
    // A directory does not become the path a later bare line names.
    if (!raw.endsWith("/") && !covers.some((cover) => cover.kind === "tree" && cover.path === path))
      antecedent = { kind: "owned", path };
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
  return { citations, problems, outside_scope: outsideScope };
}
