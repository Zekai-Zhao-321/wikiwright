// docs/architecture.md §The invariants —
// "The kernel imports nothing from `packages/core/src/stdlib/`. […] This is the
// whole of what makes the standard library a layer rather than a directory: if
// the kernel may import claims, the split is decoration."
//
// A static scan of every kernel module's import specifiers. It names the
// importing file and the module it reached for, because the failure this
// prevents is exactly the one a reader cannot see: a `type` import compiles
// away, and a kernel that names `ClaimItem` reads as generic until you look.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CORE_SRC = fileURLToPath(new URL("../src/", import.meta.url));

/**
 * The package barrel is not the kernel. It is the layer ABOVE both — the file
 * whose whole job is to compose the kernel's surface with the standard
 * library's for a consumer — so it is the one file that may name both.
 * `stdlib/` is the module layer itself and is scanned for a different rule
 * below.
 */
const NOT_KERNEL = new Set(["index.ts"]);

interface SourceFile {
  /** Path relative to `packages/core/src/`, with `/` separators. */
  rel: string;
  text: string;
}

function sources(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      out.push({ rel, text: readFileSync(join(dir, entry.name), "utf8") });
    }
  };
  walk(CORE_SRC, "");
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/**
 * Every import specifier in a module, including `import type`, `export … from`
 * and dynamic `import`. A type-only import is an import for this rule: it is
 * how the kernel knew what a `ClaimItem` was for four slices.
 */
function importSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const re of [
    /(?:^|\n)\s*import\s*["']([^"']+)["']/gu,
    /\bfrom\s*["']([^"']+)["']/gu,
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const spec = match[1];
      if (spec !== undefined) out.push(spec);
    }
  }
  return out;
}

/** Resolve a relative specifier against the importing file, to a `src/`-relative path. */
function resolveRelative(fromRel: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const parts = fromRel.split("/").slice(0, -1);
  for (const segment of spec.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

describe("the kernel imports nothing from stdlib/ (docs/architecture.md §The invariants)", () => {
  const files = sources();

  it("the scan sees the files it is supposed to see", () => {
    // A boundary test that walked an empty tree would pass forever. These four
    // are the kernel modules the standard library would most want to reach into.
    for (const rel of ["grammar/index.ts", "lint/index.ts", "judge/index.ts", "modules/index.ts"]) {
      assert.equal(
        files.some((f) => f.rel === rel),
        true,
        `the walk reached ${rel}`,
      );
    }
    assert.equal(files.length > 20, true, `the walk found ${files.length} core modules`);
  });

  it("no kernel module imports from stdlib/", () => {
    const violations: string[] = [];
    for (const file of files) {
      if (file.rel.startsWith("stdlib/") || NOT_KERNEL.has(file.rel)) continue;
      for (const spec of importSpecifiers(file.text)) {
        const target = resolveRelative(file.rel, spec);
        if (target?.startsWith("stdlib/") === true) {
          violations.push(`${file.rel} imports "${spec}" (${target})`);
        }
      }
    }
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  // The rule the symmetry rests on: a first-party module reaches the kernel the
  // way a kit does — through the public API — and never through another module.
  // `docs/extending.md §A grammar`: "`claims` never imports `entries`; that coupling is exactly
  // what the layering exists to prevent, and as code it would be invisible in
  // the manifest."
  it("no standard-library module imports another module's implementation", () => {
    const violations: string[] = [];
    // A module may span several files under its own name (`claims.ts`,
    // `claims-parse.ts`, `claims-transition.ts`); the name before the first
    // hyphen is the module.
    const moduleOf = (rel: string): string => {
      const name = rel.slice("stdlib/".length);
      return (name.split("/")[0] ?? "").replace(/\.ts$/u, "").split("-")[0] ?? "";
    };
    for (const file of files) {
      if (!file.rel.startsWith("stdlib/")) continue;
      // `stdlib/index.ts` is the composition point: the standard library
      // speaking about itself, not one module reaching for another.
      if (file.rel === "stdlib/index.ts") continue;
      const mine = moduleOf(file.rel);
      for (const spec of importSpecifiers(file.text)) {
        const target = resolveRelative(file.rel, spec);
        if (target === undefined || !target.startsWith("stdlib/")) continue;
        const theirs = moduleOf(target);
        if (theirs !== mine) {
          violations.push(`${file.rel} imports ${target} — "${mine}" reached into "${theirs}"`);
        }
      }
    }
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  // The package surface offers the generic text metrics and no
  // claim-semantic predicate, which is what makes `write --correct`'s route
  // through `transitionSeam` structural. Restoring the old export would make the
  // old import resolve again, so the export list is the gate.
  it("the package barrel exports the text metrics from the kernel, not from claims", () => {
    const barrel = files.find((f) => f.rel === "index.ts");
    assert.notEqual(barrel, undefined);
    const text = barrel?.text ?? "";
    assert.match(text, /export \{[^}]*boundedLevenshtein[^}]*\} from "\.\/text\/index\.ts"/u);
    assert.match(text, /export \{[^}]*trigramJaccard[^}]*\} from "\.\/text\/index\.ts"/u);
    // And `isCorrection` is the module's, exported from the module's own file.
    assert.match(
      text,
      /export \{[^}]*isCorrection[^}]*\} from "\.\/stdlib\/claims-transition\.ts"/u,
    );
  });

  // The other half of the symmetry (docs/extending.md §What a module registers): a first-party module registers
  // through `defineModule`, not through a private hook. If a manifest ever needs
  // a kernel edit to work, this list is where it shows up first.
  it("every standard-library manifest is built with the public constructors", () => {
    for (const rel of ["stdlib/claims.ts", "stdlib/relations.ts", "stdlib/entries.ts"]) {
      const file = files.find((f) => f.rel === rel);
      assert.notEqual(file, undefined, `${rel} exists`);
      assert.match(file?.text ?? "", /export default defineModule\(\{/u);
      assert.match(file?.text ?? "", /from "\.\.\/modules\/index\.ts"/u);
    }
  });
});
