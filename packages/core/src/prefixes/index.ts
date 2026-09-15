// docs/cli.md: the registered-prefix verdict on a commit message. Pure:
// the shell reads the message file and decides what the refusal looks like.

export interface CommitPrefixPolicy {
  prefixes: string[];
}

/** The opening of a message's first line, read once for the verdict and for the refusal. */
export interface CommitPrefixOpening {
  /** The word before the optional scope and the colon, or "none". */
  prefix: string;
  /** The parenthesised scope after the word, when the line carries one. */
  scope?: string;
  /** Whether a `!` before the colon marks the change as breaking. */
  breaking: boolean;
}

export interface CommitPrefixVerdict extends CommitPrefixOpening {
  /** Whether the prefix is one the bundle registered; a message with none never is. */
  known: boolean;
}

/**
 * The Conventional Commits opening: a word, an optional `(scope)` — any
 * non-empty text without parentheses — an optional `!`, then the colon.
 * Nothing between the parts, no space before the colon.
 */
const OPENING = /^([A-Za-z][A-Za-z0-9-]*)(?:\(([^()]+)\))?(!)?:/u;

/**
 * The prefix is the word the message's FIRST line opens with, in the four
 * shapes Conventional Commits writes: `fix:`, `fix(scope):`, `fix!:` and
 * `fix(scope)!:`. The registered set names prefixes only; a scope and the
 * breaking marker are the writer's to add. A first line opening with none of
 * the four is "none", which no registered set contains.
 */
export function commitPrefixOpening(message: string): CommitPrefixOpening {
  const first = message.split("\n", 1)[0] ?? "";
  const m = OPENING.exec(first.trim());
  if (m === null) return { prefix: "none", breaking: false };
  const opening: CommitPrefixOpening = { prefix: m[1] ?? "none", breaking: m[3] === "!" };
  if (m[2] !== undefined) opening.scope = m[2];
  return opening;
}

/** The prefix alone: `commitPrefixOpening(message).prefix`. */
export function commitPrefixOf(message: string): string {
  return commitPrefixOpening(message).prefix;
}

export function commitPrefixVerdict(
  policy: CommitPrefixPolicy,
  message: string,
): CommitPrefixVerdict {
  const opening = commitPrefixOpening(message);
  return { ...opening, known: policy.prefixes.includes(opening.prefix) };
}
