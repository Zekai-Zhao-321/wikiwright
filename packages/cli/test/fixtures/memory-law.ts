// The memory law: the constitution the judge's behaviour tests are written
// against — claims with categories, relations, journal roots and folder tags
// on one small law. It is test data, not a starter: the engine ships `base`
// and `code`, and the tests that need a claims-bearing law read this one so
// that what `init` ships and what the judge is tested on can change apart.
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The fixture directory: `config/` and the charter page under `meta/`. */
export const MEMORY_LAW = fileURLToPath(new URL("./memory-law/", import.meta.url));

/** Lay the memory law over an empty directory: its config, its charter and every content root. */
export function layMemoryLaw(dir: string): void {
  cpSync(MEMORY_LAW, dir, { recursive: true });
  for (const root of ["wiki", "journal/daily", "journal/reviews"]) {
    mkdirSync(join(dir, root), { recursive: true });
  }
}
