// v2 contracts §1, §12 step 4: an old verb leaves the command table when its
// replacement lands, and is not deleted until step 6. For each old verb a
// replacement absorbs, every example its spec documents is answered by the
// replacement over a bundle on schema version 4 — each row the invocation
// that answers it, what its answer must hold for it to be an answer, and
// what of the old one is not carried — and the old verb is no verb there.
// The bundle carries a pin the history has made stale, so the freshness rows
// have something to measure.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { COMMANDS } from "../src/commands.ts";
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
import { type CommandSpec, commandSchema } from "../src/spec.ts";
import { cleanBundles, cli, commitAll, gardenBundle, git } from "./fixtures/garden-cli.ts";

afterAll(() => {
  cleanBundles();
  rmSync(scratch, { recursive: true, force: true });
});

type Answer = ReturnType<typeof cli>;
type Data = Record<string, unknown>;

/** One documented example of an old verb, and the invocation of the §9 table that answers it. */
interface Absorbed {
  example: string;
  /** The invocation, or a function of a scratch directory that builds it. */
  replacement: string[] | ((scratch: string) => string[]);
  /** What the replacement's answer holds when it answers the example. */
  expects: (r: Answer) => void;
  /** What the old invocation did that the replacement does not, when anything. */
  loss?: string;
}

const PAGES = 4;

function data(r: Answer): Data {
  return (r.envelope.data ?? {}) as Data;
}

function findings(r: Answer): { rule: string; path: string }[] {
  return (data(r)["findings"] ?? []) as { rule: string; path: string }[];
}

/** A clean judgment of the whole bundle. */
function judgedWhole(r: Answer): void {
  expect(r.status).toBe(0);
  expect((data(r)["summary"] as { pages: number }).pages).toBe(PAGES);
}

/** `check --fix` ran the surviving fixers, and nothing of `rule` is left. */
function fixedClean(rule: string, path?: string): (r: Answer) => void {
  return (r) => {
    expect(r.status).toBe(0);
    expect(Array.isArray(data(r)["fixed"])).toBe(true);
    expect(
      findings(r).filter((f) => f.rule === rule && (path === undefined || f.path === path)),
    ).toEqual([]);
  };
}

/** The pin the history made stale, measured and reported, and not advanced. */
function staleReported(r: Answer): void {
  expect(r.status).toBe(0);
  const pins = data(r)["pins"] as { counts: Record<string, number> };
  expect(pins.counts["stale"]).toBe(1);
  expect(
    findings(r)
      .filter((f) => f.rule === "pin-stale")
      .map((f) => f.path),
  ).toEqual(["wiki/Seed list.md"]);
}

/** A dry run that would land exactly this plan. */
function plans(...ops: { kind: string; path: string; from?: string }[]): (r: Answer) => void {
  return (r) => {
    expect(r.status).toBe(0);
    const planned = (data(r)["ops"] ?? []) as { kind: string; path: string; from?: string }[];
    expect(
      planned.map((o) => ({
        kind: o.kind,
        path: o.path,
        ...(o.from === undefined ? {} : { from: o.from }),
      })),
    ).toEqual(ops);
  };
}

/** The brief names this vocabulary with a count per entry, and `entry` among them when given. */
function vocabularyShown(name: string, entry?: string): (r: Answer) => void {
  return (r) => {
    expect(r.status).toBe(0);
    const brief = data(r)["brief"] as {
      vocabularies: { name: string; entries: { name: string; count: number }[] }[];
    };
    const shown = brief.vocabularies.find((v) => v.name === name);
    expect(shown).toBeDefined();
    for (const e of shown?.entries ?? []) expect(typeof e.count).toBe("number");
    if (entry !== undefined) expect(shown?.entries.map((e) => e.name)).toContain(entry);
  };
}

/** The dry run leaves BRIEF.md as it is, and BRIEF.md carries the role's section. */
function briefFor(role: string): (r: Answer) => void {
  return (r) => {
    expect(r.status).toBe(0);
    const planned = (data(r)["ops"] ?? []) as { path: string }[];
    expect(planned.map((o) => o.path)).not.toContain("generated/BRIEF.md");
    const brief = readFileSync(join(dir, "generated/BRIEF.md"), "utf8");
    expect(brief.split("\n").some((l) => l.startsWith("### ") && l.endsWith(`(the ${role})`))).toBe(
      true,
    );
  };
}

