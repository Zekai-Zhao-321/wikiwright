// v2 contracts §9.2 and §8: `gate [--commit-msg <file>]` over a synthetic
// gardening bundle in a git repository under os.tmpdir() — the index judged
// with HEAD as its base, a queued error on an untouched line demoted, the
// untouched pages left out, the whole vault judged when the law is staged,
// generated/ judged as staged, a rule the diff adds held to its tests, the
// law diff at both stages, the commit prefixes — and the published hook
// definition naming both stages.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYaml } from "@wikiwright/core";
import { parseInvocation } from "../src/argv.ts";
import { COMMANDS } from "../src/commands.ts";
import {
  cleanBundles,
  cli,
  commitAll,
  findingsOf,
  gardenBundle,
  git,
} from "./fixtures/garden-cli.ts";
import { gardenVault } from "./fixtures/garden-judge.ts";
import { engineJson, LIBRARY, removeTree } from "./fixtures/garden-law.ts";

const drafted: string[] = [];
afterAll(() => {
  cleanBundles();
  for (const dir of drafted) removeTree(dir);
});

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

function basil(dir: string): string {
  return readFileSync(join(dir, "wiki/Basil.md"), "utf8");
}

/** A committed garden whose Basil carries a tag the vocabulary does not hold: an inherited error. */
function inherited(): string {
  const dir = gardenBundle();
  writeFileSync(
    join(dir, "wiki/Basil.md"),
    basil(dir).replace("title: Basil", "title: Basil\ntags: [weeds]"),
  );
  commitAll(dir, "the garden");
  return dir;
}

function stage(dir: string, path: string, text: string): void {
  writeFileSync(join(dir, path), text);
  git(dir, "add", "-A");
}

