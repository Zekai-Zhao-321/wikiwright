// docs/concepts.md §Findings and routing — the RUNTIME half of the law. `unroutableRows`
// holds the table statically; this file holds every finding the engine actually
// emits on every corpus in the repository, plus the two paths that reach the
// envelope without a `ruleId:` literal at the emit site: the frontmatter parse
// codes and the vault passes. A finding that
// reaches the envelope carrying neither `fix` nor `queue` is a class-B hole.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { passRows, standardLibrary } from "@wikiwright/core";
import { grantedCopy, kitEnv } from "./fixtures/kit-code.ts";
import { MEMORY_LAW } from "./fixtures/memory-law.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const LAW = join(MEMORY_LAW, "config");

interface Finding {
  ruleId: string;
  pass?: string;
  severity: string;
  path: string;
  queue?: string;
  fix?: { argv: string[]; applicability: string };
}

function envelopeOf(args: string[], root?: string): { data?: { findings?: Finding[] } } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    // A corpus over a kit is judged under the copy's own trust store; the
    // others declare no module and never consult one.
    ...(root === undefined ? {} : { env: kitEnv(root) }),
  });
  return JSON.parse(r.stdout) as { data?: { findings?: Finding[] } };
}

const LANES = new Set(
  passRows(standardLibrary())
    .map((row) => row.lane)
    .filter((l) => l !== undefined),
);
const APPLICABILITY = new Set(["MachineApplicable", "MaybeIncorrect", "HasPlaceholders"]);

function assertRouted(findings: readonly Finding[], where: string): number {
  for (const f of findings) {
    const routes = (f.fix === undefined ? 0 : 1) + (f.queue === undefined ? 0 : 1);
    if (f.severity === "info") {
      assert.equal(routes, 0, `${where}: info finding ${f.ruleId} routes somewhere`);
      continue;
    }
    assert.equal(routes, 1, `${where}: ${f.ruleId} (${f.severity}) must carry exactly one route`);
    if (f.queue !== undefined) {
      assert.equal(LANES.has(f.queue as never), true, `${where}: unknown lane ${f.queue}`);
    }
    if (f.fix !== undefined) {
      assert.equal(
        APPLICABILITY.has(f.fix.applicability),
        true,
        `${where}: ${f.ruleId} has applicability ${f.fix.applicability}`,
      );
      assert.equal(f.fix.argv.length > 0, true, `${where}: ${f.ruleId} has an empty argv`);
    }
  }
  return findings.length;
}

// devwiki is a bundle over the code kit: judged from an installed, granted copy
// under os.tmpdir(), never from the shipped tree (docs/extending.md §The code kit).
const DEVWIKI_COPY = grantedCopy(join(REPO, "devwiki"), "xor-devwiki");
after(() => rmSync(DEVWIKI_COPY, { recursive: true, force: true }));

const CORPORA: Record<string, string> = {
  "memory-synth": join(REPO, "fixtures/memory-synth"),
  devwiki: DEVWIKI_COPY,
  "minimal-vault": join(REPO, "fixtures/minimal-vault"),
};

