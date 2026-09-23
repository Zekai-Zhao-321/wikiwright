// docs/cli.md §The plugin and its hooks: the two hook scripts, driven with
// synthetic stdin over temporary copies of the two handbooks and a temporary
// registry, and held to the shape the Claude Code hooks reference documents.
// Read on 2026-09-24 at https://code.claude.com/docs/en/hooks, the fields this
// file relies on are, on stdin, `hook_event_name`, `source` for SessionStart
// (one of "startup", "resume", "clear", "compact", "fork"), and `tool_name` and
// `tool_input.file_path` for PostToolUse; on stdout, a JSON object whose
// `hookSpecificOutput` carries `hookEventName` and `additionalContext`; and a
// plugin's hooks in `hooks/hooks.json`, a `matcher` and hooks of `"type":
// "command"` whose command may name `${CLAUDE_PLUGIN_ROOT}`. These tests hold
// the scripts to that documented shape. They do not verify what a host does
// with it: no host runs here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(PACKAGE, "dist", "main.js");
const SESSION_START = join(PACKAGE, "hooks", "session-start.mjs");
const POST_EDIT = join(PACKAGE, "hooks", "post-edit.mjs");
const HANDBOOKS = fileURLToPath(new URL("../../../fixtures/handbooks/", import.meta.url));
const ALLOTMENT_FEEDBACK = "send a proposal to the allotment handbook's maintainers";

let tmp = "";
let orchard = "";
let allotment = "";
let env: NodeJS.ProcessEnv = {};

/** One hook run: what it printed, and its exit status. */
function hook(
  script: string,
  stdin: string,
  extra: NodeJS.ProcessEnv = {},
): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, [script], {
    cwd: tmp,
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, ...env, ...extra },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "" };
}

/** The documented output, parsed and checked for its shape; returns the context text. */
function contextOf(stdout: string, event: string): string {
  const output = JSON.parse(stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(output), ["hookSpecificOutput"]);
  const specific = output["hookSpecificOutput"] as Record<string, unknown>;
  assert.deepEqual(Object.keys(specific).sort(), ["additionalContext", "hookEventName"]);
  assert.equal(specific["hookEventName"], event);
  assert.equal(typeof specific["additionalContext"], "string");
  return String(specific["additionalContext"]);
}

function edited(path: string): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path, old_string: "a", new_string: "b" },
  });
}

