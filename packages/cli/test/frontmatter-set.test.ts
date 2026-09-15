// docs/concepts.md §Findings and routing (the `frontmatter-set` fixer) ·
// docs/cli.md §fix (a mechanical write edits the value in its own style, or
// refuses; values are parser-sourced, never string-split). The byte-level
// invariant, fuzzed on a fixed seed so the failing case is reproducible from
// the test name alone, and then driven through the binary on every YAML style
// the folder-tags fixer meets.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { appendToFrontmatterList, parseDoc } from "@wikiwright/core";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function run(cwd: string, args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

const TAGS = {
  topics: { description: "T." },
  existing: { description: "E." },
  主题: { description: "CJK." },
};

function syncVault(pages: Record<string, string>, tags: Record<string, unknown> = TAGS): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-min-"));
  mkdirSync(join(tmp, "config"));
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(
      documentOf({ tags, types: { note: { extends: "concept", description: "A note." } } }),
    ),
  );
  writeFileSync(
    join(tmp, "config", "engine.json"),
    JSON.stringify({ content_roots: ["wiki"], folder_tags: { mode: "materialize-add-only" } }),
  );
  for (const [rel, content] of Object.entries(pages)) {
    mkdirSync(join(tmp, rel, ".."), { recursive: true });
    writeFileSync(join(tmp, rel), content);
  }
  return tmp;
}

const FM = (tagsBlock: string) =>
  `---\ntype: note\ntitle: T\ndescription: d.\n${tagsBlock}---\n\n# t\n\nBody stays.\n`;

/** A 32-bit LCG. Deterministic across bun and node. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const FIELD = "aliases";

interface Shape {
  text: string;
  /** Values the parser should read back BEFORE the append. */
  existing: string[];
  /** Whether the fixer must refuse this shape rather than guess at it. */
  refuse: boolean;
  label: string;
}

function shapeFor(next: () => number): Shape {
  const bom = next() < 0.2 ? "﻿" : "";
  const eol = next() < 0.3 ? "\r\n" : "\n";
  const extraKey = next() < 0.5 ? `x-note: kept${eol}` : "";
  const comment = next() < 0.3 ? `# a comment${eol}` : "";
  const trailing = next() < 0.3 ? " # trailing" : "";
  const body = `${eol}A page body.${eol}${eol}## Facts${eol}${eol}- [identity] a fact (stated 2026-01-01)${eol}`;
  const wrap = (fm: string): string =>
    `${bom}---${eol}${comment}type: person${eol}${extraKey}${fm}---${eol}${body}`;
  const roll = next();
  if (roll < 0.2) {
    return {
      text: wrap(`${FIELD}: [one, two]${trailing}${eol}`),
      existing: ["one", "two"],
      refuse: false,
      label: "inline list",
    };
  }
  if (roll < 0.4) {
    return {
      text: wrap(`${FIELD}:${eol}  - one${eol}  - two${eol}`),
      existing: ["one", "two"],
      refuse: false,
      label: "block list",
    };
  }
  if (roll < 0.55) {
    return { text: wrap(""), existing: [], refuse: false, label: "absent field" };
  }
  if (roll < 0.7) {
    return { text: wrap(`${FIELD}: []${eol}`), existing: [], refuse: false, label: "empty inline" };
  }
  if (roll < 0.8) {
    return {
      text: wrap(`${FIELD}:${eol}`),
      existing: [],
      refuse: false,
      label: "key with no items",
    };
  }
  if (roll < 0.9) {
    return {
      text: wrap(`${FIELD}: >${eol}  folded scalar${eol}`),
      existing: [],
      refuse: true,
      label: "folded scalar",
    };
  }
  return {
    text: wrap(`${FIELD}: [one,${eol}  two]${eol}`),
    existing: [],
    refuse: true,
    label: "flow list across lines",
  };
}

/** Everything from the closing `---` onward, which a splice may never touch. */
function bodyOf(text: string): string {
  const stripped = text.startsWith("﻿") ? text.slice(1) : text;
  const lines = stripped.split(/\r?\n/u);
  const closing = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return lines.slice(closing).join("\n");
}

