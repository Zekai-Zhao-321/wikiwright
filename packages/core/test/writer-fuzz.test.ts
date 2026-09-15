// docs/architecture.md §The invariants · docs/concepts.md The byte-level invariant is
// FUZZED, on one deterministic seed, so the failing case is reproducible from the
// case number alone and the same 300+ cases run on every runner and both engines.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyWrite, parseDoc, type WriteOp } from "@wikiwright/core";

/** A 32-bit LCG — deterministic across bun and node. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const SEED = 0x5_11ce_07;
const CASES = 320;

interface Case {
  text: string;
  bom: boolean;
  eol: string;
  endsWithEol: boolean;
  /** Sections present, in order, with their depth. */
  sections: { heading: string; depth: number }[];
  aliases: string[];
  /** The frontmatter shape is one a splice must refuse. */
  refuseFrontmatter: boolean;
  label: string;
}

const SECTION_POOL = ["Facts", "Relations", "Timeline", "Notes", "History"];

function generate(next: () => number, index: number): Case {
  const bom = next() < 0.25;
  const eol = next() < 0.35 ? "\r\n" : "\n";
  const endsWithEol = next() < 0.75;
  const roll = next();
  let aliases: string[] = [];
  let refuseFrontmatter = false;
  let fmLines: string[];
  let label: string;
  if (roll < 0.18) {
    fmLines = ["type: person", "aliases: [one, two]"];
    aliases = ["one", "two"];
    label = "inline list";
  } else if (roll < 0.36) {
    fmLines = ["type: person", "aliases:", "  - one", "  - two"];
    aliases = ["one", "two"];
    label = "block list";
  } else if (roll < 0.5) {
    fmLines = ["type: person"];
    label = "absent field";
  } else if (roll < 0.62) {
    fmLines = ["type: person", "aliases: []"];
    label = "empty inline";
  } else if (roll < 0.72) {
    fmLines = ["# a comment", "type: person", "aliases: [one]"];
    aliases = ["one"];
    label = "comment above";
  } else if (roll < 0.82) {
    fmLines = ["type: person", 'title: "Chen Jing"', "aliases: [one] # trailing"];
    aliases = ["one"];
    label = "trailing comment";
  } else if (roll < 0.91) {
    fmLines = ["type: person", "aliases: [one]", "aliases: [two]"];
    aliases = ["two"];
    refuseFrontmatter = true;
    label = "duplicated key";
  } else {
    fmLines = ["type: person", "aliases: |", "  folded"];
    refuseFrontmatter = true;
    label = "folded scalar";
  }

  const count = 1 + Math.floor(next() * 4);
  const sections: { heading: string; depth: number }[] = [];
  const body: string[] = [""];
  if (next() < 0.4) body.push("A lede paragraph.", "");
  for (let i = 0; i < count; i += 1) {
    const heading = SECTION_POOL[i] ?? `Extra${i}`;
    const depth = next() < 0.2 ? 3 : 2;
    sections.push({ heading, depth });
    body.push(`${"#".repeat(depth)} ${heading}`, "");
    const items = Math.floor(next() * 3);
    for (let k = 0; k < items; k += 1) {
      const shape = next();
      if (shape < 0.4) body.push(`- [identity] fact ${i}.${k} (stated 2026-01-0${1 + (k % 9)})`);
      else if (shape < 0.7) body.push(`- knows [[Target ${i}${k}]]`);
      else body.push(`- 2026-0${1 + (k % 9)}-01 — an entry ${i}.${k}`);
      if (next() < 0.3) body.push(`  - a rationale line for ${i}.${k}`);
    }
    if (next() < 0.3) body.push("", "Some prose inside the section.");
    body.push("");
    if (next() < 0.15) body.push("", "");
  }
  if (next() < 0.15) body.push("---", "");

  const all = ["---", ...fmLines, "---", ...body];
  // The declared trailing-newline state must be the text's: an array ending in
  // "" already joins to a trailing newline, so the tail is trimmed first.
  while (all.length > 0 && all[all.length - 1] === "") all.pop();
  const joined = all.join(eol) + (endsWithEol ? eol : "");
  return {
    text: (bom ? "﻿" : "") + joined,
    bom,
    eol,
    endsWithEol,
    sections,
    aliases,
    refuseFrontmatter,
    label: `${index}:${label}`,
  };
}

function bodyLines(text: string): string[] {
  return text.replace(/^﻿/u, "").split(/\r?\n/u);
}

/**
 * The splice invariant: every line outside the op's OUTPUT range equals the
 * input's line at its shifted index. Walks both arrays once with one offset,
 * which is exactly what "differs only inside the range" means in lines.
 */
