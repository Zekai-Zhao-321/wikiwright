// docs/constitution.md §config/engine.json (`content_roots` is declared, and an
// omitted directory is not walked — not linted, not in the identity namespace;
// `field_sources` end to end; summaries count unevaluated diff-gated rules) ·
// docs/cli.md
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function run(cwd: string, args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function data(envelope: Record<string, unknown>): Record<string, unknown> {
  return (envelope["data"] as Record<string, unknown> | undefined) ?? {};
}

function findingsOf(envelope: Record<string, unknown>): Array<Record<string, unknown>> {
  return (data(envelope)["findings"] as Array<Record<string, unknown>> | undefined) ?? [];
}

function vault(engineConfig?: unknown, tags: Record<string, unknown> = {}): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-eng-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki"));
  mkdirSync(join(tmp, "journal"));
  mkdirSync(join(tmp, "raw"));
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(
      documentOf({
        tags,
        types: {
          daily: {
            extends: "reference",
            description: "One day's log.",
            body: { lifecycle: "append-only" },
          },
        },
      }),
    ),
  );
  if (engineConfig !== undefined) {
    writeFileSync(join(tmp, "config", "engine.json"), JSON.stringify(engineConfig));
  }
  // A clean wiki page relying on derivation (no title/description frontmatter).
  writeFileSync(
    join(tmp, "wiki", "clean.md"),
    "---\ntype: concept\ntags: []\n---\n\n# clean\n\nA lede line.\n",
  );
  // A journal page of the dated-log type.
  writeFileSync(
    join(tmp, "journal", "2026-09-01.md"),
    "---\ntype: daily\ntitle: 2026-09-01\ndescription: One day.\ntags: []\n---\n\n# 2026-09-01\n\n- entry\n",
  );
  // Archive junk that must never be walked: broken frontmatter + a basename
  // colliding with the wiki page.
  writeFileSync(join(tmp, "raw", "junk.md"), "no frontmatter at all\n");
  writeFileSync(join(tmp, "raw", "clean.md"), "---\nbroken: [\n---\nsnapshot copy\n");
  return tmp;
}

const ENGINE = {
  content_roots: ["wiki", "journal"],
  field_sources: { title: "basename", description: "lede" },
};

describe("config/engine.json: content_roots and field_sources", () => {
  // e2e:content_roots — engine.json on disk changes which pages the CLI walks.
  it("an omitted root is not walked: no findings from raw/, no identity collisions", () => {
    const tmp = vault(ENGINE);
    try {
      const r = run(tmp, ["lint"]);
      const paths = findingsOf(r.envelope).map((f) => String(f["path"]));
      assert.equal(
        paths.some((p) => p.startsWith("raw/")),
        false,
        "raw/ never linted",
      );
      const check = run(tmp, ["check"]);
      assert.equal(
        findingsOf(check.envelope).some((f) => f["ruleId"] === "identity-collision"),
        false,
        "archived duplicate basename produces no collision",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // e2e:field_sources — declared derivation changes the CLI's verdict on a page
  // carrying neither title nor description.
  it("a declared root is walked, and field derivation satisfies title/description vault-wide", () => {
    const tmp = vault(ENGINE);
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 0, JSON.stringify(findingsOf(r.envelope)));
      const summary = data(r.envelope)["summary"] as Record<string, unknown>;
      assert.equal(summary["pages"], 2, "wiki + journal pages both walked");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("summaries count unevaluated diff-gated rules", () => {
    const tmp = vault(ENGINE);
    try {
      const r = run(tmp, ["lint"]);
      const summary = data(r.envelope)["summary"] as Record<string, unknown>;
      assert.equal(summary["unevaluated"], 1, "the daily page's append-only rule had no base");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a bundle that names no content_roots is refused, and unknown keys fail loudly", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["lint"]);
      // The engine has no content-roots default. A bundle that does
      // not say which directories hold its pages is a bundle the engine would
      // have to guess about, so it is refused by name at exit 2.
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(
        (r.envelope["error"] as Record<string, unknown>)["code"],
        "content-roots-required",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    const bad = vault({ content_roots: ["wiki"], archive_roots: ["raw"] });
    try {
      const r = run(bad, ["lint"]);
      // An unknown engine.json key is a constitution failure (2), never a
      // page verdict (5) — nothing was linted.
      assert.equal(r.status, 2);
      assert.equal(JSON.stringify(r.envelope).includes("engine"), true);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });
});

describe("every engine.json key reaches the linter through the file (R3 regression)", () => {
  // The R3 lesson: a key can parse, validate, and be dropped on the floor — the
  // core test proved the checker, nothing proved the config reached it. Each
  // engine.json key gets an end-to-end fixture: a value written to the FILE
  // must change a real command result.
  // e2e:folder_tag_aliases — the key whose absence of an end-to-end fixture is
  // the reason docs/architecture.md §The invariants exists.
  it("folder_tag_aliases written to engine.json clears the aliased segment", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-alias-"));
    try {
      mkdirSync(join(tmp, "config"));
      mkdirSync(join(tmp, "journal", "daily"), { recursive: true });
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify(
          documentOf({
            tags: { "journal-daily": { description: "Daily notes." } },
            types: { daily: { extends: "reference", description: "One day." } },
          }),
        ),
      );
      writeFileSync(
        join(tmp, "journal", "daily", "2026-09-01.md"),
        "---\ntype: daily\ntitle: T\ndescription: d.\ntags: [journal-daily]\n---\n\n# T\n",
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({ content_roots: ["journal"], folder_tags: { mode: "validate" } }),
      );
      const before = run(tmp, ["lint"]);
      assert.equal(
        findingsOf(before.envelope).some((f) => f["ruleId"] === "folder-segment-registered"),
        true,
        "without the alias the daily segment cannot register (type owns the name)",
      );

      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({
          content_roots: ["journal"],
          folder_tag_aliases: { daily: "journal-daily" },
          folder_tags: { mode: "validate" },
        }),
      );
      const after = run(tmp, ["lint"]);
      assert.equal(after.status, 0, JSON.stringify(findingsOf(after.envelope)));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("declared templates must exist", () => {
  it("a type declaring a missing template fails constitution validation — no silent fallback", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-tpl-"));
    try {
      mkdirSync(join(tmp, "config"));
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify(
          documentOf({
            types: {
              note: { extends: "concept", description: "n.", template: "templates/wiki/note.md" },
            },
          }),
        ),
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({ content_roots: ["wiki"] }),
      );
      const r = run(tmp, ["lint"]);
      // A declared-but-missing template is a constitution failure (2).
      assert.equal(r.status, 2);
      assert.equal(JSON.stringify(r.envelope).includes("templates/wiki/note.md"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("tag aliases resolve through the CLI plumbing, not only the checker", () => {
  // The R3 lesson made law: the core test passes options directly and proves
  // the resolver; this one proves the FILE-loaded registry reaches search.
  it("search --tag <alias> finds pages carrying the canonical tag", () => {
    const tmp = vault(ENGINE, {
      "western-university": { description: "UWO pages.", aliases: ["uwo"] },
    });
    try {
      writeFileSync(
        join(tmp, "wiki", "campus.md"),
        "---\ntype: daily\ntitle: Campus\ndescription: d.\ntags: [western-university]\n---\n\n# Campus\n",
      );
      const r = run(tmp, ["search", "campus", "--tag", "uwo"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const results = data(r.envelope)["results"] as Array<Record<string, unknown>>;
      assert.equal(results.length, 1);
      assert.equal(results[0]?.["path"], "wiki/campus.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
