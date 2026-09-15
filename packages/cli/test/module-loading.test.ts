// docs/extending.md §Declaring a module: the entry point preloads a bundle's
// declared modules before a verb that reads the vault's law, and before no
// other. The declaration is held against what each verb's own imports reach:
// a verb that reads the law and says it does not would be judged under a
// quieter law, and one that says it does loads a bundle's third-party code to
// answer a question about the engine.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";

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

function importsOf(file: string): string[] {
  const out: string[] = [];
  for (const m of readFileSync(file, "utf8").matchAll(/from\s+"(\.[^"]+)"/gu)) {
    const target = resolve(dirname(file), m[1] ?? "");
    if (target !== REGISTRY) out.push(target);
  }
  return out;
}

function readsAVault(entry: string): boolean {
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined) break;
    if (CALLS_LOADER.test(readFileSync(file, "utf8"))) return true;
    for (const next of importsOf(file)) {
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
    for (const command of COMMANDS) {
      const entry = join(SRC, "verbs", `${command.name}.ts`);
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
    assert.deepEqual(
      COMMANDS.filter((c) => !c.needsVaultModules)
        .map((c) => c.name)
        .sort(),
      ["schema", "trust", "version"],
    );
  });

  it("and the scan can fail: a call is a read, a declaration is not", () => {
    assert.equal(CALLS_LOADER.test('const vault = loadVault("check", root);'), true);
    assert.equal(CALLS_LOADER.test("export function preloadedModules(root: string) {"), false);
    assert.equal(CALLS_LOADER.test('import { loadVault } from "../vaultio.ts";'), false);
  });

  it("every source file the walk finds is a file the graph can read", () => {
    const files = sources();
    assert.ok(files.length > 20, `${String(files.length)} source files`);
    assert.ok(files.includes(join(SRC, "vaultio.ts")));
  });
});
