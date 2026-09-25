// docs/extending.md §The purity scan: the loader reads every executable file of
// a module before it runs any of it, and refuses a construct a verdict may not
// depend on by file and line. A module imports nothing, in any form, and reaches
// no banned global, spelled or computed. The scan narrows; it is not a sandbox.
//
// One probe per rule the scan names, each written into a copy of the neutral
// gardening kit under os.tmpdir() and loaded as a bundle loads it.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PURITY_REASONS } from "@wikiwright/core";
import { loadDeclaredModules, moduleDigest } from "../src/moduleload.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const KIT_GARDEN = fileURLToPath(new URL("./fixtures/kit-garden", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-purity-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** Each rule's reason, and a line that reaches for what it refuses. */
const PROBES: readonly (readonly [reason: string, line: string])[] = [
  ["reads the clock (Date.now)", "export const sownAt = Date.now();"],
  ["reads the clock (new Date with no argument)", "export const sownAt = new Date();"],
  ["reads the clock (performance.now)", "export const sownAt = performance.now();"],
  ["is not deterministic (Math.random)", "export const bed = Math.random();"],
  [
    "compares under the machine's locale (localeCompare)",
    "export const byName = (a, b) => a.localeCompare(b);",
  ],
  ["reads the machine's locale (Intl)", "export const format = Intl.DateTimeFormat;"],
  ["reads the environment (process.env)", "export const beds = process.env.GARDEN_BEDS;"],
  [
    "reaches the network (fetch)",
    'export const beds = () => fetch("https://example.invalid/beds");',
  ],
  ["evaluates code built at runtime (eval)", "export const run = (text) => eval(text);"],
  [
    "evaluates code built at runtime (the Function constructor)",
    "export const make = (text) => new Function(text);",
  ],
  ["reaches a global by name (globalThis)", 'export const clock = globalThis["Da" + "te"];'],
  [
    "reaches a banned global by computed access (Date, Math, performance, Intl or process)",
    'export const sownAt = Date["now"]();',
  ],
  ["imports a module (an import declaration)", 'import { beds } from "./beds.js";'],
  ["re-exports a module (export … from)", 'export * from "./beds.js";'],
  ["imports a module at runtime (import())", 'export const beds = () => import("./beds.js");'],
  ["requires a module (require)", 'const beds = require("./beds.cjs");'],
  ["imports the filesystem", 'import { readFileSync } from "node:fs";'],
  ["imports the network", 'import { request } from "node:https";'],
  ["imports a child process", 'import { spawn } from "node:child_process";'],
  ["imports the process", 'import { argv } from "node:process";'],
  ["imports the operating system", 'import { hostname } from "node:os";'],
];

let serial = 0;

/** A bundle root under the scratch directory carrying `source` at `kit/<name>`. */
function carrying(source: string, name: string): string {
  const root = join(SCRATCH, `bundle-${++serial}`);
  cpSync(source, join(root, "kit", name), { recursive: true });
  return root;
}

/** Load the gardening kit with `probe` as one more of its files; the module-impure issue, if any. */
async function loadWithProbe(probe: string): Promise<{
  loaded: number;
  violations: { file: string; line: number; reason: string }[];
}> {
  const root = carrying(KIT_GARDEN, "garden");
  writeFileSync(join(root, "kit", "garden", "probe.js"), probe);
  const outcome = await loadDeclaredModules(root, [{ package: "kit-garden", path: "kit/garden" }]);
  const issue = outcome.issues.find((i) => i.code === "module-impure");
  return {
    loaded: outcome.loaded.length,
    violations: (issue?.details?.["violations"] ?? []) as {
      file: string;
      line: number;
      reason: string;
    }[],
  };
}

