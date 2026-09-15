// docs/cli.md §skills (the install stamp, `skills update | status`, the
// refusal on a bundle-edited file, skills-stale / skills-missing) (skills
// are versioned with the engine) · docs/concepts.md §Findings and routing (both arms are
// machine-local state, so warning is the ceiling).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SHIPPED = fileURLToPath(new URL("../skills", import.meta.url));
const STAMP = ".wikiwright-stamp.json";
const SKILLS = ["wikiwright-maintain", "wikiwright-write"];

interface Outcome {
  status: number;
  envelope: { ok?: boolean; data?: Record<string, unknown>; error?: Record<string, unknown> };
}

function run(cwd: string, args: string[]): Outcome {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return {
    status: r.status ?? -1,
    envelope: JSON.parse(r.stdout) as Outcome["envelope"],
  };
}

function dataOf(o: Outcome): Record<string, unknown> {
  return o.envelope.data ?? {};
}

function sha(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface Row {
  ruleId: string;
  severity: string;
  path: string;
  message?: string;
  details?: Record<string, unknown>;
}

function findings(o: Outcome): Row[] {
  return (dataOf(o)["findings"] ?? []) as Row[];
}

function stampPath(root: string, skill: string): string {
  return join(root, ".claude", "skills", skill, STAMP);
}

interface Stamp {
  engine: string;
  commit: string | null;
  files: Array<{ path: string; sha256: string }>;
}

function readStamp(root: string, skill: string): Stamp {
  return JSON.parse(readFileSync(stampPath(root, skill), "utf8")) as Stamp;
}

function shippedFiles(skill: string): string[] {
  return readdirSync(join(SHIPPED, skill), { recursive: true, encoding: "utf8" })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => f.endsWith(".md"))
    .sort();
}

function vault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-skills-"));
  const init = run(tmp, ["init"]);
  assert.equal(init.status, 0, JSON.stringify(init.envelope));
  return tmp;
}

