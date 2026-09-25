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
// name, at load, with the line that reached. It is not the argument for running
// a module at all: installing the module is the consent to run it.
//
// A module imports nothing, in any form. A kit a bundle carries travels as its
// own directory and nothing else, and every file it needs is in the digest; an
// import is how code the scan never read reaches the judge — a package, a file
// outside the kit, or Node's own modules.

/**
 * The version of the rules below. A proof is cached by the module's digest and
 * this number, so a change to any pattern bumps it: bytes the older rules
 * passed are scanned again under the newer ones rather than served a verdict
 * the rules that gave it no longer give.
 */
export const PURITY_SCAN_VERSION = 3;

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
  // `Date["now"]()` and `process["env"]` are the rules above with the member
  // named by a string: computed access to a global the rules above name is
  // refused whatever the string says.
  {
    reason: "reaches a banned global by computed access (Date, Math, performance, Intl or process)",
    pattern: /\b(?:Date|Math|performance|Intl|process)\s*\[/gu,
  },
  // No import of any form. A statement that opens with `import` (a binding, a
  // namespace, a side effect, a type), an `export … from`, a dynamic
  // `import(` and a `require(`: each brings in code the scan never read.
  {
    reason: "imports a module (an import declaration)",
    pattern: /(?<=^|[;}])[ \t]*import\b\s*(?=[\w$*{"'])/gmu,
  },
  {
    reason: "re-exports a module (export … from)",
    pattern:
      /(?<=^|[;}])[ \t]*export\s*(?:type\s+)?(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*)from\s*["']/gmu,
  },
  { reason: "imports a module at runtime (import())", pattern: /\bimport\s*\(/gu },
  { reason: "requires a module (require)", pattern: /\brequire\s*\(/gu },
];

/**
 * What an import reaches, named beside the import itself: an import is refused
 * in any form above, and one of these specifiers says which capability it was
 * reaching for.
 */
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

/**
 * docs/extending.md §The purity scan: every reason this scan reports, as it
 * reports it (a specifier rule adds the specifier after its reason). The
 * documentation names each; a test holds the two to one list.
 */
export const PURITY_REASONS: readonly string[] = [
  ...BANNED.map((rule) => rule.reason),
  ...BANNED_IMPORTS.map((rule) => rule.reason),
];

const IMPORT_SPECIFIERS: readonly RegExp[] = [
  /(?:^|\n)\s*import\s*["']([^"']+)["']/gu,
  /\bfrom\s*["']([^"']+)["']/gu,
  /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gu,
];

/** The characters after which a `/` opens a regular expression rather than dividing. */
const BEFORE_REGEX = new Set([..."(,=:[!&|?{};+-*%<>~^"]);

/** The keywords after which a `/` opens a regular expression. */
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * docs/extending.md §The purity scan: the source with every comment read
 * through — each `/* … *\/` and `// …` outside a string, a template literal
 * or a regular expression replaced by spaces, its newlines kept, so every
 * offset and line number still holds. A comment can no longer stand between a
 * banned word and the token that makes it a construct (`import/* c *\/ {`),
 * and a comment that merely mentions one is not a construct at all. A string
 * holding `/*` opens no comment, and a `${ … }` inside a template literal is
 * code again.
 */
function stripComments(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  // One frame per open template literal: the brace depth of its `${ … }` code.
  const templates: number[] = [];
  let depth = 0;
  let last = "";
  let word = "";
  let i = 0;
  const n = source.length;
  const regexAllowed = (): boolean =>
    last === "" || BEFORE_REGEX.has(last) || REGEX_KEYWORDS.has(word);
  while (i < n) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      i += 1;
      while (i < n && source[i] !== c && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
      i += 1;
      last = c;
      word = "";
      continue;
    }
    if (c === "`" || (c === "}" && templates.length > 0 && depth === templates.at(-1))) {
      if (c === "}") {
        templates.pop();
        depth -= 1;
      }
      // Inside a template literal until its closing backtick or a `${`.
      i += 1;
      while (i < n && source[i] !== "`" && !(source[i] === "$" && source[i + 1] === "{")) {
        i += source[i] === "\\" ? 2 : 1;
      }
      if (i < n && source[i] === "$") {
        depth += 1;
        templates.push(depth);
        i += 2;
        last = "{";
      } else {
        i += 1;
        last = "`";
      }
      word = "";
      continue;
    }
    if (c === "/" && regexAllowed()) {
      // A regular expression literal: to its closing slash, a class read whole.
      i += 1;
      let inClass = false;
      while (i < n && source[i] !== "\n") {
        const r = source[i];
        if (r === "\\") {
          i += 2;
          continue;
        }
        if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
        i += 1;
      }
      i += 1;
      last = "/";
      word = "";
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    if (/[\w$]/u.test(c)) {
      // A word continues only across adjacent characters: `return x` is two.
      word = i > 0 && /[\w$]/u.test(source[i - 1] as string) ? word + c : c;
      last = c;
    } else if (!/\s/u.test(c)) {
      last = c;
      word = "";
    }
    i += 1;
  }
  return out.join("");
}

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
  // The patterns read the code with its comments read through; the evidence
  // is the original line, at the same offset.
  const code = stripComments(source);
  for (const { reason, pattern } of BANNED) {
    pattern.lastIndex = 0;
    for (const match of code.matchAll(pattern)) {
      const at = match.index ?? 0;
      found.push({ reason, ...locate(source, at) });
    }
  }
  for (const re of IMPORT_SPECIFIERS) {
    re.lastIndex = 0;
    for (const match of code.matchAll(re)) {
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
