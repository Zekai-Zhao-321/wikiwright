// v2 contracts §9: the command table is the eight verbs of §9, each a
// module under src/verbs/; every example a verb documents parses under the
// table; a reader refuses --dry-run and a writer plans; and every verb of
// the old tree that left in step 6 is no verb (`unknown-command`).
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseInvocation } from "../src/argv.ts";
import { COMMANDS } from "../src/commands.ts";
import { flagsOf } from "../src/spec.ts";
import { cleanBundles, cli, gardenBundle } from "./fixtures/garden-cli.ts";
import { SRC } from "./fixtures/verb-module.ts";

afterAll(cleanBundles);

/** An example's argv: shell words, double quotes grouping one. */
function words(example: string): string[] {
  return [...example.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/gu)].map((m) =>
    m[1] === undefined ? (m[2] ?? "") : m[1].replaceAll('\\"', '"'),
  );
}

describe("the command table (v2 contracts §9)", () => {
  it("is the eight verbs, each with its module under src/verbs/", () => {
    expect(COMMANDS.map((c) => c.name).sort()).toEqual([
      "check",
      "gate",
      "read",
      "rule",
      "search",
      "type",
      "version",
      "write",
    ]);
    for (const c of COMMANDS) expect(existsSync(join(SRC, "verbs", `${c.name}.ts`))).toBe(true);
  });

  it("parses every example each verb documents", () => {
    for (const spec of COMMANDS) {
      for (const example of spec.examples) {
        const [binary, verb, ...rest] = words(example);
        expect([binary, verb === "--version" ? "version" : verb]).toEqual([
          "wikiwright",
          spec.name,
        ]);
        if (verb === "--version") continue;
        const parsed = parseInvocation(spec, rest, COMMANDS);
        expect([example, parsed.ok]).toEqual([example, true]);
      }
    }
  });

  it("gives --dry-run to the writers, check and write, and to no reader", () => {
    expect(
      COMMANDS.filter((c) => c.writes)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["check", "write"]);
    const garden = gardenBundle();
    for (const spec of COMMANDS) {
      expect(flagsOf(spec).some((f) => f.name === "dry-run")).toBe(spec.writes);
      if (spec.writes) continue;
      const argv =
        spec.subcommands === undefined ? [spec.name] : [spec.name, spec.subcommands[0] ?? ""];
      const r = cli([...argv, "--dry-run"], garden);
      expect([spec.name, r.status, r.envelope.error?.code]).toEqual([spec.name, 2, "unknown-flag"]);
    }
  });

  it("answers every verb of the old tree with unknown-command", () => {
    const garden = gardenBundle();
    for (const gone of [
      "brief",
      "bundles",
      "export",
      "fix",
      "freshness",
      "graph",
      "hook",
      "init",
      "lint",
      "modules",
      "move",
      "new",
      "okf",
      "retire",
      "schema",
      "skills",
      "vocabulary",
    ]) {
      expect([gone, cli([gone], garden).envelope.error?.code]).toEqual([gone, "unknown-command"]);
    }
  });
});
