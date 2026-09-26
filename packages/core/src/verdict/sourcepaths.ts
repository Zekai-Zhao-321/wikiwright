import type { ParsedPage } from "../interface/index.ts";
import type { Unrouted } from "./page.ts";
import type { SourceFacts } from "./state.ts";

export type SourcePathStatus = "present" | "missing" | "kind" | "unmeasured";

/** A literal source path in one selected state. Trailing slash requires a directory. */
export function sourcePathStatus(path: string, facts: SourceFacts | undefined): SourcePathStatus {
  if (facts === undefined) return "unmeasured";
  const directory = path.endsWith("/");
  const name = (directory ? path.slice(0, -1) : path).normalize("NFC");
  if (facts.skipped.some((entry) => name === entry.path || name.startsWith(`${entry.path}/`)))
    return "unmeasured";
  if (facts.directories.has(name)) return "present";
  if (facts.files.has(name)) return directory ? "kind" : "present";
  return "missing";
}

/** Claim source existence, not its bytes or the claim's truth. */
export function sourcePathFindings(page: ParsedPage, facts: SourceFacts | undefined): Unrouted[] {
  const found: Unrouted[] = [];
  const occurrences = new Map<string, number>();
  for (const section of page.occurrences) {
    const occurrence = occurrences.get(section.heading) ?? 0;
    occurrences.set(section.heading, occurrence + 1);
    for (const item of section.items) {
      if (
        item.kind !== "claim" ||
        item.provenance.kind !== "path" ||
        item.provenance.value === null
      )
        continue;
      const path = item.provenance.value;
      const status = sourcePathStatus(path, facts);
      if (status === "present") continue;
      const rule =
        status === "missing"
          ? "source-path-missing"
          : status === "kind"
            ? "source-path-kind"
            : "source-path-unmeasured";
      found.push({
        rule,
        severity: status === "unmeasured" ? "warning" : "error",
        path: page.path,
        location: {
          kind: "section",
          heading: section.heading,
          occurrence,
          line: item.location.line,
        },
        message:
          status === "missing"
            ? `the source path ${JSON.stringify(path)} is absent from the selected state`
            : status === "kind"
              ? `the source path ${JSON.stringify(path)} ends in / and is a file, not a directory`
              : `the source path ${JSON.stringify(path)} could not be measured in the selected state`,
        details: { source: path, status, line: item.location.line },
      });
    }
  }
  return found;
}
