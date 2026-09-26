// docs/architecture.md §The invariants (every verb that can reach a filesystem
// write declares `writes: true` and a `plan`, and `--dry-run` returns exactly
// that plan with `wrote: false`, touching nothing) · docs/cli.md §The dry-run law
// (a dry run answers a valid invocation; `PlanOp.from`; the plan is exact for
// the invocation as typed and names files)
// · docs/cli.md (the modules that write directly are a closed set, read off
// their imports).
//
// Whether a verb writes is proved at runtime: every writing verb's dry run is
// driven against a tree hash, and every reader verb is driven the same way. What
// is read from source is only the closed set of direct writers — a module that
// imports a `node:fs` write API or spawns a writing `git` subcommand — and that
// no module but the Writer computes a page path to write.

import { afterAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { runCli } from "./fixtures/runtime.ts";
import { verbModule } from "./fixtures/verb-module.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

/** The `node:fs` write APIs the shell may import. */
const WRITE_CALLS = [
  "writeFileSync",
  "appendFileSync",
  "renameSync",
  "cpSync",
  "mkdirSync",
  "rmSync",
  "rmdirSync",
  "unlinkSync",
  "chmodSync",
  "createWriteStream",
  // The same writes without `Sync`: the callback API of `node:fs` and the
  // promise API of `node:fs/promises` spell them so.
  "writeFile",
  "appendFile",
  "rename",
  "cp",
  "mkdir",
  "rm",
  "rmdir",
  "unlink",
  "chmod",
];

/** `git <subcommand>` spellings that change the repository rather than read it. */
const GIT_WRITE =
  /"git",\s*\[\s*"(mv|add|commit|rm|checkout|reset|clean|init|apply|stash|tag|branch|merge|push|fetch)"/;

/** Every `.ts` under `src/`, recursively, POSIX-relative to `src/`. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(SRC, rel), { encoding: "utf8" }).sort()) {
      const next = rel === "" ? entry : `${rel}/${entry}`;
      if (statSync(join(SRC, next)).isDirectory()) walk(next);
      else if (entry.endsWith(".ts")) out.push(next);
    }
  };
  walk("");
  return out;
}

/** sha256 over every file in the tree: path and bytes, in code-unit order. */
function treeHash(root: string): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { encoding: "utf8" }).sort()) {
      if (entry === ".git") continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else files.push(abs);
    }
  };
  walk(root);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(root, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Path → sha256 for every file the fidelity check compares, which is a WIDER
 * set than `treeHash`: `.git/hooks` is exactly the write a vault-shaped hash
 * cannot see (docs/cli.md §The dry-run law).
 */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(rel === "" ? root : join(root, rel), { encoding: "utf8" }).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = rel === "" ? entry : `${rel}/${entry}`;
      if (next === ".git") {
        walk(".git/hooks");
        continue;
      }
      const abs = join(root, next);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(next);
      else out.set(next, createHash("sha256").update(readFileSync(abs)).digest("hex"));
    }
  };
  walk("");
  return out;
}

function delta(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [path, sha] of after) if (before.get(path) !== sha) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
}

const ENGINE = JSON.parse(readFileSync(join(FIXTURE, "config", "engine.json"), "utf8")) as Record<
  string,
  unknown
>;
const FOLDER_MODE = { ...ENGINE, folder_tags: { mode: "materialize-add-only" } };

/** minimal-vault without its broken case, with a folder-tag mode the materializer runs under. */
function vault(engine: Record<string, unknown> = FOLDER_MODE): string {
  const dir = mkdtempSync(join(tmpdir(), "ww-dryrun-"));
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, "wiki/test-execution/broken-case.md"));
  writeFileSync(join(dir, "config", "engine.json"), `${JSON.stringify(engine, null, 2)}\n`);
  gitInit(dir);
  return dir;
}

/**
 * A home of this file's own: a verb that scans the skill directories reads
 * none of the developer's.
 */
const HOME = mkdtempSync(join(tmpdir(), "ww-dryrun-home-"));
afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
});

