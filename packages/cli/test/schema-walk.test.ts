// docs/architecture.md §The invariants (every engine-config key names a
// consumer that exists and carries an `e2e:<key>` fixture going from bytes on
// disk to a command result; the residual vector is closed by test discipline)
// · docs/constitution.md §config/engine.json (the keys this test walks).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as core from "@wikiwright/core";
import * as commands from "../src/commands.ts";
import * as law from "../src/law.ts";
import * as moduleload from "../src/moduleload.ts";
import * as vaultio from "../src/vaultio.ts";

const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));

/** The zod object the loader parses engine.json with — read, never re-listed. */
function schemaKeys(): string[] {
  const schema = (core as unknown as Record<string, unknown>)["ENGINE_CONFIG_SCHEMA"] as
    | { shape?: Record<string, unknown> }
    | undefined;
  assert.notEqual(schema, undefined, "core exports ENGINE_CONFIG_SCHEMA");
  const shape = schema?.shape;
  assert.notEqual(shape, undefined, "the exported schema is a zod object with a shape");
  return Object.keys(shape ?? {}).sort();
}

function consumers(): Record<string, string | readonly string[]> {
  const table = (core as unknown as Record<string, unknown>)["ENGINE_CONFIG_CONSUMERS"] as
    | Record<string, string | readonly string[]>
    | undefined;
  assert.notEqual(table, undefined, "core exports ENGINE_CONFIG_CONSUMERS");
  return table ?? {};
}

/**
 * Every exported function the engine's own modules offer, by name.
 *
 * docs/architecture.md §Directories: `law.ts` joined the list when the per-verb split moved the
 * engine-config readers out of `commands.ts` — the walk resolves NAMES, so the
 * module list has to name every place a consumer can live, or a key's consumer
 * could be deleted while the walk stayed green. `moduleload.ts` joined it with
 * the `modules` key, for the same reason.
 */
function exportedFunctions(): Set<string> {
  const names = new Set<string>();
  for (const mod of [core, commands, law, moduleload, vaultio] as unknown as Record<
    string,
    unknown
  >[]) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === "function") names.add(name);
    }
  }
  return names;
}

function testFiles(): string[] {
  const files: string[] = [];
  for (const pkg of readdirSync(PACKAGES, { encoding: "utf8" })) {
    const dir = join(PACKAGES, pkg, "test");
    let entries: string[];
    try {
      entries = readdirSync(dir, { encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".test.ts")) files.push(join(dir, entry));
    }
  }
  return files.sort();
}

/** A test is end-to-end when it writes the config file AND drives the binary. */
const CLI_ENTRY_POINTS = ["dist/main.js", "../src/main.ts"];

describe("the schema walk: every engine.json key is wired (docs/architecture.md §The invariants)", () => {
  it("every key of the engine-config schema names a consumer that exists", () => {
    const keys = schemaKeys();
    assert.equal(keys.length > 0, true, "the walk enumerates the shape, not a hand list");
    const table = consumers();
    const functions = exportedFunctions();
    for (const key of keys) {
      const consumer = table[key];
      assert.notEqual(
        consumer,
        undefined,
        `engine.json key "${key}" has no ENGINE_CONFIG_CONSUMERS entry — a declaration nothing reads`,
      );
      // A key with more than one reader names every one of them: the walk
      // resolves each name, so a second reader is a wired fact, not a comment.
      const readers = Array.isArray(consumer) ? consumer : [consumer ?? ""];
      assert.equal(readers.length > 0, true, `key "${key}" names no reader at all`);
      for (const reader of readers) {
        assert.equal(
          functions.has(reader),
          true,
          `key "${key}" names consumer "${reader}", which is not an exported function`,
        );
      }
    }
  });

  it("ENGINE_CONFIG_CONSUMERS names no key the schema does not declare", () => {
    const keys = new Set(schemaKeys());
    for (const key of Object.keys(consumers())) {
      assert.equal(keys.has(key), true, `ENGINE_CONFIG_CONSUMERS names unknown key "${key}"`);
    }
  });

  it("every key has an e2e:<key> fixture that goes from a config file to a command result", () => {
    const files = testFiles();
    for (const key of schemaKeys()) {
      const marker = `e2e:${key}`;
      const carriers = files.filter((f) => readFileSync(f, "utf8").includes(marker));
      assert.equal(
        carriers.length > 0,
        true,
        `no test carries the marker "${marker}" — the key has no path from bytes to a verdict`,
      );
      const end2end = carriers.filter((f) => {
        const text = readFileSync(f, "utf8");
        return text.includes("engine.json") && CLI_ENTRY_POINTS.some((e) => text.includes(e));
      });
      assert.equal(
        end2end.length > 0,
        true,
        `"${marker}" is carried only by tests that never write engine.json and run the CLI: ${carriers.join(", ")}`,
      );
    }
  });
});
