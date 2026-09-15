// docs/concepts.md §The gate (a new line on a legacy page blocks the commit
// and the legacy lines are demoted; the gate blocks what the commit caused,
// and a rename git declines to pair is caught by the link law) ·
// docs/cli.md §gate · docs/cli.md §fix (the finding's argv is the command that
// fixes it) · docs/concepts.md §Findings and routing (the cap never hides the
// finding the gate blocks on)
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MEMORY_LAW } from "./fixtures/memory-law.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const LAW = join(MEMORY_LAW, "config");

interface Finding {
  ruleId: string;
  severity: string;
  path: string;
  line?: number;
  queue?: string;
  fix?: { argv: string[]; applicability: string };
  new_since_base?: boolean;
  details?: Record<string, unknown>;
}

interface Envelope {
  ok: boolean;
  error?: { code: string; exit_code: number };
  data?: Record<string, unknown>;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function run(cwd: string, args: string[]): { status: number; envelope: Envelope } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

const findings = (e: Envelope): Finding[] => (e.data?.["findings"] ?? []) as Finding[];
const summary = (e: Envelope): Record<string, number> =>
  (e.data?.["summary"] ?? {}) as Record<string, number>;

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

const LEGACY = person(
  "Alpha",
  [
    "- [bogus-one] Alpha likes tea (stated 2026-01-01)",
    "- [bogus-two] Alpha lives east (stated 2026-01-01)",
    "- [bogus-three] Alpha works late (stated 2026-01-01)",
  ],
  ["- knows [[Beta]]"],
);
const BETA = person(
  "Beta",
  ["- [identity] Beta is a person (stated 2026-01-01)"],
  ["- knows [[Alpha]]"],
);

/** A vault whose `Facts` section declares `severity: "error"` — the ratchet, pulled. */
function ratchetedVault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-gate-"));
  mkdirSync(join(tmp, "config"), { recursive: true });
  mkdirSync(join(tmp, "wiki/Folk"), { recursive: true });
  cpSync(join(LAW, "constitution.json"), join(tmp, "config/constitution.json"));
  const law = JSON.parse(readFileSync(join(tmp, "config/constitution.json"), "utf8")) as {
    fragments: Record<string, { sections?: { list: { heading: string; severity?: string }[] } }>;
  };
  for (const entry of law.fragments["entity-body"]?.sections?.list ?? []) {
    if (entry.heading === "Facts") entry.severity = "error";
  }
  writeFileSync(join(tmp, "config/constitution.json"), JSON.stringify(law, null, 2));
  writeFileSync(join(tmp, "config/engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
  writeFileSync(join(tmp, "wiki/Folk/Alpha.md"), LEGACY);
  writeFileSync(join(tmp, "wiki/Folk/Beta.md"), BETA);
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "initial");
  return tmp;
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

/** The memory law, as a git vault — engine.json included verbatim. */
function lawVault(engine?: Record<string, unknown>): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-gate-"));
  mkdirSync(join(tmp, "config"), { recursive: true });
  mkdirSync(join(tmp, "wiki/Folk"), { recursive: true });
  cpSync(join(LAW, "constitution.json"), join(tmp, "config/constitution.json"));
  cpSync(join(LAW, "engine.json"), join(tmp, "config/engine.json"));
  if (engine !== undefined) {
    writeFileSync(join(tmp, "config/engine.json"), JSON.stringify(engine, null, 2));
  }
  writeFileSync(join(tmp, "wiki/Folk/Ana.md"), ANA);
  writeFileSync(join(tmp, "wiki/Folk/Bob.md"), BOB);
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "initial");
  return tmp;
}

