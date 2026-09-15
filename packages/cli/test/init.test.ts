// docs/cli.md §init (a fresh init passes check with zero findings, and
// its artifacts come through `check --write`'s one code path; the
// starter's declarations decide which hooks it gets) · docs/architecture.md (init scaffolds a
// vault from a starter constitution; hook when git; non-destructive; validates
// its input) · docs/cli.md §brief (the code starter's types are the fix for
// measured drift).
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
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { grantKit, installKit, KIT_PACKAGE, runKit } from "./fixtures/kit-code.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Outcome {
  status: number;
  stderr: string;
  envelope: Record<string, unknown>;
}

function run(cwd: string, args: string[]): Outcome {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    // Never consult (or create) the developer's real trust store from a test.
    env: { ...process.env, ...PINNED_CLOCK, WIKIWRIGHT_TRUST_FILE: join(cwd, ".trust.json") },
  });
  return {
    status: r.status ?? -1,
    stderr: r.stderr,
    envelope: JSON.parse(r.stdout) as Record<string, unknown>,
  };
}

function dataOf(o: Outcome): Record<string, unknown> {
  return (o.envelope["data"] ?? {}) as Record<string, unknown>;
}

function gitRepoWithHead(tmp: string): void {
  execFileSync("git", ["init", "-q"], { cwd: tmp });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: tmp });
  execFileSync("git", ["config", "user.name", "T"], { cwd: tmp });
  writeFileSync(join(tmp, "README.md"), "# a repo that will host a vault\n");
  execFileSync("git", ["add", "-A"], { cwd: tmp });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: tmp });
}

const GENERATED = ["generated/graph.json", "generated/manifest.json", "generated/tag-catalog.md"];

/** sha256 over every file in the tree (paths and bytes), so "wrote nothing" is a fact. */
function treeHash(root: string): string {
  const hash = createHash("sha256");
  const walk = (rel: string): void => {
    for (const entry of readdirSync(rel === "" ? root : join(root, rel)).sort()) {
      const next = rel === "" ? entry : `${rel}/${entry}`;
      if (statSync(join(root, next)).isDirectory()) walk(next);
      else
        hash
          .update(next)
          .update("\0")
          .update(readFileSync(join(root, next)))
          .update("\0");
    }
  };
  walk("");
  return hash.digest("hex");
}

