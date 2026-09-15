// docs/architecture.md §Directories (the path law) · docs/cli.md §new, docs/cli.md §write, docs/cli.md §fix, docs/cli.md
//
// The kernel's half is unit-tested in `core/test/path-law.test.ts`. This is the
// half that matters to a reviewer: the reproduction of the escape driven through
// the BINARY, plus every other surface that takes a path from an agent.
//
// The first case is the reproduction itself, and it is written to fail
// loudly if the guard is removed — it asserts the escape file does not exist on
// disk, not merely that the envelope said no. A guard that refused and wrote
// anyway would pass the weaker assertion.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { commitWrite } from "../src/writer.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { layMemoryLaw } from "./fixtures/memory-law.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-path-law-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

interface Run {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
  error: Record<string, unknown>;
}

function run(cwd: string, args: string[], stdin?: string): Run {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
    input: stdin ?? "",
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

const PERSON = [
  "---",
  "type: person",
  "tags: []",
  "---",
  "Chen Jing — a designer.",
  "",
  "## Facts",
  "- [identity] full name: Chen Jing (stated 2026-01-01)",
  "",
  "## Relations",
  "- knows [[Charter]]",
  "",
  "## History",
  "",
].join("\n");

/**
 * A vault one level down, so a `..` escape lands somewhere this test owns and
 * can assert about rather than somewhere in the repository.
 *
 * Each `describe` owns `SCRATCH/<name>` and tears down only that: four blocks
 * that each removed the shared root would race, and a vault deleted under a
 * running case fails in a way that looks like the law and is not.
 */
function vault(name: string): string {
  const dir = join(SCRATCH, name, "vault");
  rmSync(join(SCRATCH, name), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  layMemoryLaw(dir);
  writeFileSync(join(dir, "wiki", "Chen Jing.md"), PERSON);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "seed"], { cwd: dir });
  return dir;
}

