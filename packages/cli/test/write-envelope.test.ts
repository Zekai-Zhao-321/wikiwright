// docs/cli.md §write: `write --from`'s real run answers in its dry run's shape,
// with `wrote: true` and the ops it applied; and a `--coexist` reason lands as a
// rationale line a reader can use: the reason first, then the two newest open
// claims it stands beside and a count of the rest. On a temporary gardening
// claims bundle.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { claimsBundle, PAGES } from "./fixtures/garden-claims.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Envelope {
  ok: boolean;
  data: Record<string, unknown>;
  error?: Record<string, unknown>;
}

function run(
  root: string,
  argv: readonly string[],
  input = "",
): { status: number; envelope: Envelope } {
  const r = spawnSync(CLI_RUNTIME, [CLI, ...argv, "--root", root], {
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
    input,
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

let tmp = "";
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "ww-write-envelope-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("write --from answers in one shape, dry or real (docs/cli.md §write)", () => {
  it("the real run carries wrote: true and the ops its dry run planned, beside the same keys", () => {
    const root = claimsBundle(join(tmp, "batch"));
    const drafts = join(root, "drafts", "wiki");
    mkdirSync(drafts, { recursive: true });
    writeFileSync(
      join(drafts, "Climbing rose.md"),
      (PAGES["Climbing rose.md"] ?? "").replace(
        "## Relations",
        "- [bloom] A second flush follows in early autumn (stated 2026-09-01)\n\n## Relations",
      ),
    );
    writeFileSync(
      join(drafts, "Pear tree.md"),
      "---\ntype: plant\ntitle: Pear tree\ndescription: A pear grown against the east wall.\ntags: [fruit]\n---\n\n# Pear tree\n\nA pear grown against the east wall.\n\n## Facts\n\n- [bloom] Blossom opens a week before the apple's (stated 2026-04-08)\n",
    );
    const dry = run(root, ["write", "--from", "drafts", "--date", "2026-09-04", "--dry-run"]);
    assert.equal(dry.status, 0, JSON.stringify(dry.envelope));
    const real = run(root, ["write", "--from", "drafts", "--date", "2026-09-04"]);
    assert.equal(real.status, 0, JSON.stringify(real.envelope));

    assert.deepEqual(Object.keys(real.envelope.data), Object.keys(dry.envelope.data));
    assert.deepEqual(Object.keys(dry.envelope.data), [
      "ops",
      "wrote",
      "from",
      "date",
      "unevaluated",
      "resolve_checked",
      "pages",
    ]);
    assert.equal(dry.envelope.data["wrote"], false);
    assert.equal(real.envelope.data["wrote"], true);
    // The page the batch created is a `create` in both, read before anything landed.
    assert.deepEqual(real.envelope.data["ops"], dry.envelope.data["ops"]);
    assert.deepEqual(
      (real.envelope.data["ops"] as { kind: string; path: string }[]).map((op) => [
        op.kind,
        op.path,
      ]),
      [
        ["write", "wiki/Climbing rose.md"],
        ["create", "wiki/Pear tree.md"],
      ],
    );
    const pages = real.envelope.data["pages"] as Record<string, unknown>[];
    assert.ok(pages.every((p) => typeof p["blob"] === "string" && !("preview" in p)));
    assert.match(readFileSync(join(root, "wiki", "Pear tree.md"), "utf8"), /# Pear tree/u);
  });
});

describe("write --from reports the drafts it judged (docs/cli.md §write)", () => {
  it("reads the directory once, and a draft added after that is neither landed nor reported", () => {
    const root = claimsBundle(join(tmp, "once"));
    const drafts = join(root, "drafts");
    mkdirSync(join(drafts, "wiki"), { recursive: true });
    writeFileSync(
      join(drafts, "wiki", "Pear tree.md"),
      "---\ntype: plant\ntitle: Pear tree\ndescription: A pear grown against the east wall.\ntags: [fruit]\n---\n\n# Pear tree\n\nA pear grown against the east wall.\n\n## Facts\n\n- [bloom] Blossom opens a week before the apple's (stated 2026-04-08)\n",
    );
    // After the run's first listing of the directory, a second draft appears:
    // a report built from a second listing would name it as landed.
    const log = join(tmp, "once-reads.json");
    const preload = join(tmp, "once-preload.cjs");
    const late = join(drafts, "wiki", "Quince.md");
    writeFileSync(
      preload,
      `const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const original = fs.readdirSync;
let listings = 0;
fs.readdirSync = function (path, ...args) {
  const out = Reflect.apply(original, this, [path, ...args]);
  if (String(path) === ${JSON.stringify(drafts)}) {
    listings += 1;
    if (listings === 1) fs.writeFileSync(${JSON.stringify(late)}, "---\\ntype: plant\\n---\\n");
  }
  return out;
};
syncBuiltinESMExports();
process.on("exit", () => fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ listings })));
`,
    );
    const r = spawnSync(
      CLI_RUNTIME,
      [
        "--require",
        preload,
        CLI,
        "write",
        "--from",
        "drafts",
        "--date",
        "2026-09-04",
        "--root",
        root,
      ],
      { encoding: "utf8", env: { ...process.env, ...PINNED_CLOCK } },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const data = (JSON.parse(r.stdout) as Envelope).data;
    assert.deepEqual(
      (data["ops"] as { kind: string; path: string }[]).map((op) => [op.kind, op.path]),
      [["create", "wiki/Pear tree.md"]],
    );
    assert.deepEqual(
      (data["pages"] as { path: string }[]).map((p) => p.path),
      ["wiki/Pear tree.md"],
    );
    assert.equal(existsSync(join(root, "wiki", "Quince.md")), false, "the late draft did not land");
    assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), { listings: 1 });
  });
});

describe("--coexist records the reason first (docs/cli.md §write)", () => {
  it("names the two newest open claims of the category and counts the rest", () => {
    const root = claimsBundle(join(tmp, "coexist"));
    const append = (core: string, reason: string): void => {
      const r = run(
        root,
        [
          "write",
          "wiki/Climbing rose.md",
          "--section",
          "Facts",
          "--append",
          "--coexist",
          reason,
          "--date",
          "2026-09-04",
        ],
        `- [care] ${core} (stated 2026-09-04)\n`,
      );
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    };
    append("Mulch the root zone every spring", "the canes and the roots are separate tasks");
    append("Water deeply once a week in dry spells", "watering is its own task too");
    append("Feed after the first flowering", "feeding is a third task");

    const text = readFileSync(join(root, "wiki", "Climbing rose.md"), "utf8");
    const handles = (search: string): string => {
      const r = run(root, ["search", search, "--items", "--all"]);
      const results = (r.envelope.data["results"] ?? []) as {
        raw: string;
        fields: { handle: string };
      }[];
      const hit = results.find((i) => i.raw.includes(search));
      assert.ok(hit !== undefined, search);
      return hit.fields.handle;
    };
    const tie = handles("Tie the long canes");
    const mulch = handles("Mulch the root zone");
    const water = handles("Water deeply once a week");
    const lines = text.split("\n").filter((l) => l.startsWith("  - coexists: "));
    assert.deepEqual(lines, [
      `  - coexists: the canes and the roots are separate tasks (beside ${tie})`,
      `  - coexists: watering is its own task too (beside ${tie}, ${mulch})`,
      `  - coexists: feeding is a third task (beside ${mulch}, ${water} and 1 more)`,
    ]);
    // The rationale is a reader's line: the page still lints clean.
    assert.equal(run(root, ["lint", "--page", "wiki/Climbing rose.md"]).status, 0);
  });
});
