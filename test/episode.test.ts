// v2 contracts §12 step 7: a synthetic gardening episode through the built
// CLI and a real git pre-commit hook. Every file the test writes is temporary.
import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI, cli, gardenBundle } from "../packages/cli/test/fixtures/garden-cli.ts";
import { BASIL } from "../packages/cli/test/fixtures/garden-judge.ts";
import { writeAt } from "../packages/cli/test/fixtures/note-bundle.ts";
import { BUN } from "../packages/cli/test/fixtures/runtime.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const RULE = "observation-evidence";
const EXPR = 'section.items.all(i, !i.core.contains("degrees") || i.provenance.kind != "none")';
const SOURCE_TYPE = `type: source
role: reference
description: A capture of the garden's observation log.
fields:
  type: object
  properties:
    capture: { $ref: "#/$defs/pin" }
  required: [capture]
`;
const TIME = "2026-09-26T08:00:00+0000";
const GIT_ENV = {
  GIT_AUTHOR_NAME: "Garden Test",
  GIT_AUTHOR_EMAIL: "garden@example.test",
  GIT_COMMITTER_NAME: "Garden Test",
  GIT_COMMITTER_EMAIL: "garden@example.test",
  GIT_AUTHOR_DATE: TIME,
  GIT_COMMITTER_DATE: TIME,
};

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...GIT_ENV },
  }).trim();
}

