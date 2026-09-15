// docs/cli.md, docs/cli.md §The envelope (one spec-driven registry
// generates help + schema) · docs/architecture.md §Directories (this file is the REGISTRY — the
// COMMANDS array and nothing else. Each verb is `verbs/<name>.ts` exporting its
// CommandSpec; a helper two or more verbs share lives in the named module its
// subject names — `law.ts`, `pages.ts`, `artifacts.ts`, `hooks.ts`, `staged.ts`
// — rather than in a block between two verb specs).
import type { CommandSpec } from "./spec.ts";
import { briefCommand } from "./verbs/brief.ts";
import { checkCommand } from "./verbs/check.ts";
import { fixCommand } from "./verbs/fix.ts";
import { freshnessCommand } from "./verbs/freshness.ts";
import { gateCommand } from "./verbs/gate.ts";
import { graphCommand } from "./verbs/graph.ts";
import { hookCommand } from "./verbs/hook.ts";
import { initCommand } from "./verbs/init.ts";
import { lintCommand } from "./verbs/lint.ts";
import { modulesCommand } from "./verbs/modules.ts";
import { moveCommand } from "./verbs/move.ts";
import { newCommand } from "./verbs/new.ts";
import { okfCommand } from "./verbs/okf.ts";
import { retireCommand } from "./verbs/retire.ts";
import { schemaCommand } from "./verbs/schema.ts";
import { searchCommand } from "./verbs/search.ts";
import { skillsCommand } from "./verbs/skills.ts";
import { trustCommand } from "./verbs/trust.ts";
import { typeCommand } from "./verbs/type.ts";
import { versionCommand } from "./verbs/version.ts";
import { vocabularyCommand } from "./verbs/vocabulary.ts";
import { writeCommand } from "./verbs/write.ts";

export const COMMANDS: CommandSpec[] = [
  briefCommand,
  checkCommand,
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
  retireCommand,
  schemaCommand,
  searchCommand,
  skillsCommand,
  trustCommand,
  typeCommand,
  versionCommand,
  vocabularyCommand,
  writeCommand,
];
