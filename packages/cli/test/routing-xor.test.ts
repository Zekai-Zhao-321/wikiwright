// docs/concepts.md §Findings and routing — the RUNTIME half of the law. The
// verdict table holds it statically (verdict-table.test.ts); this file holds
// every finding the engine actually emits on every corpus in the repository,
// plus the paths that reach the envelope from outside the rule rows: the
// frontmatter parse codes and `check`'s own rows. A finding that reaches the
// envelope carrying neither `fix` nor `queue` is a class-B hole.

import { afterAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERDICT_TABLE } from "@wikiwright/core";
import { V2_CORPORA } from "./fixtures/corpora.ts";
import { cleanBundles, cli, type Envelope, gardenBundle } from "./fixtures/garden-cli.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const LANES = new Set(VERDICT_TABLE.map((row) => row.lane).filter((l) => l !== undefined));

afterAll(() => {
  cleanBundles();
});

/** Every error and warning names exactly one of a lane and a fix; an info names neither. */
function assertRouted(envelope: Envelope, where: string): number {
  const findings = envelope.data?.findings ?? [];
  for (const f of findings) {
    const routes = (f.fix === undefined ? 0 : 1) + (f.queue === undefined ? 0 : 1);
    if (f.severity === "info") {
      assert.equal(routes, 0, `${where}: info finding ${f.rule} routes somewhere`);
      continue;
    }
    assert.equal(routes, 1, `${where}: ${f.rule} (${f.severity}) carries exactly one route`);
    if (f.queue !== undefined) assert.equal(LANES.has(f.queue), true, `${where}: ${f.queue}`);
    if (f.fix !== undefined) assert.equal(f.fix.argv.length > 0, true, `${where}: ${f.rule}`);
  }
  return findings.length;
}

describe("every emitted finding routes (docs/concepts.md §Findings and routing)", () => {
  let judged = 0;
  for (const corpus of V2_CORPORA) {
    it(`check --all over ${corpus}`, () => {
      judged += assertRouted(cli(["check", "--all"], join(REPO, corpus)).envelope, corpus);
    });
  }
  // A clean corpus produces nothing; the law is about findings that exist,
  // so the corpora together must produce some.
  it("the corpora produced findings to judge", () => {
    assert.equal(judged > 0, true, `${judged} finding(s) across ${V2_CORPORA.length} corpora`);
  });

  it("the parse seam's own codes route: malformed frontmatter and a duplicate key", () => {
    const dir = gardenBundle({
      "wiki/Broken.md": "---\ntype: planting\n  bad: [unclosed\n---\nbody\n",
      "wiki/Doubled.md": "---\ntype: guide\ntitle: Doubled\ntitle: Doubled\n---\nbody\n",
    });
    const envelope = cli(["check", "--all"], dir).envelope;
    const ids = new Set((envelope.data?.findings ?? []).map((f) => f.rule));
    assert.equal(
      ids.has("malformed-frontmatter") || ids.has("frontmatter-not-mapping"),
      true,
      `the parse seam fired: ${[...ids].join(", ")}`,
    );
    assert.equal(ids.has("duplicate-key"), true, `duplicate-key fired: ${[...ids].join(", ")}`);
    assertRouted(envelope, "parse codes");
  });

  it("check's own rows route: okf-missing-type and generated-drift", () => {
    const dir = gardenBundle({ "wiki/NoType.md": "---\ntitle: NoType\n---\nbody\n" });
    const envelope = cli(["check", "--all"], dir).envelope;
    const ids = new Set((envelope.data?.findings ?? []).map((f) => f.rule));
    assert.equal(ids.has("okf-missing-type"), true, `okf fired: ${[...ids].join(", ")}`);
    assert.equal(ids.has("generated-drift"), true, `drift fired: ${[...ids].join(", ")}`);
    assertRouted(envelope, "check");
  });
});
