// docs/cli.md, docs/cli.md §The envelope (one spec-driven registry
// generates help and each verb's schema) · docs/architecture.md §Directories
// (this file is the REGISTRY — the two tables and nothing else. Each verb of
// the v2 table is `verbs/<name>.ts` exporting its CommandSpec; each old verb
// is `legacy/<name>.ts`; a helper two or more verbs share lives in the named
// module its subject names — `typelaw.ts`, `generated.ts`, `pins.ts` —
// rather than in a block between two verb specs).
//
// v2 contracts §9, §12 step 4: `COMMANDS` is the command table, the verbs a
// bundle on schema version 4 is answered by; as each verb of §9 lands, the
// old verbs it replaces and absorbs leave it. `LEGACY_COMMANDS` is the old
// table, whole: it answers a root that holds no schema-version-4 bundle — a
// bundle on the old constitution, or none — so the corpora the suite judges
// keep their verbs until step 5 migrates them, and it leaves with the old
// verbs in step 6.

import { briefCommand } from "./legacy/brief.ts";
import { bundlesCommand } from "./legacy/bundles.ts";
import { checkCommand as legacyCheckCommand } from "./legacy/check.ts";
import { exportCommand } from "./legacy/export.ts";
import { fixCommand } from "./legacy/fix.ts";
import { freshnessCommand } from "./legacy/freshness.ts";
import { gateCommand as legacyGateCommand } from "./legacy/gate.ts";
import { graphCommand } from "./legacy/graph.ts";
import { hookCommand } from "./legacy/hook.ts";
import { initCommand } from "./legacy/init.ts";
import { lintCommand } from "./legacy/lint.ts";
import { modulesCommand } from "./legacy/modules.ts";
import { moveCommand } from "./legacy/move.ts";
import { newCommand } from "./legacy/new.ts";
import { okfCommand } from "./legacy/okf.ts";
import { readCommand } from "./legacy/read.ts";
import { retireCommand } from "./legacy/retire.ts";
import { schemaCommand } from "./legacy/schema.ts";
import { searchCommand } from "./legacy/search.ts";
import { skillsCommand } from "./legacy/skills.ts";
import { typeCommand } from "./legacy/type.ts";
import { versionCommand } from "./legacy/version.ts";
import { vocabularyCommand } from "./legacy/vocabulary.ts";
import { writeCommand as legacyWriteCommand } from "./legacy/write.ts";
import type { CommandSpec } from "./spec.ts";
import { checkCommand } from "./verbs/check.ts";
import { gateCommand } from "./verbs/gate.ts";
import { ruleCommand } from "./verbs/rule.ts";
import { writeCommand } from "./verbs/write.ts";

/** The command table: the verbs a schema-version-4 bundle is answered by. */
export const COMMANDS: CommandSpec[] = [
  briefCommand,
  bundlesCommand,
  checkCommand,
  exportCommand,
  gateCommand,
  graphCommand,
  initCommand,
  modulesCommand,
  readCommand,
  ruleCommand,
  schemaCommand,
  searchCommand,
  skillsCommand,
  typeCommand,
  versionCommand,
  vocabularyCommand,
  writeCommand,
];

/** The old table, whole: what answers a root with no schema-version-4 bundle. */
export const LEGACY_COMMANDS: CommandSpec[] = [
  briefCommand,
  bundlesCommand,
  legacyCheckCommand,
  exportCommand,
  freshnessCommand,
  legacyGateCommand,
  graphCommand,
  hookCommand,
  initCommand,
  fixCommand,
  lintCommand,
  modulesCommand,
  moveCommand,
  newCommand,
  okfCommand,
  readCommand,
  retireCommand,
  schemaCommand,
  searchCommand,
  skillsCommand,
  typeCommand,
  versionCommand,
  vocabularyCommand,
  legacyWriteCommand,
];