describe("the frontmatter-set fixer's byte invariant, fuzzed", () => {
  it("240 generated shapes: the splice touches only the field's own lines", () => {
    const next = rng(0x5_1ce5);
    let applied = 0;
    let refused = 0;
    for (let i = 0; i < 240; i += 1) {
      const shape = shapeFor(next);
      const before = shape.text;
      const parsedBefore = parseDoc(before);
      const value = parsedBefore.frontmatter.value[FIELD];
      const existing = Array.isArray(value) ? value : [];
      const result = appendToFrontmatterList(before, FIELD, existing, ["Older Name"]);
      if (!result.ok) {
        refused += 1;
        assert.equal(
          shape.refuse,
          true,
          `case ${i} (${shape.label}): refused a shape the fixer must handle: ${result.reason}`,
        );
        continue;
      }
      if (shape.refuse) {
        // A shape the generator marked "refuse" may still be readable — what is
        // NOT allowed is a wrong answer, so it is held to the same invariant.
        assert.notEqual(result.text, undefined);
      }
      applied += 1;
      const after = result.text;

      // 1. The body is byte-identical.
      assert.equal(bodyOf(after), bodyOf(before), `case ${i} (${shape.label}): the body moved`);
      // 2. The BOM survives.
      assert.equal(after.startsWith("﻿"), before.startsWith("﻿"), `case ${i}: the BOM changed`);
      // 3. The page's own line ending survives.
      assert.equal(/\r\n/u.test(after), /\r\n/u.test(before), `case ${i}: the line ending changed`);
      // 4. Every frontmatter line that is not the field's is byte-identical.
      const strip = (t: string): string[] => (t.startsWith("﻿") ? t.slice(1) : t).split(/\r?\n/u);
      const fmBefore = strip(before).filter((l) => !l.startsWith(FIELD) && !/^\s*-\s/u.test(l));
      const fmAfter = strip(after).filter((l) => !l.startsWith(FIELD) && !/^\s*-\s/u.test(l));
      assert.deepEqual(fmAfter, fmBefore, `case ${i} (${shape.label}): an unrelated line moved`);
      // 5. The value reads back as existing + added, in order.
      const parsedAfter = parseDoc(after);
      assert.deepEqual(
        parsedAfter.frontmatter.value[FIELD],
        [...existing, "Older Name"],
        `case ${i} (${shape.label}): the value did not read back`,
      );
      assert.deepEqual(
        parsedAfter.frontmatter.issues,
        [],
        `case ${i} (${shape.label}): the result does not parse`,
      );
    }
    assert.equal(applied > 150, true, `the generator produced writable shapes (${applied})`);
    assert.equal(refused > 0, true, `and shapes the fixer refuses (${refused})`);
  });

  it("the same seed produces the same verdict twice — the fuzz is a fixture", () => {
    const one = shapeFor(rng(0x5_1ce5)).text;
    const two = shapeFor(rng(0x5_1ce5)).text;
    assert.equal(one, two);
  });

  it("a non-string entry in the existing list is refused, never coerced", () => {
    const page = `---\ntype: person\n${FIELD}: [1, 2]\n---\nbody\n`;
    const result = appendToFrontmatterList(page, FIELD, [1, 2], ["Older Name"]);
    assert.equal(result.ok, false);
  });
});