describe("the purity scan reads through comments (docs/extending.md §The purity scan)", () => {
  // A comment between a banned word and the token that makes it a construct
  // hid the construct from the patterns: a kit could import a helper from
  // outside itself, whose bytes no digest covers, and change a verdict under
  // an unchanged law.
  for (const [reason, line] of [
    [
      "imports a module (an import declaration)",
      'import/* shared helper */ { beds } from "../../garden-beds.mjs";',
    ],
    ["re-exports a module (export … from)", 'export/* c */ * from "./beds.js";'],
    [
      "imports a module at runtime (import())",
      'export const beds = () => import/* c */("./beds.js");',
    ],
    ["requires a module (require)", 'const beds = require/* c */("./beds.cjs");'],
    [
      "reaches a banned global by computed access (Date, Math, performance, Intl or process)",
      'export const sownAt = Date/* c */["now"]();',
    ],
  ] as const) {
    it(`${reason}, a comment between its tokens: refused at load, naming line 2`, async () => {
      const { loaded, violations } = await loadWithProbe(`// A probe.\n${line}\n`);
      assert.equal(loaded, 0, "the kit loaded");
      assert.ok(
        violations.some((v) => v.file === "probe.js" && v.line === 2 && v.reason === reason),
        JSON.stringify(violations),
      );
    });
  }

  it("a comment that only mentions import is not a construct", async () => {
    const { loaded, violations } = await loadWithProbe(
      '// We import nothing: see import("x") in the docs.\n/* import { beds } from "./beds.js"; */\nexport const note = 1;\n',
    );
    assert.deepEqual(violations, []);
    assert.equal(loaded, 1);
  });

  it("a string holding /* opens no comment: what follows is still read", async () => {
    const { violations } = await loadWithProbe(
      'export const s = "/* not a comment";\nimport { beds } from "./beds.js"; // */\n',
    );
    assert.ok(
      violations.some(
        (v) => v.line === 2 && v.reason === "imports a module (an import declaration)",
      ),
      JSON.stringify(violations),
    );
  });
});

describe("the purity scan refuses by file and line (docs/extending.md §The purity scan)", () => {
  for (const [reason, line] of PROBES) {
    it(`${reason}: refused at load, naming the file and the line`, async () => {
      const root = carrying(KIT_GARDEN, "garden");
      // The probe is one more executable file of the kit, its construct on line 2.
      writeFileSync(join(root, "kit", "garden", "probe.js"), `// A probe.\n${line}\n`);
      const outcome = await loadDeclaredModules(root, [
        { package: "kit-garden", path: "kit/garden" },
      ]);
      assert.deepEqual(outcome.loaded, []);
      const [issue] = outcome.issues;
      assert.equal(issue?.code, "module-impure", JSON.stringify(outcome.issues));
      const violations = (issue?.details?.["violations"] ?? []) as {
        file: string;
        line: number;
        reason: string;
      }[];
      assert.ok(
        violations.some(
          (v) => v.file === "probe.js" && v.line === 2 && v.reason.startsWith(reason),
        ),
        JSON.stringify(violations),
      );
      assert.match(issue?.message ?? "", /probe\.js:2 /u);
    });
  }

  it("a probe for every rule the scan names, and no probe for a rule it does not", () => {
    assert.deepEqual(PROBES.map(([reason]) => reason).sort(), [...PURITY_REASONS].sort());
  });

  it("the shipped kit, the gardening kit and the conformance module pass", () => {
    for (const [source, name] of [
      [join(REPO, "packages", "kit-code"), "@wikiwright/kit-code"],
      [KIT_GARDEN, "kit-garden"],
      [join(REPO, "fixtures", "conformance", "module-fixture"), "@wikiwright-fixture/probe"],
    ] as const) {
      const root = carrying(source, "under-scan");
      const digest = moduleDigest(root, { package: name, path: "kit/under-scan" });
      assert.notEqual(digest, undefined, name);
      assert.deepEqual(digest?.violations, [], name);
    }
  });

  it("docs/extending.md names every reason the scan reports", () => {
    const doc = readFileSync(join(REPO, "docs", "extending.md"), "utf8");
    const section = doc.slice(doc.indexOf("## The purity scan"));
    assert.notEqual(doc.indexOf("## The purity scan"), -1, "the section exists");
    const body = section.slice(0, section.indexOf("\n## ", 1));
    for (const reason of PURITY_REASONS) {
      assert.ok(
        body.includes(reason),
        `docs/extending.md §The purity scan does not name "${reason}"`,
      );
    }
  });
});
