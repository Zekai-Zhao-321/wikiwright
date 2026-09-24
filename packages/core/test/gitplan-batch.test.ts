// docs/architecture.md §Directories (core/gitplan: pure parsers for git plumbing output) ·
// docs/roadmap.md §Every run parses the whole corpus (the staged gate and the
// replay read a state's pages through `cat-file --batch`, in a number of git
// processes bounded by the bytes, never one per page).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BatchStreamTruncated,
  parseCatFileBatch,
  parseCatFileBatchCheck,
} from "../src/gitplan/index.ts";

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
      (e: unknown) =>
        e instanceof BatchStreamTruncated &&
        e.object === A &&
        /ends inside object/u.test(e.message),
    );
    // Cut after the content's own last newline: the stream still ends in a
    // newline, and only the object's size says it stopped short.
    assert.throws(
      () => parseCatFileBatch(whole.subarray(0, whole.byteLength - 1), decode),
      (e: unknown) => e instanceof BatchStreamTruncated && e.object === A,
    );
    assert.throws(
      () => parseCatFileBatch(encoder.encode(`${A} blob`), decode),
      (e: unknown) =>
        e instanceof BatchStreamTruncated &&
        e.object === undefined &&
        /ends inside a header/u.test(e.message),
    );
    assert.throws(() => parseCatFileBatch(encoder.encode(`${A} blob x\n`), decode), /unreadable/u);
  });

  it("throws an object that runs past its size as malformed, not as a cut stream", () => {
    const wrong = encoder.encode(`${A} blob 3\nfour\n`);
    assert.throws(
      () => parseCatFileBatch(wrong, decode),
      (e: unknown) =>
        !(e instanceof BatchStreamTruncated) && /is not followed by a newline/u.test(String(e)),
    );
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

/**
 * docs/roadmap.md: a cut answer. A stream cut BETWEEN objects, or a check
 * answer cut between lines, is well-formed as far as it goes, so the parsers
 * return a shorter answer and cannot tell; the shell holds every read to its
 * terminator and its count (packages/cli/src/git.ts `terminated`). A cut
 * inside an object is the one shape the parser itself refuses.
 */
describe("a cut answer: what the parsers alone can and cannot tell", () => {
  it("a --batch stream cut between objects parses as fewer objects", () => {
    const whole = concat([record(A, "one\n"), record(B, "two\n")]);
    const cut = whole.subarray(0, record(A, "one\n").byteLength);
    assert.deepEqual([...parseCatFileBatch(cut, decode).keys()], [A]);
  });

  it("a --batch stream cut inside an object is refused by the parser, by type", () => {
    const whole = concat([record(A, "one\n"), record(B, "two\n")]);
    assert.throws(
      () => parseCatFileBatch(whole.subarray(0, whole.byteLength - 3), decode),
      (e: unknown) => e instanceof BatchStreamTruncated && e.object === B,
    );
  });

  it("a --batch-check answer cut between lines parses as fewer records", () => {
    assert.deepEqual(
      parseCatFileBatchCheck(`${A} blob 12\n`).map((r) => r.name),
      [A],
    );
  });

  it("a --batch-check answer cut inside its last size parses as a smaller size", () => {
    // `B blob 345` cut to `B blob 3`: a well-formed line with the wrong number,
    // which only the missing final newline gives away.
    assert.deepEqual(parseCatFileBatchCheck(`${A} blob 12\n${B} blob 3`), [
      { name: A, size: 12 },
      { name: B, size: 3 },
    ]);
  });
});
