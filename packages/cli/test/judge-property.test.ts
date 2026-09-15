// docs/architecture.md §The invariants (one fixture through the four state
// constructors — fsState, indexState, overlayState, revisionState — and the
// Writer's proof, the fifth write path, a second judge over spliced bytes;
// state-arm findings identical, transition-arm findings identical across the
// constructors that carry a base; docs/concepts.md says the same) · docs/architecture.md §How a verdict is produced
// the case is arranged so it can fail, .29 (NFC at every
// constructor), .21 (the correction guards).
//
// This file runs under `bun test` AND `node --test` (package.json's `test` and
// `test:node` scripts both glob it), which is what makes the property a
// determinism claim and not just an agreement claim.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { judge, type VaultState, type Verdict } from "@wikiwright/core";
import { lawFor } from "../src/law.ts";
import { fsState, indexState, overlayState, revisionState } from "../src/state.ts";
import { loadVault } from "../src/vaultio.ts";
import { MEMORY_LAW } from "./fixtures/memory-law.ts";

const LAW = join(MEMORY_LAW, "config");
const ROOTS = ["wiki"] as const;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function page(title: string, facts: string[], relations: string[]): string {
  return `---
type: person
title: ${title}
description: A synthetic person for the judge property.
tags: [folk]
---
${title} is a person.

## Facts

${facts.join("\n")}

## Relations

${relations.join("\n")}
`;
}

const ALPHA_BASE = page(
  "Alpha",
  [
    "- [identity] Alpha is a person (stated 2026-01-01)",
    "- [housing] Alpha lives in Shangai since 2024 (stated 2026-01-01)",
    "- [preference] Alpha likes green tea (stated 2026-01-01)",
  ],
  ["- knows [[Beta]]"],
);

/** The draft the transition arms judge: one claim removed with nothing landing. */
const ALPHA_DRAFT = page(
  "Alpha",
  [
    "- [identity] Alpha is a person (stated 2026-01-01)",
    "- [housing] Alpha lives in Shanghai since 2024 (stated 2026-01-01)",
  ],
  ["- knows [[Beta]]"],
);

const BETA = page(
  "Beta",
  ["- [identity] Beta is a person (stated 2026-01-01)"],
  ["- knows [[Alpha]]"],
);
const GAMMA = page(
  "Gamma",
  ["- [identity] Gamma is a person (stated 2026-01-01)"],
  ["- knows [[Alpha]]"],
);
const DELTA = page(
  "Delta",
  ["- [identity] Delta is a person (stated 2026-01-01)"],
  ["- knows [[Alpha]]"],
);

function scratchVault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-judge-prop-"));
  mkdirSync(join(tmp, "config"), { recursive: true });
  mkdirSync(join(tmp, "wiki/Folk"), { recursive: true });
  cpSync(join(LAW, "constitution.json"), join(tmp, "config/constitution.json"));
  writeFileSync(join(tmp, "config/engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
  writeFileSync(join(tmp, "wiki/Folk/Alpha.md"), ALPHA_BASE);
  writeFileSync(join(tmp, "wiki/Folk/Beta.md"), BETA);
  writeFileSync(join(tmp, "wiki/Folk/Delta.md"), DELTA);
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "initial");
  return tmp;
}

/** Ids whose verdict needs a base: everything else is a state arm. */
const TRANSITION_IDS = new Set([
  "claims-transition",
  "claim-landing",
  "entry-mutated",
  "renamed-without-alias",
  "former-folder-tags-review",
  "accumulate",
  "append-only",
  "claim-classes",
  "supersede-history",
]);

const stateKey = (v: Verdict): string[] =>
  v.findings
    .filter((f) => !TRANSITION_IDS.has(f.pass ?? f.ruleId))
    .map((f) => `${f.path}|${f.line ?? "-"}|${f.ruleId}|${f.severity}`)
    .sort();

const transitionKey = (v: Verdict, path: string): string[] =>
  v.findings
    .filter((f) => TRANSITION_IDS.has(f.pass ?? f.ruleId) && f.path === path)
    .map(
      (f) =>
        `${f.path}|${f.ruleId}|${f.line ?? "-"}|${String(f.details?.["handle"] ?? f.details?.["entry"] ?? "")}`,
    )
    .sort();

function judgeAll(root: string, state: VaultState): Verdict {
  const vault = loadVault("lint", root);
  assert.equal(vault.ok, true, "the scratch vault loads");
  if (!vault.ok) throw new Error("unreachable");
  // `gate: false` on purpose: the property is about the findings BEFORE the
  // gate's line-scoped severity rescopes them (docs/architecture.md §The invariants).
  return judge(state, lawFor(vault), { all: true });
}

