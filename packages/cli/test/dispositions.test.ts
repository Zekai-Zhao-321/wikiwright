// v2 contracts §1: the disposition table has one generator, and every rule
// id, constitution key and engine key of the old tree has exactly one row.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dispositionProblems, renderDispositions } from "../../../tools/dispositions.ts";

const DOC = fileURLToPath(new URL("../../../docs/v2-dispositions.md", import.meta.url));
const CHANGELOG = fileURLToPath(new URL("../../../CHANGELOG.md", import.meta.url));

describe("docs/v2-dispositions.md", () => {
  it("gives every enumerated id one row, and no row to an id the old tree lacks", () => {
    expect(dispositionProblems()).toEqual([]);
  });

  it("is what the generator renders", () => {
    expect(readFileSync(DOC, "utf8")).toBe(renderDispositions());
  });

  it("lists every dropped v1 id and key in the changelog", () => {
    const table = readFileSync(DOC, "utf8");
    const changelog = readFileSync(CHANGELOG, "utf8");
    const dropped = [...table.matchAll(/^\| `([^`]+)` \| dropped \|/gmu)].map((match) => match[1]);
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped.filter((id) => !changelog.includes(`\`${id}\``))).toEqual([]);
  });
});
