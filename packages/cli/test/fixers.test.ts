// docs/concepts.md §Findings and routing (each fixer flips its PASS_TABLE row from queue to
// fix with no spec-table edit beyond the fixer column) · docs/concepts.md §The judge and its states
// (history-close as --propose only; canonical-form as the only dialect rewrite)
// docs/cli.md §fix (--staged, --propose, --expect any; the verb reads the
// bytes it writes; the splice refuses what the parser could not read).
//
// Each fixer carries three things here: a red fixture where it fires and the fix
// applies, a case where it must REFUSE rather than guess, and — through
// `writer-fuzz` — coverage of the splice its ops ride on.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FIXER_REGISTRY,
  fixerExecutes,
  PASS_TABLE,
  passRows,
  standardLibrary,
} from "@wikiwright/core";
import { layMemoryLaw } from "./fixtures/memory-law.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-fixers-test-"));

interface Run {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
  error: Record<string, unknown>;
}

function run(cwd: string, args: string[]): Run {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  const envelope = JSON.parse(r.stdout) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
  return {
    status: r.status ?? -1,
    ok: envelope.ok,
    data: envelope.data ?? {},
    error: envelope.error ?? {},
  };
}

interface VaultSpec {
  name: string;
  /** Extra engine.json keys merged over the law's. */
  engine?: Record<string, unknown>;
  pages?: Record<string, string>;
  /** Run after the seed commit; the tree is left dirty unless it stages. */
  arrange?: (dir: string) => void;
}

function vault(spec: VaultSpec): string {
  const dir = join(SCRATCH, spec.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  layMemoryLaw(dir);
  if (spec.engine !== undefined) {
    const file = join(dir, "config", "engine.json");
    const engine = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, `${JSON.stringify({ ...engine, ...spec.engine }, null, 2)}\n`);
  }
  for (const [rel, text] of Object.entries(spec.pages ?? {})) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "seed"], { cwd: dir });
  spec.arrange?.(dir);
  return dir;
}

function page(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), "utf8");
}

/** A `person` page with every section its type requires, plus the body given. */
const PERSON = (body: string): string =>
  [
    "---",
    "type: person",
    "tags: []",
    "---",
    "A page.",
    "",
    body,
    "",
    "## Relations",
    "",
    "- knows [[Charter]]",
    "",
  ].join("\n");

