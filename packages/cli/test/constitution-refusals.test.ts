// docs/constitution.md §config/constitution.json (the v3 surface: the mode lives on the
// vocabulary, never on the section) (the `labels` refusal names
// the fix, and "registered" is not admitted as a spelling) (a v3
// bundle's issues are rooted at the file the author edits) (the
// scan that recurses) · docs/cli.md §The envelope (exit 2 = a defect in the LAW).
//
// Both findings come from a bundle in use: the engine's
// refusal was correct and its message was about a file the author does not have.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { grantedCopy, kitEnv } from "./fixtures/kit-code.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const CODE_STARTER = fileURLToPath(new URL("../constitutions/code", import.meta.url));

interface Issue {
  code: string;
  where: string;
  message: string;
}

interface Envelope {
  ok: boolean;
  data?: { issues?: Issue[] };
  error?: { code: string; type: string; details?: Record<string, unknown> };
}

function run(cwd: string, args: string[]): { status: number; envelope: Envelope } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: kitEnv(cwd),
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

/**
 * The shipped `code` starter, copied with its kit installed and granted so the
 * test can damage its constitution and still reach the constitution's own
 * refusal rather than the loader's (docs/extending.md §The code kit).
 */
function codeVault(mutate: (doc: Record<string, unknown>) => void): string {
  const tmp = grantedCopy(CODE_STARTER, "refusal");
  const path = join(tmp, "config/constitution.json");
  const doc = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  mutate(doc);
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  return tmp;
}

/**
 * The `Relations` section entry of the starter's `subsystem` type: the kit's
 * heading, redeclared on the bundle's subtype at its inherited bounds — the
 * one place a bundle author edits a kit section, and the entry the refusals
 * below must be anchored at.
 */
function subsystemRelations(doc: Record<string, unknown>): Record<string, unknown> {
  const types = doc["types"] as Record<string, Record<string, unknown>>;
  const subsystem = types["subsystem"];
  assert.notEqual(subsystem, undefined, "the code starter declares a subsystem type");
  const entry: Record<string, unknown> = { heading: "Relations", min: 1, max: 1 };
  (subsystem as Record<string, unknown>)["sections"] = { depth: 2, list: [entry] };
  return entry;
}

describe("`labels` is not a section parameter: the mode lives on the vocabulary", () => {
  // The tempting "fix" is to accept `labels: "registered"` and mean
  // `mode: "registered"` on the vocabulary. That gives the mode two homes, which
  // is the thing v3 exists to end: the bundle must fail to load, and
  // the refusal is the one every stray parameter gets — named by the grammar's
  // own parameter set, rooted at the entry the author edits.
  for (const value of ["registered", "census"]) {
    it(`\`labels: "${value}"\` is refused at exit 2 as a parameter the grammar does not own`, () => {
      const tmp = codeVault((doc) => {
        subsystemRelations(doc)["labels"] = value;
      });
      try {
        const r = run(tmp, ["lint"]);
        assert.equal(r.status, 2, JSON.stringify(r.envelope));
        assert.equal(r.envelope.error?.code, "constitution-invalid");
        const issues = r.envelope.data?.issues ?? [];
        const issue = issues.find((i) => i.code === "sections-grammar-params");
        assert.notEqual(issue, undefined, JSON.stringify(issues));
        assert.equal(issue?.message.includes("labels"), true, issue?.message);
        assert.equal(issue?.where.startsWith("type:subsystem"), true, issue?.where);
        assert.equal(run(tmp, ["vocabulary", "show", "relations"]).status, 2);
        assert.equal(run(tmp, ["type", "show", "subsystem"]).status, 2);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it("a `labels` list inside a `require` row is the row's own key, never a stray parameter", () => {
    const tmp = codeVault((doc) => {
      subsystemRelations(doc)["require"] = [{ labels: ["part_of", "mapped_in"], min: 1 }];
    });
    try {
      const r = run(tmp, ["type", "show", "subsystem"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("a v3 bundle's issues name the file the author edits", () => {
  it("a v3 schema issue is anchored at the type the author edits, never at type-registry.", () => {
    const tmp = codeVault((doc) => {
      // Any key the section schema does not declare: the refusal is the same
      // one `labels: "registered"` used to get, and it is the path that was
      // wrong, not the verdict.
      subsystemRelations(doc)["no-such-parameter"] = true;
    });
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      const issues = r.envelope.data?.issues ?? [];
      // The v3 section schema passes unknown keys through, because a
      // kit may declare a parameter the kernel never heard of — so a stray key
      // is now named by `sections-grammar-params` rather than by zod. The LAW
      // this case carries is about the PATH, not the code: whichever pass
      // reports it must name the file the author opens, entry and all.
      const schema = issues.filter(
        (i) => i.code === "schema-invalid" || i.code === "sections-grammar-params",
      );
      assert.equal(schema.length > 0, true, JSON.stringify(issues));
      for (const issue of schema) {
        assert.equal(
          issue.where.startsWith("type:subsystem"),
          true,
          `a v3 bundle has no config/type-registry.json: ${issue.where}`,
        );
      }
      // The rest of the path is exact — only the root moved.
      assert.equal(
        schema.some((i) => i.where.startsWith("type:subsystem/sections/list/")),
        true,
        JSON.stringify(schema),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