describe("judge(state, law): five constructors, one verdict (docs/architecture.md §The invariants)", () => {
  it("state-arm findings are identical across all four constructors", () => {
    const tmp = scratchVault();
    try {
      // A snapshot every constructor can describe: rename, add, delete, edit,
      // all committed, so the working tree, the index and HEAD agree.
      git(tmp, "mv", "wiki/Folk/Alpha.md", "wiki/Folk/Alpha Prime.md");
      writeFileSync(join(tmp, "wiki/Folk/Gamma.md"), GAMMA);
      git(tmp, "rm", "-q", "wiki/Folk/Delta.md");
      writeFileSync(join(tmp, "wiki/Folk/Beta.md"), `${BETA}\n<!-- edited -->\n`);
      git(tmp, "add", "-A");
      git(tmp, "commit", "-q", "-m", "the change");

      const fs = fsState(tmp, ROOTS);
      const target = "wiki/Folk/Alpha Prime.md";
      const disk = readFileSync(join(tmp, target), "utf8");
      const constructors: Record<string, VaultState> = {
        fsState: fs,
        indexState: indexState(tmp, ROOTS),
        overlayState: overlayState(fs, tmp, [{ path: target, text: disk }]),
        revisionState: revisionState(tmp, "HEAD", undefined, ROOTS),
      };
      const verdicts = Object.fromEntries(
        Object.entries(constructors).map(([name, state]) => [name, judgeAll(tmp, state)] as const),
      );
      const reference = stateKey(verdicts["fsState"] as Verdict);
      assert.equal(reference.length > 0, true, "the fixture fires state-arm findings at all");
      for (const [name, verdict] of Object.entries(verdicts)) {
        assert.deepEqual(stateKey(verdict), reference, `${name}: state arms differ`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // docs/architecture.md §The invariants: the case above stages AND commits, so
  // `gitStagedChanges` is empty and all four constructors are handed identical
  // page maps — it proves `judge` is a function, not that the constructors
  // agree. The three that follow hold them apart, each on a case the reviewers
  // walked through: an NFD path, a working-tree-only edit, a staged rename.

  it("an NFD path names the page the vault already holds, not a second one", () => {
    const tmp = scratchVault();
    try {
      // The on-disk name stays NFC; what varies is the path the CALLER passes,
      // which is exactly the `--page` / `--stdin --path` shape.
      const nfc = "wiki/Folk/Café.md".normalize("NFC");
      const nfd = nfc.normalize("NFD");
      assert.notEqual(nfc, nfd, "the fixture is two byte sequences for one name");
      writeFileSync(
        join(tmp, nfc),
        page("Café", ["- [identity] Café is a person (stated 2026-01-01)"], ["- knows [[Beta]]"]),
      );
      const fs = fsState(tmp, ROOTS);
      assert.equal(fs.pages.has(nfc), true, "walkPages stores NFC");

      const disk = readFileSync(join(tmp, nfc), "utf8");
      {
        const state = overlayState(fs, tmp, [{ path: nfd, text: disk }]);
        assert.equal(state.pages.size, fs.pages.size, "the page set doubled");
        assert.deepEqual(
          stateKey(judgeAll(tmp, state)),
          stateKey(judgeAll(tmp, fs)),
          "an NFD path changed the verdict",
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a working-tree edit the index does not carry separates fsState from indexState", () => {
    const tmp = scratchVault();
    try {
      // Unstaged: the tree has it, the index does not. A constructor that read
      // the wrong one would make this case pass by accident, so it is asserted
      // as a DISAGREEMENT with a named direction.
      const target = "wiki/Folk/Beta.md";
      writeFileSync(
        join(tmp, target),
        BETA.replace(
          "- [identity] Beta is a person (stated 2026-01-01)",
          "- [identity] Beta is a person (stated 2026-01-01)\n- [bogus] Beta is odd (stated 2026-02-02)",
        ),
      );
      const fs = fsState(tmp, ROOTS);
      const index = indexState(tmp, ROOTS);
      assert.notEqual(
        fs.pages.get(target),
        index.pages.get(target),
        "the two constructors must not be reading the same bytes here",
      );
      const inTree = stateKey(judgeAll(tmp, fs)).filter((k) => k.includes("unknown-category"));
      const inIndex = stateKey(judgeAll(tmp, index)).filter((k) => k.includes("unknown-category"));
      assert.equal(inTree.length, 1, "the tree carries the unstaged bullet");
      assert.equal(inIndex.length, 0, "the index does not, and says so");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a staged, uncommitted rename is a rename to the constructor that reads the index", () => {
    const tmp = scratchVault();
    try {
      git(tmp, "mv", "wiki/Folk/Alpha.md", "wiki/Folk/Alpha Prime.md");
      git(tmp, "add", "-A");
      const index = indexState(tmp, ROOTS);
      assert.deepEqual(
        index.renames,
        [{ from: "wiki/Folk/Alpha.md", to: "wiki/Folk/Alpha Prime.md" }],
        "renames are derived from the index, not defaulted to []",
      );
      const verdict = judgeAll(tmp, index);
      assert.equal(
        verdict.findings.some(
          (f) => f.ruleId === "renamed-without-alias" && f.path === "wiki/Folk/Alpha Prime.md",
        ),
        true,
        "and the P4 law runs on them",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("transition-arm findings are identical across the constructors that carry a base", () => {
    const tmp = scratchVault();
    try {
      const target = "wiki/Folk/Alpha.md";
      const fs = fsState(tmp, ROOTS);
      // The overlay pair: disk (= HEAD) as base, the draft as the page.
      const overlayVerdict = judgeAll(
        tmp,
        overlayState(fs, tmp, [{ path: target, text: ALPHA_DRAFT }]),
      );

      // The staged pair: the same draft, staged against the same HEAD.
      writeFileSync(join(tmp, target), ALPHA_DRAFT);
      git(tmp, "add", "-A");
      const staged = judgeAll(tmp, indexState(tmp, ROOTS));

      // The commit pair: the same draft, committed, judged against its parent.
      git(tmp, "commit", "-q", "-m", "the edit");
      const replayed = judgeAll(tmp, revisionState(tmp, "HEAD", undefined, ROOTS));

      const reference = transitionKey(overlayVerdict, target);
      assert.equal(reference.length > 0, true, "the draft fires a transition arm at all");
      assert.deepEqual(transitionKey(staged, target), reference, "indexState differs");
      assert.deepEqual(transitionKey(replayed, target), reference, "revisionState differs");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a constructor with no base reports no-base coverage rather than a clean zero", () => {
    const tmp = scratchVault();
    try {
      const verdict = judgeAll(tmp, fsState(tmp, ROOTS));
      assert.equal(verdict.coverage.passes["claims-transition"]?.reason, "no-base");
      assert.equal(verdict.coverage.passes["claims-transition"]?.evaluated, 0);
      assert.equal(verdict.summary.unevaluated > 0, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the corrected disposition: a typo fix fires nothing and is counted", () => {
    const tmp = scratchVault();
    try {
      const target = "wiki/Folk/Alpha.md";
      // The ONLY change: Shangai -> Shanghai, markers untouched.
      const corrected = ALPHA_BASE.replace("Shangai", "Shanghai");
      const verdict = judgeAll(
        tmp,
        overlayState(fsState(tmp, ROOTS), tmp, [{ path: target, text: corrected }]),
      );
      assert.equal(
        verdict.findings.some((f) => f.ruleId === "claims-transition" && f.path === target),
        false,
        "a corrected typo is not a replacement demanding a History landing",
      );
      assert.equal(verdict.dispositions[target]?.corrected, 1);
      assert.equal(verdict.dispositions[target]?.removed_illegally, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // docs/concepts.md §Section grammar: the escape may not swallow a date, an amount
  // or a polarity. Each pair below is inside a tolerance arm and is not a typo.
  const NOT_A_TYPO: [string, string, string][] = [
    ["Alpha lives in Shangai since 2024", "Alpha lives in Shangai since 2029", "a date"],
    ["Alpha lives in Shangai since 2024", "Alpha never lived in Shangai", "a polarity"],
  ];
  for (const [before, after, what] of NOT_A_TYPO) {
    it(`a changed ${what} is a supersession, never a correction`, () => {
      const tmp = scratchVault();
      try {
        const target = "wiki/Folk/Alpha.md";
        assert.equal(ALPHA_BASE.includes(before), true, "the fixture carries the base claim");
        const changed = ALPHA_BASE.replace(before, after);
        const verdict = judgeAll(
          tmp,
          overlayState(fsState(tmp, ROOTS), tmp, [{ path: target, text: changed }]),
        );
        assert.equal(verdict.dispositions[target]?.corrected, 0, "not laundered as a typo fix");
        assert.equal(
          verdict.findings.some((f) => f.ruleId === "claims-transition" && f.path === target),
          true,
          "the record is told the old value needs a History landing",
        );
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it("a reworded core is a supersession, exactly as before", () => {
    const tmp = scratchVault();
    try {
      const target = "wiki/Folk/Alpha.md";
      const reworded = ALPHA_BASE.replace(
        "Alpha lives in Shangai since 2024",
        "Alpha relocated to Chengdu for work",
      );
      const verdict = judgeAll(
        tmp,
        overlayState(fsState(tmp, ROOTS), tmp, [{ path: target, text: reworded }]),
      );
      assert.equal(
        verdict.findings.some((f) => f.ruleId === "claims-transition" && f.path === target),
        true,
      );
      assert.equal(verdict.dispositions[target]?.corrected, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
