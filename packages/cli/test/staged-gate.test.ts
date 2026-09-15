// docs/cli.md §lint (--staged is the pre-commit gate; it judges the COMPLETE staged
// state — a virtual post-index vault: staged bytes for staged files, committed
// bytes elsewhere, the constitution included — so a write bypassing the CLI
// cannot land an unknown tag or type) · docs/concepts.md (the gate is for agents)
//  (body-append-only compares the staged text to the base
// revision) · identity vault-wide at the gate (the rule
// meets the writer at write time) · claim transitions at the gate.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function run(cwd: string, args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function findingsOf(envelope: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = envelope["data"] as Record<string, unknown> | undefined;
  return (data?.["findings"] as Array<Record<string, unknown>> | undefined) ?? [];
}

function commitAll(tmp: string, message: string): void {
  git(tmp, "init", "-q", "-b", "main");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", message);
}

/** minimal-vault, committed, with the deliberately broken page pruned. */
function gitVault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-staged-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  commitAll(tmp, "initial");
  return tmp;
}

/** A one-type, one-page repository built by hand, committed. */
function repo(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-stg-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki"));
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(documentOf({ types: { note: { extends: "concept", description: "A note." } } })),
  );
  writeFileSync(join(tmp, "config", "engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
  writeFileSync(
    join(tmp, "wiki", "alpha.md"),
    "---\ntype: note\ntitle: Alpha\ndescription: a.\ntags: []\n---\n\n# alpha\n",
  );
  commitAll(tmp, "base");
  return tmp;
}

const PAGE = "wiki/test-execution/warm-reset.md";

describe("lint --staged — the pre-commit gate (docs/cli.md §lint)", () => {
  it("passes a clean staged append and ignores unstaged state", () => {
    const tmp = gitVault();
    try {
      const current = readFileSync(join(tmp, PAGE), "utf8");
      writeFileSync(join(tmp, PAGE), `${current}\n2026-08-31: run 1 green.\n`);
      git(tmp, "add", PAGE);
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 0);
      const data = r.envelope["data"] as { summary: { pages: number } };
      assert.equal(data.summary.pages, 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("blocks an edit to an append-only page, with fragment provenance", () => {
    const tmp = gitVault();
    try {
      const current = readFileSync(join(tmp, PAGE), "utf8");
      writeFileSync(join(tmp, PAGE), `${current}\n2026-08-30: run 0 red.\n`);
      git(tmp, "add", PAGE);
      git(tmp, "commit", "-q", "-m", "log run 0");
      const edited = readFileSync(join(tmp, PAGE), "utf8").replace("run 0 red", "run 0 green");
      writeFileSync(join(tmp, PAGE), edited);
      git(tmp, "add", PAGE);
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 5);
      const data = r.envelope["data"] as {
        findings: Array<{ ruleId: string; contributedBy?: string }>;
      };
      // The mutation reports through `body-append-only`, and the provenance is
      // the type that pastes the lifecycle contract.
      const f = data.findings.find((x) => x.ruleId === "body-append-only");
      assert.notEqual(f, undefined, JSON.stringify(data.findings.map((x) => x.ruleId)));
      assert.equal(f?.contributedBy, "test-case");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("each of several staged pages is judged against its own HEAD bytes", () => {
    const tmp = gitVault();
    try {
      const hot = "wiki/test-execution/热重启.md";
      for (const p of [PAGE, hot]) {
        writeFileSync(
          join(tmp, p),
          `${readFileSync(join(tmp, p), "utf8")}\n2026-08-30: run 0 red.\n`,
        );
      }
      git(tmp, "add", "-A");
      git(tmp, "commit", "-q", "-m", "log run 0");
      // One page rewrites a committed line and the other only appends: a base
      // read for the wrong page would move the finding or lose it.
      const warm = readFileSync(join(tmp, PAGE), "utf8").replace("run 0 red", "run 0 green");
      writeFileSync(join(tmp, PAGE), warm);
      writeFileSync(join(tmp, hot), `${readFileSync(join(tmp, hot), "utf8")}2026-08-31: run 1.\n`);
      git(tmp, "add", "-A");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      const data = r.envelope["data"] as { findings: Array<{ ruleId: string; path: string }> };
      const appendOnly = data.findings.filter((f) => f.ruleId === "body-append-only");
      assert.deepEqual(
        appendOnly.map((f) => f.path),
        [PAGE],
        JSON.stringify(data.findings),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("blocks a staged page with an unknown type even when committed files are clean", () => {
    const tmp = gitVault();
    try {
      writeFileSync(
        join(tmp, "wiki/rogue.md"),
        "---\ntype: no-such-type\ntitle: Rogue\ndescription: x.\ntags: []\n---\n\n# Rogue\n",
      );
      git(tmp, "add", "wiki/rogue.md");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("lints the staged content, not the working tree", () => {
    const tmp = gitVault();
    try {
      const current = readFileSync(join(tmp, PAGE), "utf8");
      writeFileSync(join(tmp, PAGE), `${current}\n2026-08-31: staged append.\n`);
      git(tmp, "add", PAGE);
      // Working tree then diverges with a violation that is NOT staged.
      writeFileSync(join(tmp, PAGE), current.replace("## Execution", "## Renamed"));
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports nothing to lint when no markdown is staged", () => {
    const tmp = gitVault();
    try {
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 0);
      const data = r.envelope["data"] as { summary: { pages: number } };
      assert.equal(data.summary.pages, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the staged gate judges the complete virtual vault (docs/cli.md §lint)", () => {
  it("a staged source-root move preserving the basename needs no self-alias", {
    timeout: 15_000,
  }, () => {
    const tmp = repo();
    try {
      mkdirSync(join(tmp, "sources"));
      git(tmp, "mv", "wiki/alpha.md", "sources/alpha.md");
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({ content_roots: ["sources", "raw"] }),
      );
      git(tmp, "add", "-A");
      git(tmp, "commit", "-qm", "place source");

      mkdirSync(join(tmp, "raw", "source"), { recursive: true });
      git(tmp, "mv", "sources/alpha.md", "raw/source/alpha.md");
      const staged = git(tmp, "diff", "--cached", "--name-status", "-M");
      assert.match(staged, /^R\d+\tsources\/alpha\.md\traw\/source\/alpha\.md$/u);

      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "renamed-without-alias"),
        false,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a staged title duplicating an UNCHANGED page fails at the gate", () => {
    const tmp = repo();
    try {
      writeFileSync(
        join(tmp, "wiki", "beta.md"),
        "---\ntype: note\ntitle: Alpha\ndescription: b.\ntags: []\n---\n\n# beta\n",
      );
      git(tmp, "add", "wiki/beta.md");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 5);
      assert.equal(
        findingsOf(r.envelope).some(
          (f) => f["ruleId"] === "identity-collision" && String(f["message"]).includes("Alpha"),
        ),
        true,
        "duplicate title caught before commit",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a staged alias colliding with an UNCHANGED basename fails at the gate", () => {
    const tmp = repo();
    try {
      writeFileSync(
        join(tmp, "wiki", "beta.md"),
        '---\ntype: note\ntitle: Beta\ndescription: b.\ntags: []\naliases: ["alpha"]\n---\n\n# beta\n',
      );
      git(tmp, "add", "wiki/beta.md");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 5);
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "identity-collision"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a staged constitution change revalidates UNCHANGED pages", () => {
    const tmp = repo();
    try {
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify(
          documentOf({
            types: {
              note: {
                extends: "concept",
                description: "A note.",
                sections: { list: [{ heading: "Log", min: 1 }] },
              },
            },
          }),
        ),
      );
      git(tmp, "add", "config/constitution.json");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 5);
      assert.equal(
        findingsOf(r.envelope).some(
          (f) => f["ruleId"] === "sections" && f["path"] === "wiki/alpha.md",
        ),
        true,
        "the committed page fails the newly staged rule",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the gate uses STAGED constitution bytes, not the working tree", () => {
    const tmp = repo();
    try {
      // The working-tree constitution is garbage, but it is NOT staged.
      writeFileSync(join(tmp, "config", "constitution.json"), "not json at all");
      // Stage a perfectly valid page edit.
      writeFileSync(
        join(tmp, "wiki", "alpha.md"),
        "---\ntype: note\ntitle: Alpha\ndescription: a2.\ntags: []\n---\n\n# alpha\n\nMore.\n",
      );
      git(tmp, "add", "wiki/alpha.md");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("pre-existing findings on untouched pages do not block an unrelated staged edit", () => {
    const tmp = repo();
    try {
      // Commit a page that violates nothing today, then stage a rule-free edit
      // to a DIFFERENT page while another committed page carries a defect that
      // predates this commit (an unknown tag).
      writeFileSync(
        join(tmp, "wiki", "old-debt.md"),
        "---\ntype: note\ntitle: Old debt\ndescription: d.\ntags: [never-registered]\n---\n\n# old-debt\n",
      );
      git(tmp, "add", "-A");
      git(tmp, "commit", "-qm", "debt lands (hook-less)");
      writeFileSync(
        join(tmp, "wiki", "alpha.md"),
        "---\ntype: note\ntitle: Alpha\ndescription: a3.\ntags: []\n---\n\n# alpha\n\nEdit.\n",
      );
      git(tmp, "add", "wiki/alpha.md");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 0, "old debt on untouched pages is check's job, not the gate's");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the gate judges generated-drift over the staged state (docs/cli.md §gate)", () => {
  /** minimal-vault with its artifacts tracked: `check --write`, then commit. */
  function trackedVault(): string {
    const tmp = gitVault();
    assert.equal(run(tmp, ["check", "--write"]).status, 0);
    git(tmp, "add", "-A");
    git(tmp, "commit", "-q", "-m", "track generated/");
    return tmp;
  }
  function newCase(tmp: string, name: string, id: string): string {
    const rel = `wiki/test-execution/${name}.md`;
    const seed = readFileSync(join(tmp, PAGE), "utf8")
      .replace("title: Warm reset under load", `title: ${name}`)
      .replace(/case_id: .*/u, `case_id: ${id}`)
      .replace("# Warm reset under load", `# ${name}`);
    writeFileSync(join(tmp, rel), seed);
    return rel;
  }

  it("a partial staging whose staged generated/ describes the staged pages passes, whatever the tree holds", () => {
    const tmp = trackedVault();
    try {
      const one = newCase(tmp, "op-one", "TC-0101");
      assert.equal(run(tmp, ["check", "--write"]).status, 0);
      git(tmp, "add", one, "generated");
      // The second op lands in the working tree AFTER the first was staged, so
      // the tree's generated/ no longer describes the tree — `check` would say
      // drift — while the index is consistent with itself.
      newCase(tmp, "op-two", "TC-0102");
      const r = run(tmp, ["gate"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const coverage = (
        r.envelope["data"] as {
          coverage: { passes: Record<string, { evaluated: number; reason?: string }> };
        }
      ).coverage.passes;
      assert.equal(coverage["generated-drift"]?.reason, undefined, "the pass ran");
      assert.equal((coverage["generated-drift"]?.evaluated ?? 0) > 0, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a staging that forgot to regenerate fails with the artifact named", () => {
    const tmp = trackedVault();
    try {
      git(tmp, "add", newCase(tmp, "op-one", "TC-0101"));
      const r = run(tmp, ["gate"]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      const drift = findingsOf(r.envelope).filter((f) => f["ruleId"] === "generated-drift");
      assert.deepEqual(drift.map((f) => f["path"]).sort(), [
        "generated/graph.json",
        "generated/manifest.json",
      ]);
      assert.deepEqual(drift[0]?.["fix"], {
        argv: ["check", "--write"],
        applicability: "MachineApplicable",
      });
      // And the same envelope from the agent's preview of the gate.
      assert.equal(run(tmp, ["lint", "--staged"]).status, 5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a bundle that tracks no artifact is not judged on them at the gate", () => {
    const tmp = gitVault();
    try {
      git(tmp, "add", newCase(tmp, "op-one", "TC-0101"));
      const r = run(tmp, ["gate"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const coverage = (
        r.envelope["data"] as { coverage: { passes: Record<string, { reason?: string }> } }
      ).coverage.passes;
      assert.equal(coverage["generated-drift"]?.reason, "capability-unavailable");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the staged gate gates the index, not the worktree (docs/cli.md §lint)", () => {
  it("flags a staged wikilink whose target exists only unstaged", () => {
    const tmp = gitVault();
    try {
      const page = join(tmp, PAGE);
      writeFileSync(
        page,
        readFileSync(page, "utf8").replace(
          "# Warm reset under load",
          "# Warm reset under load\n\nSee [[unstaged-page]].",
        ),
      );
      git(tmp, "add", PAGE);
      writeFileSync(
        join(tmp, "wiki/unstaged-page.md"),
        "---\ntype: test-case\ntitle: Unstaged\ndescription: x.\ncase_id: TC-9\ntags: []\n---\n\n# Unstaged\n\n## Purpose\n\n## Execution\n",
      );
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "wikilink-unresolved"),
        true,
        "unstaged files must not satisfy staged link resolution",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("catches a staged basename collision (at the gate)", () => {
    const tmp = gitVault();
    try {
      mkdirSync(join(tmp, "raw"), { recursive: true });
      writeFileSync(
        join(tmp, "raw/warm-reset.md"),
        "---\ntype: concept\ntitle: Colliding capture\ndescription: x.\ntags: []\n---\n\n# Colliding capture\n",
      );
      git(tmp, "add", "raw/warm-reset.md");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 5);
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "identity-collision"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports unmerged paths as a typed conflict, not an internal crash", () => {
    const tmp = gitVault();
    try {
      git(tmp, "checkout", "-qb", "side");
      writeFileSync(
        join(tmp, PAGE),
        readFileSync(join(tmp, PAGE), "utf8").replace("saturated", "side-edit"),
      );
      git(tmp, "commit", "-qam", "side");
      git(tmp, "checkout", "-q", "main");
      writeFileSync(
        join(tmp, PAGE),
        readFileSync(join(tmp, PAGE), "utf8").replace("saturated", "main-edit"),
      );
      git(tmp, "commit", "-qam", "main");
      const merge = spawnSync("git", ["merge", "side"], { cwd: tmp, encoding: "utf8" });
      assert.notEqual(merge.status, 0, "merge must conflict for this test");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 4);
      assert.equal(((r.envelope["error"] ?? {}) as Record<string, unknown>)["type"], "conflict");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("claim transitions are judged on the staged diff at the gate", () => {
  it("an accumulate bullet edited in the staged version blocks the commit", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-clm-"));
    try {
      mkdirSync(join(tmp, "config"));
      mkdirSync(join(tmp, "wiki"));
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify(
          documentOf({
            vocabularies: {
              categories: {
                mode: "registered",
                entries: { preference: { class: "accumulate" }, address: { class: "supersede" } },
              },
            },
            types: {
              person: {
                extends: "concept",
                description: "A person page.",
                sections: {
                  depth: 2,
                  list: [
                    {
                      heading: "Facts",
                      grammar: "claims",
                      history: "History",
                      vocabulary: "categories",
                    },
                    {
                      heading: "History",
                      grammar: "claims",
                      role: "history",
                      vocabulary: "categories",
                    },
                  ],
                },
              },
            },
          }),
        ),
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({ content_roots: ["wiki"] }),
      );
      writeFileSync(
        join(tmp, "wiki", "zhang.md"),
        "---\ntype: person\ntitle: 张伟\ndescription: d.\ntags: []\n---\n\n# 张伟\n\n## Facts\n- [preference] 喜欢吃辣 (stated 2026-08-14)\n",
      );
      commitAll(tmp, "base");
      writeFileSync(
        join(tmp, "wiki", "zhang.md"),
        "---\ntype: person\ntitle: 张伟\ndescription: d.\ntags: []\n---\n\n# 张伟\n\n## Facts\n- [preference] 不吃辣 (stated 2026-09-01)\n",
      );
      git(tmp, "add", "wiki/zhang.md");
      const r = run(tmp, ["lint", "--staged"]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "claims-transition"),
        true,
        "the dispositional observation must accumulate, not be overwritten",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
