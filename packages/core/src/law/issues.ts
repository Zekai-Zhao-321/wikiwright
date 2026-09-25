// v2 contracts §2, §3: what the type-document loader reports.
//
// One issue shape for every load-time code the loader names. `where` is framed
// as the law digest frames a file (§7): `bundle:<bundle-relative path>` or
// `<library id>:<library-relative path>`, so a reader can find the file from
// the issue and the digest line from the file. Ported from the old registry's
// `RegistryIssue` (code, where, message) and its one-cause-one-issue collapse;
// `sites` is dropped (a v2 document is one file, reported where it is), and
// `details` is added so a limit or a keyword reaches a machine reader as data.
import { codeUnitCompare } from "../identity/index.ts";

export interface LawIssue {
  code: string;
  where: string;
  message: string;
  details?: Record<string, unknown>;
}

/** One cause, one issue: the same code, place and message is reported once, in first-raised order. */
export function collapseLawIssues(issues: readonly LawIssue[]): LawIssue[] {
  const seen = new Set<string>();
  const out: LawIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}\u0000${issue.where}\u0000${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

/** Issues in a stable order: by place, then code, then message (code units). */
export function sortLawIssues(issues: readonly LawIssue[]): LawIssue[] {
  return [...issues].sort(
    (a, b) =>
      codeUnitCompare(a.where, b.where) ||
      codeUnitCompare(a.code, b.code) ||
      codeUnitCompare(a.message, b.message),
  );
}
