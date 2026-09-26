// v2 contracts §5 and §10: the judge property, ported from
// judge-property.test.ts to the v2 law and extended to `unevaluated`. One
// gardening vault under os.tmpdir() through the four constructors — the
// working tree, the overlay, the index, a revision — each reading its bytes
// through its own path (the disk, drafts over the disk, the git index, git's
// objects), so agreement is a claim about the constructors and not about one
// read. Over the same bytes:
//   - every finding that does not compare with a base is the same from all four;
//   - every transition — the kernel's three and a CEL rule that reads before —
//     has one verdict per page among the constructors with a base (the
//     overlay, the index) and one among those without (the working tree, a
//     revision), and `unevaluated` is that verdict where there is no base:
//     never a pass, never a finding.
import { afterAll, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JudgeState, TypeLawVerdict } from "@wikiwright/core";
import { fsState, indexState, overlayState, revisionState } from "../src/lawstate.ts";
import { BASIL, git, gitCommitAll, HERB_BED } from "./fixtures/garden-judge.ts";
import { cleanUp, judgeState, vaultDir } from "./fixtures/judge-run.ts";

afterAll(cleanUp);

/** A transition rule over the planting: its sections only grow. */
const GROWS = `  - id: sections-grow
    expr: '!before.present || size(page.sections) >= size(before.sections)'
    message: A planting's sections only grow.
`;

function vault(): string {
  const dir = vaultDir({
    // The bundle planting with a transition rule appended.
    "constitution/types/planting.yaml": null,
    "wiki/Tomato.md": BASIL.replace("title: Basil", "title: Tomato").replace(
      "- [observed] Basil bolts above thirty degrees. ([[Herb bed]])",
      "- [observed] Tomatoes split after heavy rain. ([[Herb bed]])\n- [measured] Twelve fruit a truss in 2025. ([[Herb bed]])",
    ),
    "wiki/Leaf.md": "---\ntype: pond\ntitle: Leaf\n---\n\nSee [[Nowhere]].\n",
  });
  return dir;
}

import { gardenTree } from "./fixtures/garden-law.ts";

function withRule(dir: string): void {
  const planting = gardenTree()["constitution/types/planting.yaml"] ?? "";
  writeFileSync(join(dir, "constitution/types/planting.yaml"), `${planting}${GROWS}`);
}

/** A committed vault: HEAD, the index and the working tree agree. */
function committed(): string {
  const dir = vault();
  withRule(dir);
  gitCommitAll(dir);
  return dir;
}

const TRANSITIONS = new Set([
  "entry-edited",
  "claims-transition",
  "relation-removed",
  "renamed-without-alias",
  "sections-grow",
]);

/** An exception's verdict on a transition compares with the base, as the transition does. */
const onTransition = (f: TypeLawVerdict["findings"][number]): boolean =>
  (f.rule === "exception-applied" || f.rule === "exception-stale") &&
  TRANSITIONS.has(String(f.details["rule"]));

/** Every finding that does not compare with a base, as one comparable line. */
const stateKey = (v: TypeLawVerdict): string[] =>
  v.findings
    .filter((f) => !TRANSITIONS.has(f.rule) && f.rule !== "unevaluated" && !onTransition(f))
    .map((f) => `${f.path}|${JSON.stringify(f.location)}|${f.rule}|${f.severity}|${f.message}`)
    .sort();

/** Each transition's verdict on each page: a finding, unevaluated, or a pass. */
function transitionVerdicts(v: TypeLawVerdict, paths: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    for (const id of TRANSITIONS) {
      if (id === "renamed-without-alias") continue;
      const found = v.findings.filter((f) => f.path === path && f.rule === id);
      const unevaluated = v.findings.filter(
        (f) => f.path === path && f.rule === "unevaluated" && f.details["rule"] === id,
      );
      out[`${path}|${id}`] =
        found.length > 0
          ? `finding:${found.map((f) => JSON.stringify([f.location, f.details])).join(";")}`
          : unevaluated.length > 0
            ? "unevaluated"
            : "pass";
    }
  }
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

function assertPages(state: JudgeState, expected: readonly string[]): void {
  expect([state.kind, [...state.pages.keys()].sort()]).toEqual([state.kind, [...expected].sort()]);
}

