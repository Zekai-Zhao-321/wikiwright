// v2 contracts §1, §12 step 4: an old verb leaves the command table when its
// replacement lands, and is not deleted until step 6. For each old verb a
// replacement absorbs, every example its spec documents is answered by the
// replacement over a bundle on schema version 4 — each row the invocation
// that answers it, and what of the old one is not carried — and the old verb
// is no verb there.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { briefCommand } from "../src/legacy/brief.ts";
import { fixCommand } from "../src/legacy/fix.ts";
import { freshnessCommand } from "../src/legacy/freshness.ts";
import { lintCommand } from "../src/legacy/lint.ts";
import { moveCommand } from "../src/legacy/move.ts";
import { newCommand } from "../src/legacy/new.ts";
import { okfCommand } from "../src/legacy/okf.ts";
import { retireCommand } from "../src/legacy/retire.ts";
import { schemaCommand } from "../src/legacy/schema.ts";
import { vocabularyCommand } from "../src/legacy/vocabulary.ts";
import type { CommandSpec } from "../src/spec.ts";
import { cleanBundles, cli, commitAll, gardenBundle } from "./fixtures/garden-cli.ts";

afterAll(() => {
  cleanBundles();
  rmSync(scratch, { recursive: true, force: true });
});

/** One documented example of an old verb, and the invocation of the §9 table that answers it. */
interface Absorbed {
  example: string;
  /** The invocation, or a function of a scratch directory that builds it. */
  replacement: string[] | ((scratch: string) => string[]);
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
    spec: newCommand,
    rows: [
      {
        example: 'wikiwright new architecture-overview "Architecture" --dest wiki/architecture.md',
        replacement: (scratch) =>
          draftsOf(scratch, {
            "wiki/Architecture.md":
              "---\ntype: guide\ntitle: Architecture\n---\n\n# Architecture\n\n## Start here\n",
          }),
        loss: "the template: the skeleton is `type show --brief`'s, and the agent writes the draft",
      },
      {
        example:
          'wikiwright new subsystem "Parser" --dest wiki/parser.md --item "Relations: part_of [[Architecture]]"',
        replacement: (scratch) =>
          draftsOf(scratch, {
            "wiki/Parser.md":
              "---\ntype: guide\ntitle: Parser\n---\n\n# Parser\n\n## Start here\n\nSee [[Basil]].\n",
          }),
        loss: "--item: an item is a line of the draft",
      },
      {
        example:
          'wikiwright new code-concept "Lexing" --dest wiki/lexing.md --set description="How the lexer tokenizes."',
        replacement: (scratch) =>
          draftsOf(scratch, {
            "wiki/Lexing.md":
              "---\ntype: guide\ntitle: Lexing\ndescription: How the beds are dug.\n---\n\n# Lexing\n\n## Start here\n",
          }),
        loss: "--set: a key is a line of the draft's frontmatter",
      },
    ],
  },
  {
    spec: moveCommand,
    rows: [
      {
        example: "wikiwright move wiki/a/x.md wiki/b/x.md --reason activity-boundary",
        replacement: (scratch) =>
          draftsOf(
            scratch,
            {},
            {
              move: [
                { from: "wiki/Start.md", to: "wiki/guides/Start.md", reason: "activity-boundary" },
              ],
            },
          ),
        loss: "`git mv`: the batch writer moves the file, and staging is the committer's",
      },
      {
        example:
          "wikiwright move wiki/a/Ana.md wiki/a/Anna.md --reason browse-misleading --rename --rewrite-links",
        replacement: (scratch) =>
          draftsOf(
            scratch,
            {},
            {
              move: [{ from: "wiki/Start.md", to: "wiki/Begin.md", reason: "browse-misleading" }],
            },
          ),
      },
    ],
  },
  {
    spec: retireCommand,
    rows: [
      {
        example: "wikiwright retire wiki/old-model.md --superseded-by new-model",
        replacement: (scratch) =>
          draftsOf(scratch, {}, { retire: [{ path: "wiki/Start.md", successor: "Basil" }] }),
        loss: "the retirement banner",
      },
    ],
  },
  {
    spec: vocabularyCommand,
    rows: [
      {
        example: "wikiwright vocabulary show relations",
        replacement: ["type", "show", "planting", "--brief"],
      },
      {
        example: "wikiwright vocabulary show relations --label part_of",
        replacement: ["type", "show", "planting", "--brief"],
        loss: "one entry alone: the brief lists every entry with its count",
      },
      {
        example: "wikiwright vocabulary show relations --target source-map",
        replacement: ["type", "show", "planting", "--brief"],
        loss: "the labels whose range admits a target type: a range is the `relation-range` rule's config",
      },
      {
        example: "wikiwright vocabulary show tags",
        replacement: ["type", "show", "planting", "--brief"],
      },
    ],
  },
  {
    spec: briefCommand,
    rows: ["writer", "maintainer", "consumer"].map((role) => ({
      example: `wikiwright brief --role ${role}`,
      replacement: ["check", "--write", "--dry-run"],
      loss: "a brief per role printed on demand: the three roles are sections of generated/BRIEF.md, which check --write renders",
    })),
  },
  {
    spec: schemaCommand,
    rows: [
      {
        example: "wikiwright schema",
        replacement: ["check", "--help", "--json"],
        loss: "a verb that prints every verb's schema: `wikiwright --help --json` does, and a verb's own `--help --json` its row",
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

/** `write --from <a drafts directory> --dry-run`, the directory written under `scratch`. */
function draftsOf(scratch: string, pages: Record<string, string>, ops?: unknown): string[] {
  const from = mkdtempSync(join(scratch, "drafts-"));
  for (const [path, text] of Object.entries(pages)) {
    mkdirSync(dirname(join(from, path)), { recursive: true });
    writeFileSync(join(from, path), text);
  }
  if (ops !== undefined) writeFileSync(join(from, "ops.json"), JSON.stringify(ops));
  return ["write", "--from", from, "--dry-run"];
}

let dir = "";
let scratch = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "ww-absorbed-"));
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
    const argv = typeof replacement === "function" ? replacement(scratch) : replacement;
    const r = cli(argv, dir);
    expect(r.envelope.metadata.command).toBe(argv[0] ?? "");
    expect([0, 5]).toContain(r.status);
    // A verb's help answers before any bundle is read, and names none.
    if (!argv.includes("--help"))
      expect(r.envelope.metadata.bundle?.["label"]).toBe("kitchen-garden");
  });
});
