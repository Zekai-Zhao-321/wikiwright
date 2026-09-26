// Judging a gardening vault under os.tmpdir() with the v2 judge: write the
// tree, construct a state, load its law, judge. The v2 judge is reached by a
// test-only import (contracts §12 step 3); no verb calls it yet.
import {
  type JudgeState,
  judgeTypeLaw,
  loadTypeLaw,
  type TypeLaw,
  type TypeLawJudgeOptions,
  type TypeLawVerdict,
  type VerdictFinding,
} from "@wikiwright/core";
import { fsState } from "../../src/lawstate.ts";
import { gardenVault } from "./garden-judge.ts";
import { removeTree, type Tree, writeTree } from "./garden-law.ts";

export const made: string[] = [];

export function cleanUp(): void {
  for (const dir of made.splice(0)) removeTree(dir);
}

/** A gardening vault with `extra` laid over it; `null` removes a file. */
export function vaultDir(extra: Record<string, string | null> = {}): string {
  const tree: Tree = {};
  for (const [path, text] of Object.entries(gardenVault())) tree[path] = text;
  for (const [path, text] of Object.entries(extra)) {
    if (text === null) delete tree[path];
    else tree[path] = text;
  }
  const dir = writeTree(tree, "ww-judge-");
  made.push(dir);
  return dir;
}

export function lawOf(state: JudgeState): TypeLaw {
  const loaded = loadTypeLaw(state.law);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues, null, 2));
  return loaded.law;
}

/**
 * Judge a state. Every verdict a test produces is held to be JSON, as the
 * envelope will write it: a `bigint` or a cycle in a finding's details
 * throws here.
 */
export async function judgeState(
  state: JudgeState,
  options: TypeLawJudgeOptions = {},
): Promise<TypeLawVerdict> {
  const verdict = judgeTypeLaw(state, lawOf(state), { all: true, ...options });
  JSON.stringify(verdict);
  return verdict;
}

/** The working tree of a vault with `extra` over it, judged. */
export async function judgeVault(
  extra: Record<string, string | null> = {},
  options: TypeLawJudgeOptions = {},
): Promise<TypeLawVerdict> {
  return judgeState(await fsState(vaultDir(extra)), options);
}

/** The findings as `[path, rule]`, errors and warnings only. */
export function blocking(verdict: TypeLawVerdict): [string, string][] {
  return verdict.findings
    .filter((f) => f.severity !== "info")
    .map((f) => [f.path, f.rule] as [string, string]);
}

export function only(verdict: TypeLawVerdict, rule: string): VerdictFinding[] {
  return verdict.findings.filter((f) => f.rule === rule);
}