describe("judgeTypeLaw(state, law): four constructors, one verdict", () => {
  it("findings that need no base are identical from all four", async () => {
    const dir = committed();
    // A snapshot every constructor can describe: a rename, an addition, a
    // deletion and an edit, committed, so the tree, the index and HEAD agree.
    git(dir, "mv", "wiki/Basil.md", "wiki/Sweet basil.md");
    writeFileSync(join(dir, "wiki/Mint.md"), BASIL.replace("title: Basil", "title: Mint"));
    git(dir, "rm", "-q", "wiki/Start.md");
    writeFileSync(join(dir, "wiki/Herb bed.md"), `${HERB_BED}\nSee [[Pond]].\n`);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "the change");
    const disk = new TextDecoder().decode(
      (await fsState(dir)).pages.get("wiki/Sweet basil.md") ?? new Uint8Array(),
    );
    const states: JudgeState[] = [
      await fsState(dir),
      await indexState(dir),
      await overlayState(dir, [{ path: "wiki/Sweet basil.md", bytes: text(disk) }]),
      await revisionState(dir, "HEAD"),
    ];
    const expected = [
      "wiki/Herb bed.md",
      "wiki/Leaf.md",
      "wiki/Mint.md",
      "wiki/Sweet basil.md",
      "wiki/Tomato.md",
    ];
    const keys: string[][] = [];
    for (const state of states) {
      assertPages(state, expected);
      keys.push(stateKey(await judgeState(state)));
    }
    expect((keys[0] ?? []).length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toEqual(keys[0] ?? []);
  });

  it("an NFD path names the page the vault already holds, not a second one", async () => {
    const dir = committed();
    const nfc = "wiki/Café.md".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    const cafe = BASIL.replace("title: Basil", "title: Café");
    writeFileSync(join(dir, nfc), cafe);
    const fs = await fsState(dir);
    const overlay = await overlayState(dir, [{ path: nfd, bytes: text(cafe) }]);
    expect(overlay.pages.size).toBe(fs.pages.size);
    expect(stateKey(await judgeState(overlay))).toEqual(stateKey(await judgeState(fs)));
  });

  it("a working-tree edit the index does not carry separates the working tree from the index", async () => {
    const dir = committed();
    writeFileSync(join(dir, "wiki/Basil.md"), BASIL.replace("[observed] Basil", "[guess] Basil"));
    const inTree = stateKey(await judgeState(await fsState(dir))).filter((k) =>
      k.includes("vocabulary-unknown"),
    );
    const inIndex = stateKey(await judgeState(await indexState(dir))).filter((k) =>
      k.includes("vocabulary-unknown"),
    );
    expect([inTree.length, inIndex.length]).toEqual([1, 0]);
  });

  it("a staged, uncommitted rename is a rename to the constructor that reads the index", async () => {
    const dir = committed();
    git(dir, "mv", "wiki/Basil.md", "wiki/Sweet basil.md");
    const index = await indexState(dir);
    expect(index.renames).toEqual([{ from: "wiki/Basil.md", to: "wiki/Sweet basil.md" }]);
    const verdict = await judgeState(index);
    expect(
      verdict.findings.filter((f) => f.rule === "renamed-without-alias").map((f) => f.path),
    ).toEqual(["wiki/Sweet basil.md"]);
  });

  it("a transition has one verdict where there is a base, and is unevaluated where there is none", async () => {
    const dir = committed();
    const target = "wiki/Tomato.md";
    const base = new TextDecoder().decode(
      (await fsState(dir)).pages.get(target) ?? new Uint8Array(),
    );
    // One draft that trips all four transitions: an entry edited, a claim
    // gone, a relation gone and a section gone.
    const draft = base
      .replace("- 2026-04-12 — sown", "- 2026-04-13 — sown")
      .replace("- [measured] Twelve fruit a truss in 2025. ([[Herb bed]])\n", "")
      .replace("## Relations\n\n- grows-in [[Herb bed]]\n", "");
    expect(draft).not.toBe(base);
    const paths = [target, "wiki/Basil.md"];

    // With a base, from the disk: the draft over the disk, which is HEAD.
    const overlay = transitionVerdicts(
      await judgeState(await overlayState(dir, [{ path: target, bytes: text(draft) }])),
      paths,
    );
    // With a base, from git: the same draft staged over the same HEAD.
    writeFileSync(join(dir, target), draft);
    git(dir, "add", "-A");
    const index = transitionVerdicts(await judgeState(await indexState(dir)), paths);
    // Without a base: the same bytes in the working tree, and committed.
    const tree = transitionVerdicts(await judgeState(await fsState(dir)), paths);
    git(dir, "commit", "-q", "-m", "the edit");
    const revision = transitionVerdicts(await judgeState(await revisionState(dir, "HEAD")), paths);

    for (const id of ["entry-edited", "claims-transition", "relation-removed", "sections-grow"]) {
      expect([id, (overlay[`${target}|${id}`] ?? "").startsWith("finding:")]).toEqual([id, true]);
      expect([id, overlay[`wiki/Basil.md|${id}`]]).toEqual([id, "pass"]);
    }
    expect(index).toEqual(overlay);
    expect(Object.values(tree).every((v) => v === "unevaluated")).toBe(true);
    expect(revision).toEqual(tree);
  });

  it("an exception on a transition is judged where there is a base, and is neither stale nor applied where there is none", async () => {
    const dir = committed();
    const target = "wiki/Tomato.md";
    const base = new TextDecoder().decode(
      (await fsState(dir)).pages.get(target) ?? new Uint8Array(),
    );
    // A claim and a section gone, each waived; an exception on an entry
    // transition that holds, which closes nothing.
    const draft = base
      .replace(
        "sown: 2026-04-12\n",
        "sown: 2026-04-12\nexceptions:\n  - { rule: claims-transition, reason: moved to Tomatoes }\n  - { rule: sections-grow, reason: split in two }\n  - { rule: entry-edited, reason: none edited }\n",
      )
      .replace("- [measured] Twelve fruit a truss in 2025. ([[Herb bed]])\n", "")
      .replace("## Relations\n\n- grows-in [[Herb bed]]\n", "");
    const waivers = (v: TypeLawVerdict): string[] =>
      v.findings
        .filter(onTransition)
        .map((f) => `${f.path}|${f.rule}|${String(f.details["rule"])}`)
        .sort();
    const overlay = await judgeState(
      await overlayState(dir, [{ path: target, bytes: text(draft) }]),
    );
    writeFileSync(join(dir, target), draft);
    git(dir, "add", "-A");
    const index = await judgeState(await indexState(dir));
    const tree = await judgeState(await fsState(dir));
    git(dir, "commit", "-q", "-m", "the waiver");
    const revision = await judgeState(await revisionState(dir, "HEAD"));

    expect(waivers(overlay)).toEqual([
      `${target}|exception-applied|claims-transition`,
      `${target}|exception-applied|sections-grow`,
      `${target}|exception-stale|entry-edited`,
    ]);
    expect(waivers(index)).toEqual(waivers(overlay));
    expect(waivers(tree)).toEqual([]);
    expect(waivers(revision)).toEqual([]);
    for (const v of [index, tree, revision]) expect(stateKey(v)).toEqual(stateKey(overlay));
  });

  it("an unchanged page under a base holds every transition, and without one is unevaluated", async () => {
    const dir = committed();
    const paths = ["wiki/Basil.md", "wiki/Tomato.md"];
    const withBase = [
      transitionVerdicts(await judgeState(await indexState(dir)), paths),
      transitionVerdicts(await judgeState(await overlayState(dir, [])), paths),
    ];
    const without = [
      transitionVerdicts(await judgeState(await fsState(dir)), paths),
      transitionVerdicts(await judgeState(await revisionState(dir, "HEAD")), paths),
    ];
    for (const v of withBase) expect(Object.values(v).every((x) => x === "pass")).toBe(true);
    for (const v of without) expect(Object.values(v).every((x) => x === "unevaluated")).toBe(true);
    // Counted as their own verdict: in the block and in the summary.
    const tree = await judgeState(await fsState(dir));
    // Two plantings: the page of an unknown type reaches no rule.
    expect(tree.unevaluated["sections-grow"]).toEqual({ count: 2, reasons: ["no-base"] });
    expect(tree.summary.unevaluated).toBeGreaterThan(0);
    const staged = await judgeState(await indexState(dir));
    expect(staged.unevaluated).toEqual({});
  });
});