describe("the pre-commit stage (v2 contracts §9.2)", () => {
  it("judges a first commit with no HEAD: no base to demote against, and no law diff", () => {
    const dir = gardenBundle();
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    const r = cli(["gate"], dir);
    expect(r.status).toBe(0);
    expect(r.envelope.data?.["law_changes"]).toEqual([]);
    expect(r.envelope.data?.["stage"]).toBe("pre-commit");
  });

  it("reviews a former folder tag after a staged rename, then clears it when removed", () => {
    const oldPath = "wiki/beds/North bed.md";
    const newPath = "wiki/herbs/North bed.md";
    const page =
      "---\ntype: garden/bed\ntitle: North bed\ntags: [beds, herbs]\n---\n\n# North bed\n";
    const dir = gardenBundle({
      "config/engine.json": engineJson({ folder_tags: { mode: "validate" } }),
      [oldPath]: page,
    });
    commitAll(dir, "the beds");
    mkdirSync(join(dir, "wiki/herbs"), { recursive: true });
    git(dir, "mv", oldPath, newPath);
    const retained = cli(["gate"], dir);
    expect(retained.status).toBe(0);
    expect(
      findingsOf(retained.envelope, "former-folder-tags-review").map((f) => [
        f.path,
        f.severity,
        f.queue,
        f.details["from"],
      ]),
    ).toEqual([[newPath, "warning", "tag-review", oldPath]]);

    writeFileSync(join(dir, newPath), page.replace("[beds, herbs]", "[herbs]"));
    git(dir, "add", "-A");
    const removed = cli(["gate"], dir);
    expect(removed.status).toBe(0);
    expect(findingsOf(removed.envelope, "former-folder-tags-review")).toEqual([]);
  });

  it("refuses an error the commit writes, with the census on stderr", () => {
    const dir = gardenBundle();
    commitAll(dir, "the garden");
    stage(dir, "wiki/Basil.md", basil(dir).replace("title: Basil", "title: Basil\ntags: [weeds]"));
    const r = cli(["gate"], dir);
    expect(r.status).toBe(5);
    expect(findingsOf(r.envelope, "vocabulary-unknown").map((f) => f.severity)).toEqual(["error"]);
    expect(r.stderr).toContain("wikiwright gate: 1 error finding(s) block this commit");
    expect(r.stderr).toContain("queue: category-review");
  });

  it("demotes a queued error on a line the commit did not touch, and names it demoted", () => {
    const dir = inherited();
    stage(dir, "wiki/Basil.md", `${basil(dir)}\nA line the commit adds.\n`);
    const r = cli(["gate"], dir);
    expect(r.status).toBe(0);
    const found = findingsOf(r.envelope, "vocabulary-unknown");
    expect(found.map((f) => [f.severity, f.details["demoted_from"], f.queue])).toEqual([
      ["warning", "error", "category-review"],
    ]);
    expect(r.envelope.data?.summary?.errors).toBe(0);
  });

  it("leaves out the findings of a page the commit does not touch", () => {
    const dir = inherited();
    stage(dir, "wiki/Start.md", `${readFileSync(join(dir, "wiki/Start.md"), "utf8")}\nMore.\n`);
    const r = cli(["gate"], dir);
    expect(r.status).toBe(0);
    expect(findingsOf(r.envelope, "vocabulary-unknown")).toEqual([]);
    expect((r.envelope.data?.summary as { pages?: number } | undefined)?.pages).toBe(1);
  });

  it("judges the whole vault, demoting nothing, when the commit stages the law", () => {
    const dir = inherited();
    stage(
      dir,
      "constitution/types/shed.yaml",
      "type: shed\nrole: reference\ndescription: A shed.\n",
    );
    const r = cli(["gate"], dir);
    expect(r.status).toBe(5);
    expect(r.envelope.data?.["config_changed"]).toBe(true);
    expect(findingsOf(r.envelope, "vocabulary-unknown").map((f) => f.severity)).toEqual(["error"]);
  });

  it("reports the law diff as law-changed, info, and never blocks on it", () => {
    const dir = gardenBundle();
    commitAll(dir, "the garden");
    const guide = join(dir, "constitution/types/guide.yaml");
    stage(
      dir,
      "constitution/types/guide.yaml",
      readFileSync(guide, "utf8").replace("max: 1", "max: 2"),
    );
    const r = cli(["gate"], dir);
    expect(r.status).toBe(0);
    const changed = findingsOf(r.envelope, "law-changed");
    expect(changed.map((f) => [f.severity, f.details["kind"]])).toEqual([
      ["info", "type-sections"],
    ]);
  });

  it("holds a rule the diff adds to its test set: rule-untested is an error at the gate", () => {
    const dir = gardenBundle();
    commitAll(dir, "the garden");
    const guide = join(dir, "constitution/types/guide.yaml");
    stage(
      dir,
      "constitution/types/guide.yaml",
      `${readFileSync(guide, "utf8")}rules:\n  - id: guide-titled\n    expr: has(page.fields.title)\n    severity: error\n    message: A guide has a title.\n`,
    );
    const r = cli(["gate"], dir);
    expect(r.status).toBe(5);
    expect(
      findingsOf(r.envelope, "rule-untested").map((f) => [f.severity, f.details["rule"]]),
    ).toEqual([["error", "guide-titled"]]);
  });

  it("judges generated/ as staged, once the index tracks it", () => {
    const dir = gardenBundle();
    cli(["check", "--write"], dir);
    commitAll(dir, "the garden and its generated files");
    stage(dir, "wiki/Basil.md", basil(dir).replace("title: Basil", "title: Sweet basil"));
    const r = cli(["gate"], dir);
    expect(r.status).toBe(5);
    const drift = findingsOf(r.envelope, "generated-drift");
    expect(drift.map((f) => f.details["state"])).toContain("index");
    cli(["check", "--write"], dir);
    git(dir, "add", "-A");
    expect(cli(["gate"], dir).status).toBe(0);
  });

  it("refuses an engine outside the declared range, and a root in no repository", () => {
    const dir = gardenBundle({ "config/engine.json": engineJson({ engine: "<0.0.1" }) });
    commitAll(dir, "the garden");
    expect(cli(["gate"], dir).envelope.error?.code).toBe("engine-mismatch");
    const loose = gardenBundle();
    const r = cli(["gate"], loose);
    expect(r.status).toBe(4);
    expect(r.envelope.error?.code).toBe("git-unavailable");
  });
});