/** A directory link that does not require Windows developer mode. */
function directoryLink(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

/** Every shape a path-taking flag must refuse, and why it is on the list. */
const ESCAPES = [
  "wiki/../../ESCAPED.md", // the review's reproduction
  "wiki/a/../../../ESCAPED.md", // traversal past a real segment
  "../ESCAPED.md", // no root at all
  "/tmp/ESCAPED.md", // absolute
  "wiki/./ESCAPED.md", // a dot segment, which `join` would eat silently
  "wiki//ESCAPED.md", // an empty segment
];

describe("docs/architecture.md §Directories — no verb writes outside the vault", () => {
  let dir = "";
  before(() => {
    dir = vault("verbs");
  });
  after(() => {
    rmSync(join(SCRATCH, "verbs"), { recursive: true, force: true });
  });

  it("`new --dest` refuses every escape, and lands no file above the root", () => {
    for (const dest of ESCAPES) {
      const r = run(dir, ["new", "person", "Escape", "--dest", dest, "--date", "2026-09-04"]);
      assert.equal(r.ok, false, `new accepted ${dest}`);
      assert.equal(r.error["code"], "invalid-path", `${dest}: ${JSON.stringify(r.error)}`);
    }
    // The whole point. The original defect wrote this file and reported ok.
    assert.equal(existsSync(join(dirname(dir), "ESCAPED.md")), false, "nothing above the vault");
    assert.equal(existsSync("/tmp/ESCAPED.md"), false, "nothing at an absolute path");
  });

  it("`write` refuses every escape by the same code", () => {
    for (const path of ESCAPES) {
      const r = run(dir, ["write", path, "--date", "2026-09-04"], PERSON);
      assert.equal(r.ok, false, `write accepted ${path}`);
      assert.equal(r.error["code"], "invalid-path", `${path}: ${JSON.stringify(r.error)}`);
    }
    assert.equal(existsSync(join(dirname(dir), "ESCAPED.md")), false);
  });

  it("`fix --path` and `lint --stdin --path` refuse them too", () => {
    for (const path of ESCAPES) {
      // `fix` checks its own required flags first, so a bare --path would
      // never reach the path guard and the case would prove nothing.
      const fixArgv = ["fix", "--rule", "frontmatter-set", "--expect", "any", "--dry-run"];
      const fix = run(dir, [...fixArgv, "--path", path]);
      assert.equal(fix.error["code"], "invalid-path", `fix accepted ${path}`);
      const lint = run(dir, ["lint", "--stdin", "--path", path], PERSON);
      assert.equal(lint.error["code"], "invalid-path", `lint accepted ${path}`);
    }
    // The contrast that makes the loop mean something: a LEGAL path gets past
    // the guard and is refused for a different, later reason.
    const legal = run(dir, [
      "fix",
      "--rule",
      "frontmatter-set",
      "--expect",
      "any",
      "--dry-run",
      "--path",
      "wiki/nonexistent.md",
    ]);
    assert.equal(legal.error["code"], "page-not-found", JSON.stringify(legal.error));
  });

  it("`lint --page` refuses a backslash spelling before it can become an OS path", () => {
    const lint = run(dir, ["lint", "--page", "wiki\\Chen Jing.md"]);
    assert.equal(lint.ok, false, JSON.stringify(lint));
    assert.equal(lint.error["code"], "invalid-path", JSON.stringify(lint.error));
  });

  it("`move` refuses both endpoints through the same path-law matrix before side effects", {
    timeout: 60_000,
  }, () => {
    const badEndpoints = [
      "wiki/../../Chen Jing.md",
      "wiki/a/../../../Chen Jing.md",
      "../Chen Jing.md",
      "/outside/Chen Jing.md",
      "wiki/./Chen Jing.md",
      "wiki//Chen Jing.md",
      "wiki\\Chen Jing.md",
      "notes/Chen Jing.md",
      "wiki2/Chen Jing.md",
    ];
    for (const to of badEndpoints) {
      const result = run(dir, [
        "move",
        "wiki/Chen Jing.md",
        to,
        "--reason",
        "activity-boundary",
        "--dry-run",
      ]);
      assert.equal(
        result.error["code"],
        "invalid-path",
        `destination ${to}: ${JSON.stringify(result)}`,
      );
      assert.equal(existsSync(join(dir, "wiki", "Chen Jing.md")), true, "source was not moved");
    }
    for (const from of badEndpoints) {
      const result = run(dir, [
        "move",
        from,
        "wiki/craft/Chen Jing.md",
        "--reason",
        "activity-boundary",
        "--dry-run",
      ]);
      assert.equal(
        result.error["code"],
        "invalid-path",
        `source ${from}: ${JSON.stringify(result)}`,
      );
      assert.equal(existsSync(join(dir, "wiki", "craft", "Chen Jing.md")), false);
    }
  });

  it("a legal path still writes — the guard refuses shapes, not pages", () => {
    const r = run(dir, ["write", "wiki/Bo Lin.md", "--date", "2026-09-04"], PERSON);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(existsSync(join(dir, "wiki", "Bo Lin.md")), true);
    // The names a real vault carries are not collateral damage. Han
    // and a space, which is half of what the target corpora are made of.
    const han = run(dir, ["write", "wiki/陈静 设计师.md", "--date", "2026-09-04"], PERSON);
    assert.equal(han.ok, true, JSON.stringify(han.error));
    assert.equal(existsSync(join(dir, "wiki", "陈静 设计师.md")), true);
  });
});

describe("docs/architecture.md §Directories — the walk and the index agree", () => {
  let dir = "";
  before(() => {
    dir = vault("walk");
  });
  after(() => {
    rmSync(join(SCRATCH, "walk"), { recursive: true, force: true });
  });

  function pagesSeen(): number {
    const linted = run(dir, ["lint", "--all"]);
    const summary = (linted.data["summary"] ?? {}) as Record<string, number>;
    const pages = summary["pages"];
    assert.equal(typeof pages, "number", JSON.stringify(linted));
    return pages ?? -1;
  }

  it("the walk never yields a path the law refuses", () => {
    // `fsState` reads the walk and `indexState` filters git's paths through
    // `isContentPath`. If the two disagree, the working tree judges a page the
    // gate does not — which is exactly what `docs/architecture.md §How a verdict is produced` exists to prevent, and
    // what tightening `isContentPath` alone DID cause: a POSIX filename may
    // contain a backslash, the law refuses one, and the walk went on yielding
    // it. Found by probing this change rather than by the suite.
    const before = pagesSeen();
    assert.equal(before > 0, true, "the walk sees the seeded page");
    // A legal page: the count moves, so the measurement is real.
    writeFileSync(join(dir, "wiki", "Wu Lan.md"), PERSON.replaceAll("Chen Jing", "Wu Lan"));
    assert.equal(pagesSeen(), before + 1, "a legal page is walked");
    if (process.platform === "win32") return;
    // A name the law refuses: the count does not move.
    writeFileSync(join(dir, "wiki", "back\\slash.md"), PERSON.replaceAll("Chen Jing", "Bo Lin"));
    assert.equal(existsSync(join(dir, "wiki", "back\\slash.md")), true, "the file is on disk");
    assert.equal(pagesSeen(), before + 1, "the walk yielded a path the law refuses");
  });
});

describe("docs/architecture.md §Directories — a declared root is a vault path", () => {
  let dir = "";
  before(() => {
    dir = vault("roots");
  });
  after(() => {
    rmSync(join(SCRATCH, "roots"), { recursive: true, force: true });
  });

  it("content_roots: ['..'] is refused at load, naming the reason", () => {
    // It loaded, and the walk linted every .md BESIDE the vault under the
    // bundle's own constitution. A read escape, at load, before any verb ran.
    const engine = join(dir, "config", "engine.json");
    const before = readFileSync(engine, "utf8");
    const config = JSON.parse(before) as Record<string, unknown>;
    for (const bad of ["..", "/etc", "wiki/..", "./wiki"]) {
      writeFileSync(engine, JSON.stringify({ ...config, content_roots: [bad] }, null, 2));
      const r = run(dir, ["lint"]);
      assert.equal(r.ok, false, `content_roots: ["${bad}"] loaded`);
      assert.equal(r.error["code"], "constitution-invalid", JSON.stringify(r.error));
      const issues = r.data["issues"] as { where: string; message: string }[];
      assert.equal(issues.length, 1, JSON.stringify(issues));
      assert.equal(issues[0]?.where, "engine.content_roots.0");
      assert.match(issues[0]?.message ?? "", /not a root inside the vault: it /u);
    }
    writeFileSync(engine, before);
  });

  it("source_roots is held to the same law", () => {
    const engine = join(dir, "config", "engine.json");
    const before = readFileSync(engine, "utf8");
    const config = JSON.parse(before) as Record<string, unknown>;
    writeFileSync(engine, JSON.stringify({ ...config, source_roots: ["../sources"] }, null, 2));
    const r = run(dir, ["lint"]);
    assert.equal(r.error["code"], "constitution-invalid", JSON.stringify(r.error));
    const issues = r.data["issues"] as { where: string }[];
    assert.equal(issues[0]?.where, "engine.source_roots.0");
    writeFileSync(engine, before);
  });

  it("a multi-segment root is still legal", () => {
    const engine = join(dir, "config", "engine.json");
    const before = readFileSync(engine, "utf8");
    const config = JSON.parse(before) as Record<string, unknown>;
    mkdirSync(join(dir, "docs", "wiki"), { recursive: true });
    writeFileSync(join(dir, "docs", "wiki", "Chen Jing.md"), PERSON);
    writeFileSync(engine, JSON.stringify({ ...config, content_roots: ["docs/wiki"] }, null, 2));
    const r = run(dir, ["lint"]);
    // Findings or not, the CONFIG loaded: the `content_roots` declaration names a directory
    // and no depth, so `docs/wiki` must not be collateral damage of the path law.
    assert.notEqual(r.error["code"], "constitution-invalid", JSON.stringify(r.error));
    writeFileSync(engine, before);
    rmSync(join(dir, "docs"), { recursive: true, force: true });
  });
});

describe("docs/architecture.md §Directories — containment is resolved, not spelled", () => {
  let dir = "";
  before(() => {
    dir = vault("symlink");
  });
  after(() => {
    rmSync(join(SCRATCH, "symlink"), { recursive: true, force: true });
  });

  // `craft`, because it is a REGISTERED tag of the memory law. A folder the
  // constitution does not know is refused by `folder-segment-registered` long
  // before the write, and this case would then pass while proving nothing about
  // containment. The link is the only thing wrong with what follows.
  // A distinct identity, so the contained-write case below is not refused by
  // the identity tier for answering to the seeded page's name.
  const LINKED = "wiki/craft/Wu Lan.md";
  const TAGGED = PERSON.replace("tags: []", "tags: [craft]").replaceAll("Chen Jing", "Wu Lan");

  it("a symlinked directory out of the vault does not become a write target", () => {
    // Nothing about the path is illegal to SPELL. Only realpath knows.
    const outside = join(SCRATCH, "symlink", "outside");
    mkdirSync(outside, { recursive: true });
    directoryLink(outside, join(dir, "wiki", "craft"));
    const r = run(dir, ["write", LINKED, "--date", "2026-09-04"], TAGGED);
    assert.equal(r.ok, false, "the write through a link out of the vault succeeded");
    assert.equal(r.error["code"], "invalid-path", JSON.stringify(r.error));
    assert.match(String(r.error["message"]), /resolves outside the vault/u);
    assert.equal(existsSync(join(outside, "Wu Lan.md")), false, "bytes landed outside");
  });

  it("`new --dest` is contained by the same question", () => {
    const outside = join(SCRATCH, "symlink", "outside");
    const r = run(dir, [
      "new",
      "person",
      "Bo Lin",
      "--dest",
      "wiki/craft/Bo Lin.md",
      "--date",
      "2026-09-04",
    ]);
    assert.equal(r.error["code"], "invalid-path", JSON.stringify(r.error));
    assert.match(String(r.error["message"]), /resolves outside the vault/u);
    assert.equal(existsSync(join(outside, "Bo Lin.md")), false);
  });

  it("a page symlinked out of the vault is refused where its bytes are read", () => {
    // The walk decides shape; the read decides containment. A link the walk
    // lists is refused by `readPage` before any verb judges it, so a lint over
    // the tree cannot quietly take bytes from outside the vault.
    if (process.platform === "win32") return; // a file link needs developer mode there
    const outside = join(SCRATCH, "symlink", "Yu Fen.md");
    writeFileSync(outside, PERSON.replaceAll("Chen Jing", "Yu Fen"));
    const linked = join(dir, "wiki", "Yu Fen.md");
    symlinkSync(outside, linked);
    try {
      const r = run(dir, ["lint"]);
      assert.equal(r.ok, false, "a lint over a linked-out page passed");
      assert.equal(r.error["code"], "unexpected-error", JSON.stringify(r.error));
      assert.match(String(r.error["message"]), /resolves outside the vault/u);
    } finally {
      rmSync(linked, { force: true });
    }
  });

  it("the same path inside the vault writes — the link is what is refused", () => {
    // Without this the case above is satisfied by any refusal at all. Replace
    // the link with a real directory and the identical argv succeeds.
    unlinkSync(join(dir, "wiki", "craft"));
    mkdirSync(join(dir, "wiki", "craft"), { recursive: true });
    const r = run(dir, ["write", LINKED, "--date", "2026-09-04"], TAGGED);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(existsSync(join(dir, "wiki", "craft", "Wu Lan.md")), true);
  });
});

describe("docs/architecture.md §Directories — vault-controlled reads stay inside the vault", () => {
  it("a template path cannot read and copy bytes from above the vault", () => {
    const dir = vault("template-read");
    const outside = join(SCRATCH, "template-read", "outside.md");
    const dest = join(dir, "wiki", "Copied.md");
    try {
      writeFileSync(outside, PERSON.replace("Chen Jing — a designer.", "EXTERNAL-SECRET"));
      const constitution = join(dir, "config", "constitution.json");
      const parsed = JSON.parse(readFileSync(constitution, "utf8")) as {
        types: { person: { template?: string } };
      };
      parsed.types.person.template = "../outside.md";
      writeFileSync(constitution, JSON.stringify(parsed, null, 2));

      const result = run(dir, [
        "new",
        "person",
        "Copied",
        "--dest",
        "wiki/Copied.md",
        "--date",
        "2026-09-04",
      ]);
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error["code"], "constitution-invalid", JSON.stringify(result.error));
      assert.equal(existsSync(dest), false, "external template bytes were not copied");
    } finally {
      rmSync(join(SCRATCH, "template-read"), { recursive: true, force: true });
    }
  });

  it("a content root linked outside is refused before its pages are walked", () => {
    const dir = vault("linked-root");
    const outside = join(SCRATCH, "linked-root", "outside");
    try {
      rmSync(join(dir, "wiki"), { recursive: true, force: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "External.md"), PERSON);
      directoryLink(outside, join(dir, "wiki"));

      const result = run(dir, ["lint", "--all"]);
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error["code"], "content-root-outside", JSON.stringify(result.error));
    } finally {
      rmSync(join(SCRATCH, "linked-root"), { recursive: true, force: true });
    }
  });
});

