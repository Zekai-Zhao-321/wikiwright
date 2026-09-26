// docs/cli.md, docs/cli.md §The envelope (one spec-driven registry
// generates help and each verb's schema) · docs/architecture.md §Directories
// (this file is the REGISTRY — the table and nothing else. Each verb is
// `verbs/<name>.ts` exporting its CommandSpec; a helper two or more verbs
// share lives in the named module its subject names — `typelaw.ts`,
// `generated.ts`, `pins.ts` — rather than in a block between two verb specs).
//
// v2 contracts §9: `COMMANDS` is the command table, the eight verbs every
// root is answered by. The old table, and the old verbs under `legacy/`,
// left in step 6.

import type { CommandSpec } from "./spec.ts";
import { checkCommand } from "./verbs/check.ts";
import { gateCommand } from "./verbs/gate.ts";
import { readCommand } from "./verbs/read.ts";
import { ruleCommand } from "./verbs/rule.ts";
import { searchCommand } from "./verbs/search.ts";
import { typeCommand } from "./verbs/type.ts";
import { versionCommand } from "./verbs/version.ts";
import { writeCommand } from "./verbs/write.ts";

/** The command table (v2 contracts §9): the eight verbs. */
export const COMMANDS: CommandSpec[] = [
  checkCommand,
  gateCommand,
  readCommand,
  ruleCommand,
  searchCommand,
  typeCommand,
  versionCommand,
  writeCommand,
];
