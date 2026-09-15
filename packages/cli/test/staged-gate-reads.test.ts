// docs/roadmap.md §Every run parses the whole corpus: the staged gate and the
// replay read a state's pages in a number of git processes bounded by the
// bytes, never one per page, and the bytes they read are the index's exactly.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

interface Run {
  status: number;
  envelope: Record<string, unknown>;
}

function run(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Run {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: env ?? process.env,
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function page(title: string, body = ""): string {
  return `---\ntype: note\ntitle: ${title}\ndescription: ${title}.\ntags: []\n---\n\n# ${title}\n${body}`;
}

function dataOf(envelope: Record<string, unknown>): Record<string, unknown> {
  return envelope["data"] as Record<string, unknown>;
}

/** How many pages the `malformed-frontmatter` pass evaluated: every page the state read. */
function parsedPages(envelope: Record<string, unknown>): number {
  const passes = (dataOf(envelope)["coverage"] as { passes: Record<string, { evaluated: number }> })
    .passes;
  return passes["malformed-frontmatter"]?.evaluated ?? -1;
}

/** A one-type repository of `count` pages, committed, with the first staged as modified. */
function repo(count: number, changed = 1): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-reads-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki"));
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(documentOf({ types: { note: { extends: "concept", description: "A note." } } })),
  );
  writeFileSync(join(tmp, "config", "engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
  for (let i = 0; i < count; i++) {
    writeFileSync(join(tmp, "wiki", `Note ${i}.md`), page(`Note ${i}`));
  }
  git(tmp, "init", "-q", "-b", "main");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "base");
  for (let i = 0; i < changed; i++) {
    writeFileSync(join(tmp, "wiki", `Note ${i}.md`), page(`Note ${i}`, "\nA staged line.\n"));
  }
  git(tmp, "add", "-A");
  return tmp;
}

/**
 * POSIX-only, like hook.test.ts: the counting `git` is an `sh` launcher on
 * PATH, which means nothing on Windows.
 */
const POSIX_ONLY = process.platform === "win32";

/** A `git` on PATH that appends its argv to a log, then runs the real git. */
function countingGit(tmp: string): { env: NodeJS.ProcessEnv; log: string } {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = join(tmp, ".bin");
  mkdirSync(bin);
  const log = join(tmp, "git.log");
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${real}" "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  const PATH = `${bin}${delimiter}${process.env["PATH"] ?? ""}`;
  return { env: { ...process.env, PATH }, log };
}

function calls(log: string): string[] {
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

/** The git argvs a verb spawns over a repository of `count` pages. */
function spawned(count: number, argv: (tmp: string) => string[], changed = 1): string[] {
  const tmp = repo(count, changed);
  try {
    const { env, log } = countingGit(tmp);
    const r = run(tmp, argv(tmp), env);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    return calls(log);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("a state's git process count is bounded by bytes, not pages (docs/roadmap.md)", () => {
  it("lint --staged spawns as many git processes over 60 pages as over 6", () => {
    if (POSIX_ONLY) return;
    const six = spawned(6, () => ["lint", "--staged"]);
    const sixty = spawned(60, () => ["lint", "--staged"]);
    assert.equal(
      sixty.length,
      six.length,
      `6 pages:\n${six.join("\n")}\n60 pages:\n${sixty.join("\n")}`,
    );
    assert.equal(
      sixty.some((c) => c.startsWith("cat-file --batch")),
      true,
      "the pages come through cat-file --batch",
    );
    assert.equal(
      sixty.some((c) => c.startsWith("show :./wiki/")),
      false,
      "and never through a `git show` per page",
    );
  });

  it("lint --since spawns as many git processes over 60 pages as over 6", () => {
    if (POSIX_ONLY) return;
    const since = (tmp: string): string[] => ["lint", "--since", git(tmp, "rev-parse", "HEAD")];
    const six = spawned(6, since);
    const sixty = spawned(60, since);
    assert.equal(
      sixty.length,
      six.length,
      `6 pages:\n${six.join("\n")}\n60 pages:\n${sixty.join("\n")}`,
    );
    // The replay's reader still takes the two config files of each revision
    // one `cat-file blob` at a time; that count is the revision's, not the corpus's.
    assert.equal(
      sixty.filter((c) => c.startsWith("cat-file blob ")).length,
      six.filter((c) => c.startsWith("cat-file blob ")).length,
    );
  });
});

describe("a bulk commit reads its HEAD bases in one process (docs/roadmap.md)", () => {
  it("lint --staged spawns as many git processes for 40 changed pages as for 2", () => {
    if (POSIX_ONLY) return;
    const two = spawned(40, () => ["lint", "--staged"], 2);
    const forty = spawned(40, () => ["lint", "--staged"], 40);
    assert.equal(
      forty.length,
      two.length,
      `2 changed:\n${two.join("\n")}\n40:\n${forty.join("\n")}`,
    );
    assert.equal(
      forty.some((c) => c.startsWith("show HEAD:")),
      false,
      "no `git show` per changed page",
    );
  });
});

describe("the gate reads the index once (docs/cli.md §gate)", () => {
  it("lint --staged and gate each spawn the staged diff and the index listing once", () => {
    if (POSIX_ONLY) return;
    // The constitution is read from the index before the roots are known and
    // the pages after; both reads take one snapshot, so a second read of the
    // index spawns nothing again.
    for (const argv of [["lint", "--staged"], ["gate"]]) {
      const calls = spawned(6, () => argv);
      const count = (prefix: string): number => calls.filter((c) => c.startsWith(prefix)).length;
      assert.equal(count("diff --cached"), 1, `${argv.join(" ")}:\n${calls.join("\n")}`);
      assert.equal(count("ls-files"), 1, `${argv.join(" ")}:\n${calls.join("\n")}`);
    }
  });
});

describe("the gate reads the index's bytes exactly (docs/cli.md §lint --staged)", () => {
  it("multi-byte text, a header-shaped line and a BOM judge as the working tree does", () => {
    const tmp = repo(2);
    try {
      const hex = "f".repeat(40);
      writeFileSync(
        join(tmp, "wiki", "热重启.md"),
        page("热重启", "\n热重启 recovers [[Note 1]].\n"),
      );
      writeFileSync(
        join(tmp, "wiki", "Header.md"),
        page("Header", `\n${hex} blob 12\nnot a header\n`),
      );
      writeFileSync(join(tmp, "wiki", "Bom.md"), `﻿${page("Bom")}`);
      git(tmp, "add", "-A");
      const staged = run(tmp, ["lint", "--staged"]);
      const tree = run(tmp, ["lint"]);
      assert.equal(staged.status, 0, JSON.stringify(staged.envelope));
      assert.deepEqual(dataOf(staged.envelope)["findings"], []);
      assert.deepEqual(dataOf(tree.envelope)["findings"], []);
      // All five pages parsed from the index's bytes, as from the tree's; the
      // summary counts the four staged ones, which is the gate's scope.
      assert.equal(parsedPages(staged.envelope), 5);
      assert.equal(parsedPages(tree.envelope), 5);
      assert.equal((dataOf(staged.envelope)["summary"] as { pages: number }).pages, 4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