function commit(dir: string, message: string, ...paths: string[]): string {
  git(dir, "add", "--", ...paths);
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

function sourcePage(commitId: string): string {
  return `---
type: source
title: Observation log
capture:
  commit: ${commitId}
  origin: "."
  covers: [notes/observations.txt]
---

# Observation log

The dated observation log for the planting notes.
`;
}

function observationPage(title: string, grounded: boolean): string {
  return `---
type: planting
title: ${title}
bed: herb
sown: 2026-04-12
---

# ${title}

## Observations

- [observed] ${title} bolts above thirty degrees.${grounded ? " ([[Observation log]])" : ""}
`;
}

function ruleTests(): Record<string, string> {
  const root = `rule-tests/${RULE}`;
  return {
    [`${root}/expect.json`]: `${JSON.stringify({ rule: RULE, location: { section: "Observations", occurrence: 0 } })}\n`,
    [`${root}/negative.md`]: observationPage("Cress", false),
    [`${root}/repaired.md`]: observationPage("Cress", true),
    [`${root}/positive/ordinary.md`]: observationPage("Parsley", false).replace(
      "bolts above thirty degrees",
      "grew two leaves",
    ),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function installGateHook(dir: string): void {
  const published = readFileSync(join(REPO, ".pre-commit-hooks.yaml"), "utf8");
  expect(published).toContain("entry: wikiwright gate");
  expect(published).toContain("stages: [pre-commit]");
  const hook = join(dir, ".git/hooks/pre-commit");
  writeFileSync(
    hook,
    `#!/bin/sh\nexec ${shellQuote(BUN)} ${shellQuote(CLI)} gate --root . > .git/episode-gate.json\n`,
  );
  chmodSync(hook, 0o755);
}

function status(dir: string, verb: "read" | "search") {
  const r = cli(verb === "read" ? ["read", "Basil"] : ["search", "basil"], dir);
  expect(r.status).toBe(0);
  if (verb === "read")
    return r.envelope.data?.["status"] as { stale: boolean; reason: string | null };
  const results = r.envelope.data?.["results"] as
    | { path: string; status: { stale: boolean; reason: string | null } }[]
    | undefined;
  return results?.find((result) => result.path === "wiki/Basil.md")?.status;
}

function episode(): Record<string, unknown> {
  const defect = BASIL.replace(" ([[Herb bed]])", "");
  const dir = gardenBundle({
    "constitution/types/source.yaml": SOURCE_TYPE,
    "notes/observations.txt": "Basil bolted on a hot day.\n",
    "wiki/Basil.md": defect,
  });
  const drafts = mkdtempSync(join(tmpdir(), "ww-episode-drafts-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "Garden Test");
    git(dir, "config", "user.email", "garden@example.test");
    git(dir, "config", "core.hooksPath", ".git/hooks");
    const first = commit(dir, "test: the garden", ".");
    writeAt(dir, "wiki/Observation log.md", sourcePage(first));
    commit(dir, "test: capture the observation log", "wiki/Observation log.md");

    // The ungrounded observation conforms today. A candidate rule identifies
    // the gap before the maintainer changes either the page or the law.
    expect(cli(["check", "--write"], dir).status).toBe(0);
    const initial = cli(["check", "--all"], dir);
    expect(initial.status).toBe(0);
    expect(initial.envelope.data?.summary?.errors).toBe(0);
    const candidate = [
      "rule",
      "try",
      "--type",
      "planting",
      "--section",
      "Observations",
      "--expr",
      EXPR,
    ];
    const tried = (r: ReturnType<typeof cli>) =>
      r.envelope.data?.["working"] as {
        would_refuse: { path: string; location: { kind: string; heading: string } }[];
        would_pass: string[];
      };
    const before = cli(candidate, dir);
    expect(before.status).toBe(0);
    expect(tried(before).would_refuse).toMatchObject([
      { path: "wiki/Basil.md", location: { kind: "section", heading: "Observations" } },
    ]);

    // The maintainer repairs the page through the governed writer.
    const repaired = defect.replace(
      "Basil bolts above thirty degrees.",
      "Basil bolts above thirty degrees. ([[Observation log]])",
    );
    writeAt(drafts, "wiki/Basil.md", repaired);
    const written = cli(["write", "--from", drafts], dir);
    expect(written.status).toBe(0);
    expect(readFileSync(join(dir, "wiki/Basil.md"), "utf8")).toContain("([[Observation log]])");
    expect(tried(cli(candidate, dir)).would_pass).toContain("wiki/Basil.md");
    commit(dir, "fix: ground the heat observation", "wiki/Basil.md");
    rmSync(join(drafts, "wiki/Basil.md"));

    // The rule lands with a negative, a repaired twin and a positive example.
    const typePath = "constitution/types/planting.yaml";
    const type = readFileSync(join(dir, typePath), "utf8");
    writeAt(
      dir,
      typePath,
      `${type}  - id: ${RULE}\n    section: Observations\n    expr: '${EXPR.replaceAll("'", "''")}'\n    severity: error\n    message: A heat observation must name evidence.\n`,
    );
    for (const [path, text] of Object.entries(ruleTests())) writeAt(dir, path, text);
    expect(cli(["check", "--write"], dir).status).toBe(0);
    const governed = cli(["check", "--all"], dir);
    expect(governed.status).toBe(0);
    expect(
      (governed.envelope.data?.findings ?? []).filter((f) =>
        ["rule-untested", "rule-test-fails"].includes(f.rule),
      ),
    ).toEqual([]);
    commit(dir, "feat: require evidence for heat observations", typePath, "rule-tests");

    // A recurrence is refused by check and by the actual pre-commit hook.
    const recurrence = observationPage("Mint", false);
    writeAt(dir, "wiki/Mint.md", recurrence);
    const checked = cli(["check", "--all"], dir);
    expect(checked.status).toBe(5);
    const finding = (checked.envelope.data?.findings ?? []).find(
      (item) => item.rule === RULE && item.path === "wiki/Mint.md",
    );
    expect(finding).toMatchObject({
      severity: "error",
      location: { kind: "section", heading: "Observations", occurrence: 0 },
    });
    git(dir, "add", "--", "wiki/Mint.md");
    installGateHook(dir);
    const headBeforeRefusal = git(dir, "rev-parse", "HEAD");
    let refused = false;
    try {
      git(dir, "commit", "-q", "-m", "test: recur without evidence");
    } catch (error) {
      refused = (error as { status?: number }).status !== 0;
    }
    expect(refused).toBe(true);
    expect(git(dir, "rev-parse", "HEAD")).toBe(headBeforeRefusal);
    const gate = JSON.parse(readFileSync(join(dir, ".git/episode-gate.json"), "utf8")) as {
      error: { code: string; exit_code: number };
      data: { findings: { rule: string; path: string; location: { heading: string } }[] };
    };
    expect([gate.error.code, gate.error.exit_code]).toEqual(["findings", 5]);
    expect(gate.data.findings).toContainEqual(
      expect.objectContaining({
        rule: RULE,
        path: "wiki/Mint.md",
        location: expect.objectContaining({ heading: "Observations" }),
      }),
    );

    writeAt(drafts, "wiki/Mint.md", observationPage("Mint", true));
    expect(cli(["write", "--from", drafts], dir).status).toBe(0);
    commit(dir, "fix: ground the recurring observation", "wiki/Mint.md");
    const acceptedGate = JSON.parse(readFileSync(join(dir, ".git/episode-gate.json"), "utf8")) as {
      ok: boolean;
    };
    expect(acceptedGate.ok).toBe(true);

    writeAt(dir, "notes/observations.txt", "Basil bolted on a hot day.\nMint bolted later.\n");
    const evidence = commit(dir, "test: update the observation log", "notes/observations.txt");
    const staleRead = status(dir, "read");
    const staleSearch = status(dir, "search");
    expect(staleRead).toMatchObject({ stale: true, reason: "stale-source-cited" });
    expect(staleSearch).toMatchObject({ stale: true, reason: "stale-source-cited" });

    writeAt(dir, "wiki/Observation log.md", sourcePage(evidence));
    const finalHead = commit(dir, "fix: repin the observation log", "wiki/Observation log.md");
    expect(status(dir, "read")).toMatchObject({ stale: false, reason: null });
    expect(status(dir, "search")).toMatchObject({ stale: false, reason: null });
    const rendered = cli(["check", "--write"], dir);
    expect(rendered.status).toBe(0);
    const files = ["BRIEF.md", "graph.json", "manifest.json", "queue.md", "tag-catalog.md"];
    return {
      finalHead,
      tree: git(dir, "rev-parse", "HEAD^{tree}"),
      gateFinding: gate.data.findings.filter((item) => item.rule === RULE),
      stale: { read: staleRead, search: staleSearch },
      fresh: { read: status(dir, "read"), search: status(dir, "search") },
      generated: Object.fromEntries(
        files.map((file) => [file, readFileSync(join(dir, "generated", file), "utf8")]),
      ),
    };
  } finally {
    rmSync(drafts, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the first v2 delivery episode", () => {
  it("refuses recurrence, exposes changed evidence, and is byte-reproducible twice", () => {
    expect(episode()).toEqual(episode());
  }, 30_000);
});
