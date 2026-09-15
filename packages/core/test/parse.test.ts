// docs/architecture.md §Directories determinism invariants (BOM/CRLF normalization) · docs/architecture.md
// (micromark/mdast behind the ParsedDoc seam; yaml strict frontmatter)
// docs/concepts.md §Findings and routing (headings, fences and wikilinks are the checker inputs)
//  (wikilink forms).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeInput, parseDoc } from "../src/parse/index.ts";

const LF_DOC = `---
type: test-case
title: Warm reset under load
tags: [reset, cycling]
x-owner: someone
---

# Warm reset under load

## Purpose

Verify [[热重启|warm reset]] recovery. See [[张伟]] and [[Fixture Page#Setup|setup]].

\`\`\`mermaid
graph TD; a-->b
\`\`\`

> ## Quoted heading

<!--
# Commented-out heading
-->

\`[[not-a-link]]\` stays inline code.

~~~text
\`\`\`
# heading inside fence
\`\`\`
~~~

[md link](https://example.com)
`;

describe("normalizeInput — the input-normalization invariant", () => {
  it("strips a UTF-8 BOM and reports it", () => {
    const r = normalizeInput("﻿---\ntype: concept\n---\n");
    assert.equal(r.hadBom, true);
    assert.equal(r.text.startsWith("---"), true);
  });

  it("normalizes CRLF to LF and reports it", () => {
    const r = normalizeInput("a\r\nb\r\n");
    assert.equal(r.hadCrlf, true);
    assert.equal(r.text, "a\nb\n");
  });

  it("leaves clean LF input untouched", () => {
    const r = normalizeInput("a\nb\n");
    assert.equal(r.hadBom, false);
    assert.equal(r.hadCrlf, false);
    assert.equal(r.text, "a\nb\n");
  });
});

describe("parseDoc — the CRLF blank-out regression", () => {
  it("parses a CRLF page identically to its LF twin", () => {
    const lf = parseDoc(LF_DOC);
    const crlf = parseDoc(LF_DOC.replaceAll("\n", "\r\n"));
    assert.deepEqual(crlf.headings, lf.headings);
    assert.deepEqual(crlf.frontmatter.value, lf.frontmatter.value);
    assert.deepEqual(crlf.wikilinks, lf.wikilinks);
    assert.equal(crlf.frontmatter.present, true);
  });

  it("detects frontmatter behind a BOM", () => {
    const doc = parseDoc(`﻿${LF_DOC}`);
    assert.equal(doc.frontmatter.present, true);
    assert.equal(doc.frontmatter.value["type"], "test-case");
  });
});

describe("parseDoc — frontmatter", () => {
  it("exposes values, top-level key lines, and the x- mount untouched", () => {
    const doc = parseDoc(LF_DOC);
    assert.equal(doc.frontmatter.present, true);
    assert.equal(doc.frontmatter.value["type"], "test-case");
    assert.deepEqual(doc.frontmatter.value["tags"], ["reset", "cycling"]);
    assert.equal(doc.frontmatter.value["x-owner"], "someone");
    const typeKey = doc.frontmatter.keys.find((k) => k.key === "type");
    assert.equal(typeKey?.line, 2);
    const xKey = doc.frontmatter.keys.find((k) => k.key === "x-owner");
    assert.equal(xKey?.line, 5);
  });

  it("reports duplicate keys as an issue with the offending line", () => {
    const doc = parseDoc("---\ntype: concept\ntype: hub\n---\n\nBody.\n");
    const dup = doc.frontmatter.issues.find((i) => i.code === "duplicate-key");
    assert.notEqual(dup, undefined);
    assert.equal(dup?.line, 3);
  });

  it("accepts frontmatter whose closing fence ends the file without a trailing newline", () => {
    const doc = parseDoc("---\ntype: concept\n---");
    assert.equal(doc.frontmatter.present, true);
    assert.deepEqual(doc.frontmatter.issues, []);
  });

  it("flags non-mapping frontmatter", () => {
    const doc = parseDoc("---\n- a\n- b\n---\n\nBody.\n");
    assert.equal(
      doc.frontmatter.issues.some((i) => i.code === "frontmatter-not-mapping"),
      true,
    );
  });

  it("treats a page without frontmatter as absent, not as an error", () => {
    const doc = parseDoc("# Just a heading\n");
    assert.equal(doc.frontmatter.present, false);
    assert.deepEqual(doc.frontmatter.issues, []);
  });
});

describe("parseDoc — headings (checker inputs, 07)", () => {
  it("extracts ATX headings with depth and line, including CJK text", () => {
    const doc = parseDoc("---\ntype: concept\n---\n\n# 张伟\n\n## 早年经历\n");
    assert.deepEqual(doc.headings, [
      { depth: 1, text: "张伟", line: 5 },
      { depth: 2, text: "早年经历", line: 7 },
    ]);
  });

  it("does not extract headings from inside code fences", () => {
    const doc = parseDoc(LF_DOC);
    assert.equal(
      doc.headings.some((h) => h.text.includes("heading inside fence")),
      false,
    );
  });

  it("does not extract headings from inside HTML comments", () => {
    const doc = parseDoc(LF_DOC);
    assert.equal(
      doc.headings.some((h) => h.text.includes("Commented-out")),
      false,
    );
  });

  it("does extract blockquoted headings (resolved by micromark)", () => {
    const doc = parseDoc(LF_DOC);
    assert.equal(
      doc.headings.some((h) => h.text === "Quoted heading" && h.depth === 2),
      true,
    );
  });
});