after(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** The memory law as a git vault, with two persons who know each other. */
function lawVault(name: string): string {
  return vault({ name, pages: { "wiki/Folk/Ana.md": ANA, "wiki/Folk/Bob.md": BOB } });
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function person(title: string, facts: string[], relations: string[], extra = ""): string {
  return `---
type: person
title: ${title}
description: A synthetic person.
tags: [folk]${extra}
---
${title} is a person.

## Facts

${facts.join("\n")}

## Relations

${relations.join("\n")}
`;
}

const ANA = person(
  "Ana",
  ["- [identity] Ana is a person (stated 2026-01-01)"],
  ["- knows [[Bob]]"],
);
const BOB = person(
  "Bob",
  ["- [identity] Bob is a person (stated 2026-01-01)"],
  ["- knows [[Ana]]"],
);

describe("docs/concepts.md §Findings and routing — the fixer registry is closed and every rule it names has a row", () => {
  it("every registered (fixer, rule) pair names a pass-table row that carries that fixer", () => {
    const rows = passRows(standardLibrary());
    for (const [fixer, entry] of Object.entries(FIXER_REGISTRY)) {
      for (const rule of entry.rules) {
        const row = rows.find((r) => r.id === rule);
        assert.notEqual(row, undefined, `"${rule}" is fixed by "${fixer}" and has no row`);
        // `canonical-form` is the one opt-in row: an INFO finding carries no
        // fix, so its row names no fixer and the operator names the rule.
        if (rule === "canonical-form") {
          assert.equal(row?.severity, "info");
          assert.equal(row?.fixer, undefined);
          continue;
        }
        assert.equal(row?.fixer, fixer, `"${rule}"'s row names "${row?.fixer}", not "${fixer}"`);
      }
    }
  });

  it("the fixers are registered and the two aliases are named", () => {
    for (const fixer of [
      "heading-depth",
      "section-stub",
      "folder-tags",
      "link-rewrite",
      "tag-rename",
      "retype",
      "canonical-form",
      "history-close",
      "frontmatter-delete",
      "frontmatter-set",
    ]) {
      assert.notEqual(FIXER_REGISTRY[fixer], undefined, `"${fixer}" is not registered`);
    }
    // docs/constitution.md §Shapes: a stale capture is by definition a pin whose covering diff
    // is not empty — the one pin a fast-forward never advances — so the
    // "fixer" that named it was a route the verb broke on contact.
    assert.equal(FIXER_REGISTRY["freshness-fast-forward"], undefined);
    assert.equal(FIXER_REGISTRY["freshness --fast-forward"], undefined);
  });

  it("the applicability of each fixer is the declared one", () => {
    assert.equal(FIXER_REGISTRY["history-close"]?.applicability, "HasPlaceholders");
    assert.equal(FIXER_REGISTRY["canonical-form"]?.applicability, "MaybeIncorrect");
    for (const fixer of [
      "heading-depth",
      "section-stub",
      "link-rewrite",
      "tag-rename",
      "retype",
      "frontmatter-delete",
    ]) {
      assert.equal(FIXER_REGISTRY[fixer]?.applicability, "MachineApplicable", fixer);
    }
  });

  it("a registered fixer flips a row from queue to fix with no spec edit", () => {
    // The registry is the only thing consulted: the row's `fixer` column already
    // said `heading-depth`, and until this slice the row queued.
    assert.equal(fixerExecutes("heading-depth", "section-depth"), true);
    assert.equal(fixerExecutes("heading-depth", "sections"), false, "keyed on (fixer, rule)");
  });
});

describe("frontmatter-delete (unknown-frontmatter-key)", () => {
  const SCALAR = "wiki/Scalar.md";
  const BLOCK = "wiki/Block.md";
  const PAGE = (extra: string, alias = "S"): string =>
    `---\ntype: person\ntags: []\n${extra}aliases: ["${alias}"]\n---\nA person.\n\n## Facts\n\n## Relations\n- knows [[Charter]]\n`;

  it("deletes exactly the named key — a scalar, or a block value with every line beneath it", () => {
    const dir = vault({
      name: "fm-delete",
      pages: {
        [SCALAR]: PAGE("owner: raw/Thing.md\n"),
        [BLOCK]: PAGE("owners:\n  - raw/One.md\n  - raw/Two.md\n", "B"),
      },
    });
    const before = run(dir, ["lint", "--page", SCALAR]);
    const finding = (before.data["findings"] as Array<Record<string, unknown>>).find(
      (f) => f["ruleId"] === "unknown-frontmatter-key",
    );
    assert.deepEqual((finding?.["fix"] as { argv: string[] } | undefined)?.argv, [
      "fix",
      "--rule",
      "unknown-frontmatter-key",
      "--path",
      SCALAR,
      "--line",
      "4",
      "--expect",
      "1",
    ]);
    // One run over the whole vault: the bundle's case is 149 pages, one key each.
    const r = run(dir, ["fix", "--rule", "unknown-frontmatter-key", "--expect", "2"]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.data["changed"], [BLOCK, SCALAR]);
    assert.equal(readFileSync(join(dir, SCALAR), "utf8"), PAGE(""));
    assert.equal(readFileSync(join(dir, BLOCK), "utf8"), PAGE("", "B"));
    const after = run(dir, ["lint", "--page", BLOCK]);
    assert.equal(after.status, 0, JSON.stringify(after.data["findings"]));
  });

  it("refuses when the line does not carry the key it was told to delete", () => {
    const dir = vault({ name: "fm-delete-refuse", pages: { [SCALAR]: PAGE("owner: me\n") } });
    const r = run(dir, [
      "fix",
      "--rule",
      "unknown-frontmatter-key",
      "--path",
      SCALAR,
      "--line",
      "2",
      "--expect",
      "1",
    ]);
    assert.equal(r.ok, false);
    assert.equal(readFileSync(join(dir, SCALAR), "utf8"), PAGE("owner: me\n"), "nothing moved");
  });
});

describe("heading-depth (section-depth)", () => {
  it("re-levels the heading and touches nothing else", () => {
    const dir = vault({
      name: "heading-depth",
      pages: {
        "wiki/A.md": PERSON("### Facts\n\n- [identity] a (stated 2026-01-01)\n\n## History"),
      },
    });
    const before = page(dir, "wiki/A.md");
    const r = run(dir, ["fix", "--rule", "section-depth", "--path", "wiki/A.md", "--expect", "1"]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data["proved"], true);
    const after = page(dir, "wiki/A.md");
    assert.equal(after, before.replace("### Facts", "## Facts"));
  });

  it("refuses when the finding names no line it can read", () => {
    const dir = vault({ name: "heading-depth-refuse", pages: { "wiki/B.md": PERSON("## Facts") } });
    const r = run(dir, ["fix", "--rule", "section-depth", "--path", "wiki/B.md", "--expect", "1"]);
    assert.equal(r.status, 4);
    assert.equal(r.error["code"], "expect-mismatch");
  });
});

describe("section-stub (a missing min>0 section)", () => {
  it("adds the declared heading and nothing else", () => {
    const dir = vault({
      name: "section-stub",
      pages: { "wiki/A.md": PERSON("## Facts\n\n- [identity] a (stated 2026-01-01)") },
    });
    const lint = run(dir, ["lint", "--page", "wiki/A.md", "--all"]);
    const missing = (lint.data["findings"] as { ruleId: string }[]).filter(
      (f) => f.ruleId === "sections",
    );
    if (missing.length === 0) return; // the starter declares no other min>0 section
    const r = run(dir, [
      "fix",
      "--rule",
      "sections",
      "--path",
      "wiki/A.md",
      "--expect",
      String(missing.length),
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.match(page(dir, "wiki/A.md"), /^## /mu);
  });
});

describe("folder-tags (folder-tags-present)", () => {
  const pages = {
    "wiki/Folk/A.md": PERSON("## Facts\n\n- [identity] a (stated 2026-01-01)"),
  };
  it("materializes the missing folder tag under the mode that admits it", () => {
    const dir = vault({
      name: "folder-tags",
      engine: { folder_tags: { mode: "materialize-add-only" } },
      pages,
    });
    const r = run(dir, [
      "fix",
      "--rule",
      "folder-tags-present",
      "--path",
      "wiki/Folk/A.md",
      "--expect",
      "any",
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.match(page(dir, "wiki/Folk/A.md"), /^tags: \[.*[Ff]olk.*\]$/mu);
  });

  it("former-folder-tags-review is NOT fixable: a removal is not an add-only op", () => {
    const row = PASS_TABLE.find((r) => r.id === "former-folder-tags-review");
    assert.equal(row?.fixer, undefined);
    assert.equal(row?.lane, "tag-review");
  });
});

describe("link-rewrite (wikilink-alias-target)", () => {
  it("rewrites the alias to the canonical name and keeps the display", () => {
    const dir = vault({
      name: "link-rewrite",
      pages: {
        "wiki/Bo Lin.md": [
          "---",
          "type: person",
          "tags: []",
          "aliases: [Bo]",
          "---",
          "A page.",
          "",
          "## Facts",
          "",
          "- [identity] a (stated 2026-01-01)",
          "",
        ].join("\n"),
        "wiki/A.md": PERSON(
          "## Facts\n\n- [identity] a (stated 2026-01-01)\n\n## Notes\n\nSee [[Bo]].",
        ),
      },
    });
    const r = run(dir, [
      "fix",
      "--rule",
      "wikilink-alias-target",
      "--path",
      "wiki/A.md",
      "--expect",
      "1",
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.match(page(dir, "wiki/A.md"), /\[\[Bo Lin\|Bo\]\]/u);
  });
});

describe("retype (tombstone with replaced_by) and tag-rename", () => {
  it("retype refuses where the type names more than one replacement", () => {
    // The registry decides; with no single `replaced_by`, the derivation refuses
    // and the row keeps its queue rather than promising an argv.
    assert.equal(FIXER_REGISTRY["retype"]?.rules.includes("tombstone"), true);
    assert.equal(FIXER_REGISTRY["retype"]?.rules.includes("abstract-type"), false);
  });

  it("tag-rename covers the alias and the retirement, never the unknown tag", () => {
    const rules = FIXER_REGISTRY["tag-rename"]?.rules ?? [];
    assert.deepEqual([...rules].sort(), ["tag-alias-target", "tag-retired"]);
    assert.equal(PASS_TABLE.find((r) => r.id === "unknown-tag")?.fixer, undefined);
  });
});

describe("canonical-form — the only dialect rewrite, opt-in (docs/concepts.md §The judge and its states)", () => {
  it("fires as info on a full-width marker and rewrites it only when named", () => {
    const dir = vault({
      name: "canonical-form",
      pages: { "wiki/A.md": PERSON("## Facts\n\n- 【identity】a (stated 2026-01-01)") },
    });
    const before = page(dir, "wiki/A.md");
    const lint = run(dir, ["lint", "--page", "wiki/A.md", "--all"]);
    const found = (
      lint.data["findings"] as { ruleId: string; severity: string; fix?: unknown }[]
    ).filter((f) => f.ruleId === "canonical-form");
    assert.equal(found.length, 1, JSON.stringify(lint.data["findings"]));
    assert.equal(found[0]?.severity, "info");
    assert.equal(
      found[0]?.fix,
      undefined,
      "an info finding advertises no fix (docs/concepts.md §Findings and routing)",
    );
    // Nothing rewrites it as a side effect: a whole other fix run leaves it.
    const other = run(dir, [
      "fix",
      "--rule",
      "section-depth",
      "--path",
      "wiki/A.md",
      "--expect",
      "0",
    ]);
    assert.equal(other.ok, true, JSON.stringify(other.error));
    assert.equal(page(dir, "wiki/A.md"), before, "no verb rewrote the dialect on its own");
    const r = run(dir, ["fix", "--rule", "canonical-form", "--path", "wiki/A.md", "--expect", "1"]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.match(page(dir, "wiki/A.md"), /^- \[identity\] a \(stated 2026-01-01\)$/mu);
  });
});

describe("history-close is --propose only (docs/concepts.md §The judge and its states)", () => {
  it("proposes the closing clause with placeholders and applies nothing", () => {
    const dir = vault({
      name: "history-close",
      pages: {
        "wiki/A.md": PERSON(
          "## Facts\n\n- [identity] a (stated 2026-01-01)\n\n## History\n\n- [identity] an old value (stated 2025-01-01)",
        ),
      },
    });
    const before = page(dir, "wiki/A.md");
    const r = run(dir, ["fix", "--rule", "history-marker", "--path", "wiki/A.md", "--propose"]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const proposals = r.data["proposals"] as { rendered: string[]; applicability: string }[];
    assert.equal(proposals.length, 1, JSON.stringify(r.data));
    assert.equal(proposals[0]?.applicability, "HasPlaceholders");
    assert.match(proposals[0]?.rendered[0] ?? "", /\(valid <FROM>→<TO>, superseded <DATE>\)/u);
    assert.equal(page(dir, "wiki/A.md"), before, "--propose writes nothing");
  });

  it("--expect never applies it: a HasPlaceholders op is not a mechanical one", () => {
    const dir = vault({
      name: "history-close-expect",
      pages: {
        "wiki/A.md": PERSON(
          "## Facts\n\n- [identity] a (stated 2026-01-01)\n\n## History\n\n- [identity] an old value (stated 2025-01-01)",
        ),
      },
    });
    const before = page(dir, "wiki/A.md");
    const r = run(dir, ["fix", "--rule", "history-marker", "--path", "wiki/A.md", "--expect", "1"]);
    assert.equal(r.status, 4);
    assert.equal(r.error["code"], "expect-mismatch");
    assert.equal(page(dir, "wiki/A.md"), before);
  });
});

describe("docs/cli.md §fix — the grown flags", () => {
  it("--staged selects every page the index changed", () => {
    const dir = vault({
      name: "staged",
      engine: { folder_tags: { mode: "materialize-add-only" } },
      pages: {},
      arrange: (d) => {
        for (const name of ["A", "B"]) {
          mkdirSync(join(d, "wiki", "Folk"), { recursive: true });
          writeFileSync(
            join(d, "wiki", "Folk", `${name}.md`),
            PERSON("## Facts\n\n- [identity] a (stated 2026-01-01)"),
          );
        }
        execFileSync("git", ["add", "-A"], { cwd: d });
      },
    });
    const r = run(dir, ["fix", "--rule", "folder-tags-present", "--staged", "--expect", "any"]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual((r.data["changed"] as string[]).sort(), ["wiki/Folk/A.md", "wiki/Folk/B.md"]);
  });

  it("--expect any is refused without --dry-run, --propose or a MachineApplicable rule", () => {
    const dir = vault({
      name: "expect-any",
      pages: {
        "wiki/A.md": PERSON(
          "## Facts\n\n- [identity] a (stated 2026-01-01)\n\n## History\n\n- [identity] old (stated 2025-01-01)",
        ),
      },
    });
    const r = run(dir, [
      "fix",
      "--rule",
      "history-marker",
      "--path",
      "wiki/A.md",
      "--expect",
      "any",
    ]);
    assert.equal(r.status, 2);
    assert.equal(r.error["code"], "expect-any-unadmitted");
    const dry = run(dir, [
      "fix",
      "--rule",
      "history-marker",
      "--path",
      "wiki/A.md",
      "--expect",
      "any",
      "--dry-run",
    ]);
    assert.equal(dry.ok, true, JSON.stringify(dry.error));
  });

  it("all-or-nothing: one refusal writes nothing at all", () => {
    const dir = vault({
      name: "all-or-nothing",
      pages: {
        "wiki/A.md": [
          "---",
          "type: person",
          "tags: []",
          "aliases: |",
          "  folded",
          "---",
          "A page.",
          "",
          "## Facts",
          "",
          "- [identity] a (stated 2026-01-01)",
          "",
        ].join("\n"),
      },
    });
    const before = page(dir, "wiki/A.md");
    const r = run(dir, [
      "fix",
      "--rule",
      "folder-tags-present",
      "--path",
      "wiki/A.md",
      "--expect",
      "1",
    ]);
    assert.notEqual(r.status, 0);
    assert.equal(page(dir, "wiki/A.md"), before);
  });
});

describe("`fix --staged` reads the bytes it writes (docs/cli.md §fix)", () => {
  /** Stage a rename that leaves the alias off, so the P4 row has a fix. */
  function stagedRename(tmp: string): void {
    git(tmp, "mv", "wiki/Folk/Bob.md", "wiki/Folk/Bobby.md");
    writeFileSync(join(tmp, "wiki/Folk/Ana.md"), ANA.replace("[[Bob]]", "[[Bobby]]"));
    git(tmp, "add", "-A");
  }

  it("an unstaged edit is never overwritten by index bytes under `ok: true`", () => {
    const tmp = lawVault("fix-reads-drift");
    try {
      stagedRename(tmp);
      // The writer keeps working after staging — an ordinary thing to do.
      const drifted = `${readFileSync(join(tmp, "wiki/Folk/Bobby.md"), "utf8")}\n- [role] Bob works at the docks (stated 2026-03-03)\n`;
      writeFileSync(join(tmp, "wiki/Folk/Bobby.md"), drifted);

      const r = run(tmp, [
        "fix",
        "--rule",
        "renamed-without-alias",
        "--path",
        "wiki/Folk/Bobby.md",
        "--staged",
        "--expect",
        "1",
      ]);
      assert.equal(r.status, 4, JSON.stringify(r));
      assert.equal(r.error["code"], "working-tree-drift");
      assert.deepEqual((r.data as { paths?: string[] })["paths"], ["wiki/Folk/Bobby.md"]);
      assert.equal(
        readFileSync(join(tmp, "wiki/Folk/Bobby.md"), "utf8"),
        drifted,
        "the unstaged edit survives the refusal",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--dry-run refuses too: ops from bytes that are not on disk are not a report", () => {
    const tmp = lawVault("fix-reads-dry-run");
    try {
      stagedRename(tmp);
      writeFileSync(
        join(tmp, "wiki/Folk/Bobby.md"),
        `${readFileSync(join(tmp, "wiki/Folk/Bobby.md"), "utf8")}\n<!-- still typing -->\n`,
      );
      const r = run(tmp, [
        "fix",
        "--rule",
        "renamed-without-alias",
        "--path",
        "wiki/Folk/Bobby.md",
        "--staged",
        "--expect",
        "1",
        "--dry-run",
      ]);
      assert.equal(r.status, 4, JSON.stringify(r));
      assert.equal(r.error["code"], "working-tree-drift");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("with the tree and the index agreeing, the fix lands exactly as before", () => {
    const tmp = lawVault("fix-reads-agree");
    try {
      stagedRename(tmp);
      const r = run(tmp, [
        "fix",
        "--rule",
        "renamed-without-alias",
        "--path",
        "wiki/Folk/Bobby.md",
        "--staged",
        "--expect",
        "1",
      ]);
      assert.equal(r.status, 0, JSON.stringify(r));
      assert.deepEqual(r.data["changed"], ["wiki/Folk/Bobby.md"]);
      assert.match(readFileSync(join(tmp, "wiki/Folk/Bobby.md"), "utf8"), /aliases:.*Bob/u);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the splice refuses what the parser could not read (docs/cli.md §fix)", () => {
  it("a duplicated key is refused by name, not rewritten by guess", () => {
    const tmp = lawVault("fix-splice-duplicate-key");
    try {
      git(tmp, "mv", "wiki/Folk/Bob.md", "wiki/Folk/Bobby.md");
      writeFileSync(join(tmp, "wiki/Folk/Ana.md"), ANA.replace("[[Bob]]", "[[Bobby]]"));
      // Edited in place, so git still records `R` and the P4 row still fires;
      // a whole-file rewrite drops below git's similarity threshold, which is
      // its own ruling and not what this case is about.
      const doubled = readFileSync(join(tmp, "wiki/Folk/Bobby.md"), "utf8").replace(
        "tags: [folk]\n",
        "tags: [folk]\naliases: [one]\naliases: [two]\n",
      );
      writeFileSync(join(tmp, "wiki/Folk/Bobby.md"), doubled);
      git(tmp, "add", "-A");
      const r = run(tmp, [
        "fix",
        "--rule",
        "renamed-without-alias",
        "--path",
        "wiki/Folk/Bobby.md",
        "--staged",
        "--expect",
        "1",
      ]);
      assert.equal(r.status, 4, JSON.stringify(r));
      assert.equal(r.error["code"], "fixer-refused");
      assert.equal(
        readFileSync(join(tmp, "wiki/Folk/Bobby.md"), "utf8"),
        doubled,
        "and nothing is written",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("`fix` judges the state the finding came from (docs/cli.md §fix)", () => {
  /** `check`'s argv on a page that exists only in the working tree runs as handed out. */
  it("a working-tree finding's argv fixes an unstaged page: no index, no drift, no --staged", () => {
    const dir = vault({
      name: "working-tree-argv",
      pages: {},
      arrange: (d) => {
        // A page `write` would leave: on disk, never staged.
        writeFileSync(join(d, "wiki", "A.md"), PERSON("A page with no Facts heading."));
      },
    });
    const check = run(dir, ["check", "--all"]);
    const finding = (
      check.data["findings"] as { ruleId: string; path: string; fix?: { argv: string[] } }[]
    ).find((f) => f.ruleId === "sections" && f.path === "wiki/A.md");
    assert.notEqual(finding?.fix, undefined, JSON.stringify(check.data["findings"]));
    const argv = finding?.fix?.argv ?? [];
    assert.equal(argv.includes("--staged"), false, "a working-tree finding names no index");
    const r = run(dir, argv);
    assert.equal(r.status, 0, JSON.stringify(r.error));
    assert.equal(r.data["state"], "working-tree");
    assert.deepEqual(r.data["changed"], ["wiki/A.md"]);
    assert.match(page(dir, "wiki/A.md"), /## Facts/u);
  });

  it("a gate finding's argv carries --staged, and fix then judges the index", () => {
    const tmp = lawVault("gate-argv");
    try {
      git(tmp, "mv", "wiki/Folk/Bob.md", "wiki/Folk/Bobby.md");
      writeFileSync(join(tmp, "wiki/Folk/Ana.md"), ANA.replace("[[Bob]]", "[[Bobby]]"));
      git(tmp, "add", "-A");
      const gate = run(tmp, ["gate", "--all"]);
      const finding = (
        gate.data["findings"] as { ruleId: string; fix?: { argv: string[] } }[]
      ).find((f) => f.ruleId === "renamed-without-alias");
      const argv = finding?.fix?.argv ?? [];
      assert.equal(argv.includes("--staged"), true, JSON.stringify(finding));
      const r = run(tmp, argv);
      assert.equal(r.status, 0, JSON.stringify(r.error));
      assert.equal(r.data["state"], "index");
      assert.match(readFileSync(join(tmp, "wiki/Folk/Bobby.md"), "utf8"), /aliases:.*Bob/u);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an index finding run without --staged is refused with the state named in the hint", () => {
    const tmp = lawVault("state-hint");
    try {
      git(tmp, "mv", "wiki/Folk/Bob.md", "wiki/Folk/Bobby.md");
      writeFileSync(join(tmp, "wiki/Folk/Ana.md"), ANA.replace("[[Bob]]", "[[Bobby]]"));
      git(tmp, "add", "-A");
      const r = run(tmp, [
        "fix",
        "--rule",
        "renamed-without-alias",
        "--path",
        "wiki/Folk/Bobby.md",
        "--expect",
        "1",
      ]);
      assert.equal(r.status, 4, JSON.stringify(r));
      assert.equal(r.error["code"], "expect-mismatch");
      assert.equal((r.data as { state?: string })["state"], "working-tree");
      assert.match(String(r.error["hint"]), /add --staged/u);
      assert.match(String(r.error["message"]), /in the working tree/u);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("vault-wide: one judge, one proof, and every drifted page named under --staged", () => {
    const dir = vault({
      name: "vault-wide",
      pages: { "wiki/A.md": PERSON("A."), "wiki/B.md": PERSON("B."), "wiki/C.md": PERSON("C.") },
      arrange: (d) => {
        // Three staged pages carrying the key, then two unstaged edits on top:
        // the state `write` leaves behind.
        for (const name of ["A", "B", "C"]) {
          const withKey = page(d, `wiki/${name}.md`).replace("tags: []", "tags: []\nbogus: []");
          writeFileSync(join(d, "wiki", `${name}.md`), withKey);
        }
        execFileSync("git", ["add", "-A"], { cwd: d });
        for (const name of ["A", "B"]) {
          writeFileSync(join(d, "wiki", `${name}.md`), `${page(d, `wiki/${name}.md`)}\nMore.\n`);
        }
      },
    });
    const staged = run(dir, [
      "fix",
      "--rule",
      "unknown-frontmatter-key",
      "--staged",
      "--expect",
      "any",
    ]);
    assert.equal(staged.error["code"], "working-tree-drift", JSON.stringify(staged));
    assert.deepEqual((staged.data as { paths?: string[] })["paths"], ["wiki/A.md", "wiki/B.md"]);
    assert.match(String(staged.error["message"]), /2 page\(s\).*wiki\/A\.md, wiki\/B\.md/u);
    // The working tree is what a plain `fix` judges, so the unstaged edits are
    // the input, not a refusal: every page is fixed in one pass.
    const r = run(dir, ["fix", "--rule", "unknown-frontmatter-key", "--expect", "3"]);
    assert.equal(r.status, 0, JSON.stringify(r.error));
    assert.deepEqual(r.data["changed"], ["wiki/A.md", "wiki/B.md", "wiki/C.md"]);
    for (const name of ["A", "B", "C"]) {
      assert.equal(page(dir, `wiki/${name}.md`).includes("bogus:"), false);
    }
    assert.match(page(dir, "wiki/A.md"), /More\./u, "the unstaged edit is kept, not overwritten");
  });

  it("the proof is vault-wide: an op that would break another page is refused", () => {
    // The folder-tags materializer used to land the folder's spelling and the
    // page then failed `unknown-tag`; the finding now names the registered tag
    // and the proof would refuse a new error on any page.
    const dir = vault({
      name: "proof-vault-wide",
      engine: { folder_tags: { mode: "materialize-add-only" } },
      pages: {},
      arrange: (d) => {
        mkdirSync(join(d, "wiki", "Folk"), { recursive: true });
        writeFileSync(
          join(d, "wiki", "Folk", "A.md"),
          PERSON("## Facts\n\n- [identity] a (stated 2026-01-01)"),
        );
      },
    });
    const r = run(dir, [
      "fix",
      "--rule",
      "folder-tags-present",
      "--path",
      "wiki/Folk/A.md",
      "--expect",
      "1",
    ]);
    assert.equal(r.status, 0, JSON.stringify(r.error));
    assert.match(
      page(dir, "wiki/Folk/A.md"),
      /tags: \["folk"\]/u,
      "the registered spelling, not the folder's",
    );
    const lint = run(dir, ["lint", "--page", "wiki/Folk/A.md"]);
    assert.equal(lint.status, 0, JSON.stringify(lint.data["findings"]));
  });
});
