// docs/architecture.md §The invariants: the engine's modules form a graph with
// no runtime cycle. A cycle runs whichever module the loader reaches first and
// leaves the other half-built, so a binding read at module scope can be
// undefined for reasons that have nothing to do with the code being read; the
// registry and the verbs carried one for a while, and the cure was to hand the
// registry to the invocation instead of importing it back.
//
// A type-only import is erased before anything runs and is not an edge.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { encoding: "utf8" }).sort()) {
      const next = join(dir, entry);
      if (statSync(next).isDirectory()) walk(next);
      else if (entry.endsWith(".ts")) out.push(next);
    }
  };
  for (const pkg of readdirSync(PACKAGES, { encoding: "utf8" }).sort()) {
    const src = join(PACKAGES, pkg, "src");
    try {
      if (statSync(src).isDirectory()) walk(src);
    } catch {
      // A package with no `src/` contributes no modules.
    }
  }
  return out;
}

/**
 * Every relative specifier that survives compilation, from one file: an
 * import, a re-export — `export { x } from "./y.ts"` runs `./y.ts` exactly as
 * an import does — a bare import for its side effects, and a dynamic import,
 * which defers the edge but does not remove it. A `type` import or a `type`
 * re-export is erased and is no edge.
 */
export function runtimeImports(source: string, file: string): string[] {
  const out: string[] = [];
  const here = (specifier: string): void => {
    out.push(resolve(dirname(file), specifier));
  };
  for (const match of source.matchAll(/^\s*(import|export)\s+([\s\S]*?)from\s+"(\.[^"]+)"/gmu)) {
    if (/^\s*type\s/u.test(match[2] ?? "")) continue;
    here(match[3] ?? "");
  }
  for (const match of source.matchAll(/^\s*import\s+"(\.[^"]+)"/gmu)) here(match[1] ?? "");
  for (const match of source.matchAll(/\bimport\s*\(\s*"(\.[^"]+)"/gu)) here(match[1] ?? "");
  for (const match of source.matchAll(/\brequire\s*\(\s*"(\.[^"]+)"/gu)) here(match[1] ?? "");
  return [...new Set(out)];
}

function cycles(): string[][] {
  const files = sources();
  const edges = new Map(files.map((f) => [f, runtimeImports(readFileSync(f, "utf8"), f)]));
  const found: string[][] = [];
  const done = new Set<string>();
  const walk = (node: string, path: string[]): void => {
    const at = path.indexOf(node);
    if (at !== -1) {
      found.push([...path.slice(at), node].map((p) => relative(PACKAGES, p)));
      return;
    }
    if (done.has(node)) return;
    for (const next of edges.get(node) ?? []) walk(next, [...path, node]);
    done.add(node);
  };
  for (const file of files) walk(file, []);
  const unique = new Map(found.map((c) => [[...c].sort().join("|"), c]));
  return [...unique.values()];
}

describe("the engine's modules import in one direction (docs/architecture.md)", () => {
  it("no module imports itself back, however many steps around", () => {
    assert.deepEqual(
      cycles().map((c) => c.join(" -> ")),
      [],
    );
  });

  it("and the scan can fail: every runtime spelling is an edge, a type is not", () => {
    const file = join(PACKAGES, "cli/src/x.ts");
    const y = [join(PACKAGES, "cli/src/y.ts")];
    for (const runs of [
      'import { a } from "./y.ts";',
      'import { type A, b } from "./y.ts";',
      'import a from "./y.ts";',
      'import * as a from "./y.ts";',
      'import "./y.ts";',
      'export { a } from "./y.ts";',
      'export * from "./y.ts";',
      'const a = await import("./y.ts");',
      'const a = require("./y.ts");',
    ]) {
      assert.deepEqual(runtimeImports(runs, file), y, runs);
    }
    for (const erased of [
      'import type { A } from "./y.ts";',
      'export type { A } from "./y.ts";',
      'import { a } from "@wikiwright/core";',
      'export { a } from "@wikiwright/core";',
    ]) {
      assert.deepEqual(runtimeImports(erased, file), [], erased);
    }
  });

  it("reads every package's sources", () => {
    const files = sources();
    assert.ok(
      files.some((f) => f.includes("/core/src/")),
      "no kernel sources",
    );
    assert.ok(
      files.some((f) => f.includes("/cli/src/")),
      "no shell sources",
    );
    assert.ok(files.length > 50, `${String(files.length)} sources`);
  });
});
