// The shell half of the Writer: core splices bytes, this proves them and puts
// them on disk (docs/concepts.md §The judge and its states). Every writing verb
// that touches a CONTENT page goes through `commitWrites`, and the dry-run
// law's write scan (docs/cli.md §The dry-run law) fails the build by name on a
// page write anywhere else.
import { createHash } from "node:crypto";
import {
  applyWrite,
  type Finding,
  type JudgeOptions,
  judge,
  type Law,
  type VaultState,
  type Verdict,
  type WriteOp,
  type WritePlan,
  type WriteRange,
} from "@wikiwright/core";
import { replaceFiles } from "./atomicwrite.ts";
import { vaultAbsolute } from "./paths.ts";
import type { PlanOp } from "./spec.ts";

/** git's own blob identity: `sha1("blob <len>\0" + bytes)` — what a write envelope reports. */
export function blobSha(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\u0000`).update(bytes).digest("hex");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** docs/cli.md §The dry-run law: the one file a proved write lands, named for the plan. */
export function writeOps(path: string, kind: PlanOp["kind"], summary: string): PlanOp[] {
  return [{ kind, path, summary }];
}

export type ProofFailure =
  | { code: "not-proved"; message: string; details: Record<string, unknown> }
  | { code: "new-errors"; message: string; details: Record<string, unknown> };

export type ProofResult = { ok: true; findings: Finding[] } | ({ ok: false } & ProofFailure);

function key(f: Finding): string {
  return `${f.ruleId}\u0000${f.path}\u0000${f.line ?? ""}\u0000${f.message}`;
}

/**
 * The proof, over a SET of pages at once: every replaced page goes back into
 * the same state, the same law judges the whole vault ONCE, and two things must
 * hold — on each replaced page the finding an op addresses is gone, and no new
 * error appeared anywhere. "Gone from the disk" is not the claim; the claim is
 * about what the engine would now say. The caller that already judged the
 * state hands that verdict in as `before`, so a vault-wide `fix` costs two
 * judges however many pages it touches, and `options` carries the
 * judge options that verdict was produced under so the two are comparable.
 */
export function proveWrites(input: {
  state: VaultState;
  law: Law;
  pages: readonly { path: string; after: string }[];
  addresses?: (finding: Finding) => boolean;
  before?: Verdict;
  options?: Pick<JudgeOptions, "gate" | "configChanged">;
}): ProofResult {
  const { state, law } = input;
  const judgeOptions: JudgeOptions = { ...input.options, all: true };
  const before = input.before ?? judge(state, law, judgeOptions);
  const pages = new Map(state.pages);
  for (const page of input.pages) pages.set(page.path, page.after);
  const verdict = judge({ ...state, pages }, law, judgeOptions);
  const replaced = new Set(input.pages.map((page) => page.path));
  if (input.addresses !== undefined) {
    const remaining = verdict.findings.filter((f) => replaced.has(f.path) && input.addresses?.(f));
    if (remaining.length > 0) {
      const where = [...new Set(remaining.map((f) => f.path))].sort();
      return {
        ok: false,
        code: "not-proved",
        message: `the op applied but the finding it addresses still fires on ${where.join(", ")}`,
        details: { remaining },
      };
    }
  }
  const known = new Set(before.findings.filter((f) => f.severity === "error").map(key));
  const introduced = verdict.findings.filter((f) => f.severity === "error" && !known.has(key(f)));
  if (introduced.length > 0) {
    const where = [...new Set(introduced.map((f) => f.path))].sort();
    return {
      ok: false,
      code: "new-errors",
      message: `the write would introduce ${introduced.length} error finding(s) on ${where.join(", ")}`,
      details: { findings: introduced },
    };
  }
  return { ok: true, findings: verdict.findings.filter((f) => replaced.has(f.path)) };
}

/** One page, through the same proof. */
export function proveWrite(input: {
  state: VaultState;
  law: Law;
  path: string;
  after: string;
  addresses?: (finding: Finding) => boolean;
}): ProofResult {
  const { state, law, path, after } = input;
  return proveWrites({
    state,
    law,
    pages: [{ path, after }],
    ...(input.addresses === undefined ? {} : { addresses: input.addresses }),
  });
}

/**
 * The one filesystem write of content pages in the engine (docs/concepts.md §The judge and its states).
 * Every page's bytes land in an exclusively created temp file beside it
 * first, and only when every temp file is complete are they renamed into
 * place — so a failure while writing leaves every old page as it was and no
 * debris, and a set of pages written together lands together. The
 * rename loop itself is not batch-atomic; a crash inside it is the one window.
 * Returns the blob sha of each page landed, in the caller's order.
 */
export function commitWrites(
  root: string,
  pages: readonly { path: string; text: string }[],
): string[] {
  replaceFiles(
    pages.map((page) => ({ path: vaultAbsolute(root, page.path), contents: page.text })),
  );
  return pages.map((page) => blobSha(page.text));
}

/** One page, through the same path. */
export function commitWrite(root: string, path: string, text: string): string {
  return commitWrites(root, [{ path, text }])[0] ?? blobSha(text);
}

export interface SplicedPlan {
  text: string;
  ranges: WriteRange[];
  consumed: WriteRange[];
}

/** Apply one page's ops. The plan's `path` is the caller's; this is its bytes. */
export function splicePlan(
  before: string,
  plan: WritePlan,
): { ok: true; spliced: SplicedPlan } | { ok: false; reason: string } {
  const result = applyWrite(before, plan.ops as readonly WriteOp[]);
  if (!result.ok) return result;
  return {
    ok: true,
    spliced: { text: result.text, ranges: result.ranges, consumed: result.consumed },
  };
}
