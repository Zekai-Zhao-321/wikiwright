// v2 contracts §3.1: the engine's Ajv factory on its own — the engine
// keywords' meta-schemas, the format validators, RE2 behind `pattern`.
import { describe, expect, it } from "bun:test";
import { ENGINE_DEFS, isDate, isDateTime, isUri, parseUrl, strictAjv } from "../src/index.ts";

describe("the engine keywords", () => {
  it("are held to their meta-schemas", () => {
    const ajv = strictAjv();
    expect(() => ajv.compile({ type: "string", target_type: 5 })).toThrow();
    expect(() => ajv.compile({ type: "string", target_type: "Garden Bed" })).toThrow();
    expect(() => ajv.compile({ type: "string", target_root: "" })).toThrow();
    expect(() =>
      ajv.compile({ type: "string", target_type: "garden/bed", target_root: "raw" }),
    ).not.toThrow();
  });

  it("assert nothing about a value by themselves: the judge reads them", () => {
    const validate = strictAjv().compile({ type: "string", target_type: "bed" });
    expect(validate("anything")).toBe(true);
  });
});

describe("the format validators", () => {
  it("know the calendar without a clock", () => {
    expect(["2026-01-31", "2024-02-29", "2000-02-29"].every(isDate)).toBe(true);
    expect(
      ["1900-02-29", "2026-04-31", "2026-00-10", "26-01-01", "2026-01-01T00:00:00Z"].some(isDate),
    ).toBe(false);
  });

  it("read RFC 3339 date-times", () => {
    expect(isDateTime("2026-06-30T23:59:60Z")).toBe(true);
    expect(isDateTime("2026-06-30T23:59:59-07:30")).toBe(true);
    expect(isDateTime("2026-06-30T23:59:59+24:00")).toBe(false);
    expect(isDateTime("2026-06-30T23:60:00Z")).toBe(false);
  });

  it("read a URL as the WHATWG parser does, scheme and host lower-cased", () => {
    expect(isUri("https://Seeds.Example/Basil?x=1")).toBe(true);
    expect(isUri("/relative/path")).toBe(false);
    expect(parseUrl("HTTPS://Seeds.Example:8080/Basil")).toEqual({
      scheme: "https",
      host: "seeds.example:8080",
      path: "/Basil",
    });
  });

  it("are the only formats: any other is refused at compile", () => {
    expect(() => strictAjv().compile({ type: "string", format: "email" })).toThrow();
  });
});

describe("pattern", () => {
  it("is RE2: a lookahead does not compile, a case-insensitive group does", () => {
    expect(() => strictAjv().compile({ type: "string", pattern: "a(?=b)" })).toThrow();
    expect(strictAjv().compile({ type: "string", pattern: "(?i)^basil$" })("BASIL")).toBe(true);
  });

  it("holds the engine's pin shape", () => {
    const validate = strictAjv().compile({ $defs: ENGINE_DEFS, $ref: "#/$defs/pin" });
    expect(validate({ commit: "0123abc", origin: ".", covers: ["libraries/kit-garden"] })).toBe(
      true,
    );
    expect(validate({ commit: "0123abc", origin: ".", covers: [], extra: 1 })).toBe(false);
  });
});
