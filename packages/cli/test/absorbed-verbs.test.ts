// v2 contracts §1, §12 step 4: an old verb leaves the command table when its
// replacement lands, and is not deleted until step 6. For each old verb a
// replacement absorbs, every example its spec documents is answered by the
// replacement over a bundle on schema version 4 — each row the invocation
// that answers it, and what of the old one is not carried — and the old verb
// is no verb there.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fixCommand } from "../src/legacy/fix.ts";
import { freshnessCommand } from "../src/legacy/freshness.ts";
import { lintCommand } from "../src/legacy/lint.ts";
import { okfCommand } from "../src/legacy/okf.ts";
import type { CommandSpec } from "../src/spec.ts";
import { cleanBundles, cli, commitAll, gardenBundle } from "./fixtures/garden-cli.ts";

afterAll(cleanBundles);

/** One documented example of an old verb, and the invocation of the §9 table that answers it. */
interface Absorbed {
  example: string;
  replacement: string[];
  /** What the old invocation did that the replacement does not, when anything. */
  loss?: string;
}

const ABSORBED: { spec: CommandSpec; rows: Absorbed[] }[] = [
  {
    spec: lintCommand,
    rows: [
      { example: "wikiwright lint --root .", replacement: ["check"] },
      { example: "wikiwright lint --staged", replacement: ["gate"] },
      {
        example: "wikiwright lint --page wiki/example.md",
        replacement: ["check", "--path", "wiki/Basil.md"],
      },
      {
        example: "wikiwright lint --since HEAD~5",
        replacement: ["check"],
        loss: "the replay of each commit against its parent: deferred with replay",
      },
    ],
  },
  {
    spec: fixCommand,
    rows: [
      {
        example: "wikiwright fix --rule sections --path wiki/parser.md --expect 1",
        replacement: ["check", "--fix", "--rule", "section-count", "--path", "wiki/Start.md"],
        loss: "the section-stub fixer: a missing section is written by the agent",
      },
      {
        example: "wikiwright fix --rule folder-tags-present --staged --expect any",
        replacement: ["check", "--fix", "--rule", "folder-tags-present"],
        loss: "fixing the index rather than the working tree",
      },
      {
        example: "wikiwright fix --rule unknown-frontmatter-key --expect any",
        replacement: ["check", "--fix", "--rule", "page-shape-invalid"],
        loss: "the frontmatter-delete fixer",
      },
      {
        example:
          "wikiwright fix --rule renamed-without-alias --path wiki/lexer.md --staged --expect 1",
        replacement: ["check", "--fix", "--rule", "renamed-without-alias"],
        loss: "the alias fixer: write's move operation keeps the old name as it moves",
      },
    ],
  },
  {
    spec: freshnessCommand,
    rows: [
      { example: "wikiwright freshness", replacement: ["check", "--rule", "pin-stale"] },
      {
        example: "wikiwright freshness --fast-forward",
        replacement: ["check"],
        loss: "advancing a clean pin: a pin is re-read and re-pinned by a write",
      },
    ],
  },
  {
    spec: okfCommand,
    rows: [
      { example: "wikiwright okf check", replacement: ["check", "--rule", "okf-missing-type"] },
    ],
  },
];

let dir = "";
beforeAll(() => {
  dir = gardenBundle();
  cli(["check", "--write"], dir);
  commitAll(dir, "the garden");
});

describe.each(ABSORBED)("the old $spec.name, absorbed", ({ spec, rows }) => {
  it("every documented example has its row", () => {
    expect(rows.map((r) => r.example)).toEqual(spec.examples);
  });

  it("is no verb over a schema-version-4 bundle", () => {
    const r = cli([spec.name], dir);
    expect(r.status).toBe(2);
    expect(r.envelope.error?.code).toBe("unknown-command");
  });

  it.each(rows)("$example is answered by its replacement", ({ replacement }) => {
    const r = cli(replacement, dir);
    expect(r.envelope.metadata.command).toBe(replacement[0] ?? "");
    expect([0, 5]).toContain(r.status);
    expect(r.envelope.metadata.bundle?.["label"]).toBe("kitchen-garden");
  });
});
