// docs/cli.md, docs/cli.md §The envelope (one spec-driven registry
// generates help + schema) · docs/architecture.md §Directories (this file is the REGISTRY — the
// COMMANDS array and nothing else. Each verb is `verbs/<name>.ts` exporting its
// CommandSpec; a helper two or more verbs share lives in the named module its
// subject names — `law.ts`, `pages.ts`, `artifacts.ts`, `hooks.ts`, `staged.ts`
// — rather than in a block between two verb specs).

import { briefCommand } from "./legacy/brief.ts";
import { bundlesCommand } from "./legacy/bundles.ts";
import { checkCommand } from "./legacy/check.ts";
import { exportCommand } from "./legacy/export.ts";
import { fixCommand } from "./legacy/fix.ts";
import { freshnessCommand } from "./legacy/freshness.ts";
import { gateCommand } from "./legacy/gate.ts";
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
import { writeCommand } from "./legacy/write.ts";
import type { CommandSpec } from "./spec.ts";

export const COMMANDS: CommandSpec[] = [
  briefCommand,
  bundlesCommand,
  checkCommand,
  exportCommand,
  freshnessCommand,
  gateCommand,
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
  writeCommand,
];