describe("the correction tolerance under the transition, ported", () => {
  const claim = "- [measured] Twelve fruit a truss in 2025. ([[Herb bed]])";
  const judge = async (after: string) => {
    const dir = committed();
    const base = new TextDecoder().decode(
      (await fsState(dir)).pages.get("wiki/Tomato.md") ?? new Uint8Array(),
    );
    const verdict = await judgeState(
      await overlayState(dir, [
        { path: "wiki/Tomato.md", bytes: text(base.replace(claim, after)) },
      ]),
    );
    return verdict.findings.filter((f) => f.rule === "claims-transition");
  };

  it("a typo fix fires nothing", async () => {
    expect(await judge(claim.replace("truss", "trus"))).toEqual([]);
  });

  it("the same core under another source is the same claim, by its handle", async () => {
    expect(await judge(claim.replace("([[Herb bed]])", "(https://seeds.example/tomato)"))).toEqual(
      [],
    );
  });

  it.each([
    ["a date", claim.replace("2025", "2026")],
    ["a polarity", claim.replace("Twelve fruit", "Never twelve fruit")],
    ["a reworded core", "- [measured] Eight fruit a truss this year. ([[Herb bed]])"],
  ])("%s is a new claim, and the old one left unclosed", async (_what, after) => {
    expect(await judge(after)).toHaveLength(1);
  });
});
