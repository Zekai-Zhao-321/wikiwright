// docs/extending.md §Declaring a module: the entry point preloads a bundle's
// declared modules before a verb that reads the vault's law, and before no
// other. The declaration is held against what each verb's own imports reach:
// a verb that reads the law and says it does not would be judged under a
// quieter law, and one that says it does loads a bundle's third-party code to
// answer a question about the engine.
//
// The scan reads source text: it follows every runtime import edge the shared
// recognizer sees — a named, default or namespace import, a re-export, a bare
// import for its side effects, a dynamic import of a literal — and a loader
// call spelled out. A specifier or a call built at runtime is outside it.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS, LEGACY_COMMANDS } from "../src/commands.ts";
import { runtimeImports } from "./fixtures/imports.ts";
import { everyVerb } from "./fixtures/verb-module.ts";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Every source file of the shell, repository-relative to `src`. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { encoding: "utf8" }).sort()) {
      const next = join(dir, entry);
      if (statSync(next).isDirectory()) walk(next);
      else if (entry.endsWith(".ts")) out.push(next);
    }
  };
  walk(SRC);
  return out;
}

/**
 * A call of the vault loader, not its declaration: `vaultio.ts` defines
 * `loadVault`, and defining it is not reading a vault.
 */
const CALLS_LOADER = /(?<!function )\b(?:loadVault|loadVaultVia|preloadedModules)\s*\(/u;

/**
 * The registry imports every verb, so an edge through it would make every verb
 * reach every other. It is the list of verbs, not a step any verb takes.
 */
const REGISTRY = join(SRC, "commands.ts");

function readSource(file: string): string {
  return readFileSync(file, "utf8");
}

/** The files a module's runtime imports reach, the registry's edge left out. */
function importsOf(source: string, file: string): string[] {
  return runtimeImports(source, file).filter((target) => target !== REGISTRY);
}

/** Whether `entry`, or a module its imports reach, calls the vault loader. */
function readsAVault(entry: string, read: (file: string) => string = readSource): boolean {
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined) break;
    const source = read(file);
    if (CALLS_LOADER.test(source)) return true;
    for (const next of importsOf(source, file)) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

describe("a verb declares whether it reads the vault's law (docs/extending.md)", () => {
  it("every declaration matches what the verb's imports reach", () => {
    const wrong: string[] = [];
    for (const { spec: command, module } of everyVerb(COMMANDS, LEGACY_COMMANDS)) {
      const entry = join(SRC, module);
      const reaches = readsAVault(entry);
      if (reaches !== command.needsVaultModules) {
        wrong.push(
          `"${command.name}" declares needsVaultModules: ${String(command.needsVaultModules)} and ${reaches ? "reads a vault" : "reads no vault"}`,
        );
      }
    }
    assert.deepEqual(wrong, []);
  });

  it("the verbs that read no vault are named, so adding one is a decision", () => {
    // A verb of the command table reads its law through the type-document
    // loader, which loads no module: none of them preloads one.
    assert.deepEqual(
      LEGACY_COMMANDS.filter((c) => !c.needsVaultModules)
        .map((c) => c.name)
        .sort(),
      ["schema", "version"],
    );
    assert.deepEqual(
      COMMANDS.filter((c) => !LEGACY_COMMANDS.includes(c) && c.needsVaultModules).map(
        (c) => c.name,
      ),
      [],
    );
  });

  it("and the scan can fail: a call is a read, a declaration is not", () => {
    assert.equal(CALLS_LOADER.test('const vault = loadVault("check", root);'), true);
    assert.equal(CALLS_LOADER.test("export function preloadedModules(root: string) {"), false);
    assert.equal(CALLS_LOADER.test('import { loadVault } from "../vaultio.ts";'), false);
  });

  it("and the graph follows every runtime edge to a loader call, and no type-only one", () => {
    // Two in-memory modules: the verb reaches the loader call only through the
    // one edge each case spells.
    const verb = join(SRC, "verbs", "probe.ts");
    const helper = join(SRC, "probe-helper.ts");
    const graph = (spelling: string) => (file: string) =>
      file === verb ? spelling : file === helper ? "loadVault(command, root);\n" : "";
    for (const reaches of [
      'import { helper } from "../probe-helper.ts";',
      'import helper from "../probe-helper.ts";',
      'import * as helper from "../probe-helper.ts";',
      'export { helper } from "../probe-helper.ts";',
      'import "../probe-helper.ts";',
      'const helper = await import("../probe-helper.ts");',
    ]) {
      assert.equal(readsAVault(verb, graph(reaches)), true, reaches);
    }
    for (const erased of [
      'import type { Helper } from "../probe-helper.ts";',
      'export type { Helper } from "../probe-helper.ts";',
    ]) {
      assert.equal(readsAVault(verb, graph(erased)), false, erased);
    }
  });

  it("every source file the walk finds is a file the graph can read", () => {
    const files = sources();
    assert.ok(files.length > 20, `${String(files.length)} source files`);
    assert.ok(files.includes(join(SRC, "vaultio.ts")));
  });
});
