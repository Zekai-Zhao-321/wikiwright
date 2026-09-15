// docs/extending.md §The determinism fixture (a determinism fixture per module,
// input bytes and expected findings, run by the engine at the grant that pins
// the module's bytes — before the module judges anything of the bundle's — and
// again by `modules list` and `modules plan` on request) · docs/architecture.md §The invariants
//
// The second of the three determinism guards. The purity scan reads a module's
// bytes and refuses the ordinary ways of reaching the clock; this runs the
// module and requires it to be a FUNCTION of its input: the same bytes, twice,
// in one process, and the findings it shipped as its own expectation.
//
// Separate from `moduleload.ts` because it needs the composed registry, and the
// registry is composed only after every declared module has resolved.
import { readFileSync } from "node:fs";
import {
  judge,
  loadConstitution,
  loadModules,
  type ModuleManifest,
  STANDARD_LIBRARY,
} from "@wikiwright/core";
import type { LoadedModule, ModuleIssue } from "./moduleload.ts";

/**
 * What a module ships beside its code: a constitution that declares the module's
 * own surface, the pages that exercise it, and the findings they must produce.
 */
export interface ModuleFixture {
  constitution: unknown;
  pages: Record<string, string>;
  /** `ruleId|path|line|severity` per expected finding, in the engine's own order. */
  expected: string[];
}

/** The comparable form of one finding: what a module's fixture pins. */
function shapeOf(finding: {
  ruleId: string;
  path: string;
  line?: number;
  severity: string;
}): string {
  return `${finding.ruleId}|${finding.path}|${finding.line ?? 0}|${finding.severity}`;
}

export interface FixtureResult {
  package: string;
  /** How many pages the fixture judged, and how many findings it produced. */
  pages: number;
  findings: number;
}

/**
 * docs/extending.md §The determinism fixture: run one module's fixture under a registry composed of the
 * standard library plus THAT module — never the whole bundle's module set, so a
 * fixture proves the module rather than the company it keeps.
 */
export function runModuleFixture(
  module: LoadedModule,
): { ok: true; result: FixtureResult } | { ok: false; issue: ModuleIssue } {
  let fixture: ModuleFixture;
  try {
    fixture = JSON.parse(readFileSync(module.fixture, "utf8")) as ModuleFixture;
    if (
      fixture.constitution === undefined ||
      fixture.pages === null ||
      typeof fixture.pages !== "object" ||
      !Array.isArray(fixture.expected)
    ) {
      throw new Error("a fixture carries `constitution`, `pages` and `expected`");
    }
  } catch (error) {
    return {
      ok: false,
      issue: {
        code: "module-fixture-failed",
        package: module.package,
        message: `the determinism fixture of "${module.package}" is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  const manifests: ModuleManifest[] = [...STANDARD_LIBRARY, module.manifest];
  const composed = loadModules(manifests);
  if (!composed.ok) {
    return {
      ok: false,
      issue: {
        code: "module-fixture-failed",
        package: module.package,
        message: `"${module.package}" does not compose with the standard library: ${composed.conflicts
          .map((c) => `${c.kind} "${c.id}"`)
          .join(", ")}`,
        details: { conflicts: composed.conflicts },
      },
    };
  }
  const built = loadConstitution(fixture.constitution, composed.registry);
  if (!built.ok) {
    return {
      ok: false,
      issue: {
        code: "module-fixture-failed",
        package: module.package,
        message: `the fixture constitution of "${module.package}" does not load: ${built.issues
          .map(
            (i) =>
              `${i.code} at ${i.where}${i.sites === undefined ? "" : ` (${i.sites.join(", ")})`}`,
          )
          .join(", ")}`,
        details: { issues: built.issues },
      },
    };
  }

  const state = () => ({ pages: new Map(Object.entries(fixture.pages)) });
  const law = { registry: built.registry, modules: composed.registry };
  const run = (): string[] =>
    judge(state(), law, { all: true, limit: 10_000 }).findings.map(shapeOf);

  const first = run();
  const second = run();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    return {
      ok: false,
      issue: {
        code: "module-nondeterministic",
        package: module.package,
        message: `"${module.package}" produced different findings for the same bytes in one process`,
        hint: "a module's verdict is a function of the page it is handed; find the state it is reading",
        details: { first, second },
      },
    };
  }
  if (JSON.stringify(first) !== JSON.stringify(fixture.expected)) {
    return {
      ok: false,
      issue: {
        code: "module-fixture-failed",
        package: module.package,
        message: `"${module.package}" did not produce the findings its own fixture expects`,
        hint: "the module and this engine disagree; regenerate the fixture against the engine you ship for, or fix the module",
        details: { expected: fixture.expected, actual: first },
      },
    };
  }
  return {
    ok: true,
    result: {
      package: module.package,
      pages: Object.keys(fixture.pages).length,
      findings: first.length,
    },
  };
}