describe("the gate rule, end to end (docs/concepts.md §The gate)", () => {
  it("one new bullet on a legacy page: exit 5, one error, three demoted warnings", () => {
    const tmp = ratchetedVault();
    try {
      writeFileSync(
        join(tmp, "wiki/Folk/Alpha.md"),
        LEGACY.replace(
          "- [bogus-three] Alpha works late (stated 2026-01-01)",
          "- [bogus-three] Alpha works late (stated 2026-01-01)\n- [bogus-four] Alpha bought a bike (stated 2026-02-02)",
        ),
      );
      git(tmp, "add", "-A");
      const r = run(tmp, ["gate", "--root", ".", "--all"]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      const unknown = findings(r.envelope).filter((f) => f.ruleId === "unknown-category");
      assert.equal(unknown.length, 4);
      assert.equal(summary(r.envelope)["errors"], 1, "only the new line blocks the commit");
      const demoted = unknown.filter((f) => f.details?.["demoted_from"] === "error");
      assert.equal(demoted.length, 3);
      for (const f of demoted) {
        assert.equal(f.severity, "warning");
        assert.equal(f.new_since_base, false);
        assert.equal(f.queue, "category-review");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an unrelated one-line edit on the same page: exit 0, three warnings", () => {
    const tmp = ratchetedVault();
    try {
      writeFileSync(
        join(tmp, "wiki/Folk/Alpha.md"),
        LEGACY.replace("Alpha is a person.", "Alpha is a person, briefly."),
      );
      git(tmp, "add", "-A");
      const r = run(tmp, ["gate", "--root", ".", "--all"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      assert.equal(
        findings(r.envelope).filter(
          (f) => f.ruleId === "unknown-category" && f.severity === "warning",
        ).length,
        3,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("whole-vault lint has no base, so no demotion and no new_since_base", () => {
    const tmp = ratchetedVault();
    try {
      const r = run(tmp, ["lint", "--root", ".", "--all"]);
      assert.equal(r.status, 5);
      const unknown = findings(r.envelope).filter((f) => f.ruleId === "unknown-category");
      assert.equal(unknown.length, 3);
      for (const f of unknown) {
        assert.equal(f.severity, "error");
        assert.equal(f.new_since_base, undefined);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("renamed-without-alias and the fix verb (docs/cli.md §fix)", () => {
  it("an Obsidian rename that drops the alias fails the gate with a MachineApplicable fix", () => {
    const tmp = ratchetedVault();
    try {
      git(tmp, "mv", "wiki/Folk/Beta.md", "wiki/Folk/Beta Prime.md");
      writeFileSync(
        join(tmp, "wiki/Folk/Alpha.md"),
        LEGACY.replace("knows [[Beta]]", "knows [[Beta Prime]]"),
      );
      git(tmp, "add", "-A");
      const r = run(tmp, ["gate", "--root", ".", "--all"]);
      const finding = findings(r.envelope).find((f) => f.ruleId === "renamed-without-alias");
      assert.notEqual(finding, undefined, JSON.stringify(r.envelope));
      assert.equal(finding?.severity, "error");
      assert.equal(finding?.fix?.applicability, "MachineApplicable");
      assert.equal(finding?.queue, undefined);
      assert.equal(finding?.fix?.argv[0], "fix");

      // The argv the finding carries is the command that fixes it.
      const fixed = run(tmp, [...(finding?.fix?.argv ?? []), "--root", "."]);
      assert.equal(fixed.status, 0, JSON.stringify(fixed.envelope));
      assert.deepEqual(fixed.envelope.data?.["changed"], ["wiki/Folk/Beta Prime.md"]);
      assert.equal(fixed.envelope.data?.["proved"], true);
      const text = readFileSync(join(tmp, "wiki/Folk/Beta Prime.md"), "utf8");
      assert.equal(text.includes("Beta"), true);
      assert.match(text, /aliases:/);

      git(tmp, "add", "-A");
      const after = run(tmp, ["gate", "--root", ".", "--all"]);
      assert.equal(
        findings(after.envelope).some((f) => f.ruleId === "renamed-without-alias"),
        false,
        "the fix is proved by the same judge that raised the finding",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a rename whose new page already carries the alias fires nothing", () => {
    const tmp = ratchetedVault();
    try {
      writeFileSync(
        join(tmp, "wiki/Folk/Beta.md"),
        person(
          "Beta",
          ["- [identity] Beta is a person (stated 2026-01-01)"],
          ["- knows [[Alpha]]"],
          "\naliases: [Beta]",
        ),
      );
      git(tmp, "add", "-A");
      git(tmp, "commit", "-q", "-m", "alias first");
      git(tmp, "mv", "wiki/Folk/Beta.md", "wiki/Folk/Beta Prime.md");
      writeFileSync(
        join(tmp, "wiki/Folk/Alpha.md"),
        LEGACY.replace("knows [[Beta]]", "knows [[Beta Prime]]"),
      );
      git(tmp, "add", "-A");
      const r = run(tmp, ["gate", "--root", ".", "--all"]);
      assert.equal(
        findings(r.envelope).some((f) => f.ruleId === "renamed-without-alias"),
        false,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--expect refuses a count it did not find, and --dry-run writes nothing", () => {
    const tmp = ratchetedVault();
    try {
      git(tmp, "mv", "wiki/Folk/Beta.md", "wiki/Folk/Beta Prime.md");
      writeFileSync(
        join(tmp, "wiki/Folk/Alpha.md"),
        LEGACY.replace("knows [[Beta]]", "knows [[Beta Prime]]"),
      );
      git(tmp, "add", "-A");
      const before = readFileSync(join(tmp, "wiki/Folk/Beta Prime.md"), "utf8");
      const wrong = run(tmp, [
        "fix",
        "--rule",
        "renamed-without-alias",
        "--path",
        "wiki/Folk/Beta Prime.md",
        "--staged",
        "--expect",
        "2",
        "--root",
        ".",
      ]);
      assert.equal(wrong.status, 4, JSON.stringify(wrong.envelope));
      assert.equal(wrong.envelope.error?.code, "expect-mismatch");
      const dry = run(tmp, [
        "fix",
        "--rule",
        "renamed-without-alias",
        "--path",
        "wiki/Folk/Beta Prime.md",
        "--staged",
        "--expect",
        "1",
        "--dry-run",
        "--root",
        ".",
      ]);
      assert.equal(dry.status, 0, JSON.stringify(dry.envelope));
      assert.deepEqual(dry.envelope.data?.["changed"], []);
      assert.equal(
        readFileSync(join(tmp, "wiki/Folk/Beta Prime.md"), "utf8"),
        before,
        "--dry-run is byte-identical",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the gate blocks what the commit caused (docs/concepts.md §The gate)", () => {
  it("a rename that turns a live link into an alias link blocks the commit", () => {
    const tmp = lawVault();
    try {
      git(tmp, "mv", "wiki/Folk/Ana.md", "wiki/Folk/Anna.md");
      writeFileSync(
        join(tmp, "wiki/Folk/Anna.md"),
        person(
          "Anna",
          ["- [identity] Anna is a person (stated 2026-01-01)"],
          ["- knows [[Bob]]"],
          "\naliases: [Ana]",
        ),
      );
      git(tmp, "add", "-A");

      const lint = run(tmp, ["lint", "--root", ".", "--all"]);
      const inLint = findings(lint.envelope).filter(
        (f) => f.ruleId === "wikilink-alias-target" && f.path === "wiki/Folk/Bob.md",
      );
      assert.equal(inLint.length, 1, "lint sees it");

      const gate = run(tmp, ["gate", "--root", ".", "--all"]);
      const inGate = findings(gate.envelope).filter(
        (f) => f.ruleId === "wikilink-alias-target" && f.path === "wiki/Folk/Bob.md",
      );
      assert.equal(inGate.length, 1, "and so does the gate — it caused it");
      assert.equal(inGate[0]?.severity, "error");
      assert.equal(gate.status, 5, JSON.stringify(summary(gate.envelope)));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a rename below git's similarity threshold: the alias law misses, the link law does not", () => {
    const tmp = lawVault();
    try {
      // Git records this as D+A, not R, and the threshold is
      // deliberately left alone. The consequence the alias law exists to
      // prevent is caught by the name-index scoping instead.
      git(tmp, "mv", "wiki/Folk/Ana.md", "wiki/Folk/Zelda.md");
      writeFileSync(
        join(tmp, "wiki/Folk/Zelda.md"),
        person(
          "Zelda",
          [
            "- [identity] Zelda studies marine biology at a coastal institute (stated 2026-04-04)",
            "- [role] Zelda coordinates the tide survey every second Thursday (stated 2026-04-04)",
          ],
          ["- knows [[Bob]]"],
        ),
      );
      git(tmp, "add", "-A");
      const staged = git(tmp, "diff", "--cached", "--name-status", "-M");
      assert.equal(/^R/mu.test(staged), false, `git paired them after all: ${staged}`);

      const gate = run(tmp, ["gate", "--root", ".", "--all"]);
      assert.equal(
        findings(gate.envelope).some((f) => f.ruleId === "renamed-without-alias"),
        false,
        "the alias law needs a successor git declined to name",
      );
      const dangling = findings(gate.envelope).find(
        (f) => f.ruleId === "wikilink-unresolved" && f.path === "wiki/Folk/Bob.md",
      );
      assert.notEqual(
        dangling,
        undefined,
        "but the dangling link is reported, on an untouched page",
      );
      assert.equal(dangling?.new_since_base, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the cap never hides the finding it blocks on (docs/concepts.md §Findings and routing)", () => {
  // One page carrying the warnings, not sixty: the staged gate reads every
  // page through `git show`, and sixty spawns outran the runner's default
  // timeout on the Windows CI host (killed process, empty stdout). Two pages
  // hit the cap just as well and keep the case about the cap, not the clock.
  it("gate prints the error even when it sorts past the default limit", { timeout: 60_000 }, () => {
    const tmp = lawVault();
    try {
      // Many warnings on one page sorting before the one page with an error.
      mkdirSync(join(tmp, "wiki/Folk"), { recursive: true });
      const unresolved: string[] = [];
      for (let i = 0; i < 60; i += 1)
        unresolved.push(`- knows [[Nobody ${String(i).padStart(3, "0")}]]`);
      writeFileSync(
        join(tmp, "wiki/Folk/Aaa.md"),
        person("Aaa", ["- [identity] Aaa is a person (stated 2026-01-01)"], unresolved),
      );
      writeFileSync(
        join(tmp, "wiki/Folk/Zzz.md"),
        person(
          "Zzz",
          ["- [identity] Zzz is a person (stated 2026-01-01)"],
          ["- knows [[Ana]]"],
          "\ntags: [folk]",
        ),
      );
      git(tmp, "add", "-A");
      const r = run(tmp, ["gate", "--root", "."]);
      const caps = r.envelope.data?.["caps"] as { hit?: boolean } | undefined;
      assert.equal(caps?.hit, true, "the fixture actually hits the cap");
      assert.equal(
        (summary(r.envelope)["errors"] ?? 0) > 0,
        true,
        JSON.stringify(r.envelope.error),
      );
      assert.equal(r.status, 5, "the commit is blocked");
      assert.equal(
        findings(r.envelope).some((f) => f.severity === "error"),
        true,
        "a hook that blocks prints what it blocked on",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
