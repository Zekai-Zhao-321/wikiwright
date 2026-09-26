// docs/extending.md §The code kit · docs/extending.md §Declaring a module
//
// The v1 domain kit, `@wikiwright/kit-code`: its manifest registers
// declarations only and composes with the standard library. The verbs that
// installed and ran it left with the old table; `libraries/kit-code` is its
// v2 form, and the kit itself leaves in the next commits of step 6.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadModules, type ModuleManifest, STANDARD_LIBRARY } from "@wikiwright/core";
import { KIT_CODE } from "./fixtures/kit-code.ts";

const manifest = (await import(pathToFileURL(join(KIT_CODE, "index.js")).href)) as {
  default: ModuleManifest;
};
const KIT = manifest.default;

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
