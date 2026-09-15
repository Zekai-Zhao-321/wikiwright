// docs/architecture.md §Directories (the path law) · docs/concepts.md §The judge and its states (a vault path names a
// file INSIDE the vault, and one function decides that).
//
// "A type system is only as good as its narrowest write path" (AGENTS.md). The
// narrowest write path takes a string from an agent — `new --dest`,
// `write --path`, `lint --stdin`'s draft path — joins it to the vault root and
// writes. Until the path law the only guard was `startsWith(root + "/") && endsWith(".md")`,
// which `wiki/../../ESCAPED.md` satisfies, and `join` then resolves out of the
// vault. This module is the whole of the answer, and it lives in core because
// the constitution's declared roots and the shell's page paths are the same law.
//
// The kernel decides SHAPE — what a vault path may spell — because that is
// decidable from the string. Containment against a real directory is the
// shell's, beside the write: it needs the filesystem, and `docs/architecture.md §Directories`
// keeps the filesystem out of here.

/** Why a path is not a vault path. One reason, the first that applies. */
export type PathRefusal =
  | "empty"
  | "absolute"
  | "drive"
  | "unc"
  | "backslash"
  | "control-character"
  | "empty-segment"
  | "dot-segment"
  | "traversal"
  | "trailing-slash";

/**
 * The message a refusal carries into a finding or an envelope. Data, not prose
 * assembled at the call site, so two verbs cannot describe one refusal
 * differently.
 */
export const PATH_REFUSALS: Readonly<Record<PathRefusal, string>> = Object.freeze({
  empty: "is empty",
  absolute: "is absolute; a vault path is relative to the vault root",
  drive: "is drive-qualified; a vault path is relative to the vault root",
  unc: "is a UNC path; a vault path is relative to the vault root",
  backslash: 'contains "\\"; a vault path separates segments with "/" on every platform',
  "control-character": "contains a control character",
  "empty-segment": 'contains an empty segment ("//")',
  "dot-segment": 'contains a "." segment',
  traversal: 'contains a ".." segment, which would leave the vault',
  "trailing-slash": "ends with a separator; a vault path names a file",
});

/**
 * The one reading of a vault-relative path. Returns the refusal, or
 * `undefined` when the string is a legal vault path.
 *
 * Everything here is decidable from the string alone, which is what lets the
 * kernel own it (`AGENTS.md`: decidable checks only at the gate). Note what is
 * NOT refused: a leading dot on a SEGMENT (`wiki/.obsidian/x.md` is a real path
 * a vault may carry), a space, or a non-ASCII name. Half the target corpora are
 * Han, and refusing what a filesystem accepts would be a second, narrower path
 * law nobody declared.
 *
 * A DECLARED ROOT is held to exactly this, and deliberately not to something
 * narrower: `content_roots: [".."]` is refused at load rather than walked — it
 * WAS walked, and the loader climbed out of the vault and linted the parent
 * directory's Markdown under the bundle's constitution — while a multi-segment
 * root like `docs/wiki` stays legal, because `03`'s `content_roots` row calls a
 * root a walked directory and names no depth.
 */
export function pathRefusal(path: string): PathRefusal | undefined {
  if (path.length === 0) return "empty";
  // Windows first, because "C:/x" is also not absolute by the POSIX test and a
  // reader meeting `absolute` for it would look in the wrong place.
  if (/^[A-Za-z]:/u.test(path)) return "drive";
  if (path.startsWith("\\\\") || path.startsWith("//")) return "unc";
  if (path.startsWith("/")) return "absolute";
  if (path.includes("\\")) return "backslash";
  // NUL truncates a C string and the rest are not path material either. `\u007f`
  // included: it is a control character that renders as nothing.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (/[\u0000-\u001f\u007f]/u.test(path)) return "control-character";
  if (path.endsWith("/")) return "trailing-slash";
  for (const segment of path.split("/")) {
    if (segment.length === 0) return "empty-segment";
    if (segment === ".") return "dot-segment";
    if (segment === "..") return "traversal";
  }
  return undefined;
}

/** `pathRefusal`, as a boolean, for the many call sites that only branch. */
export function isVaultPath(path: string): boolean {
  return pathRefusal(path) === undefined;
}

/**
 * docs/cli.md §new, docs/cli.md §write, docs/cli.md §lint: is this a page the vault's constitution governs?
 *
 * The `.md` test and the root test are what they always were; the shape test in
 * front of them is the path law. One definition, imported by the state constructors,
 * the page walk and every writing verb — there were two identical copies, and a
 * fix to one would have left the other open.
 */
export function isContentPath(path: string, roots: readonly string[]): boolean {
  if (!isVaultPath(path)) return false;
  return roots.some((r) => path.startsWith(`${r}/`)) && path.endsWith(".md");
}