const ABSORBED: { spec: CommandSpec; rows: Absorbed[] }[] = [
  {
    spec: lintCommand,
    rows: [
      { example: "wikiwright lint --root .", replacement: ["check"], expects: judgedWhole },
      {
        example: "wikiwright lint --staged",
        replacement: ["gate"],
        expects: (r) => {
          expect(r.status).toBe(0);
          expect(data(r)["stage"]).toBe("pre-commit");
        },
      },
      {
        example: "wikiwright lint --page wiki/example.md",
        replacement: ["check", "--path", "wiki/Basil.md"],
        expects: (r) => {
          expect(r.status).toBe(0);
          expect(findings(r).length).toBeGreaterThan(0);
          expect(new Set(findings(r).map((f) => f.path))).toEqual(new Set(["wiki/Basil.md"]));
        },
      },
      {
        example: "wikiwright lint --since HEAD~5",
        replacement: ["check"],
        expects: judgedWhole,
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
        expects: fixedClean("section-count", "wiki/Start.md"),
        loss: "the section-stub fixer: a missing section is written by the agent",
      },
      {
        example: "wikiwright fix --rule folder-tags-present --staged --expect any",
        replacement: ["check", "--fix", "--rule", "folder-tags-present"],
        expects: fixedClean("folder-tags-present"),
        loss: "fixing the index rather than the working tree",
      },
      {
        example: "wikiwright fix --rule unknown-frontmatter-key --expect any",
        replacement: ["check", "--fix", "--rule", "page-shape-invalid"],
        expects: fixedClean("page-shape-invalid"),
        loss: "the frontmatter-delete fixer",
      },
      {
        example:
          "wikiwright fix --rule renamed-without-alias --path wiki/lexer.md --staged --expect 1",
        replacement: ["check", "--fix", "--rule", "renamed-without-alias"],
        expects: fixedClean("renamed-without-alias"),
        loss: "the alias fixer: write's move operation keeps the old name as it moves",
      },
    ],
  },
  {
    spec: freshnessCommand,
    rows: [
      {
        example: "wikiwright freshness",
        replacement: ["check", "--rule", "pin-stale"],
        expects: staleReported,
      },
      {
        example: "wikiwright freshness --fast-forward",
        replacement: ["check"],
        expects: staleReported,
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
        expects: plans({ kind: "create", path: "wiki/Architecture.md" }),
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
        expects: plans({ kind: "create", path: "wiki/Parser.md" }),
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
        expects: plans({ kind: "create", path: "wiki/Lexing.md" }),
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
        expects: plans({ kind: "rename", path: "wiki/guides/Start.md", from: "wiki/Start.md" }),
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
        expects: plans({ kind: "rename", path: "wiki/Begin.md", from: "wiki/Start.md" }),
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
        expects: (r) => {
          plans({ kind: "write", path: "wiki/Start.md" })(r);
          expect((data(r)["operations"] as { op: string; path: string }[])[0]).toMatchObject({
            op: "retire",
            path: "wiki/Start.md",
          });
        },
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
        expects: vocabularyShown("garden/relations"),
      },
      {
        example: "wikiwright vocabulary show relations --label part_of",
        replacement: ["type", "show", "planting", "--brief"],
        expects: vocabularyShown("garden/relations", "grows-in"),
        loss: "one entry alone: the brief lists every entry with its count",
      },
      {
        example: "wikiwright vocabulary show relations --target source-map",
        replacement: ["type", "show", "planting", "--brief"],
        expects: vocabularyShown("garden/relations"),
        loss: "the labels whose range admits a target type: a range is the `relation-range` rule's config",
      },
      {
        example: "wikiwright vocabulary show tags",
        replacement: ["type", "show", "planting", "--brief"],
        expects: vocabularyShown("tags"),
      },
    ],
  },
  {
    spec: briefCommand,
    rows: ["writer", "maintainer", "consumer"].map((role) => ({
      example: `wikiwright brief --role ${role}`,
      replacement: ["check", "--write", "--dry-run"],
      expects: briefFor(role),
      loss: "a brief per role printed on demand: the three roles are sections of generated/BRIEF.md, which check --write renders",
    })),
  },
  {
    spec: schemaCommand,
    rows: [
      {
        example: "wikiwright schema",
        replacement: ["check", "--help", "--json"],
        expects: (r) => {
          expect(r.status).toBe(0);
          const check = COMMANDS.find((c) => c.name === "check");
          if (check === undefined) throw new Error("no check in the command table");
          expect(r.envelope.data).toEqual(commandSchema(check));
        },
        loss: "a verb that prints every verb's schema: `wikiwright --help --json` does, and a verb's own `--help --json` its row",
      },
    ],
  },
  {
    spec: okfCommand,
    rows: [
      {
        example: "wikiwright okf check",
        replacement: ["check", "--rule", "okf-missing-type"],
        expects: (r) => {
          expect(r.status).toBe(0);
          const coverage = data(r)["coverage"] as Record<string, { evaluated: number }>;
          expect(coverage["okf-missing-type"]?.evaluated).toBe(PAGES);
        },
      },
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
const SOURCE_TYPE = `type: source
role: reference
description: A capture of a file in this repository.
fields:
  type: object
  properties:
    capture: { $ref: "#/$defs/pin" }
  required: [capture]
`;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "ww-absorbed-"));
  dir = gardenBundle({
    "constitution/types/source.yaml": SOURCE_TYPE,
    "notes/seeds.txt": "basil\n",
  });
  commitAll(dir, "the garden");
  // A capture pinned at this commit, then a commit that changes what it covers.
  const pinned = git(dir, "rev-parse", "HEAD").trim();
  writeFileSync(
    join(dir, "wiki/Seed list.md"),
    `---\ntype: source\ntitle: Seed list\ncapture:\n  commit: ${pinned}\n  origin: "."\n  covers: [notes/seeds.txt]\n---\n\n# Seed list\n`,
  );
  writeFileSync(join(dir, "notes/seeds.txt"), "basil\nmint\n");
  cli(["check", "--write"], dir);
  commitAll(dir, "the capture, and mint");
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

  it.each(rows)("$example is answered by its replacement", ({ replacement, expects }) => {
    const argv = typeof replacement === "function" ? replacement(scratch) : replacement;
    const r = cli(argv, dir);
    expect(r.envelope.metadata.command).toBe(argv[0] ?? "");
    expects(r);
    // A verb's help answers before any bundle is read, and names none.
    if (!argv.includes("--help"))
      expect(r.envelope.metadata.bundle?.["label"]).toBe("kitchen-garden");
  });
});
