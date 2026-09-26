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

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUN, runCli } from "./fixtures/runtime.ts";

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const CLI = join(PACKAGE, "dist", "main.js");
const SESSION_START = join(PACKAGE, "hooks", "session-start.mjs");
const POST_EDIT = join(PACKAGE, "hooks", "post-edit.mjs");
const HANDBOOKS = fileURLToPath(new URL("../../../fixtures/v1/handbooks/", import.meta.url));

let tmp = "";
let orchard = "";
let home = "";
let env: NodeJS.ProcessEnv = {};

/** One hook run: what it printed, and its exit status. */
function hook(
  script: string,
  stdin: string,
  extra: NodeJS.ProcessEnv = {},
): { status: number; stdout: string } {
  const r = runCli([script], {
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

/** The engine itself, under the hooks' environment. */
function cli(argv: readonly string[]): { status: number; stdout: string } {
  const r = runCli([CLI, ...argv], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "" };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** A copy of the orchard handbook under the test's directory, as `name`: nothing registers it. */
function handbookCopy(name: string): string {
  const root = join(tmp, name);
  cpSync(join(HANDBOOKS, "orchard"), root, { recursive: true });
  return root;
}

/** A page with one fix-routed finding: its Notes heading one level too deep. */
function withDeepNotes(text: string): string {
  return text.replace("## Notes", "### Notes");
}

function edited(path: string): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path, old_string: "a", new_string: "b" },
  });
}

