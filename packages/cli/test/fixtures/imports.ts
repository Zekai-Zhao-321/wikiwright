// The one recognizer of a module's runtime import edges, shared by the scans
// that follow them: the import graph's cycle check and the vault-loading
// declaration check. It reads source text, so it sees the spellings below and
// nothing a module builds at runtime; the scans that use it say so.
import { dirname, resolve } from "node:path";

/**
 * Every relative specifier that survives compilation, from one file: an
 * import, a re-export — `export { x } from "./y.ts"` runs `./y.ts` exactly as
 * an import does — a bare import for its side effects, and a dynamic import of
 * a literal, which defers the edge but does not remove it. A `type` import or a
 * `type` re-export is erased and is no edge.
 */
export function runtimeImports(source: string, file: string): string[] {
  const out: string[] = [];
  const here = (specifier: string): void => {
    out.push(resolve(dirname(file), specifier));
  };
  for (const match of source.matchAll(/^\s*(import|export)\s+([\s\S]*?)from\s+"(\.[^"]+)"/gmu)) {
    if (/^\s*type\s/u.test(match[2] ?? "")) continue;
    here(match[3] ?? "");
  }
  for (const match of source.matchAll(/^\s*import\s+"(\.[^"]+)"/gmu)) here(match[1] ?? "");
  for (const match of source.matchAll(/\bimport\s*\(\s*"(\.[^"]+)"/gu)) here(match[1] ?? "");
  for (const match of source.matchAll(/\brequire\s*\(\s*"(\.[^"]+)"/gu)) here(match[1] ?? "");
  return [...new Set(out)];
}
