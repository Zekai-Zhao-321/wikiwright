// Where a registered verb's module lives, relative to packages/cli/src: one
// module per verb under `verbs/`.
import { fileURLToPath } from "node:url";

export const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

export function verbModule(name: string): string {
  return `verbs/${name}.ts`;
}
