// Where a registered verb's module lives, relative to packages/cli/src: a
// verb of the v2 table under `verbs/`, an old verb under `legacy/`, where
// each waits for its replacement (v2 contracts §12 step 4). A name with a
// module under `verbs/` is always the v2 verb, since an old verb leaves the
// table in the commit its replacement lands.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

export function verbModule(name: string): string {
  const v2 = `verbs/${name}.ts`;
  return existsSync(join(SRC, v2)) ? v2 : `legacy/${name}.ts`;
}
