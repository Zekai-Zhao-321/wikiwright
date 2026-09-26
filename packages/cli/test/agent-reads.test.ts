// docs/cli.md §type, §new, §vocabulary: three answers as an agent reads them.
// `type show --brief` leads with the brief, the skeleton and the section lines;
// `new` writes no `title:` that would only repeat the name where the bundle
// derives the title from the basename; `vocabulary show` names its entries in
// one sorted list. On copies
// of the orchard handbook and a temporary gardening claims bundle.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { claimsBundle } from "./fixtures/garden-claims.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const ORCHARD = fileURLToPath(new URL("../../../fixtures/v1/handbooks/orchard", import.meta.url));

function run(
  root: string,
  argv: readonly string[],
): { status: number; data: Record<string, unknown> } {
  const r = runCli([CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  const envelope = JSON.parse(r.stdout) as { data?: Record<string, unknown> };
  return { status: r.status ?? -1, data: envelope.data ?? {} };
}

let tmp = "";
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ww-agent-reads-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("type show --brief leads with what a writer reads first (docs/cli.md §type)", () => {
  it("brief, skeleton and section_lines come before fields; without --brief the order is as it was", () => {
    const brief = run(ORCHARD, ["type", "show", "procedure-page", "--brief"]);
    assert.equal(brief.status, 0);
    const keys = Object.keys(brief.data);
    assert.deepEqual(keys.slice(0, 3), ["brief", "skeleton", "section_lines"]);
    assert.ok(keys.indexOf("fields") > 2, keys.join(", "));
    assert.match(String(brief.data["skeleton"]), /^# <title>\n\n## Steps\n$/u);
    const plain = run(ORCHARD, ["type", "show", "procedure-page"]);
    assert.deepEqual(Object.keys(plain.data), [
      "name",
      "status",
      "description",
      "chain",
      "archetype",
      "fields",
      "checks",
      "sections",
      "use_when",
      "avoid_when",
      "fragments",
      "abstract",
      "vocabularies",
      "section_lines",
    ]);
  });
});

describe("new under a basename-derived title (docs/cli.md §new)", () => {
  it("writes no title: when the title is the name, keeps the H1, and keeps a title that differs", () => {
    const root = join(tmp, "derived");
    cpSync(ORCHARD, root, { recursive: true });
    writeFileSync(
      join(root, "config", "engine.json"),
      `${JSON.stringify({
        content_roots: ["wiki"],
        field_sources: { title: "basename", description: "lede" },
      })}\n`,
    );
    const made = run(root, [
      "new",
      "procedure-page",
      "Mulching beds",
      "--dest",
      "wiki/Mulching beds.md",
      "--set",
      "applies_to=temperate",
    ]);
    assert.equal(made.status, 0, JSON.stringify(made.data));
    const text = readFileSync(join(root, "wiki", "Mulching beds.md"), "utf8");
    assert.doesNotMatch(text, /^title:/mu);
    assert.match(text, /^# Mulching beds$/mu);
    const read = run(root, ["read", "wiki/Mulching beds.md"]);
    assert.equal((read.data["page"] as { title: string }).title, "Mulching beds");
    assert.equal(run(root, ["lint", "--page", "wiki/Mulching beds.md"]).status, 0);

    // A title that differs from the name is the caller's, and is written.
    const other = run(root, [
      "new",
      "procedure-page",
      "Spreading compost",
      "--dest",
      "wiki/compost.md",
      "--set",
      "applies_to=temperate",
    ]);
    assert.equal(other.status, 0, JSON.stringify(other.data));
    assert.match(
      readFileSync(join(root, "wiki", "compost.md"), "utf8"),
      /^title: "Spreading compost"$/mu,
    );
  });

  it("writes title: where nothing derives it", () => {
    const root = join(tmp, "stated");
    cpSync(ORCHARD, root, { recursive: true });
    const made = run(root, [
      "new",
      "procedure-page",
      "Mulching beds",
      "--dest",
      "wiki/mulching-beds.md",
      "--set",
      "applies_to=temperate",
    ]);
    assert.equal(made.status, 0, JSON.stringify(made.data));
    assert.match(
      readFileSync(join(root, "wiki", "mulching-beds.md"), "utf8"),
      /^title: "Mulching beds"$/mu,
    );
  });
});

describe("vocabulary show names its entries (docs/cli.md §vocabulary)", () => {
  it("data.names is every entry name, sorted", () => {
    const garden = claimsBundle(join(tmp, "vocabulary"));
    assert.deepEqual(run(garden, ["vocabulary", "show", "categories"]).data["names"], [
      "bloom",
      "care",
      "pest",
    ]);
    assert.deepEqual(run(ORCHARD, ["vocabulary", "show", "tags"]).data["names"], [
      "fruit",
      "orientation",
      "pruning",
    ]);
  });
});