describe("parseDoc — fences", () => {
  it("captures fence info, span, and body", () => {
    const doc = parseDoc(LF_DOC);
    const mermaid = doc.fences.find((f) => f.info === "mermaid");
    assert.notEqual(mermaid, undefined);
    assert.equal(mermaid?.value.includes("graph TD"), true);
  });

  it("handles backtick fences nested inside tilde fences", () => {
    const doc = parseDoc(LF_DOC);
    const text = doc.fences.find((f) => f.info === "text");
    assert.equal(text?.value.includes("# heading inside fence"), true);
  });
});

describe("parseDoc — wikilinks (forms)", () => {
  it("extracts bare, aliased, and heading-targeted wikilinks with lines", () => {
    const doc = parseDoc(LF_DOC);
    const targets = doc.wikilinks.map((w) => w.target);
    assert.deepEqual(targets, ["热重启", "张伟", "Fixture Page"]);
    const aliased = doc.wikilinks[0];
    assert.equal(aliased?.alias, "warm reset");
    const headed = doc.wikilinks[2];
    assert.equal(headed?.heading, "Setup");
    assert.equal(headed?.alias, "setup");
    assert.equal(
      doc.wikilinks.every((w) => w.line === 12),
      true,
    );
  });

  it("ignores wikilink syntax inside inline code and fences", () => {
    const doc = parseDoc(LF_DOC);
    assert.equal(
      doc.wikilinks.some((w) => w.target === "not-a-link"),
      false,
    );
  });
});

describe("parseDoc — wikilinks survive markdown reshaping", () => {
  it("extracts a wikilink even when a matching reference definition exists", () => {
    const doc = parseDoc(
      "---\ntype: concept\ntitle: T\ndescription: x.\ntags: []\n---\n\nSee [[Target]].\n\n[Target]: https://example.com\n",
    );
    assert.deepEqual(
      doc.wikilinks.map((w) => w.target),
      ["Target"],
    );
  });

  it("extracts wikilinks whose display text carries inline markdown", () => {
    const doc = parseDoc(
      "---\ntype: concept\ntitle: T\ndescription: x.\ntags: []\n---\n\n[[Target|*nice* name]] and [[a*b*c]].\n",
    );
    assert.deepEqual(
      doc.wikilinks.map((w) => w.target),
      ["Target", "a*b*c"],
    );
  });

  it("does not extract escaped wikilink syntax", () => {
    const doc = parseDoc(
      "---\ntype: concept\ntitle: T\ndescription: x.\ntags: []\n---\n\n\\[[NotALink]] is literal.\n",
    );
    assert.deepEqual(doc.wikilinks, []);
  });

  it("parses GFM constructs as CommonMark: no heading, fence or wikilink appears or disappears", () => {
    // The GFM extensions are not loaded (docs/roadmap.md §Every run parses the
    // whole corpus): a table, a task list, a footnote, strikethrough and an
    // autolink literal are prose to the projection, and what the checkers read
    // — headings, fences, inline code, HTML, wikilinks — is the same as when
    // they were.
    const doc = parseDoc(
      [
        "# Title",
        "",
        "| Column | Note |",
        "| --- | --- |",
        "| [[Cell Link]] | `[[Not A Link]]` |",
        "| # not a heading | ~~struck~~ |",
        "",
        "- [ ] a task with [[Task Link]]",
        "- [x] done",
        "",
        "See www.example.com/[[Not Either]] and [[Bare]]. Footnote[^1].",
        "",
        "[^1]: The note cites [[Footnote Link]].",
        "",
        "```",
        "# fenced",
        "```",
        "",
      ].join("\n"),
    );
    assert.deepEqual(
      doc.headings.map((h) => [h.depth, h.text, h.line]),
      [[1, "Title", 1]],
    );
    assert.deepEqual(
      doc.fences.map((f) => [f.info, f.line, f.endLine]),
      [["", 15, 17]],
    );
    assert.deepEqual(
      doc.wikilinks.map((w) => [w.target, w.line]),
      [
        ["Cell Link", 5],
        ["Task Link", 8],
        ["Not Either", 11],
        ["Bare", 11],
        ["Footnote Link", 13],
      ],
    );
  });

  it("still ignores wikilinks inside fences and inline code", () => {
    const doc = parseDoc(
      "---\ntype: concept\ntitle: T\ndescription: x.\ntags: []\n---\n\n`[[not-a-link]]`\n\n```\n[[also-not]]\n```\n",
    );
    assert.deepEqual(doc.wikilinks, []);
  });
});