describe("init lands a starter that declares modules, and names what makes it green (docs/cli.md §init)", () => {
  // docs/extending.md §The code kit: the `code` starter is a bundle over
  // `@wikiwright/kit-code`. The kit lives in node_modules the copy does not
  // create and a grant is a machine-local act, so init lands the files and
  // the hook, renders no artifact and no brief, and the envelope names the
  // install, the grant, `check --write` and `brief --write`.
  it("the envelope names the steps; the plan is the files; check refuses by name until they are done", {
    timeout: 60_000,
  }, () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-init-code-"));
    try {
      const planned = runKit(tmp, ["init", "--constitution", "code", "--dry-run"]);
      assert.equal(planned.status, 0, JSON.stringify(planned.envelope));
      const plannedPaths = ((planned.envelope.data?.["ops"] ?? []) as { path: string }[])
        .map((op) => op.path)
        .sort();
      const init = runKit(tmp, ["init", "--constitution", "code"]);
      assert.equal(init.status, 0, JSON.stringify(init.envelope));
      const data = init.envelope.data ?? {};
      assert.deepEqual(data["generated"], [], "no law loaded, so no artifact was rendered");
      assert.equal(data["brief"], null);
      const modules = data["modules"] as { declared: string[]; loaded: boolean; next: string[] };
      assert.deepEqual(modules.declared, [KIT_PACKAGE]);
      assert.equal(modules.loaded, false);
      // The approval is a maintainer's decision, never a command the envelope
      // hands an agent to run; the check that follows it is a command.
      assert.equal(modules.next.length, 2, JSON.stringify(modules.next));
      assert.doesNotMatch(modules.next[0] ?? "", /trust grant/u);
      assert.match(modules.next[0] ?? "", /maintainer/u);
      assert.match(modules.next[0] ?? "", /@wikiwright\/kit-code/u);
      assert.equal(modules.next[1], "wikiwright check --write");
      assert.equal(existsSync(join(tmp, "package.json")), true, "the starter ships its manifest");
      assert.equal(existsSync(join(tmp, "generated", "graph.json")), false);
      // The dry run's path set is the real run's delta: the directory was
      // empty, so every file it holds now is what init landed.
      const landed = readdirSync(tmp, { recursive: true, encoding: "utf8" })
        .map((f) => f.replaceAll("\\", "/"))
        .filter((f) => statSync(join(tmp, f)).isFile())
        .sort();
      assert.deepEqual(plannedPaths, landed);
      // Before the install: refused by name, with the install named and the
      // approval left to a maintainer.
      const unresolved = runKit(tmp, ["check"]);
      assert.equal(unresolved.status, 2, JSON.stringify(unresolved.envelope));
      assert.equal(unresolved.envelope.error?.["code"], "module-unresolved");
      assert.match(String(unresolved.envelope.error?.["hint"]), /install/u);
      assert.doesNotMatch(String(unresolved.envelope.error?.["hint"]), /trust grant/u);
      const listed = runKit(tmp, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as { code: string; hint: string }[];
      assert.equal(refused[0]?.code, "module-unresolved");
      assert.match(refused[0]?.hint ?? "", /install .* maintainer/u);
      // After the install, before the grant: the approval is named as a
      // maintainer's decision, not as a command to run.
      installKit(tmp);
      const untrusted = runKit(tmp, ["check"]);
      assert.equal(untrusted.envelope.error?.["code"], "module-untrusted");
      assert.match(String(untrusted.envelope.error?.["hint"]), /maintainer/u);
      assert.doesNotMatch(String(untrusted.envelope.error?.["hint"]), /trust grant/u);
      // The named steps, in order, and the first real check is green.
      grantKit(tmp);
      assert.equal(
        runKit(tmp, ["check", "--write"]).status,
        0,
        "artifacts and the brief, one verb",
      );
      const check = runKit(tmp, ["check"]);
      assert.equal(check.status, 0, JSON.stringify(check.envelope));
      assert.deepEqual(
        check.envelope.data?.["findings"],
        [],
        "a code bundle is green once installed and granted",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("init leaves a green vault (docs/cli.md §init)", () => {
  it("reports the generated artifacts, and the very first check has zero findings", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-r0-init-"));
    try {
      const init = run(tmp, ["init"]);
      assert.equal(init.status, 0, JSON.stringify(init.envelope));
      const generated = dataOf(init)["generated"];
      assert.equal(Array.isArray(generated), true, "init's envelope lists `generated`");
      for (const path of GENERATED) {
        assert.equal((generated as string[]).includes(path), true, `init generated ${path}`);
        assert.equal(existsSync(join(tmp, path)), true, `${path} exists on disk`);
      }
      const check = run(tmp, ["check"]);
      assert.equal(check.status, 0, JSON.stringify(check.envelope));
      const findings = dataOf(check)["findings"] as unknown[];
      assert.deepEqual(findings, [], "a fresh init has nothing to report");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("init's artifacts are the bytes check --write produces — one generator, no second path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-r0-init-"));
    try {
      const init = run(tmp, ["init", "--constitution", "base"]);
      assert.equal(init.status, 0, JSON.stringify(init.envelope));
      const before = new Map(GENERATED.map((p) => [p, readFileSync(join(tmp, p))]));
      const written = run(tmp, ["check", "--write"]);
      assert.equal(written.status, 0);
      assert.deepEqual(
        [...(dataOf(init)["generated"] as string[])].sort(),
        [...(dataOf(written)["generated"] as { files: string[] }).files].sort(),
        "init reports exactly the set check --write writes",
      );
      for (const [path, bytes] of before) {
        assert.equal(
          bytes.equals(readFileSync(join(tmp, path))),
          true,
          `${path} unchanged by check --write`,
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("in a git repository with a head, init installs the hook and check is still clean", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-r0-init-"));
    try {
      gitRepoWithHead(tmp);
      const init = run(tmp, ["init"]);
      assert.equal(init.status, 0, JSON.stringify(init.envelope));
      assert.equal(dataOf(init)["hook"], true);
      const check = run(tmp, ["check"]);
      assert.equal(check.status, 0, JSON.stringify(check.envelope));
      assert.deepEqual(dataOf(check)["findings"], []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("no spawned git diagnostic leaks onto stderr: init outside git, check with no head", () => {
    // docs/cli.md §The envelope — a subprocess never inherits the verb's stderr;
    // docs/cli.md §init — a repository with no commit yet carries NO finding:
    // `check` contacts no origin and the freshness rows read `external-origin`
    // in the coverage block, so the law that a fresh init is green holds
    // with no exception.
    const plain = mkdtempSync(join(tmpdir(), "ww-r0-init-"));
    const repo = mkdtempSync(join(tmpdir(), "ww-r0-init-"));
    try {
      const outside = run(plain, ["init"]);
      assert.equal(outside.status, 0, JSON.stringify(outside.envelope));
      assert.equal(dataOf(outside)["hook"], false);
      assert.equal(outside.stderr, "", "init outside git is silent on stderr");

      execFileSync("git", ["init", "-q"], { cwd: repo });
      const init = run(repo, ["init"]);
      assert.equal(init.status, 0, JSON.stringify(init.envelope));
      assert.equal(dataOf(init)["hook"], true, "a head is not needed to install the hook");
      assert.equal(init.stderr, "", "init in a no-head repository is silent on stderr");
      const check = run(repo, ["check"]);
      assert.equal(check.status, 0, JSON.stringify(check.envelope));
      const findings = dataOf(check)["findings"] as Array<{ ruleId: string; severity: string }>;
      assert.deepEqual(findings, [], "nothing to be fresh against is not a defect");
      const coverage = dataOf(check)["coverage"] as {
        passes: Record<string, { reason?: string }>;
      };
      assert.equal(coverage.passes["stale-capture"]?.reason, "external-origin");
      assert.equal(check.stderr, "", "the missing head is coverage, not a fatal on stderr");
    } finally {
      rmSync(plain, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("init — scaffold from a starter constitution (docs/architecture.md)", () => {
  it("scaffolds a working vault whose charter lints clean", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-init-"));
    try {
      const r = run(tmp, ["init"]);
      assert.equal(r.status, 0);
      assert.equal(existsSync(join(tmp, "config/constitution.json")), true);
      assert.equal(existsSync(join(tmp, "meta/charter.md")), true);
      const list = run(tmp, ["type", "list"]);
      assert.equal(list.status, 0);
      const lint = run(tmp, ["lint", "--page", "meta/charter.md"]);
      assert.equal(lint.status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // A file already carrying the bytes init would write is not a conflict,
  // so a second init over its own output is a no-op that says so — the attitude
  // `hook install` already took to its own hook.
  it("a second init over its own output writes nothing and reports every file unchanged", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-init-"));
    try {
      assert.equal(run(tmp, ["init"]).status, 0);
      const before = treeHash(tmp);
      const again = run(tmp, ["init"]);
      assert.equal(again.status, 0, JSON.stringify(again.envelope));
      assert.deepEqual(dataOf(again)["written"], []);
      assert.deepEqual(dataOf(again)["overwritten"], []);
      const unchanged = dataOf(again)["unchanged"] as string[];
      assert.equal(unchanged.includes("config/constitution.json"), true);
      assert.equal(unchanged.includes("meta/charter.md"), true);
      assert.equal(treeHash(tmp), before, "the second init moved a byte");
      const dry = run(tmp, ["init", "--dry-run"]);
      assert.equal(dry.status, 0, JSON.stringify(dry.envelope));
      assert.deepEqual(dataOf(dry)["ops"], [], "nothing to write, so the plan is empty");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("installs the pre-commit hook when a git repo exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-init-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: tmp });
      assert.equal(run(tmp, ["init"]).status, 0);
      assert.equal(existsSync(join(tmp, ".git/hooks/pre-commit")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // docs/cli.md §init — the STARTER's declarations decide which hooks
  // it gets. Neither shipped starter declares commit_prefixes, so a fresh init
  // installs the staged gate and nothing else; the declared arm is the one
  // commit-prefixes.test.ts drives through `hook install`.
  it("installs no commit-msg hook for a starter that declares no prefixes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-init-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: tmp });
      assert.equal(run(tmp, ["init"]).status, 0);
      assert.equal(existsSync(join(tmp, ".git/hooks/commit-msg")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("init --constitution code — the code bundle (types are the fix for openwiki's measured drift)", () => {
  // The starter is a bundle over the code kit (docs/extending.md §The code
  // kit): its concrete types extend the kit's abstract ones, and a fresh vault
  // is judged once the kit is installed and granted.
  const CODE_TYPES = [
    "architecture-overview",
    "code-concept",
    "decision",
    "integration",
    "ops-reference",
    "quickstart",
    "source-map",
    "subsystem",
    "testing-guide",
  ];

  /** `init --constitution code`, then the two steps its envelope names. */
  function codeBundle(): string {
    const tmp = mkdtempSync(join(tmpdir(), "ww-code-"));
    const init = runKit(tmp, ["init", "--constitution", "code"]);
    assert.equal(init.status, 0, JSON.stringify(init.envelope));
    installKit(tmp);
    grantKit(tmp);
    return tmp;
  }

  it("registers the nine nominal code types plus the charter, over the kit's abstract ones", () => {
    const tmp = codeBundle();
    try {
      const r = runKit(tmp, ["type", "list"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const types = (r.envelope.data as { types: Array<{ name: string; abstract?: boolean }> })
        .types;
      const names = types.map((t) => t.name);
      for (const t of [...CODE_TYPES, "charter"]) {
        assert.equal(names.includes(t), true, `code constitution registers ${t}`);
      }
      assert.equal(names.includes("code/subsystem"), true, "the kit's abstract types are listed");
      assert.equal(names.includes("workflow"), false, "a recurring procedure is the archetype");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("makes the subsystem shape a hard contract, not a prompt checklist", () => {
    const tmp = codeBundle();
    try {
      const r = runKit(tmp, [
        "new",
        "subsystem",
        "Registry pipeline",
        "--dest",
        "wiki/registry-pipeline.md",
        "--set",
        "pin=0123456789abcdef0123456789abcdef01234567",
        "--set",
        "origin=.",
        "--set",
        'covers=["packages/core/src/registry/"]',
        "--item",
        "Relations: mapped_in [[repository-layout]]",
      ]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const content = readFileSync(join(tmp, "wiki/registry-pipeline.md"), "utf8");
      for (const heading of ["## Responsibilities", "## Entry points", "## Invariants"]) {
        assert.equal(content.includes(heading), true, `template seeds ${heading}`);
      }
      assert.equal(runKit(tmp, ["lint", "--page", "wiki/registry-pipeline.md"]).status, 0);
      writeFileSync(
        join(tmp, "wiki/registry-pipeline.md"),
        content.replace("## Invariants", "## Vibes"),
      );
      const relint = runKit(tmp, ["lint", "--page", "wiki/registry-pipeline.md"]);
      assert.equal(relint.status, 5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a fresh code vault passes check --write once the kit is installed and granted", () => {
    const tmp = codeBundle();
    try {
      const r = runKit(tmp, ["check", "--write"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("init is non-destructive and validates its input (docs/architecture.md)", () => {
  /** Two files the base starter lands, with bytes that are not the starter's. */
  function twoConflicts(tmp: string): void {
    mkdirSync(join(tmp, "meta"), { recursive: true });
    mkdirSync(join(tmp, "config"), { recursive: true });
    writeFileSync(join(tmp, "meta/charter.md"), "MY PRECIOUS CUSTOM CHARTER\n");
    writeFileSync(join(tmp, "config/engine.json"), '{ "content_roots": ["wiki"] }\n');
  }

  it("refuses over every conflicting file in ONE envelope, and writes nothing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-rf-init-"));
    try {
      twoConflicts(tmp);
      const before = treeHash(tmp);
      const r = run(tmp, ["init"]);
      assert.equal(r.status, 4, JSON.stringify(r.envelope));
      const error = r.envelope["error"] as { code: string; details: { conflicts: string[] } };
      assert.equal(error.code, "file-exists");
      // Both, in one refusal — not one per run (three rounds to learn
      // three names). Code-unit order, so the list is stable.
      assert.deepEqual(error.details.conflicts, ["config/engine.json", "meta/charter.md"]);
      assert.deepEqual(dataOf(r)["conflicts"], ["config/engine.json", "meta/charter.md"]);
      // The refusal carries the plan too, so the whole file set is readable
      // from the envelope that refused it.
      const ops = dataOf(r)["ops"] as Array<{ kind: string; path: string; summary: string }>;
      assert.equal(dataOf(r)["wrote"], false);
      const charter = ops.find((op) => op.path === "meta/charter.md");
      assert.equal(charter?.kind, "write");
      assert.match(charter?.summary ?? "", /--force/);
      assert.equal(
        ops.some((op) => op.path === "config/constitution.json" && op.kind === "copy"),
        true,
        "the plan names the files that are not in conflict as well",
      );
      assert.equal(treeHash(tmp), before, "the refusal is atomic: nothing was written");
      assert.equal(readFileSync(join(tmp, "meta/charter.md"), "utf8").includes("PRECIOUS"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--dry-run over the conflicts is the same refusal, so the conflict list can be read first", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-rf-init-"));
    try {
      twoConflicts(tmp);
      const dry = run(tmp, ["init", "--dry-run"]);
      assert.equal(dry.status, 4, JSON.stringify(dry.envelope));
      const error = dry.envelope["error"] as { code: string; details: { conflicts: string[] } };
      assert.equal(error.code, "file-exists");
      assert.deepEqual(error.details.conflicts, ["config/engine.json", "meta/charter.md"]);
      assert.equal(existsSync(join(tmp, "config/constitution.json")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a file already identical to what init writes is not a conflict", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-rf-init-"));
    try {
      const starter = fileURLToPath(new URL("../constitutions/base/", import.meta.url));
      mkdirSync(join(tmp, "meta"), { recursive: true });
      mkdirSync(join(tmp, "raw"), { recursive: true });
      cpSync(join(starter, "meta/charter.md"), join(tmp, "meta/charter.md"));
      writeFileSync(join(tmp, "raw/.gitkeep"), "");
      const r = run(tmp, ["init"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const unchanged = dataOf(r)["unchanged"] as string[];
      assert.deepEqual(unchanged, ["meta/charter.md", "raw/.gitkeep"]);
      assert.equal((dataOf(r)["written"] as string[]).includes("config/constitution.json"), true);
      assert.equal(run(tmp, ["check"]).status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--force overwrites exactly the listed conflicts and reports them", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-rf-init-"));
    try {
      twoConflicts(tmp);
      const r = run(tmp, ["init", "--force"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      assert.deepEqual(dataOf(r)["overwritten"], ["config/engine.json", "meta/charter.md"]);
      assert.equal(readFileSync(join(tmp, "meta/charter.md"), "utf8").includes("PRECIOUS"), false);
      const check = run(tmp, ["check"]);
      assert.equal(check.status, 0, JSON.stringify(check.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a locally edited skill file is a conflict", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-rf-init-"));
    try {
      assert.equal(run(tmp, ["init"]).status, 0);
      const skill = join(tmp, ".claude/skills/wikiwright-write/SKILL.md");
      writeFileSync(skill, "mine now\n");
      const r = run(tmp, ["init"]);
      assert.equal(r.status, 4, JSON.stringify(r.envelope));
      assert.deepEqual(
        (r.envelope["error"] as { details: { conflicts: string[] } }).details.conflicts,
        [".claude/skills/wikiwright-write/SKILL.md"],
      );
      assert.equal(readFileSync(skill, "utf8"), "mine now\n");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects unknown or empty constitution names as usage", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-rf-init-"));
    try {
      assert.equal(run(tmp, ["init", "--constitution", ""]).status, 2);
      assert.equal(run(tmp, ["init", "--constitution", ".."]).status, 2);
      assert.equal(existsSync(join(tmp, "config")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