describe("what the commit caused is never demoted (v2 contracts §9.2)", () => {
  /** A committed garden, then `edit` of one page staged. */
  function staged(
    extra: Record<string, string>,
    path: string,
    edit: (text: string) => string,
  ): string {
    const dir = gardenBundle(extra);
    commitAll(dir, "the garden");
    stage(dir, path, edit(readFileSync(join(dir, path), "utf8")));
    return dir;
  }

  /** The planting type with history-dated raised to an error. */
  const DATED = {
    "libraries/kit-garden/types/planting.yaml": LIBRARY[
      "libraries/kit-garden/types/planting.yaml"
    ]?.replace("severity: warning", "severity: error") as string,
  };

  /** The guide type with a page rule over the body: a guide links to a page. */
  const LINKED = {
    "constitution/types/guide.yaml": `${gardenVault()["constitution/types/guide.yaml"]}rules:\n  - id: guide-links\n    expr: page.body.contains("[[")\n    severity: error\n    message: A guide links to a page.\n`,
  };

  function refused(dir: string, rule: string): void {
    const r = cli(["gate"], dir);
    const found = findingsOf(r.envelope, rule);
    expect(found.map((f) => [f.severity, f.details["demoted_from"]])).toEqual([
      ["error", undefined],
    ]);
    expect(r.status).toBe(5);
  }

  it("refuses a relation removed with no History entry: a transition, at its heading", () => {
    refused(
      staged({}, "wiki/Basil.md", (t) => t.replace("- grows-in [[Herb bed]]\n", "")),
      "relation-removed",
    );
  });

  it("refuses an open claim removed, and an append-only entry removed", () => {
    refused(
      staged({}, "wiki/Basil.md", (t) =>
        t.replace("- [observed] Basil bolts above thirty degrees. ([[Herb bed]])\n", ""),
      ),
      "claims-transition",
    );
    refused(
      staged({}, "wiki/Basil.md", (t) => t.replace("- 2026-04-12 — sown\n", "")),
      "entry-edited",
    );
  });

  it("refuses a required section removed: a finding with no line is never demoted", () => {
    refused(
      staged({}, "wiki/Start.md", (t) => t.replace("## Start here\n\n", "")),
      "section-count",
    );
  });

  it("refuses a CEL page rule the body breaks, with the frontmatter unchanged", () => {
    refused(
      staged(LINKED, "wiki/Start.md", (t) => t.replace("Read [[Basil]] first.", "Read on.")),
      "guide-links",
    );
  });

  it("refuses a CEL section rule broken by an item added under an unchanged heading", () => {
    refused(
      staged(DATED, "wiki/Basil.md", (t) =>
        t.replace("- 2026-04-12 — sown\n", "- 2026-04-12 — sown\n- 2026-05 — thinned\n"),
      ),
      "history-dated",
    );
  });

  it("still demotes a section finding the base carried, in a section the commit left alone", () => {
    const undated = (t: string) => t.replace("- 2026-04-12 — sown", "- 2026-04 — sown");
    const dir = gardenBundle({
      ...DATED,
      "wiki/Basil.md": undated(gardenVault()["wiki/Basil.md"] as string),
    });
    commitAll(dir, "the garden");
    stage(dir, "wiki/Basil.md", basil(dir).replace("# Basil\n", "# Basil\n\nSown by the door.\n"));
    const r = cli(["gate"], dir);
    expect(r.status).toBe(0);
    expect(
      findingsOf(r.envelope, "history-dated").map((f) => [f.severity, f.details["demoted_from"]]),
    ).toEqual([["warning", "error"]]);
  });

  it("shows a page reference the commit's retyping broke, on the page it did not touch", () => {
    const vault = gardenVault();
    const dir = gardenBundle({
      "wiki/Basil.md": (vault["wiki/Basil.md"] as string).replace(
        "bed: herb",
        "bed: herb\norigin: Herb bed",
      ),
    });
    commitAll(dir, "the garden");
    stage(
      dir,
      "wiki/Herb bed.md",
      "---\ntype: guide\ntitle: Herb bed\n---\n\n# Herb bed\n\n## Start here\n\nThe raised bed.\n",
    );
    const r = cli(["gate"], dir);
    expect(r.status).toBe(5);
    expect(
      findingsOf(r.envelope, "page-ref-type").map((f) => [f.path, f.severity, f.details["kind"]]),
    ).toEqual([["wiki/Basil.md", "error", "type"]]);
  });

  it("shows what a deleted page leaves dangling, on the page the commit did not touch", () => {
    const vault = gardenVault();
    const dir = gardenBundle({
      "wiki/Basil.md": (vault["wiki/Basil.md"] as string).replace(
        "bed: herb",
        "bed: herb\norigin: Herb bed",
      ),
    });
    commitAll(dir, "the garden");
    git(dir, "rm", "-q", "wiki/Herb bed.md");
    const r = cli(["gate"], dir);
    expect(r.status).toBe(5);
    expect(findingsOf(r.envelope, "page-ref-type").map((f) => [f.path, f.details["kind"]])).toEqual(
      [["wiki/Basil.md", "unresolved"]],
    );
    expect(findingsOf(r.envelope, "relation-target-unresolved").map((f) => f.path)).toEqual([
      "wiki/Basil.md",
    ]);
  });

  it("agrees with write: the change write refuses, the gate refuses", () => {
    const dir = gardenBundle(DATED);
    commitAll(dir, "the garden");
    const text = basil(dir)
      .replace("- 2026-04-12 — sown\n", "- 2026-04-12 — sown\n- 2026-05 — thinned\n")
      .replace("- grows-in [[Herb bed]]\n", "");
    const from = mkdtempSync(join(tmpdir(), "ww-gate-drafts-"));
    drafted.push(from);
    mkdirSync(join(from, "wiki"));
    writeFileSync(join(from, "wiki/Basil.md"), text);
    const write = cli(["write", "--from", from, "--dry-run"], dir);
    expect(write.status).toBe(5);
    stage(dir, "wiki/Basil.md", text);
    const gate = cli(["gate"], dir);
    expect(gate.status).toBe(5);
    const errors = (r: typeof gate): string[] =>
      (r.envelope.data?.findings ?? [])
        .filter((f) => f.severity === "error")
        .map((f) => f.rule)
        .sort();
    expect(errors(gate)).toEqual(["history-dated", "relation-removed"]);
    expect(errors(write)).toEqual(["history-dated", "relation-removed"]);
  });
});

