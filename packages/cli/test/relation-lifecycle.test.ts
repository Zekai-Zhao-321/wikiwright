// docs/extending.md §An arm (a relation dropped or relabeled by a
// rewrite must land as a closing clause in the section's History; a count with
// no label and no target is the defect) · docs/concepts.md §Findings and routing (the row
// counts `evaluated` only where the arm ran, and the finding reaches every
// write path — the stdin overlay, the write draft, the staged index and the
// commit replay — or the pass is green hiding a gap).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Run {
  status: number;
  data: Record<string, unknown>;
  error: Record<string, unknown>;
}

function run(cwd: string, args: string[], stdin?: string): Run {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    input: stdin ?? "",
    env: { ...process.env, WIKIWRIGHT_TODAY: "2026-09-05" },
  });
  const envelope = JSON.parse(r.stdout) as {
    data?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
  return { status: r.status ?? -1, data: envelope.data ?? {}, error: envelope.error ?? {} };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

type Finding = {
  ruleId: string;
  severity: string;
  details?: Record<string, unknown>;
  line?: number;
};
const findings = (r: Run): Finding[] => (r.data["findings"] ?? []) as Finding[];
const removed = (r: Run): Finding[] => findings(r).filter((f) => f.ruleId === "relation-removed");
const retired = (r: Run): Finding[] => findings(r).filter((f) => f.ruleId === "relation-retired");
const row = (r: Run, id: string): Record<string, unknown> =>
  (r.data["coverage"] as { passes: Record<string, Record<string, unknown>> }).passes[id] ?? {};
/** The judging verbs key dispositions by page; `write` reports its one page's. */
const dispositionsOf = (r: Run, path?: string): Record<string, number> =>
  path === undefined
    ? (r.data["dispositions"] as Record<string, number>)
    : ((r.data["dispositions"] as Record<string, Record<string, number>>)[path] ?? {});

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: { mode: "registered", entries: {} },
    relations: {
      mode: "registered",
      entries: {
        implements: { description: "implements the requirement", range: ["requirement"] },
        "diverges-from": { description: "diverges from the requirement", range: ["requirement"] },
        covers: { description: "explains the requirement", range: ["requirement"] },
      },
    },
  },
  types: {
    requirement: { extends: "reference", description: "One requirement." },
    "rtl-module": {
      extends: "reference",
      description: "One RTL module.",
      sections: {
        depth: 2,
        list: [
          {
            heading: "Relations",
            grammar: "relations",
            vocabulary: "relations",
            history: "History",
          },
          { heading: "History", grammar: "entries", date: "required" },
        ],
      },
    },
  },
};

const HEAD =
  "---\ntype: rtl-module\ntitle: Core\ndescription: The core.\ntags: []\n---\n\n# Core\n\n## Relations\n\n";
const BASE = `${HEAD}- diverges-from [[REQ-1]]\n- covers [[REQ-2]]\n\n## History\n\n- 2026-09-01 — read at the pinned commit\n`;
/** The `covers` line dropped, nothing closed. */
const DROPPED = `${HEAD}- diverges-from [[REQ-1]]\n\n## History\n\n- 2026-09-01 — read at the pinned commit\n`;
/** `diverges-from` relabeled `implements` on the same target, nothing closed. */
const RELABELED = `${HEAD}- implements [[REQ-1]]\n- covers [[REQ-2]]\n\n## History\n\n- 2026-09-01 — read at the pinned commit\n`;
/** Both edits, each closed by a dated History line quoting the relation. */
const LANDED = `${HEAD}- implements [[REQ-1]]\n\n## History\n\n- 2026-09-01 — read at the pinned commit\n- 2026-09-05 — retired diverges-from [[REQ-1]]: the RTL was read and the guide was wrong\n- 2026-09-05 — retired covers [[REQ-2]]: moved to the design note\n`;

function vault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-relation-life-"));
  write(tmp, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
  write(tmp, "config/engine.json", `${JSON.stringify({ content_roots: ["wiki"] })}\n`);
  for (const n of [1, 2]) {
    write(
      tmp,
      `wiki/REQ-${n}.md`,
      `---\ntype: requirement\ntitle: REQ-${n}\ndescription: r.\ntags: []\n---\n\n# REQ-${n}\n`,
    );
  }
  write(tmp, "wiki/Core.md", BASE);
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "t@e.com");
  git(tmp, "config", "user.name", "T");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-qm", "base");
  return tmp;
}

const named = (f: Finding[]): string[] =>
  f.map((x) => `${String(x.details?.["label"])} [[${String(x.details?.["target"])}]]`).sort();

