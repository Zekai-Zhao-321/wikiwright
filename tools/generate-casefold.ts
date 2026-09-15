// Regenerates packages/core/src/identity/casefold-data.ts from the vendored Unicode
// CaseFolding.txt, keeping statuses C + F (full case folding). docs/architecture.md §Directories
// (identity); attribution: packages/core/data/UNICODE-LICENSE.txt.
import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("../packages/core/data/CaseFolding.txt", import.meta.url);
const OUT = new URL("../packages/core/src/identity/casefold-data.ts", import.meta.url);

const lines = readFileSync(SRC, "utf8").split("\n");
const entries: Array<[number, string]> = [];
let version = "unknown";
for (const line of lines) {
  const versionMatch = line.match(/^# CaseFolding-([\d.]+)\.txt/);
  const versionCapture = versionMatch?.[1];
  if (versionCapture !== undefined) version = versionCapture;
  const m = line.match(/^([0-9A-F]+); ([CF]); ([0-9A-F ]+);/);
  if (m === null) continue;
  const [, cpHex, , mappingHex] = m;
  if (cpHex === undefined || mappingHex === undefined) continue;
  const cp = Number.parseInt(cpHex, 16);
  const mapped = mappingHex
    .trim()
    .split(" ")
    .map((h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .join("");
  entries.push([cp, mapped]);
}
entries.sort((a, b) => a[0] - b[0]);

const escapeCodepoints = (s: string): string =>
  [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0);
      return cp === undefined ? "" : `\\u{${cp.toString(16)}}`;
    })
    .join("");

const rows = entries
  .map(([cp, s]) => `  [0x${cp.toString(16)}, "${escapeCodepoints(s)}"],`)
  .join("\n");
const header = [
  "// GENERATED FILE — do not edit. Regenerate: bun tools/generate-casefold.ts",
  `// Source: Unicode CaseFolding-${version}.txt, statuses C + F (full case folding).`,
  "// © Unicode, Inc. — see packages/core/data/UNICODE-LICENSE.txt for attribution and terms.",
].join("\n");
const body = `${header}\nexport const CASE_FOLD: ReadonlyMap<number, string> = new Map([\n${rows}\n]);\n`;
writeFileSync(OUT, body);
console.log(`wrote ${entries.length} mappings (Unicode ${version})`);
