// docs/cli.md §bundles: a root that carries a marker is an installed copy, and
// every verb that can write is refused over it — named by `--bundle`, by
// `--root` or by the working directory alike, `--dry-run` included — with
// where a change goes instead, in the words of the copy's contribution mode. A
// marker that is not one is refused before anything loads.
//
// Every copy is a gardening bundle's rendered export under os.tmpdir(), and
// every scan runs with HOME there.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_COMMANDS } from "../src/commands.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; type?: string; hint?: string; details?: Record<string, unknown> };
}

let tmp = "";
let home = "";
let serial = 0;
beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "ww-copy-readonly-")));
  home = join(tmp, "home");
  mkdirSync(home);
  // Every scan's project tier stops at the top of this repository.
  execFileSync("git", ["init", "-q"], { cwd: tmp });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(
  cwd: string,
  argv: readonly string[],
  input = "",
  extra: NodeJS.ProcessEnv = {},
): { status: number; envelope: Envelope } {
  const r = runCli([CLI, ...argv], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, HOME: home, WIKIWRIGHT_SKILL_DIRS: "", ...extra },
    input,
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** A gardening bundle's rendered `garden` export under the contribution given, copied to a plain directory. */
function copyWith(contribution: Record<string, unknown>, repository?: string): string {
  const root = join(tmp, `source-${++serial}`, "garden");
  write(root, {
    "config/constitution.json": `${JSON.stringify({
      schema: "wikiwright/constitution",
      schema_version: 3,
      vocabularies: {
        tags: { mode: "registered", entries: { compost: { description: "Compost." } } },
      },
      types: { note: { extends: "concept", description: "A gardening note." } },
    })}\n`,
    "config/engine.json": `${JSON.stringify({
      content_roots: ["wiki"],
      exports: [
        {
          name: "garden",
          select: { kind: "all" },
          ...(repository === undefined ? {} : { repository }),
          contribution,
        },
      ],
    })}\n`,
    "wiki/turning-compost.md":
      "---\ntype: note\ntitle: Turning compost\ndescription: Turning compost, briefly.\ntags: [compost]\n---\n\n# Turning compost\n\nTurn it weekly.\n",
  });
  const rendered = run(root, ["check", "--write", "--root", "."]);
  assert.equal(rendered.status, 0, JSON.stringify(rendered.envelope));
  const copy = join(tmp, `copy-${serial}`, "garden");
  cpSync(join(root, "skills", "garden"), copy, { recursive: true });
  return copy;
}

/** sha256 over every file under `dir`, so a refused write is proved not to have landed. */
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { encoding: "utf8" }).sort()) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(`${path}\0`).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

const NEW = ["new", "note", "Mulching", "--dest", "wiki/mulching.md"];

describe("a marked root refuses every write path (docs/cli.md §bundles)", () => {
  it("--root and the working directory are refused alike, with the copy named", () => {
    const copy = copyWith({ mode: "none" });
    const before = treeHash(copy);
    for (const [cwd, argv] of [
      [tmp, [...NEW, "--root", copy]],
      [copy, NEW],
      [copy, [...NEW, "--dry-run"]],
    ] as const) {
      const r = run(cwd, argv);
      assert.equal(r.status, 2, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "bundle-readonly");
      assert.deepEqual(r.envelope.error?.details, {
        export: "garden",
        contribution: { mode: "none" },
        root: copy,
      });
    }
    assert.equal(treeHash(copy), before, "a refused write touched the copy");
    // Reading it is what a copy is for.
    assert.equal(run(copy, ["search", "compost"]).status, 0);
  });

  it("the hint says where a change goes, in the words of each contribution mode", () => {
    const repository = "https://example.invalid/garden";
    for (const [contribution, hint] of [
      [{ mode: "issues" }, `report at ${repository}/issues`],
      [
        { mode: "issues", repository: "https://example.invalid/garden-reports" },
        "report at https://example.invalid/garden-reports/issues",
      ],
      [{ mode: "pull-requests" }, `clone ${repository} and write there`],
      [
        { mode: "local-folder", folder: "proposals/garden" },
        "write a proposal under proposals/garden",
      ],
      [{ mode: "none" }, "this copy takes no reports"],
    ] as const) {
      const copy = copyWith(contribution, repository);
      const r = run(tmp, [...NEW, "--root", copy]);
      assert.equal(r.envelope.error?.code, "bundle-readonly", JSON.stringify(r.envelope));
      assert.ok(
        (r.envelope.error?.hint ?? "").endsWith(hint),
        `${JSON.stringify(contribution)}: ${r.envelope.error?.hint}`,
      );
    }
  });

  it("every writing verb is refused over a copy", () => {
    const copy = copyWith({ mode: "none" });
    const before = treeHash(copy);
    for (const spec of LEGACY_COMMANDS.filter((c) => c.writes)) {
      const lead = spec.subcommands === undefined ? [] : [spec.subcommands[0] ?? ""];
      const r = run(tmp, [spec.name, ...lead, "--root", copy]);
      assert.equal(
        r.envelope.error?.code,
        "bundle-readonly",
        `${spec.name}: ${JSON.stringify(r.envelope)}`,
      );
    }
    assert.equal(treeHash(copy), before, "a refused write touched the copy");
  });

  it("a copy found by --bundle is refused the same way", () => {
    const copy = copyWith({ mode: "none" });
    const installed = join(home, ".claude", "skills", "garden");
    mkdirSync(dirname(installed), { recursive: true });
    cpSync(copy, installed, { recursive: true });
    const r = run(tmp, [...NEW, "--bundle", "garden"]);
    assert.equal(r.envelope.error?.code, "bundle-readonly", JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.details?.["root"], installed);
    rmSync(installed, { recursive: true, force: true });
  });

  it("a copy's brief is the consumer's whatever the role, and is the brief the copy carries", () => {
    const copy = copyWith({ mode: "none" });
    const installed = join(home, ".claude", "skills", "garden");
    mkdirSync(dirname(installed), { recursive: true });
    cpSync(copy, installed, { recursive: true });
    try {
      for (const argv of [
        ["brief", "--root", copy],
        ["brief", "--bundle", "garden"],
        ["brief", "--role", "maintainer", "--root", copy],
      ]) {
        const r = run(tmp, argv, "", { WIKIWRIGHT_ROLE: "writer" });
        assert.equal(r.status, 0, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
        assert.equal(r.envelope.data?.["role"], "consumer", argv.join(" "));
        const details = r.envelope.data?.["details"] as { reason?: string } | undefined;
        assert.equal(details?.reason, "installed copy");
        assert.equal(
          r.envelope.data?.["brief"],
          readFileSync(join(copy, "generated", "BRIEF.md"), "utf8"),
          `${argv.join(" ")} printed another brief than the copy carries`,
        );
      }
    } finally {
      rmSync(installed, { recursive: true, force: true });
    }
  });

  it("a marker that is not one is refused before the write guard, and before anything loads", () => {
    const copy = copyWith({ mode: "none" });
    writeFileSync(join(copy, "config", "export.json"), "{ not a marker\n");
    for (const argv of [NEW, ["search", "compost"]]) {
      const r = run(tmp, [...argv, "--root", copy]);
      assert.equal(r.status, 4, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "export-marker-invalid");
    }
  });
});