function assertSpliceOnly(
  before: string,
  after: string,
  ranges: { from: number; to: number }[],
  consumed: { from: number; to: number }[],
  label: string,
): void {
  const b = bodyLines(before);
  const a = bodyLines(after);
  const keptBefore: string[] = [];
  const keptAfter: string[] = [];
  b.forEach((line, i) => {
    const n = i + 1;
    if (consumed.some((r) => n >= r.from && n <= r.to)) return;
    keptBefore.push(line);
  });
  a.forEach((line, i) => {
    const n = i + 1;
    if (ranges.some((r) => n >= r.from && n <= r.to)) return;
    keptAfter.push(line);
  });
  assert.deepEqual(keptAfter, keptBefore, `${label}: a line outside the op's range moved`);
}

function assertEnvelope(c: Case, text: string): void {
  assert.equal(text.startsWith("﻿"), c.bom, `${c.label}: BOM`);
  const body = text.replace(/^﻿/u, "");
  if (c.eol === "\r\n") {
    assert.equal(/\r\n/u.test(body), true, `${c.label}: CRLF lost`);
    assert.equal(/(?<!\r)\n/u.test(body), false, `${c.label}: a bare LF appeared`);
  } else {
    assert.equal(/\r/u.test(body), false, `${c.label}: a CR appeared`);
  }
  assert.equal(body.endsWith(c.eol), c.endsWithEol, `${c.label}: trailing newline`);
}

describe("the splice law, fuzzed (docs/architecture.md §The invariants)", () => {
  const next = rng(SEED);
  const cases: Case[] = [];
  for (let i = 0; i < CASES; i += 1) cases.push(generate(next, i));

  it(`generates ${CASES} cases from one seed, covering every shape`, () => {
    assert.equal(cases.length >= 300, true);
    const labels = new Set(cases.map((c) => c.label.split(":")[1]));
    assert.equal(labels.size >= 7, true, `only ${labels.size} frontmatter shapes generated`);
    assert.equal(
      cases.some((c) => c.bom && c.eol === "\r\n"),
      true,
    );
    assert.equal(
      cases.some((c) => !c.endsWithEol),
      true,
    );
  });

  it("every op kind splices only its own lines, on every case", () => {
    let applied = 0;
    let refused = 0;
    for (const c of cases) {
      const body = bodyLines(c.text);
      const target = c.sections[0];
      if (target === undefined) continue;
      const ops: WriteOp[] = [
        { kind: "append-section", heading: target.heading, lines: ["- [habit] appended"] },
        { kind: "insert", after: body.length - 1, lines: ["- [habit] inserted"] },
        { kind: "frontmatter-list", field: "aliases", existing: c.aliases, add: ["added"] },
      ];
      // A page with at least two body lines can have one replaced.
      const replaceAt = body.findIndex((l, i) => i > 0 && l.startsWith("- ["));
      if (replaceAt >= 0) {
        ops.push({
          kind: "replace",
          from: replaceAt + 1,
          to: replaceAt + 1,
          lines: ["- [identity] replaced (stated 2026-09-03)"],
        });
      }
      for (const op of ops) {
        const r = applyWrite(c.text, [op]);
        const mustRefuse = op.kind === "frontmatter-list" && c.refuseFrontmatter;
        if (!r.ok) {
          refused += 1;
          assert.equal(
            mustRefuse || op.kind === "frontmatter-list",
            true,
            `${c.label}: ${op.kind} refused unexpectedly: ${r.reason}`,
          );
          continue;
        }
        assert.equal(mustRefuse, false, `${c.label}: ${op.kind} should have refused`);
        assertSpliceOnly(c.text, r.text, r.ranges, r.consumed, `${c.label}/${op.kind}`);
        assertEnvelope(c, r.text);
        // The frontmatter still parses, and no new issue appeared.
        const beforeIssues = parseDoc(c.text).frontmatter.issues.length;
        assert.equal(
          parseDoc(r.text).frontmatter.issues.length,
          beforeIssues,
          `${c.label}/${op.kind}: a new frontmatter issue appeared`,
        );
        applied += 1;
      }
    }
    assert.equal(applied > 900, true, `only ${applied} ops applied`);
    assert.equal(refused > 0, true, "no refusal shape was exercised");
  });

  it("an appended value reads back as existing + added", () => {
    for (const c of cases) {
      if (c.refuseFrontmatter) continue;
      const r = applyWrite(c.text, [
        { kind: "frontmatter-list", field: "aliases", existing: c.aliases, add: ["added"] },
      ]);
      assert.equal(r.ok, true, c.label);
      if (!r.ok) continue;
      const value = parseDoc(r.text).frontmatter.value["aliases"];
      assert.deepEqual(value, [...c.aliases, "added"], c.label);
    }
  });
});
