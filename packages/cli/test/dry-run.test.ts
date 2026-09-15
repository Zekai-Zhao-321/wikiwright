// docs/architecture.md §The invariants (every verb that can reach a filesystem
// write declares `writes: true` and a `plan`, and `--dry-run` returns exactly
// that plan with `wrote: false`, touching nothing) · docs/cli.md §The dry-run law
// (a dry run answers a valid invocation; `PlanOp.from`; the plan is exact for
// the invocation as typed and names files; the consumer-writer acknowledgment)
// · docs/cli.md (the modules that write directly are a closed set, read off
// their imports).
//
// Whether a verb writes is proved at runtime: every writing verb's dry run is
// driven against a tree hash, and every reader verb is driven the same way. What
// is read from source is only the closed set of direct writers — a module that
// imports a `node:fs` write API or spawns a writing `git` subcommand — and that
// no module but the Writer computes a page path to write.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
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
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";
import { trustFilePath } from "../src/trust.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));
const MODULE_FIXTURE = fileURLToPath(
  new URL("../../../fixtures/conformance/module-fixture", import.meta.url),
);

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
 * set than `treeHash`: `.git/hooks` (where `hook install` lands) and the
 * machine-local trust store (where `trust grant` lands) are exactly the writes
 * a vault-shaped hash cannot see (docs/cli.md §The dry-run law).
 */
function snapshot(root: string, trustStore: string): Map<string, string> {
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
  if (existsSync(trustStore)) {
    out.set(trustStore, createHash("sha256").update(readFileSync(trustStore)).digest("hex"));
  }
  return out;
}

function delta(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [path, sha] of after) if (before.get(path) !== sha) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}