function run(
  cwd: string,
  args: string[],
  stdin?: string,
): { status: number; envelope: Record<string, unknown> } {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...PINNED_CLOCK,
    HOME,
  };
  const r = runCli([CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env,
    input: stdin ?? "",
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

/** The page `write`'s cases edit. */
const WRITE_TARGET = "wiki/test-execution/warm-reset.md";

/** A test case with the sections its type requires. */
function testCase(title: string, id: string): string {
  return `---\ntype: test-case\ntitle: ${title}\ndescription: ${title}.\ncase_id: ${id}\ntags: [test-execution]\n---\n\n# ${title}\n\n## Purpose\n\nA purpose.\n\n## Execution\n\nA step.\n`;
}

/** A drafts directory holding exactly `files`, outside the bundle. */
function draftsOf(files: Record<string, string>): string {
  const from = mkdtempSync(join(tmpdir(), "ww-dryrun-drafts-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(from, path)), { recursive: true });
    writeFileSync(join(from, path), text);
  }
  return from;
}

/** The drafts `write`'s cases land: the edited page, one line appended, and a new page. */
function drafts(dir: string): string {
  const seed = readFileSync(join(dir, WRITE_TARGET), "utf8");
  return draftsOf({
    [WRITE_TARGET]: `${seed.replace(/\n*$/u, "")}\n\nA line the draft adds.\n`,
    "wiki/test-execution/batch-one.md": testCase("Batch one", "TC-0201"),
  });
}

/** ops.json moving the edited page to another folder. */
function moveOps(): string {
  return draftsOf({
    "ops.json": JSON.stringify({
      move: [{ from: WRITE_TARGET, to: "wiki/reset/warm-reset.md", reason: "tidy" }],
    }),
  });
}

interface PlanOp {
  kind: string;
  path: string;
  from?: string;
  summary: string;
}

function opsOf(envelope: Record<string, unknown>): PlanOp[] {
  const data = (envelope["data"] ?? {}) as Record<string, unknown>;
  return (data["ops"] ?? []) as PlanOp[];
}

/** Every path a plan accounts for: where a file lands, and where it left. */
function plannedPaths(ops: readonly PlanOp[]): string[] {
  const paths = new Set<string>();
  for (const op of ops) {
    paths.add(op.path);
    if (op.from !== undefined) paths.add(op.from);
  }
  return [...paths].sort();
}

/** One dry-run invocation per writing verb, each one that succeeds on the fixture. */
const DRY_RUNS: Record<string, (dir: string) => string[]> = {
  check: () => ["check", "--write", "--dry-run"],
  write: (dir) => ["write", "--from", drafts(dir), "--dry-run"],
};

describe("the dry-run law (docs/architecture.md §The invariants)", () => {
  it("every writes: true verb declares a plan, and no reader does", () => {
    const writers = COMMANDS.filter((c) => c.writes).map((c) => c.name);
    assert.equal(writers.length > 0, true, "the registry has writing verbs");
    for (const command of COMMANDS) {
      if (command.writes) {
        assert.equal(
          typeof command.plan,
          "function",
          `"${command.name}" declares writes: true and no plan(args)`,
        );
      } else {
        assert.equal(
          command.plan,
          undefined,
          `"${command.name}" declares writes: false and a plan — a reader has nothing to plan`,
        );
      }
    }
  });

  it("--help --json prints writes for every command", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["--help", "--json"]);
      const commands = ((r.envelope["data"] as Record<string, unknown>)["commands"] ?? []) as Array<
        Record<string, unknown>
      >;
      assert.equal(commands.length, COMMANDS.length);
      for (const row of commands) {
        const spec = COMMANDS.find((c) => c.name === row["name"]);
        assert.notEqual(spec, undefined);
        assert.equal(
          row["writes"],
          spec?.writes,
          `the "${String(row["name"])}" row disagrees with the registry about writes`,
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("every writing verb has a dry run this test drives", () => {
    for (const command of COMMANDS) {
      if (!command.writes) continue;
      assert.notEqual(
        DRY_RUNS[command.name],
        undefined,
        `"${command.name}" writes and this test does not exercise its --dry-run`,
      );
    }
  });

  for (const command of COMMANDS.filter((c) => c.writes)) {
    it(`${command.name} --dry-run writes nothing and reports wrote: false`, () => {
      const tmp = vault();
      try {
        const before = treeHash(tmp);
        const r = run(tmp, DRY_RUNS[command.name]?.(tmp) ?? []);
        assert.equal(r.status, 0, `${command.name}: ${JSON.stringify(r.envelope)}`);
        const data = (r.envelope["data"] ?? {}) as Record<string, unknown>;
        assert.equal(data["wrote"], false, `${command.name} does not report wrote: false`);
        assert.equal(Array.isArray(data["ops"]), true, `${command.name} reports no ops array`);
        assert.equal(treeHash(tmp), before, `${command.name} --dry-run changed the vault tree`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it("a reader verb does not accept --dry-run at all (the flag comes from the registry)", () => {
    const tmp = vault();
    try {
      for (const command of COMMANDS.filter((c) => !c.writes)) {
        const r = run(tmp, [command.name, "--dry-run"]);
        assert.equal(
          r.status,
          2,
          `"${command.name}" declares writes: false and accepts --dry-run: ${JSON.stringify(r.envelope)}`,
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // One subprocess per verb; the budget is the WORK, not the runner's default.
  it("every writing verb advertises --dry-run in its own --help", () => {
    const tmp = vault();
    try {
      for (const command of COMMANDS) {
        const r = run(tmp, [command.name, "--help"]);
        const flags = ((r.envelope["data"] as Record<string, unknown>)["flags"] ?? []) as Array<{
          name: string;
        }>;
        assert.equal(
          flags.some((f) => f.name === "dry-run"),
          command.writes,
          `"${command.name}" --help and its writes declaration disagree about --dry-run`,
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});

// docs/cli.md §The dry-run law: a dry run answers a VALID invocation. Each
// row is a write the verb refuses; its dry run must refuse it the same way,
// never answer with a confident plan an agent would take as safe.
interface Refusal {
  name: string;
  argv: (dir: string) => string[];
  arrange?: (dir: string) => void;
}

const REFUSALS: Refusal[] = [
  {
    name: "write from a directory that is not there",
    argv: (dir) => ["write", "--from", join(dir, "no-such-drafts")],
  },
  {
    name: "write with an ops.json that is not one",
    argv: () => ["write", "--from", draftsOf({ "ops.json": "{ not json" })],
  },
  {
    name: "write of a draft outside the content roots",
    argv: () => ["write", "--from", draftsOf({ "notes/x.md": testCase("X", "TC-0301") })],
  },
  {
    name: "write that moves a page onto one that exists",
    argv: () => [
      "write",
      "--from",
      draftsOf({
        "ops.json": JSON.stringify({
          move: [{ from: WRITE_TARGET, to: "wiki/test-execution/热重启.md", reason: "tidy" }],
        }),
      }),
    ],
  },
  {
    name: "check --write over a law that does not load",
    argv: () => ["check", "--write"],
    arrange: (dir) =>
      writeFileSync(join(dir, "constitution", "types", "test-case.yaml"), "type: test-case\n"),
  },
];

describe("a dry run answers a valid invocation, never a typo (docs/cli.md §The dry-run law)", () => {
  for (const refusal of REFUSALS) {
    it(`${refusal.name} is refused with and without --dry-run`, () => {
      const tmp = vault();
      try {
        refusal.arrange?.(tmp);
        const argv = refusal.argv(tmp);
        const real = run(tmp, argv);
        assert.notEqual(real.status, 0, `${refusal.name}: the real run does not refuse`);
        const dry = run(tmp, [...argv, "--dry-run"]);
        const realError = (real.envelope["error"] ?? {}) as Record<string, unknown>;
        const dryError = (dry.envelope["error"] ?? {}) as Record<string, unknown>;
        assert.equal(
          dry.status,
          real.status,
          `${refusal.name}: --dry-run exits ${dry.status}, the run exits ${real.status} — ${JSON.stringify(dry.envelope)}`,
        );
        assert.equal(
          dryError["code"],
          realError["code"],
          `${refusal.name}: --dry-run and the run name different errors`,
        );
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});

// docs/cli.md §The dry-run law: the plan's path set IS the delta the run
// makes. This is the test whose absence once let a plan name writes the verb
// would not make, a directory where the verb landed files, and a rename with
// no source.
interface Fidelity {
  name: string;
  /** The verb this case drives, and its argv WITHOUT `--dry-run`. */
  verb: string;
  argv: (dir: string) => string[];
  arrange?: (dir: string) => void;
  /** Whether this case must plan at least one op — a vacuous case proves nothing. */
  writes: boolean;
}

const FIDELITY: Fidelity[] = [
  {
    name: "check (no --write writes nothing)",
    verb: "check",
    argv: () => ["check"],
    writes: false,
  },
  { name: "check --write", verb: "check", argv: () => ["check", "--write"], writes: true },
  {
    name: "check --fix (the folder-tag materializer)",
    verb: "check",
    argv: () => ["check", "--fix"],
    arrange: (dir) => {
      mkdirSync(join(dir, "wiki", "reset"), { recursive: true });
      writeFileSync(join(dir, "wiki", "reset", "cold-reset.md"), testCase("Cold reset", "TC-0401"));
    },
    writes: true,
  },
  {
    name: "write --from (drafts)",
    verb: "write",
    argv: (dir) => ["write", "--from", drafts(dir)],
    writes: true,
  },
  {
    name: "write --from (a move in ops.json)",
    verb: "write",
    argv: () => ["write", "--from", moveOps()],
    writes: true,
  },
];

describe("a plan is exact for the invocation as typed (docs/cli.md §The dry-run law)", () => {
  it("every writing verb has a fidelity case", () => {
    const covered = new Set(FIDELITY.map((c) => c.verb));
    for (const command of COMMANDS) {
      if (!command.writes) continue;
      assert.equal(
        covered.has(command.name),
        true,
        `"${command.name}" writes and no fidelity case drives it`,
      );
    }
  });

  for (const c of FIDELITY) {
    it(`${c.name}: the plan's paths are the delta's paths`, () => {
      const make = (): string => {
        const dir = vault();
        c.arrange?.(dir);
        return dir;
      };
      // The plan and the run are read from two identical trees, so the run
      // cannot be judged against a tree the dry run already changed.
      const planned = make();
      const applied = make();
      try {
        const dry = run(planned, [...c.argv(planned), "--dry-run"]);
        assert.notEqual(dry.status, 1, `${c.name} --dry-run: ${JSON.stringify(dry.envelope)}`);
        const ops = opsOf(dry.envelope);
        assert.equal(
          plannedPaths(ops).length > 0,
          c.writes,
          c.writes
            ? `${c.name}: the plan is empty — a vacuous fidelity case proves nothing`
            : `${c.name}: the invocation as typed writes nothing and the plan names paths`,
        );
        const before = snapshot(applied);
        const real = run(applied, c.argv(applied));
        assert.notEqual(real.status, 1, `${c.name}: ${JSON.stringify(real.envelope)}`);
        const actual = delta(before, snapshot(applied));
        assert.deepEqual(
          actual,
          plannedPaths(ops),
          `${c.name}: the plan and the run disagree — planned ${JSON.stringify(plannedPaths(ops))}, actual ${JSON.stringify(actual)}`,
        );
      } finally {
        rmSync(planned, { recursive: true, force: true });
        rmSync(applied, { recursive: true, force: true });
      }
    });
  }

  // One `path` per op named where a file arrives and nothing named where it left.
  it("a rename reports its source in from", () => {
    const tmp = vault();
    try {
      const ops = opsOf(run(tmp, ["write", "--from", moveOps(), "--dry-run"]).envelope);
      const rename = ops.find((op) => op.kind === "rename");
      assert.notEqual(rename, undefined, JSON.stringify(ops));
      assert.equal(rename?.path, "wiki/reset/warm-reset.md");
      assert.equal(rename?.from, WRITE_TARGET);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * docs/architecture.md §The invariants. The dry-run law bounds WHETHER a
 * verb writes; this bounds WHERE. Every content-page write goes through
 * `writer.ts`, and the set of modules that touch the filesystem directly is
 * closed with a reason per entry — so a direct write anywhere else fails the
 * build by the module's own name rather than by a reviewer noticing.
 */

/**
 * The `node:fs` write APIs a module imports, by the specifier — never by a bare
 * name: a named import of one, or a namespace (`* as fs`) or default (`fs`)
 * binding called through a member, `fs.writeFileSync(`. It reads source text,
 * so an API reached through a name built at runtime is outside it.
 */
function fsWriteImports(raw: string): string[] {
  const out: string[] = [];
  // The clause holds no `;`, so it never runs back over an earlier import.
  for (const m of raw.matchAll(
    /import\s+(?:type\s+)?([^;]*?)\s+from\s+"node:fs(?:\/promises)?"/g,
  )) {
    const clause = m[1] ?? "";
    const named = /\{([\s\S]*?)\}/u.exec(clause)?.[1] ?? "";
    for (const entry of named.split(",")) {
      const name =
        entry
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim() ?? "";
      if (WRITE_CALLS.includes(name)) out.push(name);
    }
    const bare = clause.replace(/\{[\s\S]*?\}/u, "");
    const bindings = [
      /\*\s*as\s+([A-Za-z_$][\w$]*)/u.exec(bare)?.[1],
      /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/u.exec(bare)?.[1],
    ].filter((b): b is string => b !== undefined && b !== "type");
    for (const binding of bindings) {
      const member = new RegExp(`\\b${binding.replaceAll("$", "\\$")}\\.([A-Za-z]+)\\s*\\(`, "gu");
      for (const call of raw.matchAll(member)) {
        if (WRITE_CALLS.includes(call[1] ?? "")) out.push(call[1] ?? "");
      }
    }
  }
  return out;
}

/** A module writes directly when it imports a write API or spawns a writing `git`. */
/**
 * The shell's one staged replace. A module that imports it reaches the
 * filesystem as surely as one calling `node:fs`, so the closed set below counts
 * it: extracting the staging must not become a way out of the scan.
 */
const STAGED_REPLACE = /from\s+"\.{1,2}\/atomicwrite\.ts"/u;

function writesDirectly(raw: string): boolean {
  return fsWriteImports(raw).length > 0 || GIT_WRITE.test(raw) || STAGED_REPLACE.test(raw);
}

/**
 * The destinations a module writes that it COMPUTED. A fixed artifact path is a
 * quoted literal or a module CONSTANT under the root; anything else is a path the
 * caller worked out, which is what a page path is.
 */
function computedWrites(raw: string): string[] {
  const out: string[] = [];
  const call =
    /(?:writeFileSync|renameSync|appendFileSync|replaceFiles?)\s*\(\s*join\(\s*(?:args\.)?root\s*,\s*([^)]*)\)/g;
  for (const m of raw.matchAll(call)) {
    const rest = (m[1] ?? "").trim();
    if (rest === "") continue;
    const parts = rest.split(",").map((p) => p.trim());
    const fixed = parts.every(
      (p) => /^"[^"]*"$/.test(p) || /^'[^']*'$/.test(p) || /^[A-Z][A-Z0-9_]*$/.test(p),
    );
    if (!fixed) out.push(rest);
  }
  return out;
}

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

const DIRECT_WRITERS: Readonly<Record<string, string>> = {
  "atomicwrite.ts":
    "the shell's one staged replace: an exclusive temp beside the target, renamed into place",
  "verbs/check.ts":
    "`check --write`: the generated files under generated/, through the staged replace — one generator, byte-reproducible (v2 contracts §9.1)",
  "main.ts":
    "the file `--out` names, which receives the whole envelope through the staged replace: a destination the caller chose, never a page (v2 contracts §9)",
  "stagedkits.ts":
    "a kit declared by path, written out from the index under os.tmpdir() for the staged gate and removed once loaded: never a vault path (docs/cli.md §gate)",
  "stdoutfile.ts":
    "the file a git child writes its stdout to: created exclusively under os.tmpdir(), removed once read, never a vault path (docs/roadmap.md)",
  "writer.ts": "THE Writer: every content page, temp-then-rename",
};

describe("the Writer is the only writer of a content page (docs/architecture.md §The invariants)", () => {
  it("the set of modules that write directly is closed, with a reason per entry", () => {
    const found = sourceFiles().filter((rel) => writesDirectly(source(rel)));
    assert.deepEqual(
      found.sort(),
      Object.keys(DIRECT_WRITERS).sort(),
      "a module writes directly and is not declared — route it through writer.ts, or declare it with its reason",
    );
  });

  // A `writes: false` verb has no dry run to drive, so its not writing is held
  // here: it imports no write API and no module from the closed set above.
  it("a reader verb imports neither a write API nor a direct writer", () => {
    for (const command of COMMANDS) {
      if (command.writes) continue;
      const rel = verbModule(command.name);
      const raw = source(rel);
      const here = rel.slice(0, rel.indexOf("/") + 1);
      assert.deepEqual(
        fsWriteImports(raw),
        [],
        `"${command.name}" declares writes: false and imports a node:fs write API`,
      );
      assert.equal(GIT_WRITE.test(raw), false, `"${command.name}" spawns a writing git`);
      const specifiers = [...raw.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
      const writers = Object.keys(DIRECT_WRITERS).map((writer) =>
        writer.startsWith(here) ? `./${writer.slice(here.length)}` : `../${writer}`,
      );
      assert.deepEqual(
        specifiers.filter((spec) => writers.includes(spec)),
        [],
        `"${command.name}" declares writes: false and imports a module that writes`,
      );
    }
  });

  it("no verb writes a page: a computed destination belongs to the Writer", () => {
    const offenders = sourceFiles().filter(
      (rel) => rel !== "writer.ts" && computedWrites(source(rel)).length > 0,
    );
    assert.deepEqual(
      offenders,
      [],
      "these modules write a computed path directly; content pages go through writer.ts",
    );
  });

  it("and the guard can fail: a computed write outside writer.ts is detected", () => {
    assert.deepEqual(computedWrites("writeFileSync(join(args.root, page.path), text)"), [
      "page.path",
    ]);
    // A FIXED path is a literal or a module constant, and neither is a page.
    assert.deepEqual(
      computedWrites('writeFileSync(join(args.root, "generated", "manifest.json"), text)'),
      [],
    );
    assert.deepEqual(computedWrites("appendFileSync(join(root, REPORT_FILE), row)"), []);
    // Staging the bytes elsewhere is still writing them here.
    assert.deepEqual(computedWrites("replaceFile(join(args.root, page.path), text)"), [
      "page.path",
    ]);
    assert.equal(writesDirectly('import { replaceFile } from "./atomicwrite.ts";'), true);
    assert.equal(writesDirectly('import { writeFileSync as persist } from "node:fs";'), true);
    assert.equal(writesDirectly('import { readFileSync } from "node:fs";'), false);
    // A namespace or default binding reaches the write APIs through a member.
    for (const writes of [
      'import * as fs from "node:fs";\nfs.writeFileSync(path, text);',
      'import fs from "node:fs";\nfs.renameSync(from, to);',
      'import fs, { readFileSync } from "node:fs";\nfs.rmSync(path);',
      'import * as fsp from "node:fs/promises";\nawait fsp.writeFile(path, text);',
    ]) {
      assert.equal(writesDirectly(writes), true, writes);
    }
    for (const reads of [
      'import * as fs from "node:fs";\nfs.readFileSync(path);',
      'import fs from "node:fs";\nconst text = fs.readFileSync(path, "utf8");',
    ]) {
      assert.equal(writesDirectly(reads), false, reads);
    }
  });
});