describe("the commit-msg stage (v2 contracts §8, §9.2)", () => {
  function relaxed(): string {
    const dir = gardenBundle({
      "config/engine.json": engineJson({ commit_prefixes: ["feat", "fix", "docs"] }),
    });
    commitAll(dir, "the garden");
    const planting = join(dir, "constitution/types/planting.yaml");
    stage(
      dir,
      "constitution/types/planting.yaml",
      readFileSync(planting, "utf8").replace("[seeds.example, nursery.example]", "[seeds.example]"),
    );
    return dir;
  }

  function message(dir: string, text: string): string {
    const path = join(dir, ".git", "COMMIT_EDITMSG");
    writeFileSync(path, text);
    return path;
  }

  it("refuses a law change the message gives no reason for, as law-relaxed", () => {
    const dir = relaxed();
    const r = cli(["gate", "--commit-msg", message(dir, "feat: fewer nurseries\n")], dir);
    expect(r.status).toBe(5);
    const found = findingsOf(r.envelope, "law-relaxed");
    expect(found.map((f) => [f.severity, f.details["kind"], f.queue])).toEqual([
      ["error", "rule-config", "law-review"],
    ]);
  });

  it("admits it with a law-change line, the reason in details", () => {
    const dir = relaxed();
    const r = cli(
      [
        "gate",
        "--commit-msg",
        message(dir, "feat: fewer nurseries\n\nlaw-change: the market closed\n"),
      ],
      dir,
    );
    expect(r.status).toBe(0);
    expect(findingsOf(r.envelope, "law-changed").map((f) => f.details["reason"])).toEqual([
      "the market closed",
    ]);
  });

  it("holds the message's prefix to commit_prefixes, with one line on stderr", () => {
    const dir = relaxed();
    const r = cli(["gate", "--commit-msg", message(dir, "chore: tidy\n\nlaw-change: x\n")], dir);
    expect(r.status).toBe(5);
    expect(r.envelope.error?.code).toBe("commit-prefix");
    expect(r.envelope.error?.details).toEqual({
      prefix: "chore",
      valid_values: ["feat", "fix", "docs"],
    });
    expect(r.stderr).toContain("use one of: docs, feat, fix");
    const ok = cli(["gate", "--commit-msg", message(dir, "fix: x\n\nlaw-change: y\n")], dir);
    expect(ok.envelope.data?.["commit_prefixes"]).toMatchObject({ prefix: "fix", known: true });
  });

  it("names a message file that is not there", () => {
    const dir = relaxed();
    const r = cli(["gate", "--commit-msg", join(dir, "no-such-message")], dir);
    expect(r.status).toBe(3);
    expect(r.envelope.error?.code).toBe("message-not-found");
  });
});

describe("the published hook definition (v2 contracts §9.2)", () => {
  const hooks = readYaml(readFileSync(join(REPO, ".pre-commit-hooks.yaml"), "utf8"));

  it("declares the two stages, each invoking the gate", () => {
    expect(hooks.ok).toBe(true);
    if (!hooks.ok) return;
    const rows = hooks.value as { id: string; entry: string; args?: string[]; stages: string[] }[];
    expect(rows.map((r) => [r.id, r.stages])).toEqual([
      ["wikiwright-gate", ["pre-commit"]],
      ["wikiwright-commit-msg", ["commit-msg"]],
    ]);
    const gate = COMMANDS.find((c) => c.name === "gate");
    if (gate === undefined) throw new Error("no gate in the command table");
    for (const row of rows) {
      const [binary, verb, ...rest] = row.entry.split(" ");
      expect([binary, verb]).toEqual(["wikiwright", "gate"]);
      const argv = [
        ...rest,
        ...(row.args ?? []),
        ...(row.stages[0] === "commit-msg" ? [".git/COMMIT_EDITMSG"] : []),
      ];
      const parsed = parseInvocation(gate, argv, COMMANDS);
      expect(parsed.ok).toBe(true);
      if (parsed.ok && row.stages[0] === "commit-msg")
        expect(parsed.args.flags["commit-msg"]).toBe(".git/COMMIT_EDITMSG");
    }
  });
});
