// docs/concepts.md §Generated artifacts (
// filter flags, no DSL) · docs/cli.md §move (reason vocabulary, git mv, findings not
// edits) · docs/cli.md (retire: status +
// banner + successor; refuses a frontmatter-less page; keeps CRLF) (CJK
// exact lookup) · deterministic output.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

function run(cwd: string, args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function vault(pruneBroken = true): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-verbs-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  if (pruneBroken) rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  writeFileSync(
    join(tmp, "wiki/张伟.md"),
    '---\ntype: concept\ntitle: 张伟\ndescription: A colleague who owns the reset rigs.\naliases: ["Zhang Wei"]\ntags: []\n---\n\n# 张伟\n\n## 职责\n\nOwns [[warm-reset]].\n',
  );
  return tmp;
}

function errorOf(envelope: Record<string, unknown>): Record<string, unknown> {
  return (envelope["error"] ?? {}) as Record<string, unknown>;
}

function gitInit(tmp: string): void {
  execFileSync("git", ["init", "-q"], { cwd: tmp });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: tmp });
  execFileSync("git", ["config", "user.name", "T"], { cwd: tmp });
  execFileSync("git", ["add", "-A"], { cwd: tmp });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: tmp });
}

describe("search — deterministic tiers with coverage", () => {
  it("resolves an exact CJK name at the top with a match reason", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["search", "张伟"]);
      assert.equal(r.status, 0);
      const data = r.envelope["data"] as {
        results: Array<{ path: string; match_reasons: string[] }>;
        coverage: { corpus_size: number; tiers_executed: string[]; tokenization: string };
      };
      assert.equal(data.results[0]?.path, "wiki/张伟.md");
      assert.equal(data.results[0]?.match_reasons.includes("name:exact"), true);
      assert.equal(data.coverage.corpus_size > 0, true);
      // The search redesign renamed the whole-query substring tier to body:phrase and demoted
      // it inside the ladder (docs/concepts.md §Generated artifacts).
      assert.equal(data.coverage.tiers_executed.includes("body:phrase"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("supports filter flags without a query (flags, no DSL)", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["search", "--tag", "reset"]);
      assert.equal(r.status, 0);
      const data = r.envelope["data"] as { results: Array<{ path: string }> };
      assert.equal(
        data.results.some((x) => x.path.endsWith("warm-reset.md")),
        true,
      );
      assert.equal(
        data.results.some((x) => x.path.endsWith("张伟.md")),
        false,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects a bare search with neither query nor filters as usage", () => {
    const tmp = vault();
    try {
      assert.equal(run(tmp, ["search"]).status, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("demotes retired pages below active matches (docs/concepts.md §Generated artifacts)", () => {
    const tmp = vault();
    try {
      writeFileSync(
        join(tmp, "wiki/reset-plan-old.md"),
        "---\ntype: concept\ntitle: Reset plan old\ndescription: Old reset planning notes.\ntags: [reset]\nstatus: retired\n---\n\n# Reset plan old\n\nreset content.\n",
      );
      const r = run(tmp, ["search", "reset"]);
      const data = r.envelope["data"] as { results: Array<{ path: string }> };
      const paths = data.results.map((x) => x.path);
      assert.equal(paths.includes("wiki/reset-plan-old.md"), true);
      assert.equal(
        paths.indexOf("wiki/test-execution/warm-reset.md") <
          paths.indexOf("wiki/reset-plan-old.md"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("move — reasoned, git-backed, findings not edits (docs/cli.md §move)", () => {
  it("moves with a valid reason and surfaces the former-folder-tag review", () => {
    const tmp = vault();
    gitInit(tmp);
    try {
      const r = run(tmp, [
        "move",
        "wiki/test-execution/warm-reset.md",
        "wiki/warm-reset.md",
        "--reason",
        "browse-misleading",
      ]);
      assert.equal(r.status, 0);
      assert.equal(existsSync(join(tmp, "wiki/warm-reset.md")), true);
      assert.equal(existsSync(join(tmp, "wiki/test-execution/warm-reset.md")), false);
      const data = r.envelope["data"] as { findings: Array<{ ruleId: string }> };
      assert.equal(
        data.findings.some((f) => f.ruleId === "former-folder-tags-review"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("requires a reason; any non-empty one where the bundle declares no set", () => {
    const tmp = vault();
    gitInit(tmp);
    try {
      const missing = run(tmp, ["move", "wiki/test-execution/warm-reset.md", "wiki/warm-reset.md"]);
      assert.equal(missing.status, 2);
      assert.equal(errorOf(missing.envelope)["code"], "missing-argument");
      const any = run(tmp, [
        "move",
        "wiki/test-execution/warm-reset.md",
        "wiki/warm-reset.md",
        "--reason",
        "felt-like-it",
      ]);
      assert.equal(any.status, 0, JSON.stringify(any.envelope));
      // The envelope says the vocabulary is open here, so the flag's
      // freedom reads as a fact about the bundle rather than a missing check.
      assert.equal((any.envelope["data"] as { reasons: unknown }).reasons, "undeclared");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // e2e:move_reasons — the bundle closes the set in engine.json, and the verb
  // refuses a reason outside it with the set enumerated.
  it("a bundle that declares move_reasons closes the set", () => {
    const tmp = vault();
    writeFileSync(
      join(tmp, "config", "engine.json"),
      JSON.stringify({
        content_roots: ["wiki"],
        folder_tags: { mode: "validate" },
        move_reasons: ["activity-boundary", "browse-misleading"],
      }),
    );
    gitInit(tmp);
    try {
      const bad = run(tmp, [
        "move",
        "wiki/test-execution/warm-reset.md",
        "wiki/warm-reset.md",
        "--reason",
        "felt-like-it",
      ]);
      assert.equal(bad.status, 2, JSON.stringify(bad.envelope));
      assert.equal(errorOf(bad.envelope)["code"], "invalid-reason");
      const details = errorOf(bad.envelope)["details"] as { valid_values?: string[] };
      assert.deepEqual(details.valid_values, ["activity-boundary", "browse-misleading"]);
      const good = run(tmp, [
        "move",
        "wiki/test-execution/warm-reset.md",
        "wiki/warm-reset.md",
        "--reason",
        "activity-boundary",
      ]);
      assert.equal(good.status, 0, JSON.stringify(good.envelope));
      assert.deepEqual((good.envelope["data"] as { reasons: unknown }).reasons, [
        "activity-boundary",
        "browse-misleading",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects basename changes — a move is not a rename", () => {
    const tmp = vault();
    gitInit(tmp);
    try {
      const r = run(tmp, [
        "move",
        "wiki/test-execution/warm-reset.md",
        "wiki/cold-reset.md",
        "--reason",
        "activity-boundary",
      ]);
      assert.equal(r.status, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("retire — status + banner + successor (docs/cli.md)", () => {
  it("sets status, inserts the banner, and records the successor", () => {
    const tmp = vault(false);
    try {
      const r = run(tmp, [
        "retire",
        "wiki/test-execution/warm-reset.md",
        "--superseded-by",
        "broken-case",
      ]);
      assert.equal(r.status, 0);
      const content = readFileSync(join(tmp, "wiki/test-execution/warm-reset.md"), "utf8");
      assert.equal(content.includes("status: retired"), true);
      assert.equal(content.includes("superseded_by: broken-case"), true);
      assert.equal(content.includes("> Retired. Superseded by [[broken-case]]."), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses to retire twice", () => {
    const tmp = vault();
    try {
      assert.equal(run(tmp, ["retire", "wiki/test-execution/warm-reset.md"]).status, 0);
      assert.equal(run(tmp, ["retire", "wiki/test-execution/warm-reset.md"]).status, 4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails an unknown successor as not_found", () => {
    const tmp = vault();
    try {
      const r = run(tmp, [
        "retire",
        "wiki/test-execution/warm-reset.md",
        "--superseded-by",
        "no-such-page",
      ]);
      assert.equal(r.status, 3);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses frontmatter-less pages instead of corrupting them", () => {
    const tmp = vault();
    try {
      writeFileSync(join(tmp, "wiki/bare.md"), "# Bare page\n\nBody.\n");
      const before = readFileSync(join(tmp, "wiki/bare.md"), "utf8");
      const r = run(tmp, ["retire", "wiki/bare.md"]);
      assert.equal(r.status, 4);
      assert.equal(readFileSync(join(tmp, "wiki/bare.md"), "utf8"), before);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves CRLF line endings on the rewritten file", () => {
    const tmp = vault();
    try {
      const lf = readFileSync(join(tmp, "wiki/test-execution/warm-reset.md"), "utf8");
      writeFileSync(join(tmp, "wiki/test-execution/warm-reset.md"), lf.replaceAll("\n", "\r\n"));
      const r = run(tmp, ["retire", "wiki/test-execution/warm-reset.md"]);
      assert.equal(r.status, 0);
      const after = readFileSync(join(tmp, "wiki/test-execution/warm-reset.md"), "utf8");
      assert.equal(after.includes("\r\n"), true, "CRLF style preserved");
      assert.equal(after.includes("status: retired"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the per-verb split (docs/architecture.md §Directories)", () => {
  const SRC = fileURLToPath(new URL("../src/", import.meta.url));

  it("every registered verb has its own module under src/verbs/", async () => {
    const { COMMANDS } = (await import("../src/commands.ts")) as {
      COMMANDS: Array<{ name: string }>;
    };
    assert.equal(COMMANDS.length > 0, true, "the registry is not empty");
    for (const command of COMMANDS) {
      const module = join(SRC, "verbs", `${command.name}.ts`);
      assert.equal(
        existsSync(module),
        true,
        `no verbs/${command.name}.ts for verb "${command.name}"`,
      );
      // Windows: node's ESM loader refuses a bare absolute path ("protocol
      // 'd:'"), so a dynamic import of a computed path goes through a file URL.
      const exports = (await import(pathToFileURL(module).href)) as Record<string, unknown>;
      const specs = Object.values(exports).filter(
        (v): v is { name: string } =>
          typeof v === "object" && v !== null && "name" in v && "run" in v,
      );
      assert.equal(
        specs.some((s) => s.name === command.name),
        true,
        `verbs/${command.name}.ts exports no CommandSpec named "${command.name}"`,
      );
    }
  });

  it("commands.ts is the registry: no CommandSpec literal, no run()", () => {
    const text = readFileSync(join(SRC, "commands.ts"), "utf8");
    assert.equal(
      /:\s*CommandSpec\s*=\s*\{/.test(text),
      false,
      "commands.ts still declares a CommandSpec literal — the split is not complete",
    );
    assert.equal(
      /^\s*run:/m.test(text),
      false,
      "commands.ts still carries a verb's run() — the split is not complete",
    );
    assert.equal(/^export const COMMANDS/m.test(text), true, "commands.ts exports the registry");
  });

  it("the shared helpers live in named modules, not between two verbs", () => {
    for (const module of [
      "spec.ts",
      "law.ts",
      "pages.ts",
      "artifacts.ts",
      "hooks.ts",
      "staged.ts",
    ]) {
      assert.equal(existsSync(join(SRC, module)), true, `src/${module} is missing`);
    }
  });
});