describe("the plugin's two hooks, against the documented shape (docs/cli.md §The plugin and its hooks)", () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "ww-hooks-"));
    // The session-start scan's project tier stops at the top of this repository.
    git(tmp, "init", "-q");
    orchard = join(tmp, "orchard");
    cpSync(join(HANDBOOKS, "orchard"), orchard, { recursive: true });
    // A home of the test's own: the scan reads no skill directory of the
    // developer's. Nothing is installed yet: the first case reads an empty scan.
    home = join(tmp, "home");
    mkdirSync(home);
    env = { HOME: home, WIKIWRIGHT_SKILL_DIRS: "" };
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("session start with no bundle skill installed prints nothing, and exits 0", () => {
    const r = hook(
      SESSION_START,
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  it("session start names each installed bundle skill with the action that fits how it was installed", () => {
    const skills = join(home, ".claude", "skills");
    /** A handbook's export copied into the skill directory, its SKILL.md frontmatter given `recorded`. */
    const install = (handbook: string, name: string, recorded: string): void => {
      const at = join(skills, name);
      cpSync(join(HANDBOOKS, handbook, "skills", name), at, { recursive: true });
      const skill = join(at, "SKILL.md");
      writeFileSync(
        skill,
        readFileSync(skill, "utf8").replace(
          `---\nname: ${name}\n`,
          `---\nname: ${name}\n${recorded}`,
        ),
      );
    };
    // What an installer records, whatever it calls it: a repository and a
    // tree for one that tracks a branch, a tag for one that is pinned, and
    // nothing for a copy made by hand.
    install(
      "allotment",
      "allotment",
      "source-repository: https://example.invalid/allotment\ntree: 0123456789abcdef0123456789abcdef01234567\n",
    );
    install(
      "orchard",
      "orchard",
      "source-repository: https://example.invalid/orchard\nref: v1.4.0\n",
    );
    install("orchard", "orchard-pruning", "");
    // A link into a checkout of the handbook: its own gate keeps it current.
    const checkout = join(tmp, "orchard-checkout");
    cpSync(join(HANDBOOKS, "allotment"), checkout, { recursive: true });
    mkdirSync(join(home, ".agents", "skills"), { recursive: true });
    symlinkSync(
      join(checkout, "skills", "allotment"),
      join(home, ".agents", "skills", "allotment"),
    );
    const r = hook(
      SESSION_START,
      JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
    );
    assert.equal(r.status, 0);
    assert.deepEqual(contextOf(r.stdout, "SessionStart").split("\n"), [
      "Installed wikiwright bundle skills:",
      "- allotment: the bundle allotment, user tier; update with `gh skill update allotment`",
      "- orchard: the bundle orchard, user tier; pinned at ref v1.4.0",
      "- orchard-pruning: the bundle orchard, user tier; installed by hand; `gh skill install` makes it updatable",
      "- allotment: the bundle allotment, user tier; linked to a local checkout; the checkout's own gate keeps it current",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the host's variable, named literally
      "A wikiwright command names one with --bundle <name>, or, from within its skill, with --root ${CLAUDE_SKILL_DIR}.",
    ]);
    // Context names bundles; it never carries a page's words or a digest.
    assert.doesNotMatch(r.stdout, /outward-facing bud|How to use this handbook|[0-9a-f]{64}/u);
  });

  it("after a compaction or a resume, the block says it re-establishes them", () => {
    for (const source of ["compact", "resume"]) {
      const r = hook(SESSION_START, JSON.stringify({ hook_event_name: "SessionStart", source }));
      const [first] = contextOf(r.stdout, "SessionStart").split("\n");
      assert.equal(
        first,
        "Re-establishing the installed wikiwright bundle skills from their current state:",
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

  it("an edit outside every bundle prints nothing", () => {
    const outside = join(tmp, "notes.md");
    appendFileSync(outside, "# notes\n");
    const r = hook(POST_EDIT, edited(outside));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    // Inside a bundle's root but outside its content roots is outside too.
    const config = hook(POST_EDIT, edited(join(orchard, "config", "engine.json")));
    assert.equal(config.stdout, "");
  });

  it("an edit in an installed copy says so, that the next update overwrites it, and where a change goes; it lints nothing", () => {
    // The handbook's rendered export is a copy: its nearest constitution is the
    // copy's own, beside its marker.
    const text = contextOf(
      hook(POST_EDIT, edited(join(orchard, "skills", "orchard", "wiki", "pruning-roses.md")))
        .stdout,
      "PostToolUse",
    );
    assert.equal(
      text,
      "wikiwright: this is an installed copy of orchard; edits here are overwritten by the next update; this copy takes no reports.",
    );
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
          const script = /^bun "\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks\/[a-z-]+\.mjs)"$/u.exec(
            command.command,
          )?.[1];
          assert.ok(script !== undefined, command.command);
          assert.equal(existsSync(join(PACKAGE, script)), true, script);
        }
      }
    }
  });

  it("an edit a transition law governs names the pass not judged here; the staged gate refuses it", () => {
    // The page's type declares an append-only body. A page linted alone has no
    // base, so the lint cannot judge the law, and says so in `unevaluated`.
    const root = join(tmp, "ledger");
    cpSync(join(HANDBOOKS, "orchard"), root, { recursive: true });
    const constitution = join(root, "config", "constitution.json");
    const law = JSON.parse(readFileSync(constitution, "utf8")) as {
      types: Record<string, Record<string, unknown>>;
    };
    const type = law.types["procedure-page"];
    assert.ok(type !== undefined);
    type["body"] = { lifecycle: "append-only" };
    writeFileSync(constitution, `${JSON.stringify(law, null, 2)}\n`);
    assert.equal(cli(["check", "--write", "--root", root]).status, 0);
    git(root, "init", "-q");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "baseline");

    const page = join(root, "wiki", "pruning-roses.md");
    writeFileSync(
      page,
      readFileSync(page, "utf8").replace(
        "Remove dead, diseased and damaged stems",
        "Remove dead and damaged stems",
      ),
    );
    const text = contextOf(hook(POST_EDIT, edited(page)).stdout, "PostToolUse");
    const lines = text.split("\n");
    assert.deepEqual(lines.slice(1), [
      "0 finding(s) on the page:",
      "not evaluated here: body-append-only (1 declaration(s), no-base)",
      "The staged gate judges these against HEAD, so an edit to an append-only body can pass here and be refused at commit.",
      "This judged the working-tree page against the bundle's current law; it is not the staged gate's verdict.",
    ]);

    // What the hook said the gate would do, it does.
    git(root, "add", "-A");
    const staged = cli(["lint", "--staged", "--root", root]);
    assert.equal(staged.status, 5, staged.stdout);
    const envelope = JSON.parse(staged.stdout) as {
      data: { findings: { ruleId: string; path: string }[] };
    };
    // The page is exported by both of the handbook's exports, whose rendered
    // copies were staged before the edit: the gate refuses those as stale too.
    assert.deepEqual(
      envelope.data.findings.filter((f) => f.ruleId !== "export-stale").map((f) => f.ruleId),
      ["body-append-only"],
    );
    assert.deepEqual(
      envelope.data.findings
        .filter((f) => f.ruleId === "export-stale")
        .map((f) => f.path)
        .sort(),
      ["skills/orchard", "skills/orchard-pruning"],
    );
  });

  it("a fix on a page whose path has a space is one argument, and replays as printed", () => {
    const root = handbookCopy("spaced");
    const page = join(root, "wiki", "pruning roses.md");
    writeFileSync(
      page,
      withDeepNotes(readFileSync(join(root, "wiki", "pruning-roses.md"), "utf8")),
    );
    const text = contextOf(hook(POST_EDIT, edited(page)).stdout, "PostToolUse");
    const suggestion = /— fix: (wikiwright .*)$/mu.exec(text)?.[1];
    assert.equal(
      suggestion,
      `wikiwright fix --rule section-depth --path 'wiki/pruning roses.md' --line 24 --expect 1 --root ${realpathSync(root)}`,
    );
    // Replayed through a POSIX shell exactly as printed, the engine in place of
    // the command name: the dry run plans the one fix on the one page.
    const command = `${suggestion.replace(/^wikiwright /u, `'${BUN}' '${CLI}' `)} --dry-run`;
    // The envelope goes to a file, never through the pipe the test reads.
    const envelopeFile = join(tmp, "replayed.json");
    const r = spawnSync("sh", ["-c", `${command} > '${envelopeFile}'`], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    const replayed = readFileSync(envelopeFile, "utf8");
    assert.equal(r.status, 0, `${command}\n${replayed}${r.stderr}`);
    const planned = JSON.parse(replayed) as { ok: boolean; data: { ops: { path?: string }[] } };
    assert.equal(planned.ok, true);
    assert.deepEqual(
      planned.data.ops.map((op) => op.path),
      ["wiki/pruning roses.md"],
    );
  });

  it("an engine.json that starts with a byte order mark still routes the page", () => {
    const root = handbookCopy("marked");
    const engine = join(root, "config", "engine.json");
    writeFileSync(engine, `\ufeff${readFileSync(engine, "utf8")}`);
    const page = join(root, "wiki", "pruning-roses.md");
    writeFileSync(page, withDeepNotes(readFileSync(page, "utf8")));
    // The hook's own stdin may carry one too.
    const text = contextOf(hook(POST_EDIT, `\ufeff${edited(page)}`).stdout, "PostToolUse");
    assert.match(
      text,
      /^wikiwright: wiki\/pruning-roses\.md is a page of the bundle "marked"\.$/mu,
    );
    assert.match(text, /^1 finding\(s\) on the page:$/mu);
    assert.match(
      text,
      /^- section-depth line 24: .* — fix: wikiwright fix --rule section-depth /mu,
    );
  });

  it("a page that is a link inside the vault is routed by the path it was edited at", () => {
    // wiki/pruning-roses.md links to archive/, outside the content roots but
    // inside the vault: the engine judges it at the wiki path, and so does the hook.
    const root = handbookCopy("linked");
    mkdirSync(join(root, "archive"), { recursive: true });
    const target = join(root, "archive", "pruning-roses.md");
    writeFileSync(
      target,
      withDeepNotes(readFileSync(join(root, "wiki", "pruning-roses.md"), "utf8")),
    );
    rmSync(join(root, "wiki", "pruning-roses.md"));
    symlinkSync(join("..", "archive", "pruning-roses.md"), join(root, "wiki", "pruning-roses.md"));
    const text = contextOf(
      hook(POST_EDIT, edited(join(root, "wiki", "pruning-roses.md"))).stdout,
      "PostToolUse",
    );
    assert.match(
      text,
      /^wikiwright: wiki\/pruning-roses\.md is a page of the bundle "linked"\.$/mu,
    );
    assert.match(
      text,
      /^- section-depth line 24: .* --path wiki\/pruning-roses\.md --line 24 --expect 1 --root \S+$/mu,
    );
    // The archive file itself is under no content root: nothing to say.
    assert.equal(hook(POST_EDIT, edited(target)).stdout, "");
  });

  it("a page linked out of the vault gets nothing", () => {
    const root = handbookCopy("escaping");
    const outside = join(tmp, "outside-page.md");
    writeFileSync(
      outside,
      withDeepNotes(readFileSync(join(root, "wiki", "pruning-roses.md"), "utf8")),
    );
    symlinkSync(outside, join(root, "wiki", "elsewhere.md"));
    const r = hook(POST_EDIT, edited(join(root, "wiki", "elsewhere.md")));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  it("an edit through a linked bundle root is routed to that bundle", () => {
    const root = handbookCopy("reached");
    const page = join(root, "wiki", "pruning-roses.md");
    writeFileSync(page, withDeepNotes(readFileSync(page, "utf8")));
    const link = join(tmp, "reached-link");
    symlinkSync(root, link);
    const text = contextOf(
      hook(POST_EDIT, edited(join(link, "wiki", "pruning-roses.md"))).stdout,
      "PostToolUse",
    );
    assert.match(
      text,
      /^wikiwright: wiki\/pruning-roses\.md is a page of the bundle "reached"\.$/mu,
    );
    assert.match(text, /^1 finding\(s\) on the page:$/mu);
  });

  it("an edit through a root alias into a linked content directory is routed by its wiki path", () => {
    // wiki/ is a link to archive/ inside the vault, and the edit names the page
    // through a link to the root: the root is found among the edited path's
    // ancestors, and the path below it stays the one the engine judges.
    const root = handbookCopy("composed");
    renameSync(join(root, "wiki"), join(root, "archive"));
    symlinkSync("archive", join(root, "wiki"));
    const page = join(root, "archive", "pruning-roses.md");
    writeFileSync(page, withDeepNotes(readFileSync(page, "utf8")));
    const alias = join(tmp, "composed-alias");
    symlinkSync(root, alias);
    const text = contextOf(
      hook(POST_EDIT, edited(join(alias, "wiki", "pruning-roses.md"))).stdout,
      "PostToolUse",
    );
    assert.match(
      text,
      /^wikiwright: wiki\/pruning-roses\.md is a page of the bundle "composed"\.$/mu,
    );
    assert.match(
      text,
      /^- section-depth line 24: .* --path wiki\/pruning-roses\.md --line 24 --expect 1 --root \S+$/mu,
    );
    // The same page through the root's own path, and through the alias under
    // archive/, which no content root names.
    assert.match(
      contextOf(
        hook(POST_EDIT, edited(join(root, "wiki", "pruning-roses.md"))).stdout,
        "PostToolUse",
      ),
      /^1 finding\(s\) on the page:$/mu,
    );
    assert.equal(hook(POST_EDIT, edited(join(alias, "archive", "pruning-roses.md"))).stdout, "");
  });

  it("a config linked out of the vault is refused by the engine, and the hook says the page could not be judged", () => {
    // The engine refuses to read a config/engine.json that resolves outside
    // the vault; the hook finds the bundle by its constitution and passes the
    // engine's refusal on by its code.
    const root = handbookCopy("unconfined");
    const config = join(root, "config", "engine.json");
    const outside = join(tmp, "outside-engine.json");
    cpSync(config, outside);
    rmSync(config);
    symlinkSync(outside, config);
    const page = join(root, "wiki", "pruning-roses.md");
    const engine = JSON.parse(
      cli(["lint", "--page", "wiki/pruning-roses.md", "--root", root]).stdout,
    ) as {
      error: { code: string };
    };
    const text = contextOf(hook(POST_EDIT, edited(page)).stdout, "PostToolUse");
    assert.equal(engine.error.code, "linked-outside-vault");
    assert.equal(text.split("\n")[1], "The page could not be judged: linked-outside-vault.");
  });
});
