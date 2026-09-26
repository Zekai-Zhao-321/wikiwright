// v2 contracts §4: the fixed grammar's three spellings, one canonical form
// each, parsed into records the engine's JSON Schemas hold.
import { describe, expect, it } from "bun:test";
import {
  claimHandle,
  parseClaimLine,
  parseEntryLine,
  parseRelationLine,
  RECORD_SCHEMAS,
} from "../src/index.ts";
import { claimHandle as oldClaimHandle } from "../src/stdlib/claims-parse.ts";

const ROOTS = ["raw"];
const claim = (line: string) => parseClaimLine(line, ROOTS);

describe("claims", () => {
  it("parse the category, the core and a provenance of each kind", () => {
    expect(claim("- [observed] Basil bolts above 30 degrees. ([[Growing basil]])")).toEqual({
      record: {
        kind: "claim",
        handle: claimHandle("Basil bolts above 30 degrees."),
        category: "observed",
        core: "Basil bolts above 30 degrees.",
        provenance: { kind: "page", value: "Growing basil" },
        retracted: null,
        superseded: null,
      },
    });
    const url = claim("- [measured] Forty leaves a week. (https://seeds.example/basil)");
    expect("record" in url && url.record.provenance).toEqual({
      kind: "url",
      value: "https://seeds.example/basil",
    });
    const path = claim("- [measured] Forty leaves a week. (raw/logbook/2026.md)");
    expect("record" in path && path.record.provenance).toEqual({
      kind: "path",
      value: "raw/logbook/2026.md",
    });
    const none = claim("- [advice] Pinch the tips.");
    expect("record" in none && none.record.provenance).toEqual({ kind: "none", value: null });
  });

  it("keep any other trailing parenthetical as core text", () => {
    for (const [line, core] of [
      ["- [advice] Water at dawn (not dusk)", "Water at dawn (not dusk)"],
      ["- [advice] Mulch (wiki/mulch.md)", "Mulch (wiki/mulch.md)"],
      ["- [advice] Stake it (raw/../secrets)", "Stake it (raw/../secrets)"],
      ["- [advice] Net it (raw)", "Net it (raw)"],
    ] as const) {
      const parsed = claim(line);
      expect("record" in parsed && [parsed.record.core, parsed.record.provenance.kind]).toEqual([
        core,
        "none",
      ]);
    }
  });

  it("read today's lifecycle clause, last, in its one spelling", () => {
    const retracted = claim(
      "- [observed] Slugs avoid copper. ([[Slug notes]]) (retracted 2026-05-01)",
    );
    expect("record" in retracted && retracted.record).toMatchObject({
      core: "Slugs avoid copper.",
      provenance: { kind: "page", value: "Slug notes" },
      retracted: { date: "2026-05-01" },
      superseded: null,
    });
    const superseded = claim(
      "- [observed] Beans need six weeks. (valid 2026-03-01→2026-04-30, superseded 2026-05-01)",
    );
    expect("record" in superseded && superseded.record.superseded).toEqual({
      date: "2026-05-01",
      by: null,
      valid_from: "2026-03-01",
      valid_to: "2026-04-30",
    });
    const open = claim(
      "- [observed] Beans need six weeks. (valid →2026-04-30, superseded 2026-05-01)",
    );
    expect("record" in open && open.record.superseded?.valid_from).toBe(null);
    // Ruling 5: the claim that replaced it, by handle, optionally.
    const named = claim(
      "- [observed] Beans need six weeks. (valid 2026-03-01→2026-04-30, superseded 2026-05-01 by #0a1b2c3d)",
    );
    expect("record" in named && named.record.superseded).toEqual({
      date: "2026-05-01",
      by: "#0a1b2c3d",
      valid_from: "2026-03-01",
      valid_to: "2026-04-30",
    });
  });

  it("refuse every other variant of the lifecycle clause", () => {
    for (const line of [
      "- [observed] Beans need six weeks. (superseded 2026-05-01)",
      "- [observed] Beans need six weeks. (valid 2026-03-01 -> 2026-04-30, superseded 2026-05-01)",
      "- [observed] Beans need six weeks. (valid 2026-03-01→2026-04-30) (superseded 2026-05-01)",
      "- [observed] Beans need six weeks. (Retracted 2026-05-01)",
      "- [observed] Beans need six weeks. (retracted 2026-5-1)",
      "- [observed] Beans need six weeks. (retracted 2026-02-30)",
      "- [observed] Beans need six weeks. (retracted 2026-05-01) ([[Bean notes]])",
      "- [observed] Beans need six weeks. (valid →2026-04-30, superseded 2026-05-01 by 0a1b2c3d)",
      "- [observed] Beans need six weeks. (valid →2026-04-30, superseded 2026-05-01 by #0A1B2C3D)",
      "- [observed] Beans need six weeks. (valid →2026-04-30, superseded 2026-05-01 by #0a1b2c)",
      "- [observed] Beans need six weeks. (valid →2026-04-30, superseded 2026-05-01 by [[Beans]])",
    ]) {
      expect("reason" in claim(line)).toBe(true);
    }
  });

  it("keep a parenthetical that only opens with a lifecycle word as core text", () => {
    const neighbours: [string, string][] = [
      [
        "- [advice] Sow broad beans in March (valid for zone 7)",
        "Sow broad beans in March (valid for zone 7)",
      ],
      [
        "- [advice] Sow broad beans in March (Valid only under glass) ([[Sowing]])",
        "Sow broad beans in March (Valid only under glass)",
      ],
      [
        "- [observed] The old variety failed (superseded by hybrids)",
        "The old variety failed (superseded by hybrids)",
      ],
      [
        "- [observed] The trial ran (retracted in 2026) (raw/trial.md)",
        "The trial ran (retracted in 2026)",
      ],
    ];
    for (const [line, core] of neighbours) {
      const parsed = claim(line);
      expect("record" in parsed && parsed.record.core).toBe(core);
      expect("record" in parsed && [parsed.record.retracted, parsed.record.superseded]).toEqual([
        null,
        null,
      ]);
    }
  });

  it("refuse a line that is not a claim", () => {
    for (const line of [
      "- observed: basil",
      "- [] basil",
      "- [observed]",
      "* [observed] basil",
      "- [x]basil",
    ]) {
      expect("reason" in claim(line)).toBe(true);
    }
  });

  it("keep today's handle: # and eight hex digits of the normalised core's sha256", () => {
    for (const core of ["Basil bolts above 30 degrees.", "ÉCHALOTE", "韭菜 grows back"]) {
      expect(claimHandle(core)).toBe(oldClaimHandle(core));
    }
  });
});