describe("docs/architecture.md §How a verdict is produced — Writer temporary files cannot be planted", () => {
  it("a hardlink at the former predictable temporary name cannot overwrite external bytes", () => {
    const dir = vault("writer-hardlink");
    const outside = join(SCRATCH, "writer-hardlink", "outside.txt");
    const destination = join(dir, "wiki", "Hard Link.md");
    const planted = `${destination}.wikiwright-tmp`;
    try {
      writeFileSync(outside, "ORIGINAL");
      linkSync(outside, planted);
      const draft = PERSON.replaceAll("Chen Jing", "Hard Link");

      const result = run(dir, ["write", "wiki/Hard Link.md", "--date", "2026-09-04"], draft);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(readFileSync(outside, "utf8"), "ORIGINAL", "external inode was overwritten");
      assert.match(readFileSync(destination, "utf8"), /Hard Link — a designer\./u);
      assert.equal(readFileSync(planted, "utf8"), "ORIGINAL", "the planted name was never opened");
    } finally {
      rmSync(join(SCRATCH, "writer-hardlink"), { recursive: true, force: true });
    }
  });

  it("a failed rename keeps the old destination and removes only its own temporary file", () => {
    const dir = vault("writer-failure");
    const destination = join(dir, "wiki", "blocked.md");
    try {
      mkdirSync(destination);
      const before = readdirSync(join(dir, "wiki")).sort();
      assert.throws(() => commitWrite(dir, "wiki/blocked.md", "NEW"));
      assert.equal(statSync(destination).isDirectory(), true, "the old destination remains");
      assert.deepEqual(
        readdirSync(join(dir, "wiki")).sort(),
        before,
        "no temporary debris remains",
      );
    } finally {
      rmSync(join(SCRATCH, "writer-failure"), { recursive: true, force: true });
    }
  });
});
