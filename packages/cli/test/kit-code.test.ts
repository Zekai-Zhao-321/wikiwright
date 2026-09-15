// docs/extending.md §The code kit · docs/extending.md §Declaring a module
//
// The shipped domain kit, `@wikiwright/kit-code`, as a bundle consumes it: the
// manifest registers declarations only, composes with the standard library,
// installs from the bundle's own node_modules, proves its fixture at the grant,
// and then governs the bundle — its labels range, its `require` rows fire, its
// templates render, and a bundle's subtype tightens what the kit left open.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { loadModules, type ModuleManifest, STANDARD_LIBRARY } from "@wikiwright/core";
import { grantKit, installKit, KIT_CODE, KIT_PACKAGE, runKit } from "./fixtures/kit-code.ts";

const manifest = (await import(pathToFileURL(join(KIT_CODE, "index.js")).href)) as {
  default: ModuleManifest;
};
const KIT = manifest.default;

interface Fixture {
  constitution: Record<string, unknown>;
  pages: Record<string, string>;
  expected: string[];
}
const FIXTURE = JSON.parse(readFileSync(join(KIT_CODE, "fixture.json"), "utf8")) as Fixture;

const TYPES = [
  "architecture-overview",
  "subsystem",
  "source-map",
  "concept",
  "quickstart",
  "testing-guide",
  "integration",
  "ops-reference",
  "decision",
].map((name) => `code/${name}`);
/** Every kit type but the decision record: a page that cites code by line is anchored. */
const ANCHORED = TYPES.filter((name) => name !== "code/decision");

interface TypeEntry {
  abstract?: boolean;
  extends: string;
  description?: string;
  fragments?: string[];
  template?: string;
  sections?: { list: { heading: string; require?: { labels: string[]; min: number }[] }[] };
}
const typeOf = (name: string): TypeEntry => KIT.types?.[name] as TypeEntry;

/** A bundle under os.tmpdir() built from the kit's own fixture, installed and granted. */
function fixtureBundle(): string {
  const root = mkdtempSync(join(tmpdir(), "ww-kit-code-"));
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(
    join(root, "config", "constitution.json"),
    `${JSON.stringify(FIXTURE.constitution, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "config", "engine.json"),
    `${JSON.stringify({ content_roots: ["wiki"], modules: [{ package: KIT_PACKAGE, version: "^0.1.0" }] })}\n`,
  );
  for (const [path, text] of Object.entries(FIXTURE.pages)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  installKit(root);
  return root;
}

const BUNDLE = fixtureBundle();
after(() => rmSync(BUNDLE, { recursive: true, force: true }));

const shape = (f: { ruleId: string; path: string; line?: number; severity: string }): string =>
  `${f.ruleId}|${f.path}|${f.line ?? 0}|${f.severity}`;

describe("the code kit registers declarations only (docs/extending.md §The code kit)", () => {
  it("nine abstract types under code/, one template each rendering the title", () => {
    assert.equal(KIT.id, "code");
    assert.deepEqual(Object.keys(KIT.types ?? {}).sort(), [...TYPES].sort());
    for (const name of TYPES) {
      const type = typeOf(name);
      assert.equal(type.abstract, true, `${name} is abstract: a page carries a bundle's subtype`);
      assert.equal(typeof type.description, "string", `${name} carries a description`);
      const template = type.template ?? "";
      const bytes = KIT.templates?.[template];
      assert.equal(typeof bytes, "string", `${name} names a registered template (${template})`);
      assert.match(bytes ?? "", /^# \{\{ title \}\}$/mu, `${template} renders the title`);
    }
    assert.equal(Object.keys(KIT.templates ?? {}).length, TYPES.length, "one template per type");
  });

  it("code/anchored is pasted by every type but the decision record", () => {
    const fragment = KIT.fragments?.["code/anchored"] as {
      fields: Record<
        string,
        { kind: string; required?: boolean; origin?: string; covers?: string }
      >;
      sections: { list: { heading: string; history?: string; lifecycle?: string }[] };
    };
    assert.equal(fragment.fields["pin"]?.kind, "pin");
    assert.equal(fragment.fields["pin"]?.required, true);
    assert.equal(fragment.fields["pin"]?.origin, "origin");
    assert.equal(fragment.fields["pin"]?.covers, "covers");
    assert.equal(
      fragment.fields["covers"]?.required,
      true,
      "a page covers something, or it is not anchored",
    );
    assert.deepEqual(
      fragment.sections.list.map((s) => [s.heading, s.history ?? s.lifecycle]),
      [
        ["Relations", "History"],
        ["History", "append-only"],
      ],
    );
    for (const name of TYPES) {
      const pastes = (typeOf(name).fragments ?? []).includes("code/anchored");
      assert.equal(pastes, ANCHORED.includes(name), `${name} anchored: ${String(pastes)}`);
    }
  });

  it("four labels contributed into the standard library's relations, ranged over kit types", () => {
    const labels = KIT.entries?.["relations"] ?? {};
    assert.deepEqual(Object.keys(labels).sort(), [
      "decided_by",
      "mapped_in",
      "part_of",
      "verified_by",
    ]);
    for (const [label, entry] of Object.entries(labels)) {
      const range = entry["range"] as string[];
      assert.equal(typeof entry["description"], "string", `${label} carries a description`);
      assert.equal(range.length > 0, true, `${label} carries a range`);
      for (const target of range) {
        assert.equal(TYPES.includes(target), true, `${label}'s range names the kit type ${target}`);
      }
    }
    assert.equal(
      Object.hasOwn(labels, "supersedes"),
      false,
      "succession is the kernel's supersedes edge, not a second label",
    );
  });

  it("the obligations: part_of on every part, mapped_in on a subsystem; none on the top, the map, the record", () => {
    const requireOf = (name: string) =>
      typeOf(name)
        .sections?.list.find((s) => s.heading === "Relations")
        ?.require?.map((r) => `${r.labels.join(",")}:${r.min}`);
    assert.deepEqual(requireOf("code/subsystem"), ["mapped_in:1", "part_of:1"]);
    for (const name of ["concept", "quickstart", "testing-guide", "integration", "ops-reference"]) {
      assert.deepEqual(requireOf(`code/${name}`), ["part_of:1"], `${name} belongs somewhere`);
    }
    for (const name of ["architecture-overview", "source-map", "decision"]) {
      assert.equal(requireOf(`code/${name}`), undefined, `${name} is what others point at`);
    }
  });

  it("the discipline rides as skill fragments; no lane, no check, no grammar", () => {
    assert.deepEqual(
      (KIT.skills ?? []).map((s) => s.heading),
      ["Reading code", "Anchoring", "Relations", "Decisions"],
    );
    assert.equal(KIT.lanes, undefined, "a lane nothing routes to is a declared key nothing reads");
    assert.equal(KIT.checks, undefined);
    assert.equal(KIT.grammars, undefined);
    assert.equal(KIT.vocabularies, undefined);
  });

  it("composes with the standard library, and the decision record is append-only as a whole", () => {
    const composed = loadModules([...STANDARD_LIBRARY, KIT]);
    assert.equal(composed.ok, true, composed.ok ? "" : JSON.stringify(composed.conflicts));
    const decision = typeOf("code/decision") as TypeEntry & { body?: { lifecycle: string } };
    assert.equal(decision.body?.lifecycle, "append-only");
  });
});

