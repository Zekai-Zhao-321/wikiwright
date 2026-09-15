// docs/extending.md §The determinism fixture (a purity scan over the module's bytes
// at load) · docs/architecture.md §The gate (the same static shape as the existing ban on
// locale-sensitive comparison).
//
// Module code runs inside the judge, so a bundle's verdict would otherwise
// depend on code this repository's gate never proved reproducible. This scan is
// the first of the three guards, and it is the only one that runs BEFORE the
// module's code does — which is the whole reason it is a byte scan and not a
// runtime probe.
//
// It narrows; it does not sandbox, and nothing here claims otherwise. A module
// determined to reach the clock can still do it through a name this scan cannot
// see. What the scan buys is that the ORDINARY way of reaching one is refused by
// name, at load, with the line that reached.

export interface PurityViolation {
  /** The construct that was found, as this scan names it. */
  readonly reason: string;
  /** 1-based line in the scanned source. */
  readonly line: number;
  /** The offending text, trimmed — enough to find it, never the whole file. */
  readonly evidence: string;
}

/**
 * The banned constructs, each with the reason a reader needs. Ordered most
 * specific first, because a line is reported once per rule that matches it and a
 * vaguer rule matching first would name the wrong thing.
 */
const BANNED: readonly { readonly reason: string; readonly pattern: RegExp }[] = [
  { reason: "reads the clock (Date.now)", pattern: /\bDate\s*\.\s*now\s*\(/gu },
  {
    reason: "reads the clock (new Date with no argument)",
    pattern: /\bnew\s+Date\s*\(\s*\)/gu,
  },
  { reason: "reads the clock (performance.now)", pattern: /\bperformance\s*\.\s*now\s*\(/gu },
  { reason: "is not deterministic (Math.random)", pattern: /\bMath\s*\.\s*random\s*\(/gu },
  {
    reason: "compares under the machine's locale (localeCompare)",
    pattern: /\.\s*localeCompare\s*\(/gu,
  },
  { reason: "reads the machine's locale (Intl)", pattern: /\bIntl\s*\./gu },
  {
    reason: "reads the environment (process.env)",
    pattern: /\bprocess\s*\.\s*env\b/gu,
  },
  { reason: "reaches the network (fetch)", pattern: /\bfetch\s*\(/gu },
  // Dynamic evaluation is the bypass for every rule above it: a module that can
  // build a function from a string can reach the clock without writing its name.
  // Refused for that reason, not for its own.
  { reason: "evaluates code built at runtime (eval)", pattern: /\beval\s*\(/gu },
  {
    reason: "evaluates code built at runtime (the Function constructor)",
    pattern: /\bnew\s+Function\s*\(/gu,
  },
  // `globalThis["Da"+"te"].now` reaches the clock without spelling it. The
  // rules above read plain spellings; this one reads the way around them.
  { reason: "reaches a global by name (globalThis)", pattern: /\bglobalThis\b/gu },
];

/** Import specifiers a module may not reach for: the filesystem and the network. */
const BANNED_IMPORTS: readonly {
  readonly reason: string;
  readonly test: (s: string) => boolean;
}[] = [
  {
    reason: "imports the filesystem",
    test: (s) => /^(node:)?fs(\/|$)/u.test(s) || /^(node:)?path(\/|$)/u.test(s),
  },
  {
    reason: "imports the network",
    test: (s) => /^(node:)?(http|https|net|tls|dgram|dns)(\/|$)/u.test(s),
  },
  { reason: "imports a child process", test: (s) => /^(node:)?child_process$/u.test(s) },
  { reason: "imports the process", test: (s) => /^(node:)?process$/u.test(s) },
  { reason: "imports the operating system", test: (s) => /^(node:)?os$/u.test(s) },
];

const IMPORT_SPECIFIERS: readonly RegExp[] = [
  /(?:^|\n)\s*import\s*["']([^"']+)["']/gu,
  /\bfrom\s*["']([^"']+)["']/gu,
  /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gu,
];

/** Where in the file a match at `at` sits, 1-based, and the line's own text. */
function locate(source: string, at: number): { line: number; evidence: string } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < at; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      start = i + 1;
    }
  }
  let end = source.indexOf("\n", start);
  if (end < 0) end = source.length;
  return { line, evidence: source.slice(start, end).trim().slice(0, 160) };
}

/**
 * docs/extending.md §The determinism fixture: every banned construct in one module's bytes, in source
 * order. Empty means the scan found nothing — which is a statement about this
 * scan's rules and not a proof of purity, and the caller says so where it
 * reports.
 */
export function scanPurity(source: string): PurityViolation[] {
  const found: PurityViolation[] = [];
  for (const { reason, pattern } of BANNED) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const at = match.index ?? 0;
      found.push({ reason, ...locate(source, at) });
    }
  }
  for (const re of IMPORT_SPECIFIERS) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      for (const { reason, test } of BANNED_IMPORTS) {
        if (!test(specifier)) continue;
        found.push({ reason: `${reason} ("${specifier}")`, ...locate(source, match.index ?? 0) });
      }
    }
  }
  return found.sort((a, b) => a.line - b.line || (a.reason < b.reason ? -1 : 1));
}
