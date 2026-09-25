// docs/cli.md §write: `--replace-core` on a claim dated the same day closes it
// with a zero-length interval, `valid D→D, superseded D`, where it used to be
// refused because `D→D-1` would run backwards; a date before the claim's own
// is still refused. On a temporary gardening claims bundle.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claimHandle } from "@wikiwright/core";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { claimsBundle } from "./fixtures/garden-claims.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const PAGE = "wiki/Climbing rose.md";
/** The rose's one [care] claim, stated 2026-03-10: a supersede category. */
const CARE = "Tie the long canes in along the support in autumn";

function run(
  root: string,
  argv: readonly string[],
  input = "",
): { status: number; envelope: Record<string, unknown> } {
  const r = runCli([CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
    input,
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function replace(root: string, date: string, claim: string) {
  return run(
    root,
    ["write", PAGE, "--section", "Facts", "--replace-core", claimHandle(CARE), "--date", date],
    `${claim}\n`,
  );
}

let tmp = "";
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ww-same-day-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("a claim superseded on its own date (docs/cli.md §write)", () => {
  it("lands with a zero-length interval, and the page lints clean", () => {
    const root = claimsBundle(join(tmp, "same-day"));
    const r = replace(
      root,
      "2026-03-10",
      "- [care] Tie the long canes in along the support in early spring (stated 2026-03-10)",
    );
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    const text = readFileSync(join(root, PAGE), "utf8");
    assert.match(
      text,
      /^## History\n\n- \[care\] Tie the long canes in along the support in autumn \(stated 2026-03-10\) \(valid 2026-03-10→2026-03-10, superseded 2026-03-10\)$/mu,
    );
    assert.match(
      text,
      /^- \[care\] Tie the long canes in along the support in early spring \(stated 2026-03-10\)$/mu,
    );
    assert.equal(run(root, ["lint", "--page", PAGE]).status, 0);
  });

  it("a later date closes the interval on the day before, as it always has", () => {
    const root = claimsBundle(join(tmp, "later"));
    const r = replace(
      root,
      "2026-09-04",
      "- [care] Tie the long canes in along the support in early spring (stated 2026-09-04)",
    );
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    assert.match(
      readFileSync(join(root, PAGE), "utf8"),
      /\(valid 2026-03-10→2026-09-03, superseded 2026-09-04\)$/mu,
    );
  });

  it("a date before the claim's own is refused: that interval would run backwards", () => {
    const root = claimsBundle(join(tmp, "earlier"));
    const r = replace(
      root,
      "2026-03-09",
      "- [care] Tie the long canes in along the support in early spring (stated 2026-03-09)",
    );
    assert.equal(r.status, 4, JSON.stringify(r.envelope));
    assert.equal((r.envelope["error"] as { code: string }).code, "date-before-claim");
  });
});