describe("relations", () => {
  const resolve = (name: string) =>
    name === "Herb bed" ? { path: "wiki/herb-bed.md", type: "garden/bed" } : undefined;

  it("parse a target, a heading and an alias, resolved through the vault", () => {
    expect(parseRelationLine("- grows-in [[Herb bed]]", resolve)).toEqual({
      record: {
        kind: "relation",
        label: "grows-in",
        target: {
          name: "Herb bed",
          heading: null,
          alias: null,
          path: "wiki/herb-bed.md",
          resolved: true,
          type: "garden/bed",
        },
      },
    });
    const both = parseRelationLine("- companion-of [[Tomato#Spacing|tomatoes]]", resolve);
    expect("record" in both && both.record.target).toEqual({
      name: "Tomato",
      heading: "Spacing",
      alias: "tomatoes",
      path: null,
      resolved: false,
      type: null,
    });
  });

  it("refuse any other spelling", () => {
    for (const line of [
      "- grows-in Herb bed",
      "- grows in [[Herb bed]]",
      "- grows-in [[Herb bed]] since May",
      "- [[Herb bed]]",
      "-grows-in [[Herb bed]]",
    ]) {
      expect("reason" in parseRelationLine(line, resolve)).toBe(true);
    }
  });
});

describe("entries", () => {
  it("parse three precisions, the separator ` — ` exactly", () => {
    expect(parseEntryLine("- 2026-04-12 — sown")).toEqual({
      record: { kind: "entry", date: "2026-04-12", precision: "day", text: "sown" },
    });
    const month = parseEntryLine("- 2026-05 — thinned");
    expect("record" in month && [month.record.date, month.record.precision]).toEqual([
      "2026-05",
      "month",
    ]);
    const year = parseEntryLine("- 2026 — first season");
    expect("record" in year && year.record.precision).toBe("year");
  });

  it("refuse any other spelling and a date off the calendar", () => {
    for (const line of [
      "- 2026-04-12 - sown",
      "- 2026-04-12: sown",
      "- 2026-04-12 —sown",
      "- 2026-4-12 — sown",
      "- 2026-13 — sown",
      "- 2026-02-30 — sown",
      "- 12 April 2026 — sown",
    ]) {
      expect("reason" in parseEntryLine(line)).toBe(true);
    }
  });
});

describe("the record schemas", () => {
  it("are the three the contract names", () => {
    expect(Object.keys(RECORD_SCHEMAS)).toEqual(["item-claim", "item-relation", "item-entry"]);
  });
});
