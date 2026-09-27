// docs/architecture.md §Directories (the path law) · docs/cli.md §write
//
// The kernel's half is unit-tested in `core/test/path-law.test.ts`. This is the
// half that matters to a reviewer: the escape driven through the BINARY, on
// every surface that takes a path from an agent — `write`'s drafts directory
// and its `ops.json` — and the reads the bundle's own declarations steer.
//
// Each escape case asserts the escape file does not exist on disk, not merely
// that the envelope said no. A guard that refused and wrote anyway would pass
// the weaker assertion.

import { afterAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commitWrite } from "../src/writer.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { noteEngine, notePage, writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-path-law-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

interface Run {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
  error: Record<string, unknown>;
}

function run(cwd: string, args: string[]): Run {
  const r = runCli([CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
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

/**
 * A note bundle one level down, so a `..` escape lands somewhere this test
 * owns and can assert about rather than somewhere in the repository. Each
 * `describe` owns `SCRATCH/<name>` and tears down only that.
 */
function vault(name: string): string {
  const dir = join(SCRATCH, name, "vault");
  rmSync(join(SCRATCH, name), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeNoteBundle(dir, ["Chen Jing"]);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

/** A drafts directory beside the bundle, with `files` laid in it. */
function drafts(name: string, files: Record<string, string>): string {
  const dir = mkdtempSync(join(SCRATCH, name, "drafts-"));
  for (const [path, text] of Object.entries(files)) writeAt(dir, path, text);
  return dir;
}

/** A directory link that does not require Windows developer mode. */
function directoryLink(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

/** Every shape a path an agent hands the engine must refuse, and why it is on the list. */
const ESCAPES = [
  "wiki/../../ESCAPED.md", // traversal past the root
  "wiki/a/../../../ESCAPED.md", // traversal past a real segment
  "../ESCAPED.md", // no root at all
  "/tmp/ESCAPED.md", // absolute
  "wiki/./ESCAPED.md", // a dot segment, which `join` would eat silently
  "wiki//ESCAPED.md", // an empty segment
];

describe("docs/architecture.md §Directories — no verb writes outside the bundle", () => {
  it("`write`'s ops.json refuses every escape as a move's destination, and lands nothing", () => {
    const dir = vault("moves");
    for (const to of ESCAPES) {
      const from = drafts("moves", {
        "ops.json": JSON.stringify({ move: [{ from: "wiki/Chen Jing.md", to, reason: "tidy" }] }),
      });
      const r = run(dir, ["write", "--from", from]);
      assert.equal(r.ok, false, `move to ${to} succeeded`);
      assert.notEqual(r.status, 1, `move to ${to} broke the engine: ${JSON.stringify(r.error)}`);
    }
    assert.equal(existsSync(join(SCRATCH, "moves", "ESCAPED.md")), false);
    assert.equal(existsSync(join(SCRATCH, "ESCAPED.md")), false);
    assert.equal(existsSync(join(dir, "wiki", "ESCAPED.md")), false);
    assert.equal(existsSync(join(dir, "wiki", "Chen Jing.md")), true, "the page stayed");
  });

  it("a legal path still writes — the guard refuses shapes, not pages", () => {
    const dir = vault("legal");
    const from = drafts("legal", {
      "wiki/Bo Lin.md": notePage("Bo Lin"),
      "wiki/陈静 设计师.md": notePage("陈静 设计师"),
    });
    const r = run(dir, ["write", "--from", from]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(existsSync(join(dir, "wiki", "Bo Lin.md")), true);
    // The names a real bundle carries are not collateral damage: Han and a space.
    assert.equal(existsSync(join(dir, "wiki", "陈静 设计师.md")), true);
  });
});

describe("docs/architecture.md §Directories — the walk and the index agree", () => {
  function pagesSeen(dir: string): number {
    const checked = run(dir, ["check", "--all"]);
    const summary = (checked.data["summary"] ?? {}) as Record<string, number>;
    const pages = summary["pages"];
    assert.equal(typeof pages, "number", JSON.stringify(checked));
    return pages ?? -1;
  }

  it("the walk never yields a path the law refuses", () => {
    // `fsState` reads the walk and `indexState` filters git's paths through
    // `isContentPath`. If the two disagree, the working tree judges a page the
    // gate does not: a POSIX filename may contain a backslash, the law refuses
    // one, and the walk must not yield it.
    const dir = vault("walk");
    const before = pagesSeen(dir);
    assert.equal(before > 0, true, "the walk sees the seeded page");
    writeAt(dir, "wiki/Wu Lan.md", notePage("Wu Lan"));
    assert.equal(pagesSeen(dir), before + 1, "a legal page is walked");
    if (process.platform === "win32") return;
    writeAt(dir, "wiki/back\\slash.md", notePage("Bo Lin"));
    assert.equal(existsSync(join(dir, "wiki", "back\\slash.md")), true, "the file is on disk");
    assert.equal(pagesSeen(dir), before + 1, "the walk yielded a path the law refuses");
  });
});

describe("docs/architecture.md §Directories — a declared root is a bundle path", () => {
  it("content_roots and source_roots outside the bundle are refused at load", () => {
    const dir = vault("roots");
    const engine = join(dir, "config", "engine.json");
    for (const extra of [
      { content_roots: [".."] },
      { content_roots: ["/etc"] },
      { content_roots: ["wiki/.."] },
      { content_roots: ["./wiki"] },
      { source_roots: ["../sources"] },
    ]) {
      writeFileSync(engine, noteEngine(extra));
      const r = run(dir, ["check"]);
      assert.equal(r.ok, false, `${JSON.stringify(extra)} loaded`);
      assert.equal(r.error["code"], "constitution-invalid", JSON.stringify(r.error));
      const issues = r.data["issues"] as { code: string; where: string }[];
      assert.deepEqual(
        issues.map((i) => i.where),
        ["bundle:config/engine.json"],
        JSON.stringify(issues),
      );
    }
  });

  it("a multi-segment root is still legal", () => {
    const dir = vault("multi");
    writeAt(dir, "docs/wiki/Chen Jing.md", notePage("Chen Jing"));
    writeFileSync(join(dir, "config", "engine.json"), noteEngine({ content_roots: ["docs/wiki"] }));
    const r = run(dir, ["check"]);
    assert.notEqual(r.error["code"], "constitution-invalid", JSON.stringify(r.error));
  });
});

describe("docs/architecture.md §Directories — containment is resolved, not spelled", () => {
  it("a directory linked out of the bundle does not become a write target", () => {
    // Nothing about the path is illegal to SPELL; the link is what is refused.
    const dir = vault("symlink");
    const outside = join(SCRATCH, "symlink", "outside");
    mkdirSync(outside, { recursive: true });
    directoryLink(outside, join(dir, "wiki", "craft"));
    const from = drafts("symlink", { "wiki/craft/Wu Lan.md": notePage("Wu Lan") });
    const r = run(dir, ["write", "--from", from]);
    assert.equal(r.ok, false, "the write through a link out of the bundle succeeded");
    assert.equal(existsSync(join(outside, "Wu Lan.md")), false, "bytes landed outside");

    // The same path inside the bundle writes: without this the case above is
    // satisfied by any refusal at all.
    unlinkSync(join(dir, "wiki", "craft"));
    mkdirSync(join(dir, "wiki", "craft"), { recursive: true });
    const again = run(dir, ["write", "--from", from]);
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.equal(existsSync(join(dir, "wiki", "craft", "Wu Lan.md")), true);
  });

  it("a page linked out of the bundle is not read: path-skipped, and no bytes from outside", () => {
    if (process.platform === "win32") return; // a file link needs developer mode there
    const dir = vault("page-link");
    const outside = join(SCRATCH, "page-link", "Yu Fen.md");
    writeFileSync(outside, notePage("Yu Fen", "\nEXTERNAL-SECRET\n"));
    symlinkSync(outside, join(dir, "wiki", "Yu Fen.md"));
    const r = run(dir, ["check", "--all"]);
    const findings = (r.data["findings"] ?? []) as { rule: string; path: string }[];
    assert.deepEqual(
      findings.filter((f) => f.rule === "path-skipped").map((f) => f.path),
      ["wiki/Yu Fen.md"],
    );
    const summary = (r.data["summary"] ?? {}) as Record<string, number>;
    assert.equal(summary["pages"], 1, "only the bundle's own page is judged");
  });
});

describe("docs/architecture.md §How a verdict is produced — Writer temporary files cannot be planted", () => {
  it("a hardlink at the former predictable temporary name cannot overwrite external bytes", () => {
    const dir = vault("writer-hardlink");
    const outside = join(SCRATCH, "writer-hardlink", "outside.txt");
    const destination = join(dir, "wiki", "Hard Link.md");
    const planted = `${destination}.wikiwright-tmp`;
    writeFileSync(outside, "ORIGINAL");
    linkSync(outside, planted);
    const from = drafts("writer-hardlink", { "wiki/Hard Link.md": notePage("Hard Link") });
    const result = run(dir, ["write", "--from", from]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(readFileSync(outside, "utf8"), "ORIGINAL", "external inode was overwritten");
    assert.match(readFileSync(destination, "utf8"), /# Hard Link/u);
    assert.equal(readFileSync(planted, "utf8"), "ORIGINAL", "the planted name was never opened");
  });

  it("a failed rename keeps the old destination and removes only its own temporary file", () => {
    const dir = vault("writer-failure");
    const destination = join(dir, "wiki", "blocked.md");
    mkdirSync(destination);
    const before = readdirSync(join(dir, "wiki")).sort();
    assert.throws(() => commitWrite(dir, "wiki/blocked.md", "NEW"));
    assert.equal(statSync(destination).isDirectory(), true, "the old destination remains");
    assert.deepEqual(readdirSync(join(dir, "wiki")).sort(), before, "no temporary debris remains");
  });
});