/** Install the conformance fixture module into a scratch vault, offline. */
function installFixtureModule(dir: string): void {
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "ww-dry-run-bundle",
      private: true,
      dependencies: { "@wikiwright-fixture/probe": `file:${MODULE_FIXTURE}` },
    })}\n`,
  );
  execFileSync("bun", ["install"], { cwd: dir, stdio: "ignore" });
}

function gitInit(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: dir });
}

const FOLDER_MODE = { content_roots: ["wiki"], folder_tags: { mode: "materialize-add-only" } };

/** minimal-vault, with a folder-tag mode the folder-tags fixer can run under. */
function vault(engine: Record<string, unknown> = FOLDER_MODE): string {
  const dir = mkdtempSync(join(tmpdir(), "ww-dryrun-"));
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(join(dir, "config", "engine.json"), `${JSON.stringify(engine, null, 2)}\n`);
  gitInit(dir);
  return dir;
}

function run(
  cwd: string,
  args: string[],
  trustStore?: string,
  stdin?: string,
): { status: number; envelope: Record<string, unknown> } {
  const env: Record<string, string | undefined> = { ...process.env, ...PINNED_CLOCK };
  if (trustStore !== undefined) env["WIKIWRIGHT_TRUST_FILE"] = trustStore;
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env,
    input: stdin ?? "",
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

/** The page `write`'s cases edit, and the draft that edits it. */
const WRITE_TARGET = "wiki/test-execution/warm-reset.md";

function writeDraft(dir: string): string {
  return `${readFileSync(join(dir, WRITE_TARGET), "utf8").replace(/\n*$/u, "")}\n\nA line the draft adds.\n`;
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
const DRY_RUNS: Record<string, string[]> = {
  brief: ["brief", "--role", "writer", "--write", "--dry-run"],
  check: ["check", "--dry-run"],
  fix: [
    "fix",
    "--rule",
    "renamed-without-alias",
    "--path",
    "wiki/test-execution/warm-reset.md",
    "--staged",
    "--expect",
    "0",
    "--dry-run",
  ],
  freshness: ["freshness", "--dry-run"],
  gate: ["gate", "--dry-run"],
  hook: ["hook", "install", "--dry-run"],
  move: [
    "move",
    "wiki/test-execution/warm-reset.md",
    "wiki/other/warm-reset.md",
    "--reason",
    "activity-boundary",
    "--dry-run",
  ],
  new: ["new", "test-case", "Dry Run", "--dest", "wiki/test-execution/dry-run.md", "--dry-run"],
  retire: ["retire", "wiki/test-execution/warm-reset.md", "--dry-run"],
  skills: ["skills", "update", "--dry-run"],
  trust: ["trust", "list", "--dry-run"],
  // A dry run leaves nothing on disk and still renders its date into the
  // envelope it returns; the fidelity case below runs the same argv for real.
  write: ["write", WRITE_TARGET, "--dry-run", "--date", "2026-09-03"],
};

/** The verbs whose form reads Markdown on stdin (docs/cli.md §write). */
const DRY_RUN_STDIN: Record<string, (dir: string) => string> = { write: writeDraft };

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

  it("schema prints writes for every command", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["schema"]);
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
          `schema's "${String(row["name"])}" row disagrees with the registry about writes`,
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("every writing verb has a dry run this test drives", () => {
    for (const command of COMMANDS) {
      if (!command.writes || command.name === "init") continue;
      assert.notEqual(
        DRY_RUNS[command.name],
        undefined,
        `"${command.name}" writes and this test does not exercise its --dry-run`,
      );
    }
  });

  for (const command of COMMANDS.filter((c) => c.writes && c.name !== "init")) {
    it(`${command.name} --dry-run writes nothing and reports wrote: false`, () => {
      const tmp = vault();
      const store = trustFilePath();
      const storeBefore = existsSync(store) ? readFileSync(store, "utf8") : null;
      try {
        const before = treeHash(tmp);
        const argv = DRY_RUNS[command.name] ?? [];
        const r = run(tmp, argv, undefined, DRY_RUN_STDIN[command.name]?.(tmp));
        assert.equal(r.status, 0, `${command.name}: ${JSON.stringify(r.envelope)}`);
        const data = (r.envelope["data"] ?? {}) as Record<string, unknown>;
        assert.equal(data["wrote"], false, `${command.name} does not report wrote: false`);
        assert.equal(Array.isArray(data["ops"]), true, `${command.name} reports no ops array`);
        assert.equal(treeHash(tmp), before, `${command.name} --dry-run changed the vault tree`);
        const storeAfter = existsSync(store) ? readFileSync(store, "utf8") : null;
        assert.equal(storeAfter, storeBefore, `${command.name} --dry-run wrote the trust store`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

  it("init --dry-run scaffolds nothing into an empty directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-dryrun-init-"));
    try {
      const before = treeHash(tmp);
      const r = run(tmp, ["init", "--dry-run"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const data = (r.envelope["data"] ?? {}) as Record<string, unknown>;
      assert.equal(data["wrote"], false);
      assert.equal(
        (data["ops"] as unknown[]).length > 0,
        true,
        "init plans the files it would copy",
      );
      assert.equal(treeHash(tmp), before, "init --dry-run wrote into the directory");
      assert.equal(existsSync(join(tmp, "config")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // A plan names FILES. `init` planned two `copy` ops on skill
  // DIRECTORIES while landing eight files and two stamps.
  it("init --dry-run enumerates each skill's files and its stamp", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-dryrun-initfiles-"));
    try {
      const ops = opsOf(run(tmp, ["init", "--dry-run"]).envelope);
      const paths = plannedPaths(ops);
      for (const skill of ["wikiwright-maintain", "wikiwright-write"]) {
        assert.equal(
          paths.includes(`.claude/skills/${skill}/SKILL.md`),
          true,
          `init plans ${skill}/SKILL.md`,
        );
        assert.equal(
          paths.includes(`.claude/skills/${skill}/.wikiwright-stamp.json`),
          true,
          `init plans ${skill}'s stamp, under the basename the writer uses`,
        );
        assert.equal(
          paths.includes(`.claude/skills/${skill}`),
          false,
          `init plans ${skill}'s files, not the directory`,
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

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
  it("every writing verb advertises --dry-run in its own --help", { timeout: 120_000 }, () => {
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
  });
});

// docs/cli.md §The dry-run law law 5: a dry run answers a VALID invocation.
// Every row below returned exit 0 with a confident plan for a write the verb
// refuses — the answer an agent uses to decide it is safe to proceed.
interface Refusal {
  name: string;
  argv: string[];
  engine?: Record<string, unknown>;
  arrange?: (dir: string) => void;
  /** A tree that is not the fixture vault — an empty directory, or a non-repo. */
  make?: () => string;
}

const REFUSALS: Refusal[] = [
  {
    name: "init into an already-initialized directory",
    argv: ["init"],
    arrange: () => undefined,
  },
  {
    name: "hook install over a foreign pre-commit hook",
    argv: ["hook", "install"],
    arrange: (dir) => {
      const hooks = join(dir, ".git", "hooks");
      mkdirSync(hooks, { recursive: true });
      writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\n# someone else's gate\nexit 0\n");
    },
  },
  {
    name: "hook install with a missing --chain",
    argv: ["hook", "install", "--chain", "no/such.sh"],
  },
  { name: "hook with an unknown subcommand", argv: ["hook", "frobnicate"] },
  { name: "trust with an unknown action", argv: ["trust", "frobnicate"] },
  {
    name: "trust grant on a module that is not installed",
    argv: ["trust", "grant", "module:@nope/kit"],
  },
  {
    name: "move with no --reason",
    argv: ["move", "wiki/test-execution/warm-reset.md", "wiki/other/warm-reset.md"],
  },
  {
    name: "move that changes the basename",
    argv: [
      "move",
      "wiki/test-execution/warm-reset.md",
      "wiki/other/renamed.md",
      "--reason",
      "activity-boundary",
    ],
  },
  {
    name: "new of an unregistered type",
    argv: ["new", "no-such-type", "X", "--dest", "wiki/test-execution/x.md"],
  },
  {
    name: "new outside the content roots",
    argv: ["new", "test-case", "X", "--dest", "notes/x.md"],
  },
  {
    name: "retire naming a successor that does not exist",
    argv: ["retire", "wiki/test-execution/warm-reset.md", "--superseded-by", "no-such-page"],
  },
  { name: "skills with an unknown subcommand", argv: ["skills", "frobnicate"] },
  {
    name: "skills update over a file the engine cannot account for",
    argv: ["skills", "update"],
    arrange: (dir) => {
      mkdirSync(join(dir, ".claude", "skills", "wikiwright-maintain"), { recursive: true });
      writeFileSync(join(dir, ".claude", "skills", "wikiwright-maintain", "SKILL.md"), "mine\n");
    },
  },
  {
    name: "init over a file the starter would land",
    argv: ["init"],
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), "ww-refusal-init-"));
      mkdirSync(join(dir, "meta"), { recursive: true });
      writeFileSync(join(dir, "meta", "charter.md"), "# my charter\n");
      return dir;
    },
  },
  {
    name: "freshness --fast-forward without --fetch",
    argv: ["freshness", "--fast-forward"],
  },
];

describe("a dry run answers a valid invocation, never a typo (docs/cli.md §The dry-run law)", () => {
  for (const refusal of REFUSALS) {
    it(`${refusal.name} is refused with and without --dry-run`, () => {
      const store = join(mkdtempSync(join(tmpdir(), "ww-trust-")), "trust.json");
      const tmp = refusal.make === undefined ? vault(refusal.engine) : refusal.make();
      try {
        refusal.arrange?.(tmp);
        const real = run(tmp, refusal.argv, store);
        assert.notEqual(real.status, 0, `${refusal.name}: the real run does not refuse`);
        const dry = run(tmp, [...refusal.argv, "--dry-run"], store);
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
        assert.equal(existsSync(store), false, `${refusal.name}: the trust store was written`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
        rmSync(dirname(store), { recursive: true, force: true });
      }
    });
  }
});

// docs/cli.md §The dry-run law law 6: the plan's path set IS the delta the
// run makes. This is the test whose absence let a plan name eight writes the
// verb would not make, a directory where the verb lands eight files, and a
// rename with no source.
interface Fidelity {
  name: string;
  /** The argv WITHOUT `--dry-run`; the dry run is the same argv plus the flag. */
  argv: string[];
  engine?: Record<string, unknown>;
  arrange?: (dir: string) => void;
  /** Whether this case must plan at least one op — a vacuous case proves nothing. */
  writes: boolean;
  /** An empty vault instead of the fixture (init). */
  empty?: boolean;
  /** The Markdown this invocation reads on stdin (docs/cli.md §write). */
  stdin?: (dir: string) => string;
}

const FIDELITY: Fidelity[] = [
  { name: "check (no --write writes nothing)", argv: ["check"], writes: false },
  { name: "check --write", argv: ["check", "--write"], writes: true },
  {
    name: "fix",
    argv: [
      "fix",
      "--rule",
      "renamed-without-alias",
      "--path",
      "wiki/test-execution/warm-reset-two.md",
      "--line",
      "1",
      "--staged",
      "--expect",
      "1",
    ],
    arrange: (dir) => {
      execFileSync(
        "git",
        ["mv", "wiki/test-execution/warm-reset.md", "wiki/test-execution/warm-reset-two.md"],
        { cwd: dir },
      );
      execFileSync("git", ["add", "-A"], { cwd: dir });
    },
    writes: true,
  },
  { name: "freshness", argv: ["freshness"], writes: true },
  {
    name: "freshness --fetch --fast-forward",
    argv: ["freshness", "--fetch", "--fast-forward"],
    writes: true,
  },
  { name: "hook install", argv: ["hook", "install"], writes: true },
  {
    name: "hook install with the commit-msg hook",
    argv: ["hook", "install"],
    engine: { ...FOLDER_MODE, commit_prefixes: { prefixes: ["feat"] } },
    writes: true,
  },
  { name: "init", argv: ["init"], empty: true, writes: true },
  {
    name: "move",
    argv: [
      "move",
      "wiki/test-execution/warm-reset.md",
      "wiki/other/warm-reset.md",
      "--reason",
      "activity-boundary",
    ],
    writes: true,
  },
  {
    name: "new",
    argv: ["new", "test-case", "Dry Run", "--dest", "wiki/test-execution/dry-run.md"],
    writes: true,
  },
  { name: "retire", argv: ["retire", "wiki/test-execution/warm-reset.md"], writes: true },
  {
    // The stamp covers the generated brief, so `skills update` refreshes
    // the manual's generated half even where no skill file is installed.
    name: "skills update with no skills root",
    argv: ["skills", "update"],
    writes: true,
  },
  {
    name: "skills update with the skills root installed",
    argv: ["skills", "update"],
    arrange: (dir) => mkdirSync(join(dir, ".claude", "skills"), { recursive: true }),
    writes: true,
  },
  {
    // docs/extending.md §Declaring a module: a grant names an installed module package, so
    // the case installs the conformance fixture module first — offline, it is a
    // `file:` dependency — and the plan's one path is the machine-local store.
    name: "trust grant module:<package>",
    argv: ["trust", "grant", "module:@wikiwright-fixture/probe"],
    arrange: installFixtureModule,
    writes: true,
  },
  {
    name: "write (the whole-page form)",
    argv: ["write", WRITE_TARGET, "--date", "2026-09-03"],
    stdin: writeDraft,
    writes: true,
  },
  {
    // The plan names every draft the directory holds.
    name: "write --from (the batch form)",
    argv: ["write", "--from", "temp/drafts", "--date", "2026-09-03"],
    arrange: (dir) => {
      const seed = readFileSync(join(dir, WRITE_TARGET), "utf8");
      mkdirSync(join(dir, "temp", "drafts", "wiki", "test-execution"), { recursive: true });
      for (const [name, id] of [
        ["batch-one", "TC-0201"],
        ["batch-two", "TC-0202"],
      ]) {
        writeFileSync(
          join(dir, "temp", "drafts", "wiki", "test-execution", `${name}.md`),
          seed
            .replace("title: Warm reset under load", `title: ${name}`)
            .replace(/case_id: .*/u, `case_id: ${id}`)
            .replace("# Warm reset under load", `# ${name}`),
        );
      }
    },
    writes: true,
  },
];

describe("a plan is exact for the invocation as typed (docs/cli.md §The dry-run law)", () => {
  it("every writing verb has a fidelity case", () => {
    const covered = new Set(FIDELITY.map((c) => c.argv[0]));
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
      const trustDir = mkdtempSync(join(tmpdir(), "ww-trust-"));
      const store = join(trustDir, "trust.json");
      const make = (): string => {
        if (c.empty !== true) {
          const dir = vault(c.engine);
          c.arrange?.(dir);
          return dir;
        }
        const dir = mkdtempSync(join(tmpdir(), "ww-fidelity-init-"));
        gitInitEmpty(dir);
        c.arrange?.(dir);
        return dir;
      };
      // The plan and the run are read from two identical trees, so the run
      // cannot be judged against a tree the dry run already changed.
      const planned = make();
      const applied = make();
      try {
        const dry = run(planned, [...c.argv, "--dry-run"], store, c.stdin?.(planned));
        assert.equal(dry.status, 0, `${c.name} --dry-run: ${JSON.stringify(dry.envelope)}`);
        const ops = opsOf(dry.envelope);
        assert.equal(
          plannedPaths(ops).length > 0,
          c.writes,
          c.writes
            ? `${c.name}: the plan is empty — a vacuous fidelity case proves nothing`
            : `${c.name}: the invocation as typed writes nothing and the plan names paths`,
        );
        const before = snapshot(applied, store);
        const real = run(applied, c.argv, store, c.stdin?.(applied));
        assert.notEqual(real.status, 1, `${c.name}: ${JSON.stringify(real.envelope)}`);
        const actual = delta(before, snapshot(applied, store));
        assert.deepEqual(
          actual,
          plannedPaths(ops),
          `${c.name}: the plan and the run disagree — planned ${JSON.stringify(plannedPaths(ops))}, actual ${JSON.stringify(actual)}`,
        );
      } finally {
        rmSync(planned, { recursive: true, force: true });
        rmSync(applied, { recursive: true, force: true });
        rmSync(trustDir, { recursive: true, force: true });
      }
    });
  }

  // One `path` per op named where a file arrives and nothing named
  // where it left.
  it("a rename reports its source in from", () => {
    const tmp = vault();
    try {
      const ops = opsOf(
        run(tmp, [
          "move",
          "wiki/test-execution/warm-reset.md",
          "wiki/other/warm-reset.md",
          "--reason",
          "activity-boundary",
          "--dry-run",
        ]).envelope,
      );
      const rename = ops.find((op) => op.kind === "rename");
      assert.notEqual(rename, undefined, JSON.stringify(ops));
      assert.equal(rename?.path, "wiki/other/warm-reset.md");
      assert.equal(rename?.from, "wiki/test-execution/warm-reset.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function gitInitEmpty(dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
}

/**
 * docs/architecture.md §The invariants. The dry-run law bounds WHETHER a
 * verb writes; this bounds WHERE. Every content-page write goes through
 * `writer.ts`, and the set of modules that touch the filesystem directly is
 * closed with a reason per entry — so a direct write anywhere else fails the
 * build by the module's own name rather than by a reviewer noticing.
 */

/** The `node:fs` write APIs a module imports, by the specifier — never by a bare name. */
function fsWriteImports(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(
    /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+"node:fs(?:\/promises)?"/g,
  )) {
    for (const entry of (m[1] ?? "").replace(/[{}]/g, "").split(",")) {
      const name =
        entry
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim() ?? "";
      if (WRITE_CALLS.includes(name)) out.push(name);
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
  "artifacts.ts":
    "the generated artifacts and the writer's brief — one generator, byte-reproducible",
  "hooks.ts": "the git hooks, which are outside the vault (docs/cli.md §hook)",
  "skills.ts": "the shipped skills' install and its stamp",
  "trust.ts": "the machine-local trust store",
  "writer.ts": "THE Writer: every content page, temp-then-rename",
  // `init`'s tree copy is the one declared exception: it lands a starter,
  // it does not edit a page, and a starter is a directory rather than a splice.
  "verbs/init.ts": "the starter tree copy — the declared exception",
  "verbs/freshness.ts":
    "the freshness report under generated/, and the self-ignoring .wikiwright/ the origin caches live under (fixed paths, not pages)",
  "verbs/move.ts": "`mkdirSync` for the destination directory, before `git mv`",
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
      const raw = source(`verbs/${command.name}.ts`);
      assert.deepEqual(
        fsWriteImports(raw),
        [],
        `"${command.name}" declares writes: false and imports a node:fs write API`,
      );
      assert.equal(GIT_WRITE.test(raw), false, `"${command.name}" spawns a writing git`);
      const specifiers = [...raw.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
      const writers = Object.keys(DIRECT_WRITERS).map((rel) =>
        rel.startsWith("verbs/") ? `./${rel.slice("verbs/".length)}` : `../${rel}`,
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
  });
});
