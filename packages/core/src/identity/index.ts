// docs/constitution.md §Types (the normalized-identity contract) ·
// docs/architecture.md §Directories (determinism invariants).
import { CASE_FOLD } from "./casefold-data.ts";

/**
 * Full Unicode case folding (statuses C + F) over the vendored generated table.
 * Unmapped code points pass through unchanged; folding is idempotent.
 */
export function foldCase(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const mapped = cp === undefined ? undefined : CASE_FOLD.get(cp);
    out += mapped ?? ch;
  }
  return out;
}

/**
 * The canonical identity key: NFD → full case fold → NFC. Every identity
 * comparison in the engine goes through this one seam — basenames, aliases,
 * titles, and the type/tag namespaces.
 */
export function normalizeIdentity(s: string): string {
  return foldCase(s.normalize("NFD")).normalize("NFC");
}

/**
 * Locale-free deterministic ordering: UTF-16 code-unit comparison. The only
 * comparator permitted for output-reaching sorts; locale collation is
 * banned in packages/.
 */
export function codeUnitCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
