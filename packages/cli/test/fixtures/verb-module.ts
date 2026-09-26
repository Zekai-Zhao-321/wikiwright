// Where a registered verb's module lives, relative to packages/cli/src: a
// verb of the v2 table under `verbs/`, an old verb under `legacy/`, where
// each waits for its replacement (v2 contracts §12 step 4). A name with a
// module under `verbs/` is always the v2 verb, since an old verb leaves the
// table in the commit its replacement lands.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

export function verbModule(name: string, legacy = false): string {
  const v2 = `verbs/${name}.ts`;
  return !legacy && existsSync(join(SRC, v2)) ? v2 : `legacy/${name}.ts`;
}

/**
 * Every spec of both tables with the module that defines it: the command
 * table's under `verbs/` where it has one, the old table's under `legacy/`.
 * A spec both tables hold is listed once.
 */
export function everyVerb<T extends { name: string }>(
  table: readonly T[],
  legacyTable: readonly T[],
): { spec: T; module: string }[] {
  const out: { spec: T; module: string }[] = table.map((spec) => ({
    spec,
    module: verbModule(spec.name),
  }));
  for (const spec of legacyTable) {
    if (out.some((row) => row.spec === spec)) continue;
    out.push({ spec, module: verbModule(spec.name, true) });
  }
  return out;
}
