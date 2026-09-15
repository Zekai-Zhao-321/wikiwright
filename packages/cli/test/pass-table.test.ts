// The pass table is the routing law's static half: every finding the engine can
// emit has a row, every row routes (a fixer that executes, or a lane) or is a
// census, a row names a fixer only where the registry carries it for that rule,
// every POLICY row names a real engine.json key, and the severity a row states
// is a ceiling the emit sites respect. The table a vault is judged under is the
// kernel's plus every loaded module's arms and checks, so these cases read the
// composed table under the standard library and hold the kernel's own table to
// carrying none of a module's rows.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ENGINE_CONFIG_SCHEMA,
  fixerRegistered,
  KERNEL_LANES,
  KERNEL_OWNED_ARMS,
  PASS_TABLE,
  type PassRow,
  passRows,
  routeOf,
  standardLibrary,
  unroutableRows,
} from "@wikiwright/core";

const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
const MODULES = standardLibrary();
const ROWS: readonly PassRow[] = passRows(MODULES);
const BY_ID: ReadonlyMap<string, PassRow> = new Map(ROWS.map((r) => [r.id, r] as const));

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir, { encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith(".ts")) files.push(abs);
    }
  };
  for (const pkg of readdirSync(PACKAGES, { encoding: "utf8" })) walk(join(PACKAGES, pkg, "src"));
  return files.sort();
}

/**
 * Every finding id the engine can emit: the literals at every emit site —
 * including the ternary form (`ruleId: required ? "a" : "b"`), which is why the
 * whole expression's string literals are collected — the frontmatter parse
 * codes, and the ids `checkGrammar` emits through its one `emit` helper, which
 * takes the id as an ARGUMENT and is invisible to the scan: the kernel-owned
 * arms and every arm and check a loaded module declared.
 */
function emittedRuleIds(): string[] {
  const ids = new Set<string>([
    ...KERNEL_OWNED_ARMS,
    ...MODULES.arms.keys(),
    ...MODULES.checks.keys(),
  ]);
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bruleId:([^\n]*)/g)) {
      for (const lit of (m[1] ?? "").matchAll(/"([^"]+)"/g)) {
        if (lit[1] !== undefined) ids.add(lit[1]);
      }
    }
    if (file.endsWith(join("parse", "index.ts"))) {
      for (const m of text.matchAll(/\bcode:\s*"([^"]+)"/g)) {
        if (m[1] !== undefined) ids.add(m[1]);
      }
    }
  }
  return [...ids].sort();
}

describe("the pass table classifies every pass (docs/concepts.md §Findings and routing)", () => {
  it("every finding ruleId the engine can emit has a row", () => {
    const emitted = emittedRuleIds();
    assert.equal(emitted.length > 10, true, `the collector found ids (${emitted.length})`);
    for (const id of emitted) {
      assert.equal(BY_ID.has(id), true, `finding "${id}" can be emitted with no pass-table row`);
    }
  });

  it("a module's arms carry their own rows, and the kernel's table carries none of them", () => {
    assert.equal(MODULES.arms.size > 10, true, "the standard library declares arms at all");
    for (const [id, arm] of MODULES.arms) {
      assert.equal(
        PASS_TABLE.some((r) => r.id === id),
        false,
        `"${id}" is a module's arm and sits in the kernel's table`,
      );
      const row = BY_ID.get(id);
      assert.equal(row?.kind, "type-declared", `"${id}" is declared by a section's grammar`);
      assert.equal(row?.severity, arm.row, `"${id}" carries the row its manifest declared`);
      assert.equal(row?.lane, arm.lane, `"${id}" carries the lane its manifest declared`);
    }
    for (const id of KERNEL_OWNED_ARMS) {
      assert.equal(
        PASS_TABLE.some((r) => r.id === id),
        true,
        `"${id}" is the kernel's own`,
      );
    }
  });

  it("every POLICY row names a real engine.json key; nothing else carries one", () => {
    const keys = new Set(Object.keys(ENGINE_CONFIG_SCHEMA.shape));
    assert.equal(keys.size > 0, true, "the engine-config schema is readable");
    for (const row of ROWS) {
      if (row.kind === "POLICY") {
        assert.notEqual(row.key, undefined, `POLICY row "${row.id}" names no engine.json key`);
        assert.equal(
          keys.has(row.key ?? ""),
          true,
          `POLICY row "${row.id}" names key "${row.key}", which the schema does not declare`,
        );
      } else {
        assert.equal(row.key, undefined, `only POLICY rows carry a key ("${row.id}")`);
      }
    }
  });

  it("every row states a legal kind and severity, and derives a route", () => {
    for (const row of ROWS) {
      assert.equal(
        ["LAW", "POLICY", "type-declared"].includes(row.kind),
        true,
        `row "${row.id}" has kind "${row.kind}"`,
      );
      assert.equal(
        ["error", "warning", "info", "declared"].includes(row.severity),
        true,
        `row "${row.id}" has severity "${row.severity}"`,
      );
      assert.equal(
        routeOf(row).length > 0,
        true,
        `row "${row.id}" derives a route from its fixer, its lane, or neither`,
      );
    }
  });

  // A fixer named on a row that the registry does not carry for that rule is a
  // route the envelope prints and the verb refuses: `tag-requires-link` named
  // `write <target>` and `skills-stale` named `skills update`, neither a fixer.
  it("a row names a fixer only where the registry carries it for that rule", () => {
    for (const row of ROWS) {
      if (row.fixer === undefined) continue;
      assert.equal(
        fixerRegistered(row.fixer, row.id),
        true,
        `row "${row.id}" names fixer "${row.fixer}", which the registry does not carry for it`,
      );
      assert.equal(routeOf(row), row.fixer, `"${row.id}" routes to its fixer`);
    }
  });
});

