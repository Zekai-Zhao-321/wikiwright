// v2 contracts §3.1 (`exceptions`, today's waivers, kept: `{rule, reason}`
// entries that close a queued finding on this page, reported as
// `exception-applied` info).
//
// Ported from the old judge's per-page exceptions (judge/index.ts), by id:
// `exception-stale` for an entry that closes nothing on the page, and
// `exception-illegal` for one naming no rule this law has, a census, or a
// law a page may not waive. Changed: an entry names a rule and a reason, no
// evidence digest, so it closes every finding of that rule on the page; and
// what it closes stays visible as one `exception-applied` finding each.
import type { ParsedPage } from "../interface/index.ts";
import type { TypeLaw } from "../law/load.ts";
import { PAGE_LOCATION, type Unrouted } from "./page.ts";
import { VERDICT_TABLE } from "./table.ts";

/**
 * What a page may not waive: its syntax, which no reader can get past, the
 * vault's identity and counts, an evaluator's failure, and the waivers'
 * own findings.
 */
export const NEVER_WAIVED: ReadonlySet<string> = new Set([
  "page-too-large",
  "page-not-utf8",
  "malformed-frontmatter",
  "frontmatter-not-mapping",
  "duplicate-key",
  "identity-collision",
  "instances-min",
  "instances-max",
  "rule-error",
  "exception-stale",
  "exception-illegal",
]);

interface Exception {
  rule: string;
  reason: string;
  index: number;
}

function exceptionsOf(page: ParsedPage): Exception[] {
  const raw = page.frontmatter["exceptions"];
  if (!Array.isArray(raw)) return [];
  const out: Exception[] = [];
  raw.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return;
    const { rule, reason } = entry as Record<string, unknown>;
    // A malformed entry is the reserved shape's to report.
    if (typeof rule === "string" && typeof reason === "string") out.push({ rule, reason, index });
  });
  return out;
}

/** Whether a page's exceptions have anything to judge. */
export function hasExceptions(page: ParsedPage): boolean {
  return exceptionsOf(page).length > 0;
}

/**
 * The page's findings with its exceptions applied: each finding a legal entry
 * names becomes `exception-applied`, and each entry that closes nothing or
 * may not close anything is reported.
 */
export function applyExceptions(law: TypeLaw, page: ParsedPage, found: Unrouted[]): Unrouted[] {
  const entries = exceptionsOf(page);
  if (entries.length === 0) return found;
  const known = new Set([...VERDICT_TABLE.map((row) => row.id), ...law.rules.keys()]);
  const info = new Set(VERDICT_TABLE.filter((row) => row.severity === "info").map((r) => r.id));
  const waived = new Map<string, Exception>();
  const out: Unrouted[] = [];
  for (const entry of entries) {
    const pointer = `/exceptions/${entry.index}`;
    const illegal = !known.has(entry.rule)
      ? "names no rule this law has"
      : info.has(entry.rule)
        ? "names a census, which has nothing to waive"
        : NEVER_WAIVED.has(entry.rule)
          ? "names a law a page may not waive"
          : undefined;
    if (illegal !== undefined) {
      out.push({
        rule: "exception-illegal",
        severity: "error",
        path: page.path,
        location: PAGE_LOCATION,
        message: `the exception for "${entry.rule}" ${illegal}`,
        details: { rule: entry.rule, pointer },
      });
      continue;
    }
    if (!found.some((f) => f.rule === entry.rule && f.severity !== "info")) {
      out.push({
        rule: "exception-stale",
        severity: "warning",
        path: page.path,
        location: PAGE_LOCATION,
        message: `the exception for "${entry.rule}" closes no finding on this page: remove it`,
        details: { rule: entry.rule, pointer },
      });
      continue;
    }
    if (!waived.has(entry.rule)) waived.set(entry.rule, entry);
  }
  for (const finding of found) {
    const entry = finding.severity === "info" ? undefined : waived.get(finding.rule);
    if (entry === undefined) {
      out.push(finding);
      continue;
    }
    out.push({
      rule: "exception-applied",
      severity: "info",
      path: finding.path,
      location: finding.location,
      message: `${finding.rule}, waived: ${entry.reason}`,
      details: {
        rule: finding.rule,
        reason: entry.reason,
        pointer: `/exceptions/${entry.index}`,
        severity: finding.severity,
        message: finding.message,
        details: finding.details,
      },
    });
  }
  return out;
}
