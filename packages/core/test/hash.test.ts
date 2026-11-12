// The vendored sha256 is the oracle for whatever provider the shell installs,
// and the fallback when none is: both must agree byte for byte with node:crypto.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  setSha256Provider,
  sha256Hex,
  sha256HexOfBytes,
  sha256HexOfBytesVendored,
} from "../src/hash/index.ts";

const oracle = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const inputs: Uint8Array[] = [
  new Uint8Array(0),
  new TextEncoder().encode("abc"),
  new TextEncoder().encode("Typed wiki · 月 · 🚀 · \u0000 · 55 bytes-ish of mixed text"),
  new Uint8Array(55).fill(0x61), // one byte short of the padding boundary
  new Uint8Array(56).fill(0x61),
  new Uint8Array(64).fill(0x61),
  Uint8Array.from({ length: 1 << 16 }, (_, i) => (i * 7919) & 0xff),
];

describe("sha256", () => {
  it("vendored implementation matches node:crypto", () => {
    for (const bytes of inputs) {
      assert.equal(sha256HexOfBytesVendored(bytes), oracle(bytes));
      assert.equal(sha256HexOfBytesVendored(Array.from(bytes)), oracle(bytes));
    }
  });

  it("uses the installed provider and falls back when it is cleared", () => {
    let calls = 0;
    setSha256Provider((bytes) => {
      calls += 1;
      return oracle(bytes);
    });
    try {
      for (const bytes of inputs) assert.equal(sha256HexOfBytes(bytes), oracle(bytes));
      assert.equal(sha256HexOfBytes([0x61, 0x62, 0x63]), oracle(new TextEncoder().encode("abc")));
      assert.equal(sha256Hex("月"), oracle(new TextEncoder().encode("月")));
      assert.equal(calls, inputs.length + 2);
    } finally {
      setSha256Provider(undefined);
    }
    assert.equal(sha256Hex("月"), oracle(new TextEncoder().encode("月")));
    assert.equal(calls, inputs.length + 2);
  });
});
