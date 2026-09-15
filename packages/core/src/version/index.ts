// docs/cli.md §hook (config/engine.json's `engine` is a semver range the
// running engine must satisfy; the accepted grammar is a closed subset, validated
// at LOAD so an unparseable range is a constitution failure rather than a gate
// that silently accepts every engine). Zero dependencies.

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function parseSemver(text: string): Semver | undefined {
  const m = VERSION.exec(text.trim());
  if (m === null) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compare(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export interface Comparator {
  op: "<" | "<=" | ">" | ">=" | "=";
  version: Semver;
}

function expand(term: string): Comparator[] | undefined {
  const caretOrTilde = /^([\^~])(.+)$/u.exec(term);
  if (caretOrTilde !== null) {
    const version = parseSemver(caretOrTilde[2] ?? "");
    if (version === undefined) return undefined;
    // ^0.x.y is major-pinned AND minor-pinned, per semver's 0.x rule: before
    // 1.0.0 the minor is the breaking axis, which is exactly where this engine
    // sits today.
    const upper: Semver =
      caretOrTilde[1] === "~" || version.major === 0
        ? { major: version.major, minor: version.minor + 1, patch: 0 }
        : { major: version.major + 1, minor: 0, patch: 0 };
    return [
      { op: ">=", version },
      { op: "<", version: upper },
    ];
  }
  const cmp = /^(>=|<=|>|<|=)?(.+)$/u.exec(term);
  if (cmp === null) return undefined;
  const version = parseSemver(cmp[2] ?? "");
  if (version === undefined) return undefined;
  return [{ op: (cmp[1] ?? "=") as Comparator["op"], version }];
}

/**
 * The closed subset (docs/cli.md §hook): space-separated comparators joined by AND, plus
 * `^` / `~` sugar and a bare exact version. No `||`, no x-ranges, no prerelease
 * semantics — small enough to be obviously correct, and enough for a bundle that
 * pins an engine. `undefined` means "not a range this engine can parse", which
 * the loader turns into a constitution issue.
 */
export function parseEngineRange(range: string): Comparator[] | undefined {
  const terms = range
    .trim()
    .split(/\s+/u)
    .filter((s) => s.length > 0);
  if (terms.length === 0) return undefined;
  const out: Comparator[] = [];
  for (const term of terms) {
    const expanded = expand(term);
    if (expanded === undefined) return undefined;
    out.push(...expanded);
  }
  return out;
}

export function satisfiesEngineRange(version: string, range: string): boolean {
  const running = parseSemver(version);
  const comparators = parseEngineRange(range);
  if (running === undefined || comparators === undefined) return false;
  return comparators.every((c) => {
    const d = compare(running, c.version);
    if (c.op === "<") return d < 0;
    if (c.op === "<=") return d <= 0;
    if (c.op === ">") return d > 0;
    if (c.op === ">=") return d >= 0;
    return d === 0;
  });
}