describe("a dropped or relabeled relation is named at every write path", () => {
  it("the stdin overlay", () => {
    const tmp = vault();
    try {
      const dropped = run(tmp, ["lint", "--stdin", "--path", "wiki/Core.md", "--all"], DROPPED);
      assert.deepEqual(named(removed(dropped)), ["covers [[REQ-2]]"]);
      assert.equal(removed(dropped)[0]?.severity, "warning", "the section's own knob, undeclared");
      assert.equal(row(dropped, "relation-removed")["evaluated"], 1);
      assert.deepEqual(dispositionsOf(dropped, "wiki/Core.md"), {
        relation_unchanged: 1,
        relation_added: 0,
        relation_retired: 0,
        relation_removed: 1,
      });

      const relabeled = run(tmp, ["lint", "--stdin", "--path", "wiki/Core.md", "--all"], RELABELED);
      assert.deepEqual(named(removed(relabeled)), ["diverges-from [[REQ-1]]"]);
      assert.deepEqual(dispositionsOf(relabeled, "wiki/Core.md"), {
        relation_unchanged: 1,
        relation_added: 1,
        relation_retired: 0,
        relation_removed: 1,
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the write draft, and the History landing that clears it", () => {
    const tmp = vault();
    try {
      const dropped = run(tmp, ["write", "wiki/Core.md", "--dry-run"], DROPPED);
      assert.equal(dropped.status, 0, "warning: the draft lands, and the envelope names the loss");
      assert.deepEqual(named(removed(dropped)), ["covers [[REQ-2]]"]);
      assert.match(String(removed(dropped)[0]?.["remediation" as keyof Finding]), /## History/);

      const landed = run(tmp, ["write", "wiki/Core.md", "--dry-run"], LANDED);
      assert.equal(landed.status, 0, JSON.stringify(landed.data));
      assert.deepEqual(removed(landed), []);
      assert.deepEqual(named(retired(landed)), ["covers [[REQ-2]]", "diverges-from [[REQ-1]]"]);
      assert.deepEqual(
        retired(landed)
          .map((f) => f.line)
          .sort(),
        [17, 18],
        "the census points at the closing lines",
      );
      assert.deepEqual(dispositionsOf(landed), {
        relation_unchanged: 0,
        relation_added: 1,
        relation_retired: 2,
        relation_removed: 0,
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the staged index and the gate", () => {
    const tmp = vault();
    try {
      write(tmp, "wiki/Core.md", RELABELED);
      git(tmp, "add", "-A");
      const staged = run(tmp, ["lint", "--staged", "--all"]);
      assert.deepEqual(named(removed(staged)), ["diverges-from [[REQ-1]]"]);
      assert.equal(
        row(staged, "relation-removed")["evaluated"],
        1,
        "ran on the one page with a base",
      );
      const gate = run(tmp, ["gate", "--all"]);
      assert.deepEqual(named(removed(gate)), ["diverges-from [[REQ-1]]"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the commit replay", () => {
    const tmp = vault();
    try {
      const root = git(tmp, "rev-parse", "HEAD");
      write(tmp, "wiki/Core.md", DROPPED);
      git(tmp, "add", "-A");
      git(tmp, "commit", "-qm", "drop covers");
      const replay = run(tmp, ["lint", "--since", root]);
      assert.equal(replay.status, 0, JSON.stringify(replay.data));
      const summary = replay.data["summary"] as { by_rule: Record<string, number> };
      assert.equal(summary.by_rule["relation-removed"], 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("without a base the row is not_applicable, reason no-base, and counts as unevaluated — never evaluated", () => {
    const tmp = vault();
    try {
      const plain = run(tmp, ["lint", "--all"]);
      assert.equal(row(plain, "relation-removed")["evaluated"], 0);
      assert.equal(row(plain, "relation-removed")["reason"], "no-base");
      assert.equal((plain.data["summary"] as { unevaluated: number }).unevaluated >= 1, true);
      assert.deepEqual(removed(plain), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("at the default severity the drop is a warning the write reports, never a refusal", () => {
    const tmp = vault();
    try {
      const landed = run(tmp, ["write", "wiki/Core.md", "--dry-run"], DROPPED);
      assert.equal(landed.status, 0, JSON.stringify(landed.data));
      assert.deepEqual(named(removed(landed)), ["covers [[REQ-2]]"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("at an error severity the drop is refused at write, and the landing form is accepted", () => {
    const tmp = vault();
    try {
      const doc = structuredClone(CONSTITUTION) as {
        types: Record<string, { sections?: { list: Record<string, unknown>[] } }>;
      };
      const relations = doc.types["rtl-module"]?.sections?.list[0];
      if (relations !== undefined) relations["severity"] = "error";
      write(tmp, "config/constitution.json", `${JSON.stringify(doc, null, 2)}\n`);
      // docs/extending.md §An arm: a transition arm at `error` is the write verb's
      // removed-illegally refusal, whichever module declared the arm — the
      // verb reads the arms off the manifests, never a stdlib id.
      const refused = run(tmp, ["write", "wiki/Core.md", "--dry-run"], DROPPED);
      assert.equal(refused.status, 4, JSON.stringify(refused.data));
      assert.deepEqual(
        (refused.data["findings"] as { ruleId: string }[]).map((f) => f.ruleId),
        ["relation-removed"],
      );
      // The hint is the arm's own remediation — the History landing line for a
      // relation — and never a sentence about the claims verbs.
      assert.match(String(refused.error["hint"]), /retired covers \[\[REQ-2\]\]/u);
      assert.equal(String(refused.error["hint"]).includes("--replace-core"), false);
      const accepted = run(tmp, ["write", "wiki/Core.md", "--dry-run"], LANDED);
      assert.equal(accepted.status, 0, JSON.stringify(accepted.data));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
