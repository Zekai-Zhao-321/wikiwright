// docs/architecture.md §The invariants (every declared key has a
// consumer and an end-to-end test) · docs/extending.md
//
// "A key nothing reads is a lie the config tells its author" (AGENTS.md). The
// schema walk holds `config/engine.json` to that; this holds the MODULE
// MANIFEST to it, because the manifest is the other surface an author fills in
// and it grew nine new fields in one slice.
//
// The check is a source scan, deliberately: the alternative is a hand list of
// "fields that are wired", which is the shape that fails silently. A field the
// scan cannot find is either dead or read somewhere this test does not look, and
// either way somebody must look — which is what a failure here asks for.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CORE_SRC = fileURLToPath(new URL("../src/", import.meta.url));
const CLI_SRC = fileURLToPath(new URL("../../cli/src/", import.meta.url));

/** The file that declares the manifest — and also resolves most of it. */
const DECLARATION_SITE = join(CORE_SRC, "modules", "index.ts");
/** Everything under it is the API itself, not a consumer of the API. */
const API_DIR = join(CORE_SRC, "modules") + "/";

function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (entry.name.endsWith(".ts")) out.push({ path, text: readFileSync(path, "utf8") });
    }
  };
  walk(CORE_SRC);
  walk(CLI_SRC);
  return out;
}

/**
 * The declaration file with every `export interface … { … }` block cut out.
 *
 * The exclusion that matters is the DECLARATION, not the file. Most of the
 * manifest is resolved by the API's own exported readers — `canonicalizeOf`,
 * `observedValues`, `admittedKinds`, `resolveParsers`, `effectOf`, `armApplies`
 * — and those are consumers: the kernel calls them instead of reading the
 * manifest itself, which is the whole point of `docs/extending.md`.
 * Excluding the file would call those fields dead and push the next author to
 * either delete a live field or add a fake read elsewhere. What must not count
 * is the field's own `readonly x?: T` line, so that is what is removed.
 */
function withoutDeclarations(text: string): string {
  let out = text;
  for (const match of text.matchAll(/^export interface \w+ \{$/gmu)) {
    const at = match.index;
    if (at === undefined) continue;
    const end = text.indexOf("\n}", at);
    out = out.replace(text.slice(at, end === -1 ? undefined : end + 2), "");
  }
  return out;
}

/**
 * What this scan proves, and what it does not — because a meta-test that
 * overclaims is worse than none.
 *
 * It proves that every field the manifest declares is READ somewhere outside its
 * own declaration, by looking for `.<field>` or `["<field>"]`. It does not prove
 * that the read is of a MANIFEST value: a field named with a common word (`id`,
 * `run`, `parse`, `kind`) will find a match somewhere whatever happens to it,
 * and for those this case is close to vacuous.
 *
 * It is still the right check, because the fields it is not vacuous for are
 * exactly the ones a slice ADDS — `canonicalize`, `observes`, `admits`,
 * `identityOf`, `isCorrection`, `severityDefault`, `runSection`, `delegates`,
 * `surfaces` — and a slice that adds a field and forgets to wire it is the
 * failure this exists to catch. Two cases below are what keep it honest: the
 * field list is read off the interfaces, so a new field cannot skip it, and no
 * reader of the API may itself be unread, so a field cannot be kept alive by a
 * resolver that nothing calls.
 */
function readsField(text: string, field: string): boolean {
  return new RegExp(`\\.${field}\\b|\\["${field}"\\]`, "u").test(text);
}

/** The interfaces whose fields this list must cover, in the declaration file. */
const DECLARED_INTERFACES = [
  "ModuleManifest",
  "GrammarSpec",
  "ArmSpec",
  "ParamSpec",
  "VocabularySpec",
  "CheckSpec",
];

/** Field names declared by one of those interfaces, read off the source. */
function declaredFields(): Set<string> {
  const text = readFileSync(DECLARATION_SITE, "utf8");
  const names = new Set<string>();
  for (const name of DECLARED_INTERFACES) {
    const at = text.indexOf(`export interface ${name} {`);
    assert.notEqual(at, -1, `${name} is declared in modules/index.ts`);
    const body = text.slice(at, text.indexOf("\n}", at));
    for (const match of body.matchAll(/^\s{2}readonly ([A-Za-z_][\w]*)\??:/gmu)) {
      const field = match[1];
      if (field !== undefined) names.add(field);
    }
  }
  return names;
}

describe("every manifest field has a consumer (docs/architecture.md §The invariants)", () => {
  const files = sources().map((file) =>
    file.path === DECLARATION_SITE ? { ...file, text: withoutDeclarations(file.text) } : file,
  );

  it("the scan sees the engine's own modules, and the declarations are cut", () => {
    assert.equal(files.length > 30, true, `the walk found ${files.length} modules`);
    assert.equal(
      files.some((f) => f.path.endsWith(join("lint", "index.ts"))),
      true,
    );
    const api = files.find((f) => f.path === DECLARATION_SITE);
    assert.notEqual(api, undefined);
    // The cut happened: no interface body survives to answer for its own fields…
    assert.equal(/^export interface/mu.test(api?.text ?? ""), false);
    // …and the readers that resolve those fields did survive it.
    assert.equal((api?.text ?? "").includes("export function canonicalizeOf"), true);
  });

  it("no field of the manifest is accepted and never read", () => {
    const dead = [...declaredFields()]
      .filter((field) => !files.some((f) => readsField(f.text, field)))
      .sort();
    assert.deepEqual(dead, [], `manifest fields nothing reads: ${dead.join(", ")}`);
  });

  it("the field list is read off the API, so a new field cannot skip the check", () => {
    const declared = declaredFields();
    // Not a hand list: the fields come from the interfaces themselves. These
    // four are named as a canary — if the reader stops finding them, the parse
    // above has broken and the case above has quietly stopped checking anything.
    for (const field of ["canonicalize", "observes", "identityOf", "surfaces"]) {
      assert.equal(declared.has(field), true, `the declaration parse still finds "${field}"`);
    }
    assert.equal(declared.size > 25, true, `the parse found ${declared.size} fields`);
  });

  it("no reader of the manifest is itself unread", () => {
    // The case above lets the API's own resolvers stand in for the kernel. That
    // is only sound while every one of them is called from outside the API — a
    // resolver nothing calls would keep a dead field looking alive.
    const api = readFileSync(DECLARATION_SITE, "utf8");
    const readers = [...api.matchAll(/^export function (\w+)/gmu)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined);
    assert.equal(readers.length > 15, true, `the parse found ${readers.length} exported readers`);
    const outside = files.filter((f) => !f.path.startsWith(API_DIR));
    const uncalled = readers
      .filter((name) => !outside.some((f) => new RegExp(`\\b${name}\\b`, "u").test(f.text)))
      .sort();
    assert.deepEqual(uncalled, [], `API readers nothing outside modules/ calls: ${uncalled}`);
  });
});