/**
 * Every (ruleId, severity) pair written as adjacent literals at an emit site.
 * The `ruleId:` expression may name more than one id (the ternary form), and
 * they share the one severity literal beside them.
 */
function emittedSeverities(): { id: string; severity: string; file: string }[] {
  const pairs: { id: string; severity: string; file: string }[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bruleId:([^\n]*)\n\s*severity:\s*"([a-z]+)"/g)) {
      const severity = m[2] ?? "";
      for (const lit of (m[1] ?? "").matchAll(/"([^"]+)"/g)) {
        if (lit[1] !== undefined) pairs.push({ id: lit[1], severity, file });
      }
    }
  }
  return pairs;
}

function rank(severity: string): number {
  if (severity === "error") return 2;
  if (severity === "warning") return 1;
  return 0;
}

describe("the pass table's severity is a ceiling, and it is enforced", () => {
  // The gap this closes: the run-external severity law is enforced at registry
  // LOAD, which reaches type-declared checkers only. An engine-emitted LAW pass
  // writes its severity as a literal at the emit site, where no validation runs
  // — so the law "no arm of this pass may be an `error`" could have been
  // violated with every gate still green.
  it("every emitted ruleId/severity literal pair sits at or below its row", () => {
    const pairs = emittedSeverities();
    assert.equal(pairs.length > 20, true, `the collector found emit sites (${pairs.length})`);
    for (const pair of pairs) {
      const row = BY_ID.get(pair.id);
      assert.notEqual(row, undefined, `"${pair.id}" is emitted with no pass-table row`);
      // A `declared` row carries its severity in the section's knob, not here.
      if (row === undefined || row.severity === "declared") continue;
      assert.equal(
        rank(pair.severity) <= rank(row.severity),
        true,
        `${pair.file}: "${pair.id}" is emitted at ${pair.severity}, above its ${row.severity} row`,
      );
    }
  });

  it("the ceiling is a ceiling, not an equality: skills-stale emits both arms", () => {
    // The ceiling law needs the room, and a gate that demanded equality would have
    // forced a second id for what is one law with one route.
    const emitted = emittedSeverities().filter((p) => p.id === "skills-stale");
    assert.deepEqual(
      [...new Set(emitted.map((p) => p.severity))].sort(),
      ["info", "warning"],
      "both arms of skills-stale are written as literals and both are collected",
    );
    assert.equal(rank("info") < rank("warning"), true, "the comparison is an ordering");
    assert.equal(rank("warning") < rank("error"), true, "the comparison is an ordering");
  });
});

describe("the routing law: every finding routes or the build fails (docs/concepts.md §Findings and routing)", () => {
  // The law's build-failing half: a finding an agent cannot act on and cannot
  // hand to anyone is a finding that teaches the agent to ignore findings.
  it("no row of the composed table is unroutable", () => {
    assert.deepEqual(
      unroutableRows(ROWS),
      [],
      "an error/warning row names a registered fixer or a lane; an info row names neither",
    );
  });

  it("every lane a row names is registered — the kernel's, or a module's own", () => {
    for (const row of ROWS) {
      if (row.lane === undefined) continue;
      assert.equal(MODULES.lanes.has(row.lane), true, `row "${row.id}" names lane "${row.lane}"`);
    }
  });

  it("the kernel's lane set is exactly the lanes its own rows use", () => {
    const used = new Set(PASS_TABLE.map((r) => r.lane).filter((l) => l !== undefined));
    assert.deepEqual([...used].sort(), [...KERNEL_LANES].sort());
  });

  it("a module's lane is used by one of its own arms or checks", () => {
    const used = new Set(ROWS.map((r) => r.lane).filter((l) => l !== undefined));
    for (const lane of MODULES.lanes) {
      if (KERNEL_LANES.includes(lane)) continue;
      assert.equal(used.has(lane), true, `lane "${lane}" is registered and no row routes to it`);
    }
  });
});