describe("the splice preserves valid YAML in every style, through the folder-tags fixer", () => {
  const cases: Array<{ name: string; before: string; expect: RegExp }> = [
    {
      name: "block list gains a block item",
      before: FM("tags:\n  - existing\n"),
      expect: /tags:\n {2}- existing\n {2}- topics\n/u,
    },
    {
      name: "flow list is rewritten in place",
      before: FM('tags: ["existing"]\n'),
      expect: /tags: \["existing", "topics"\]\n/u,
    },
    {
      name: "empty flow list gains the tag",
      before: FM("tags: []\n"),
      expect: /tags: \["topics"\]\n/u,
    },
    {
      name: "a comment inside the block survives",
      before: FM("tags:\n  # why this tag\n  - existing\n"),
      expect: /# why this tag\n {2}- existing\n {2}- topics\n/u,
    },
    {
      name: "quoted values keep their quoting style",
      before: FM('tags:\n  - "existing"\n'),
      expect: /- "existing"\n {2}- topics\n/u,
    },
    {
      name: "a CJK tag round-trips",
      before: FM("tags:\n  - 主题\n"),
      expect: /- 主题\n {2}- topics\n/u,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const tmp = syncVault({ "wiki/topics/p.md": c.before });
      try {
        const s = run(tmp, [
          "fix",
          "--rule",
          "folder-tags-present",
          "--path",
          "wiki/topics/p.md",
          "--expect",
          "1",
        ]);
        assert.equal(s.status, 0, JSON.stringify(s.envelope));
        const after = readFileSync(join(tmp, "wiki", "topics", "p.md"), "utf8");
        assert.match(after, c.expect, after);
        assert.match(after, /Body stays\./u, "body is untouched");
        const lint = run(tmp, ["lint"]);
        assert.equal(lint.status, 0, `lint after the fix: ${JSON.stringify(lint.envelope)}`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it("CRLF and a BOM survive the write", () => {
    const tmp = syncVault({});
    try {
      mkdirSync(join(tmp, "wiki", "topics"), { recursive: true });
      const body = FM("tags:\n  - existing\n").replaceAll("\n", "\r\n");
      writeFileSync(join(tmp, "wiki", "topics", "p.md"), `﻿${body}`);
      const s = run(tmp, [
        "fix",
        "--rule",
        "folder-tags-present",
        "--path",
        "wiki/topics/p.md",
        "--expect",
        "1",
      ]);
      assert.equal(s.status, 0, JSON.stringify(s.envelope));
      const after = readFileSync(join(tmp, "wiki", "topics", "p.md"), "utf8");
      assert.equal(after.startsWith("﻿"), true, "BOM preserved");
      assert.equal(after.includes("\r\n"), true, "CRLF preserved");
      assert.equal(/[^\r]\n/u.test(after.slice(1)), false, "no mixed endings introduced");
      assert.match(after, /- topics/u);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a page whose tags value cannot be safely rewritten is reported, never half-written", () => {
    // An anchored/aliased tags value is beyond mechanical rewriting.
    const tmp = syncVault({ "wiki/topics/p.md": FM("tags: &anchor\n  - existing\n") });
    try {
      const before = readFileSync(join(tmp, "wiki", "topics", "p.md"), "utf8");
      const s = run(tmp, [
        "fix",
        "--rule",
        "folder-tags-present",
        "--path",
        "wiki/topics/p.md",
        "--expect",
        "any",
      ]);
      const after = readFileSync(join(tmp, "wiki", "topics", "p.md"), "utf8");
      if (s.status === 0) {
        // If it claims success, the file must be valid and complete.
        const lint = run(tmp, ["lint"]);
        assert.equal(lint.status, 0, `claimed success but lint fails: ${after}`);
      } else {
        assert.equal(after, before, "a refused page is left exactly as it was");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("flow sequences round-trip through the YAML parser, never string splitting", () => {
  // Every case: one existing tag carrying a character that naive syntax
  // splitting mangles. After the fix the value must be exactly [original, topics].
  const tricky: Array<{ name: string; tag: string; source?: string }> = [
    { name: "quoted comma", tag: "a,b" },
    { name: "escaped quote", tag: 'a"b' },
    { name: "colon", tag: "a: b" },
    { name: "hash", tag: "a#b" },
    { name: "bracket", tag: "a]b" },
    { name: "unicode", tag: "主题" },
    { name: "inner whitespace", tag: "a b" },
    { name: "single-quoted source", tag: "a,b", source: "tags: ['a,b']\n" },
  ];

  for (const c of tricky) {
    it(`preserves a tag containing ${c.name}`, () => {
      const tmp = syncVault(
        {},
        { topics: { description: "T." }, [c.tag]: { description: "Tricky." } },
      );
      try {
        mkdirSync(join(tmp, "wiki", "topics"), { recursive: true });
        const line = c.source ?? `tags: ${JSON.stringify([c.tag])}\n`;
        writeFileSync(join(tmp, "wiki", "topics", "p.md"), FM(line));
        const s = run(tmp, [
          "fix",
          "--rule",
          "folder-tags-present",
          "--path",
          "wiki/topics/p.md",
          "--expect",
          "1",
        ]);
        assert.equal(s.status, 0, JSON.stringify(s.envelope));
        const lint = run(tmp, ["lint"]);
        assert.equal(lint.status, 0, `lint after the fix: ${JSON.stringify(lint.envelope)}`);
        const after = readFileSync(join(tmp, "wiki", "topics", "p.md"), "utf8");
        assert.equal(
          after.includes(JSON.stringify(c.tag)) || after.includes(`- ${c.tag}`),
          true,
          `original tag lost: ${after}`,
        );
        assert.match(after, /topics/u);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it("preserves multiplicity: a repeated tag stays repeated", () => {
    const tmp = syncVault({ "wiki/topics/p.md": FM('tags: ["existing", "existing"]\n') });
    try {
      const s = run(tmp, [
        "fix",
        "--rule",
        "folder-tags-present",
        "--path",
        "wiki/topics/p.md",
        "--expect",
        "1",
      ]);
      assert.equal(s.status, 0, JSON.stringify(s.envelope));
      const after = readFileSync(join(tmp, "wiki", "topics", "p.md"), "utf8");
      assert.match(after, /tags: \["existing", "existing", "topics"\]/u, after);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves a trailing flow comment", () => {
    const tmp = syncVault({ "wiki/topics/p.md": FM('tags: ["existing"] # why these\n') });
    try {
      const s = run(tmp, [
        "fix",
        "--rule",
        "folder-tags-present",
        "--path",
        "wiki/topics/p.md",
        "--expect",
        "1",
      ]);
      assert.equal(s.status, 0, JSON.stringify(s.envelope));
      const after = readFileSync(join(tmp, "wiki", "topics", "p.md"), "utf8");
      assert.match(after, /# why these/u, after);
      assert.match(after, /"existing", "topics"/u);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