describe("init stamps what it installed (docs/cli.md §skills)", () => {
  it("writes one stamp per skill, listing every installed file with its sha", () => {
    const tmp = vault();
    try {
      for (const skill of SKILLS) {
        assert.equal(existsSync(stampPath(tmp, skill)), true, `${skill} carries a stamp`);
        const stamp = readStamp(tmp, skill);
        assert.equal(stamp.engine, "0.1.0");
        assert.deepEqual(
          stamp.files.map((f) => f.path),
          shippedFiles(skill),
          `${skill}: the stamp lists exactly the shipped files, sorted`,
        );
        for (const file of stamp.files) {
          const installed = readFileSync(join(tmp, ".claude", "skills", skill, file.path));
          assert.equal(sha(installed), file.sha256, `${skill}/${file.path}: stamped sha is real`);
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the stamp's commit is the running build's commit — one answer, two verbs", () => {
    const tmp = vault();
    try {
      const version = dataOf(run(tmp, ["version"]));
      for (const skill of SKILLS) {
        assert.equal(readStamp(tmp, skill).commit, version["commit"] ?? null);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a freshly stamped install is `current` everywhere and check says nothing", () => {
    const tmp = vault();
    try {
      const status = run(tmp, ["skills", "status"]);
      assert.equal(status.status, 0, JSON.stringify(status.envelope));
      const skills = dataOf(status)["skills"] as Array<{
        skill: string;
        files: Array<{ state: string }>;
      }>;
      assert.equal(skills.length, 2);
      for (const skill of skills) {
        assert.equal(skill.files.length > 0, true);
        for (const file of skill.files) assert.equal(file.state, "current");
      }
      assert.deepEqual(findings(run(tmp, ["check"])), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("check reports the drift it can prove (docs/cli.md §skills)", () => {
  it("a stamp naming another build alone is skills-stale at INFO, and update clears it", () => {
    // Every installed sha is the shipped sha — nothing about the
    // install drifted, only the note saying which build wrote it. `commit` moves
    // with every engine build, so a warning here fires in every vault
    // after every engine commit, and its standing answer is "dismiss it".
    const tmp = vault();
    try {
      const running = dataOf(run(tmp, ["version"]))["commit"];
      assert.notEqual(
        running,
        null,
        "the tested binary carries build info — run `bun run build` before the suite",
      );
      const stamp = readStamp(tmp, "wikiwright-maintain");
      stamp.commit = "0000000";
      writeFileSync(stampPath(tmp, "wikiwright-maintain"), `${JSON.stringify(stamp, null, 2)}\n`);

      const check = run(tmp, ["check"]);
      const stale = findings(check);
      assert.deepEqual(
        stale.map((f) => [f.ruleId, f.severity, f.path]),
        [["skills-stale", "info", ".claude/skills/wikiwright-maintain"]],
      );
      assert.deepEqual(stale[0]?.details, {
        files_behind: 0,
        files_modified: 0,
        engine_moved: true,
      });
      const message = stale[0]?.message ?? "";
      assert.equal(
        /files are current|has moved on/.test(message),
        true,
        `the message says the files are current, not that the skill drifted: "${message}"`,
      );

      const update = run(tmp, ["skills", "update"]);
      assert.equal(update.status, 0, JSON.stringify(update.envelope));
      assert.equal(readStamp(tmp, "wikiwright-maintain").commit, running);
      assert.deepEqual(findings(run(tmp, ["check"])), [], "update clears the finding");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a stamp naming another build BESIDE a byte difference is still a warning", () => {
    const tmp = vault();
    try {
      const stamp = readStamp(tmp, "wikiwright-maintain");
      stamp.commit = "0000000";
      writeFileSync(stampPath(tmp, "wikiwright-maintain"), `${JSON.stringify(stamp, null, 2)}\n`);
      rmSync(join(tmp, ".claude", "skills", "wikiwright-maintain", "lint-response.md"));
      const stale = findings(run(tmp, ["check"]));
      assert.deepEqual(
        stale.map((f) => [f.ruleId, f.severity, f.path]),
        [["skills-stale", "warning", ".claude/skills/wikiwright-maintain"]],
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an installed file whose bytes left the shipped bytes is skills-stale", () => {
    const tmp = vault();
    try {
      const file = join(tmp, ".claude", "skills", "wikiwright-write", "SKILL.md");
      writeFileSync(file, `${readFileSync(file, "utf8")}\n<!-- a bundle's own note -->\n`);
      const drift = findings(run(tmp, ["check"]));
      assert.deepEqual(
        drift.map((f) => [f.ruleId, f.severity, f.path]),
        [["skills-stale", "warning", ".claude/skills/wikiwright-write"]],
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an install with no stamp is skills-missing (info) — the pre-stamp case", () => {
    const tmp = vault();
    try {
      for (const skill of SKILLS) rmSync(stampPath(tmp, skill));
      const check = run(tmp, ["check"]);
      assert.equal(check.status, 0, "info never fails the run");
      assert.deepEqual(
        findings(check).map((f) => [f.ruleId, f.severity, f.path]),
        [
          ["skills-missing", "info", ".claude/skills/wikiwright-maintain"],
          ["skills-missing", "info", ".claude/skills/wikiwright-write"],
        ],
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a vault with no installed skills is not nagged", () => {
    const tmp = vault();
    try {
      rmSync(join(tmp, ".claude"), { recursive: true, force: true });
      assert.deepEqual(findings(run(tmp, ["check"])), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the verb names the mistake it was actually given (docs/cli.md §skills)", () => {
  it('a bare `skills` is missing-argument, not `unknown subcommand ""`', () => {
    const tmp = vault();
    try {
      const bare = run(tmp, ["skills"]);
      assert.equal(bare.status, 2, JSON.stringify(bare.envelope));
      assert.equal(bare.envelope.error?.["code"], "missing-argument");
      assert.deepEqual(
        (bare.envelope.error?.["details"] as Record<string, unknown>)?.["valid_values"],
        ["status", "update"],
      );
      const unknown = run(tmp, ["skills", "restore"]);
      assert.equal(unknown.envelope.error?.["code"], "unknown-subcommand");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the skills root decides scope, not each directory (docs/cli.md §skills)", () => {
  it("a whole skill deleted is drift — the largest one there is, not silence", () => {
    // The regression: deleting ONE file was reported and fixed, deleting the
    // whole directory was reported clean, because scope was decided per skill.
    const tmp = vault();
    try {
      rmSync(join(tmp, ".claude", "skills", "wikiwright-write"), {
        recursive: true,
        force: true,
      });
      const gone = findings(run(tmp, ["check"]));
      assert.deepEqual(
        gone.map((f) => [f.ruleId, f.severity, f.path]),
        [["skills-stale", "warning", ".claude/skills/wikiwright-write"]],
      );
      assert.equal(
        gone[0]?.details?.["files_behind"],
        shippedFiles("wikiwright-write").length,
        "every file of the absent skill is behind",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("`skills update` restores a skill that is gone entirely, stamp included", () => {
    const tmp = vault();
    try {
      rmSync(join(tmp, ".claude", "skills", "wikiwright-write"), {
        recursive: true,
        force: true,
      });
      const update = run(tmp, ["skills", "update"]);
      assert.equal(update.status, 0, JSON.stringify(update.envelope));
      assert.deepEqual(
        dataOf(update)["updated"],
        shippedFiles("wikiwright-write").map((f) => `wikiwright-write/${f}`),
      );
      for (const rel of shippedFiles("wikiwright-write")) {
        assert.equal(
          readFileSync(join(tmp, ".claude", "skills", "wikiwright-write", rel), "utf8"),
          readFileSync(join(SHIPPED, "wikiwright-write", rel), "utf8"),
        );
      }
      assert.equal(existsSync(stampPath(tmp, "wikiwright-write")), true);
      assert.deepEqual(findings(run(tmp, ["check"])), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a skill this build newly ships reaches a vault an older build installed", () => {
    // Forward compatibility: the vault has a
    // skills root and its own skill, and no wikiwright skill has ever been
    // installed under it. `update` must install both, not refresh nothing.
    const tmp = vault();
    try {
      for (const skill of SKILLS) {
        rmSync(join(tmp, ".claude", "skills", skill), { recursive: true, force: true });
      }
      const mine = join(tmp, ".claude", "skills", "my-own-skill");
      mkdirSync(mine, { recursive: true });
      writeFileSync(join(mine, "SKILL.md"), "# the bundle's own skill\n");

      const before = findings(run(tmp, ["check"]));
      assert.deepEqual(
        before.map((f) => [f.ruleId, f.severity]),
        [
          ["skills-stale", "warning"],
          ["skills-stale", "warning"],
        ],
        "both shipped skills are in scope because the root exists",
      );

      const update = run(tmp, ["skills", "update"]);
      assert.equal(update.status, 0, JSON.stringify(update.envelope));
      for (const skill of SKILLS) {
        assert.equal(existsSync(stampPath(tmp, skill)), true, `${skill} was installed and stamped`);
      }
      assert.equal(
        readFileSync(join(mine, "SKILL.md"), "utf8"),
        "# the bundle's own skill\n",
        "a skill the engine does not ship is never touched",
      );
      assert.deepEqual(findings(run(tmp, ["check"])), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("with no skills root, neither verb nor finding says anything", () => {
    const tmp = vault();
    try {
      rmSync(join(tmp, ".claude"), { recursive: true, force: true });
      const update = run(tmp, ["skills", "update"]);
      assert.equal(update.status, 0, JSON.stringify(update.envelope));
      assert.deepEqual(dataOf(update)["updated"], []);
      assert.deepEqual(dataOf(update)["stamped"], []);
      assert.equal(
        existsSync(join(tmp, ".claude")),
        false,
        "update never creates a skills root the vault did not have",
      );
      assert.deepEqual(findings(run(tmp, ["check"])), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("skills update touches only what the engine installed (docs/cli.md §skills)", () => {
  it("is idempotent: the second run writes nothing and reports nothing updated", () => {
    const tmp = vault();
    try {
      const first = run(tmp, ["skills", "update"]);
      assert.equal(first.status, 0, JSON.stringify(first.envelope));
      assert.deepEqual(dataOf(first)["updated"], []);
      const before = readFileSync(stampPath(tmp, "wikiwright-maintain"));
      const second = run(tmp, ["skills", "update"]);
      assert.deepEqual(dataOf(second)["updated"], []);
      assert.equal(
        before.equals(readFileSync(stampPath(tmp, "wikiwright-maintain"))),
        true,
        "the stamp is byte-stable across runs",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("restores a file the engine installed and that was deleted", () => {
    const tmp = vault();
    try {
      const rel = "SKILL.md";
      const file = join(tmp, ".claude", "skills", "wikiwright-write", rel);
      rmSync(file);
      const update = run(tmp, ["skills", "update"]);
      assert.equal(update.status, 0, JSON.stringify(update.envelope));
      assert.deepEqual(dataOf(update)["updated"], [`wikiwright-write/${rel}`]);
      assert.equal(
        readFileSync(file, "utf8"),
        readFileSync(join(SHIPPED, "wikiwright-write", rel), "utf8"),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses a file the bundle edited, names it, and writes nothing without --force", () => {
    const tmp = vault();
    try {
      const rel = "lint-response.md";
      const file = join(tmp, ".claude", "skills", "wikiwright-maintain", rel);
      const edited = `${readFileSync(file, "utf8")}\n<!-- bundle-local guidance -->\n`;
      writeFileSync(file, edited);
      // A second skill is behind for an unrelated reason: the refusal is atomic
      // across skills, so nothing is half-applied.
      rmSync(join(tmp, ".claude", "skills", "wikiwright-write", "SKILL.md"));

      const refused = run(tmp, ["skills", "update"]);
      assert.equal(refused.status, 4, JSON.stringify(refused.envelope));
      assert.equal(refused.envelope.error?.["code"], "skill-modified");
      const blocked = (refused.envelope.error?.["details"] as { blocked?: Array<{ path: string }> })
        ?.blocked;
      assert.deepEqual(
        blocked?.map((b) => b.path),
        [`wikiwright-maintain/${rel}`],
      );
      assert.equal(readFileSync(file, "utf8"), edited, "the edited file is untouched");
      assert.equal(
        existsSync(join(tmp, ".claude", "skills", "wikiwright-write", "SKILL.md")),
        false,
        "nothing was written for the other skill either — the refusal is atomic",
      );

      const forced = run(tmp, ["skills", "update", "--force"]);
      assert.equal(forced.status, 0, JSON.stringify(forced.envelope));
      assert.equal(
        readFileSync(file, "utf8"),
        readFileSync(join(SHIPPED, "wikiwright-maintain", rel), "utf8"),
        "--force restores the shipped bytes",
      );
      assert.deepEqual(findings(run(tmp, ["check"])), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("never writes a file the stamp does not list", () => {
    const tmp = vault();
    try {
      const extra = join(tmp, ".claude", "skills", "wikiwright-maintain", "bundle-notes.md");
      writeFileSync(extra, "# the bundle's own page\n");
      const update = run(tmp, ["skills", "update"]);
      assert.equal(update.status, 0, JSON.stringify(update.envelope));
      assert.equal(readFileSync(extra, "utf8"), "# the bundle's own page\n");
      assert.equal(
        readStamp(tmp, "wikiwright-maintain").files.some((f) => f.path === "bundle-notes.md"),
        false,
        "a file the engine did not install never enters the stamp",
      );
      assert.deepEqual(findings(run(tmp, ["check"])), [], "and it is not drift");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an unstamped install whose bytes differ needs --force: the engine cannot prove it wrote them", () => {
    const tmp = vault();
    try {
      const file = join(tmp, ".claude", "skills", "wikiwright-write", "SKILL.md");
      writeFileSync(file, "# a pre-stamp install, edited by someone\n");
      for (const skill of SKILLS) rmSync(stampPath(tmp, skill));

      const refused = run(tmp, ["skills", "update"]);
      assert.equal(refused.status, 4, JSON.stringify(refused.envelope));
      const blocked = (
        refused.envelope.error?.["details"] as {
          blocked?: Array<{ path: string; reason: string }>;
        }
      )?.blocked;
      assert.deepEqual(blocked, [{ path: "wikiwright-write/SKILL.md", reason: "unstamped" }]);

      const forced = run(tmp, ["skills", "update", "--force"]);
      assert.equal(forced.status, 0, JSON.stringify(forced.envelope));
      assert.deepEqual(findings(run(tmp, ["check"])), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
