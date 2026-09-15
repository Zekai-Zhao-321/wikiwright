// docs/architecture.md §Directories (core/gitplan: pure parsers for git plumbing output) ·
// docs/roadmap.md §Every run parses the whole corpus (the staged gate and the
// replay read a state's pages through `cat-file --batch`, in a number of git
// processes bounded by the bytes, never one per page).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCatFileBatch, parseCatFileBatchCheck } from "../src/gitplan/index.ts";

const encoder = new TextEncoder();
const decode = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** One `--batch` record as git writes it: the header, the content, one newline. */
function record(oid: string, content: string): Uint8Array {
  const body = encoder.encode(content);
  return concat([encoder.encode(`${oid} blob ${body.byteLength}\n`), body, encoder.encode("\n")]);
}

describe("parseCatFileBatch splits the stream by the header's byte size", () => {
  it("returns each object's exact content: multi-byte text, a header-shaped line, an empty blob", () => {
    const han = "---\ntitle: 热重启\n---\n\n# 热重启\n";
    const lookalike = `${D} blob 12\nnot a header\n`;
    const out = parseCatFileBatch(
      concat([record(A, han), record(B, lookalike), record(C, "")]),
      decode,
    );
    assert.deepEqual([...out.keys()], [A, B, C]);
    assert.equal(out.get(A), han);
    assert.equal(out.get(B), lookalike);
    assert.equal(out.get(C), "");
  });

  it("hands the bytes to the decoder given, so a leading BOM survives for normalizeInput", () => {
    const bom = "﻿---\ntype: note\n---\n";
    assert.equal(parseCatFileBatch(record(A, bom), decode).get(A), bom);
  });

  it("skips a `missing` record and reads on", () => {
    const out = parseCatFileBatch(
      concat([encoder.encode(`${D} missing\n`), record(A, "x\n")]),
      decode,
    );
    assert.deepEqual([...out.entries()], [[A, "x\n"]]);
  });

  it("throws on a stream cut inside an object rather than returning a shorter page", () => {
    const whole = record(A, "twelve bytes\n");
    assert.throws(
      () => parseCatFileBatch(whole.subarray(0, whole.byteLength - 3), decode),
      /ends inside object/u,
    );
    assert.throws(
      () => parseCatFileBatch(encoder.encode(`${A} blob`), decode),
      /ends inside a header/u,
    );
    assert.throws(() => parseCatFileBatch(encoder.encode(`${A} blob x\n`), decode), /unreadable/u);
  });
});

describe("parseCatFileBatchCheck reads sizes and missing objects", () => {
  it("a missing name keeps its spaces, as a page path's does", () => {
    assert.deepEqual(parseCatFileBatchCheck("HEAD:./wiki/Note 0.md missing\n"), [
      { name: "HEAD:./wiki/Note 0.md", size: undefined },
    ]);
  });

  it("one record per line, in order; a line of neither shape throws", () => {
    assert.deepEqual(parseCatFileBatchCheck(`${A} blob 12\n${B} missing\n${C} blob 0\n`), [
      { name: A, size: 12 },
      { name: B, size: undefined },
      { name: C, size: 0 },
    ]);
    assert.deepEqual(parseCatFileBatchCheck(""), []);
    assert.throws(() => parseCatFileBatchCheck("fatal: not a repository\n"), /unreadable/u);
  });
});