describe("the plugin's two hooks, against the documented shape (docs/cli.md §The plugin and its hooks)", () => {
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "ww-hooks-"));
    orchard = join(tmp, "orchard");
    allotment = join(tmp, "allotment");
    cpSync(join(HANDBOOKS, "orchard"), orchard, { recursive: true });
    cpSync(join(HANDBOOKS, "allotment"), allotment, { recursive: true });
    env = {
      WIKIWRIGHT_BUNDLES_FILE: join(tmp, "bundles.json"),
      WIKIWRIGHT_TRUST_FILE: join(tmp, "trust.json"),
    };
    // No connection yet: the first case reads an empty registry.
  });
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("session start with no connection prints nothing, and exits 0", () => {
    const r = hook(
      SESSION_START,
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  it("session start names each connected bundle and how a command names one", () => {
    for (const argv of [
      ["bundles", "add", orchard, "--name", "orchard", "--guide", "wiki/start-here.md"],
      [
        "bundles",
        "add",
        allotment,
        "--name",
        "allotment",
        "--kind",
        "installed",
        "--feedback",
        ALLOTMENT_FEEDBACK,
      ],
    ]) {
      const r = spawnSync(process.execPath, [CLI, ...argv], {
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
      assert.equal(r.status, 0, r.stdout);
    }
    const r = hook(
      SESSION_START,
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    assert.equal(r.status, 0);
    const lines = contextOf(r.stdout, "SessionStart").split("\n");
    assert.equal(lines[0], "Connected wikiwright bundles:");
    assert.match(
      lines[1] ?? "",
      /^- allotment \(installed\): allotment at no commit, no repository$/u,
    );
    assert.match(
      lines[2] ?? "",
      /^- orchard \(maintained\): orchard at no commit, no repository; read first: wiki\/start-here\.md$/u,
    );
    assert.match(lines[3] ?? "", /--bundle <name> or --root <dir>/u);
    assert.equal(lines.length, 4);
    // Context names bundles; it never carries a page's words.
    assert.doesNotMatch(r.stdout, /outward-facing bud|How to use this handbook/u);
  });

  it("after a compaction or a resume, the block says it re-establishes them", () => {
    for (const source of ["compact", "resume"]) {
      const r = hook(SESSION_START, JSON.stringify({ hook_event_name: "SessionStart", source }));
      const [first] = contextOf(r.stdout, "SessionStart").split("\n");
      assert.equal(
        first,
        "Re-establishing the connected wikiwright bundles from their current state:",
      );
    }
  });

  it("a malformed stdin exits 0 and prints nothing, for either script", () => {
    for (const script of [SESSION_START, POST_EDIT]) {
      for (const stdin of ["", "not json", "null", "[1, 2]"]) {
        const r = hook(script, stdin);
        assert.equal(r.status, 0, `${script} on ${JSON.stringify(stdin)}`);
        assert.equal(r.stdout, "", `${script} on ${JSON.stringify(stdin)}`);
      }
    }
  });

  it("a script whose binary is missing prints nothing and exits 0", () => {
    // Each script resolves the engine as ../dist/bin.js beside itself.
    const bare = join(tmp, "bare-plugin", "hooks");
    mkdirSync(bare, { recursive: true });
    for (const [script, stdin] of [
      [SESSION_START, JSON.stringify({ hook_event_name: "SessionStart", source: "startup" })],
      [POST_EDIT, edited(join(orchard, "wiki", "pruning-roses.md"))],
    ] as const) {
      const copy = join(bare, script.split("/").at(-1) ?? "");
      cpSync(script, copy);
      const r = hook(copy, stdin);
      assert.equal(r.status, 0, copy);
      assert.equal(r.stdout, "", copy);
    }
  });

  it("an edit outside every connection prints nothing", () => {
    const outside = join(tmp, "notes.md");
    appendFileSync(outside, "# notes\n");
    const r = hook(POST_EDIT, edited(outside));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    // Inside a bundle's root but outside its content roots is outside too.
    const config = hook(POST_EDIT, edited(join(orchard, "config", "engine.json")));
    assert.equal(config.stdout, "");
  });

  it("an edit to an installed copy's page says it is read only and where a change goes", () => {
    const text = contextOf(
      hook(POST_EDIT, edited(join(allotment, "wiki", "pruning-roses.md"))).stdout,
      "PostToolUse",
    );
    assert.match(
      text,
      /^wikiwright: wiki\/pruning-roses\.md is a page of the bundle "allotment"\./u,
    );
    assert.match(text, /installed copy, which is read only/u);
    assert.match(text, new RegExp(ALLOTMENT_FEEDBACK.replace(/'/gu, "."), "u"));
  });

  it("a consumer session is told its role may not write the bundle", () => {
    const text = contextOf(
      hook(POST_EDIT, edited(join(orchard, "wiki", "pruning-roses.md")), {
        WIKIWRIGHT_ROLE: "consumer",
      }).stdout,
      "PostToolUse",
    );
    assert.match(text, /This session's role may not write this bundle\./u);
  });

  it("a maintained page is linted: the count, each rule with its route, and what it was not", () => {
    const clean = contextOf(
      hook(POST_EDIT, edited(join(orchard, "wiki", "pruning-roses.md"))).stdout,
      "PostToolUse",
    );
    assert.match(clean, /^0 finding\(s\) on the page:$/mu);

    // A tag the handbook does not register, planted in the copy's page.
    const planted = join(orchard, "wiki", "thinning-apples.md");
    writeFileSync(
      planted,
      readFileSync(planted, "utf8").replace("tags: [fruit]", "tags: [fruit, pears]"),
    );
    const text = contextOf(hook(POST_EDIT, edited(planted)).stdout, "PostToolUse");
    assert.match(text, /^1 finding\(s\) on the page:$/mu);
    assert.match(text, /^- unknown-tag line 5: unknown tag "pears" — queue: tag-review$/mu);
    assert.match(
      text,
      /This judged the working-tree page against the bundle's current law; it is not the staged gate's verdict\.$/u,
    );
  });

  it("the manifest names the package's version, and each hook names a script that ships", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      version: string;
      files: string[];
    };
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, ".claude-plugin", "plugin.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(Object.keys(manifest).sort(), ["description", "license", "name", "version"]);
    assert.equal(manifest["name"], "wikiwright");
    assert.equal(manifest["version"], pkg.version);
    assert.equal(manifest["license"], "MIT");
    for (const shipped of [".claude-plugin", "hooks", "skills"]) {
      assert.equal(pkg.files.includes(shipped), true, `package.json files carries ${shipped}`);
    }
    const hooks = JSON.parse(readFileSync(join(PACKAGE, "hooks", "hooks.json"), "utf8")) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
    };
    assert.deepEqual(Object.keys(hooks.hooks).sort(), ["PostToolUse", "SessionStart"]);
    assert.equal(hooks.hooks["SessionStart"]?.[0]?.matcher, undefined);
    assert.equal(hooks.hooks["PostToolUse"]?.[0]?.matcher, "Edit|Write");
    for (const entries of Object.values(hooks.hooks)) {
      for (const entry of entries) {
        for (const command of entry.hooks) {
          assert.equal(command.type, "command");
          const script = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks\/[a-z-]+\.mjs)"$/u.exec(
            command.command,
          )?.[1];
          assert.ok(script !== undefined, command.command);
          assert.equal(existsSync(join(PACKAGE, script)), true, script);
        }
      }
    }
  });
});
