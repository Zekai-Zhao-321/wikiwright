// docs/architecture.md §Directories: one module per verb under src/verbs/,
// the registry in commands.ts and nothing else there, and the helpers two
// verbs share in modules named for their subject.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMMANDS } from "../src/commands.ts";
import { verbModule } from "./fixtures/verb-module.ts";

describe("the per-verb split (docs/architecture.md §Directories)", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url));

  it("every registered verb has its own module under src/verbs/", async () => {
    assert.equal(COMMANDS.length > 0, true, "the registry is not empty");
    for (const command of COMMANDS) {
      const rel = verbModule(command.name);
      const module = join(SRC, rel);
      assert.equal(existsSync(module), true, `no ${rel} for verb "${command.name}"`);
      // Windows: the ESM loader refuses a bare absolute path ("protocol
      // 'd:'"), so a dynamic import of a computed path goes through a file URL.
      const exports = (await import(pathToFileURL(module).href)) as Record<string, unknown>;
      const specs = Object.values(exports).filter(
        (v): v is { name: string } =>
          typeof v === "object" && v !== null && "name" in v && "run" in v,
      );
      assert.equal(
        specs.some((s) => s.name === command.name),
        true,
        `${rel} exports no CommandSpec named "${command.name}"`,
      );
    }
  });

  it("commands.ts is the registry: no CommandSpec literal, no run()", () => {
    const text = readFileSync(join(SRC, "commands.ts"), "utf8");
    assert.equal(
      /:\s*CommandSpec\s*=\s*\{/.test(text),
      false,
      "commands.ts still declares a CommandSpec literal — the split is not complete",
    );
    assert.equal(
      /^\s*run:/m.test(text),
      false,
      "commands.ts still carries a verb's run() — the split is not complete",
    );
    assert.equal(/^export const COMMANDS/m.test(text), true, "commands.ts exports the registry");
  });

  it("the shared helpers live in named modules, not between two verbs", () => {
    for (const module of [
      "spec.ts",
      "typelaw.ts",
      "lawstate.ts",
      "lawfiles.ts",
      "generated.ts",
      "pins.ts",
      "status.ts",
      "writer.ts",
    ]) {
      assert.equal(existsSync(join(SRC, module)), true, `src/${module} is missing`);
    }
  });
});
