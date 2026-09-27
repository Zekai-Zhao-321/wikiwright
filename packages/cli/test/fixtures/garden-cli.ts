// The v2 verbs over a synthetic gardening bundle under os.tmpdir(): the
// gardening vault of garden-judge.ts written as files, optionally committed,
// and the built CLI run over it with its envelope read from a file
// (runtime.ts). Test data, not a starter.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./clock.ts";
import { gardenVault } from "./garden-judge.ts";
import { removeTree, type Tree, writeTree } from "./garden-law.ts";
import { runCli } from "./runtime.ts";

export const CLI = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

const made: string[] = [];

/** Remove every bundle this file made. */
export function cleanBundles(): void {
  for (const dir of made.splice(0)) removeTree(dir);
}

/** A gardening bundle with `extra` laid over it; `null` removes a file. */
export function gardenBundle(extra: Record<string, string | null> = {}): string {
  const tree: Tree = { ...gardenVault() };
  for (const [path, text] of Object.entries(extra)) {
    if (text === null) delete tree[path];
    else tree[path] = text;
  }
  const dir = writeTree(tree, "ww-verb-");
  made.push(dir);
  return dir;
}

export const GIT_ENV = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

/** One git command in `dir`, its stdout returned. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...GIT_ENV },
  });
}

/** `git init` if needed, stage everything, commit. */
export function commitAll(dir: string, message = "a change"): void {
  try {
    git(dir, "rev-parse", "--git-dir");
  } catch {
    git(dir, "init", "-q");
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", message);
}

export interface Envelope {
  ok: boolean;
  data?: Record<string, unknown> & {
    findings?: {
      rule: string;
      severity: string;
      path: string;
      location: Record<string, unknown>;
      message: string;
      details: Record<string, unknown>;
      queue?: string;
      fix?: { argv: string[] };
    }[];
    summary?: { errors: number; warnings: number; infos: number; by_rule: Record<string, number> };
  };
  error?: {
    code: string;
    type: string;
    exit_code: number;
    message: string;
    hint?: string;
    details?: Record<string, unknown>;
  };
  metadata: { command: string; engine: string; bundle?: Record<string, unknown> };
}

/** Run the CLI over `root` (`--root` appended) and read its envelope. */
export function cli(
  args: readonly string[],
  root: string,
  options: { env?: Record<string, string>; input?: string; cwd?: string } = {},
): { status: number; envelope: Envelope; stderr: string } {
  const r = runCli([CLI, ...args, "--root", root], {
    encoding: "utf8",
    cwd: options.cwd ?? root,
    env: { ...process.env, ...GIT_ENV, ...PINNED_CLOCK, ...options.env },
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  let envelope: Envelope;
  try {
    envelope = JSON.parse(r.stdout) as Envelope;
  } catch {
    throw new Error(`not an envelope (exit ${String(r.status)}): ${r.stdout}${r.stderr}`);
  }
  return { status: r.status ?? -1, envelope, stderr: r.stderr };
}

/** The findings of an envelope with this rule. */
export function findingsOf(envelope: Envelope, rule: string) {
  return (envelope.data?.findings ?? []).filter((f) => f.rule === rule);
}