describe("a bundle over the code kit: install, grant, judge (docs/extending.md §Declaring a module)", () => {
  it("before the grant, every judging verb refuses by name and leaves the approval to a maintainer", () => {
    const r = runKit(BUNDLE, ["check"]);
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.["code"], "module-untrusted");
    assert.match(String(r.envelope.error?.["hint"]), /maintainer/u);
    assert.doesNotMatch(String(r.envelope.error?.["hint"]), /trust grant/u);
  });

  it("the grant proves the fixture, and the bundle is judged under the kit's law", {
    timeout: 60_000,
  }, () => {
    const granted = grantKit(BUNDLE);
    assert.deepEqual(granted.data?.["fixture"], { package: KIT_PACKAGE, pages: 7, findings: 4 });
    const listed = runKit(BUNDLE, ["modules", "list"]);
    const row = ((listed.envelope.data?.["loaded"] ?? []) as Record<string, unknown>[])[0];
    assert.equal(row?.["package"], KIT_PACKAGE);
    const contributes = row?.["contributes"] as Record<string, string[]>;
    assert.deepEqual(contributes["types"], [...TYPES].sort());
    assert.deepEqual(contributes["fragments"], ["code/anchored"]);
    assert.deepEqual(contributes["lanes"], []);
    assert.deepEqual(contributes["checks"], []);
    // The fixture is the bundle's law too: lint over the same pages says the same.
    const linted = runKit(BUNDLE, ["lint", "--all"]);
    const findings = (linted.envelope.data?.["findings"] ?? []) as Parameters<typeof shape>[0][];
    assert.deepEqual(findings.map(shape).sort(), [...FIXTURE.expected].sort());
  });

  it("new renders the kit's template — the title, the sections in the template's order, the seeded origin", () => {
    const pin = "0123456789abcdef0123456789abcdef01234567";
    // The template seeds `origin: .`, so `--set` names only the pin and the paths;
    // without those two, the refusal's hint lists exactly them.
    const stubbed = runKit(BUNDLE, ["new", "fx-subsystem", "Stub", "--dest", "wiki/Stub.md"]);
    assert.equal(stubbed.status, 5, JSON.stringify(stubbed.envelope));
    const details = stubbed.envelope.error?.["details"] as { set: { field: string }[] } | undefined;
    assert.deepEqual(
      (details?.set ?? []).map((f) => f.field),
      ["covers", "pin"],
      "the seeded origin is not stubbed, so it is not hinted",
    );
    const r = runKit(BUNDLE, [
      "new",
      "fx-subsystem",
      "Probe",
      "--dest",
      "wiki/Probe.md",
      "--set",
      `pin=${pin}`,
      "--set",
      'covers=["src/probe/"]',
      "--item",
      "Relations: mapped_in [[Map]]",
    ]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    const text = readFileSync(join(BUNDLE, "wiki", "Probe.md"), "utf8");
    const headings = text.split("\n").filter((line) => line.startsWith("#"));
    assert.deepEqual(headings, [
      "# Probe",
      "## Responsibilities",
      "## Entry points",
      "## State",
      "## Invariants",
      "## Failure modes",
      "## Relations",
    ]);
    assert.match(text, /^- mapped_in \[\[Map\]\]$/mu);
    assert.match(text, /^origin: \.$/mu, "seeded from the kit's template, not from --set");
    // `type show --brief` prints the same skeleton from the same template, and
    // the seed beside the field it fills.
    const shown = runKit(BUNDLE, ["type", "show", "fx-subsystem", "--brief"]);
    const fields = shown.envelope.data?.["fields"] as Record<string, { seed?: unknown }>;
    assert.equal(fields["origin"]?.seed, ".");
    assert.equal(fields["pin"]?.seed, undefined, "an empty template value seeds nothing");
    assert.equal(fields["covers"]?.seed, undefined, "an empty list seeds nothing");
    const skeleton = String(shown.envelope.data?.["skeleton"]);
    assert.deepEqual(
      skeleton.split("\n").filter((line) => line.startsWith("#")),
      ["# <title>", ...headings.slice(1)],
    );
  });

  it("a subtype tightens origin to the enclosing repository; re-pasting the fragment its parent carries is refused", {
    timeout: 60_000,
  }, () => {
    const constitution = join(BUNDLE, "config", "constitution.json");
    const before = readFileSync(constitution, "utf8");
    try {
      const document = JSON.parse(before) as { types: Record<string, unknown> };
      // The kit's overview is anchored already: a subtype that pastes
      // `code/anchored` again redeclares the fragment's fields, and the
      // loader says so — which is why the starter's and devwiki's own pastes
      // went.
      document.types["fx-overview"] = {
        extends: "code/architecture-overview",
        description: "An overview that pastes what it already inherits.",
        fragments: ["code/anchored"],
      };
      writeFileSync(constitution, `${JSON.stringify(document, null, 2)}\n`);
      const doubled = runKit(BUNDLE, ["lint", "--all"]);
      assert.equal(doubled.status, 2, JSON.stringify(doubled.envelope));
      const issues = (doubled.envelope.data?.["issues"] ?? []) as { code: string; where: string }[];
      assert.equal(
        issues.some((i) => i.code === "field-schema-redeclared" && i.where === "type:fx-overview"),
        true,
        JSON.stringify(issues),
      );
      document.types["fx-overview"] = {
        extends: "code/architecture-overview",
        description: "An anchored overview: this wiki lives in the repository it documents.",
        fields: { origin: { kind: "string", pattern: "^\\.$" } },
      };
      writeFileSync(constitution, `${JSON.stringify(document, null, 2)}\n`);
      const page = (title: string, origin: string) =>
        `---\ntype: fx-overview\ntitle: ${title}\ndescription: An overview.\ntags: []\npin: 0123456789abcdef0123456789abcdef01234567\norigin: ${origin}\ncovers: [src/]\n---\n\n# ${title}\n\n## System shape\n\nOne.\n\n## Layers\n\nOne.\n`;
      writeFileSync(join(BUNDLE, "wiki", "Here.md"), page("Here", "."));
      writeFileSync(join(BUNDLE, "wiki", "Far.md"), page("Far", "https://example.invalid/x.git"));
      const linted = runKit(BUNDLE, ["lint", "--all"]);
      assert.notEqual(linted.status, 2, JSON.stringify(linted.envelope));
      const shapes = (
        (linted.envelope.data?.["findings"] ?? []) as { ruleId: string; path: string }[]
      )
        .filter((f) => f.ruleId === "field-shape")
        .map((f) => f.path)
        .sort();
      assert.deepEqual(shapes, ["wiki/Escaped.md", "wiki/Far.md"], "`.` passes, a URL is refused");
    } finally {
      writeFileSync(constitution, before);
      rmSync(join(BUNDLE, "wiki", "Here.md"), { force: true });
      rmSync(join(BUNDLE, "wiki", "Far.md"), { force: true });
    }
  });
});