describe("every emitted finding routes (docs/concepts.md §Findings and routing)", () => {
  for (const [name, root] of Object.entries(CORPORA)) {
    it(`lint --all over ${name}`, () => {
      const findings = envelopeOf(["lint", "--root", root, "--all"], root).data?.findings ?? [];
      const n = assertRouted(findings, `lint ${name}`);
      // devwiki is clean, so its `lint` produces nothing. The routing law is
      // about findings that EXIST; the "produced something" guard stays on the
      // corpora that still do, so this test cannot pass vacuously everywhere at
      // once.
      if (name !== "devwiki") {
        assert.equal(n > 0, true, `${name} produced findings to judge (${n})`);
      }
    });

    it(`check --all over ${name}`, () => {
      const findings = envelopeOf(["check", "--root", root, "--all"], root).data?.findings ?? [];
      assertRouted(findings, `check ${name}`);
    });
  }

  it("the parse seam's own codes route: malformed frontmatter and a duplicate key", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-xor-"));
    try {
      mkdirSync(join(tmp, "config"), { recursive: true });
      mkdirSync(join(tmp, "wiki"), { recursive: true });
      cpSync(join(LAW, "constitution.json"), join(tmp, "config/constitution.json"));
      writeFileSync(join(tmp, "config/engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
      // Unparseable YAML, and a mapping with the same key twice.
      writeFileSync(
        join(tmp, "wiki/Broken.md"),
        "---\ntype: person\n  bad: [unclosed\n---\nbody\n",
      );
      writeFileSync(
        join(tmp, "wiki/Doubled.md"),
        "---\ntype: person\ntitle: Doubled\ntitle: Doubled\ndescription: d\ntags: [folk]\n---\nbody\n",
      );
      const findings = envelopeOf(["lint", "--root", tmp, "--all"]).data?.findings ?? [];
      const ids = new Set(findings.map((f) => f.ruleId));
      assert.equal(
        ids.has("malformed-frontmatter") || ids.has("frontmatter-not-mapping"),
        true,
        `the parse seam fired: ${[...ids].join(", ")}`,
      );
      assert.equal(ids.has("duplicate-key"), true, `duplicate-key fired: ${[...ids].join(", ")}`);
      assertRouted(findings, "parse codes");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // docs/concepts.md §Findings and routing: `okf check`, `move` and `new` build findings
  // outside `judge`. The law is about what an agent RECEIVES, so it binds every
  // verb that prints a finding, and these three were printing unrouted ones.
  it("okf check routes its findings, including okf-missing-type", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-xor-okf-"));
    try {
      mkdirSync(join(tmp, "config"), { recursive: true });
      mkdirSync(join(tmp, "wiki"), { recursive: true });
      cpSync(join(LAW, "constitution.json"), join(tmp, "config/constitution.json"));
      writeFileSync(join(tmp, "config/engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
      writeFileSync(join(tmp, "wiki/NoType.md"), "---\ntitle: NoType\n---\nbody\n");
      const findings = envelopeOf(["okf", "check", "--root", tmp]).data?.findings ?? [];
      const ids = new Set(findings.map((f) => f.ruleId));
      assert.equal(ids.has("okf-missing-type"), true, `okf fired: ${[...ids].join(", ")}`);
      assertRouted(findings, "okf check");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("move routes its findings, folder-tags-present included", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-xor-move-"));
    try {
      mkdirSync(join(tmp, "config"), { recursive: true });
      mkdirSync(join(tmp, "wiki/Folk"), { recursive: true });
      mkdirSync(join(tmp, "wiki/Kin"), { recursive: true });
      cpSync(join(LAW, "constitution.json"), join(tmp, "config/constitution.json"));
      cpSync(join(LAW, "engine.json"), join(tmp, "config/engine.json"));
      writeFileSync(
        join(tmp, "wiki/Folk/Ada.md"),
        "---\ntype: person\ntitle: Ada\ndescription: A person.\ntags: [folk]\n---\nAda is a person.\n\n## Facts\n\n- [identity] Ada is a person (stated 2026-01-01)\n\n## Relations\n\n- knows [[Ada]]\n",
      );
      spawnSync("git", ["init", "-q"], { cwd: tmp });
      spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: tmp });
      spawnSync("git", ["config", "user.name", "T"], { cwd: tmp });
      spawnSync("git", ["add", "-A"], { cwd: tmp });
      spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: tmp });
      const findings =
        envelopeOf([
          "move",
          "wiki/Folk/Ada.md",
          "wiki/Kin/Ada.md",
          "--reason",
          "activity-boundary",
          "--root",
          tmp,
        ]).data?.findings ?? [];
      assert.equal(findings.length > 0, true, "the move fires the folder rows");
      assertRouted(findings, "move");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function run(cwd: string, args: string[]): { status: number; envelope: RunEnvelope } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as RunEnvelope };
}

interface RunEnvelope {
  ok: boolean;
  error?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

const findingsIn = (e: RunEnvelope): Finding[] => (e.data?.["findings"] ?? []) as Finding[];

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

/** The memory law, as a git vault — engine.json included verbatim. */
function lawVault(engine?: Record<string, unknown>): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-routing-"));
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

describe("the shipped starter has no unfixable blocking row (docs/concepts.md §Findings and routing)", () => {
  it("under the starter's own `validate` mode, folder-tags-present queues", () => {
    const tmp = lawVault();
    try {
      const engine = JSON.parse(readFileSync(join(tmp, "config/engine.json"), "utf8")) as {
        folder_tags?: { mode?: string };
      };
      assert.equal(engine.folder_tags?.mode, "validate", "the starter ships validate");
      // A page whose folder segment is not in its tags: the row fires.
      mkdirSync(join(tmp, "wiki/Folk/Kin"), { recursive: true });
      writeFileSync(
        join(tmp, "wiki/Folk/Kin/Cal.md"),
        person("Cal", ["- [identity] Cal is a person (stated 2026-01-01)"], ["- knows [[Ana]]"]),
      );
      const r = run(tmp, ["lint", "--all"]);
      const row = findingsIn(r.envelope).find((f) => f.ruleId === "folder-tags-present");
      assert.notEqual(row, undefined, JSON.stringify(findingsIn(r.envelope).map((f) => f.ruleId)));
      assert.equal(
        row?.fix,
        undefined,
        "no argv: the materializer is not admitted under this mode",
      );
      assert.equal(row?.queue, "tag-review");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("under materialize-add-only the row is fix-routed and its argv runs", () => {
    const tmp = lawVault();
    try {
      const engine = JSON.parse(readFileSync(join(tmp, "config/engine.json"), "utf8")) as Record<
        string,
        unknown
      >;
      engine["folder_tags"] = { mode: "materialize-add-only" };
      writeFileSync(join(tmp, "config/engine.json"), JSON.stringify(engine, null, 2));
      mkdirSync(join(tmp, "wiki/Folk/Kin"), { recursive: true });
      writeFileSync(
        join(tmp, "wiki/Folk/Kin/Cal.md"),
        person("Cal", ["- [identity] Cal is a person (stated 2026-01-01)"], ["- knows [[Ana]]"]),
      );
      const r = run(tmp, ["lint", "--all"]);
      const row = findingsIn(r.envelope).find((f) => f.ruleId === "folder-tags-present");
      assert.notEqual(row, undefined, JSON.stringify(findingsIn(r.envelope).map((f) => f.ruleId)));
      assert.equal(row?.fix?.applicability, "MachineApplicable");
      const applied = run(tmp, [...(row?.fix?.argv ?? [])]);
      assert.notEqual(
        applied.envelope.error?.["code"],
        "mode-required",
        "a fix-routed row's argv is never a promise the verb breaks",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
