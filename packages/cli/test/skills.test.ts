// docs/cli.md §skills (the hand-written skills are JUDGMENT ONLY and name no
// verb; the verbs live in the generated brief, and the rule-by-rule playbook is
// generated from PASS_TABLE and the fixer registry) · docs/architecture.md §The invariants (the
// no-verbs-in-prose grep, the reverse gate, and the generator guard)
// docs/cli.md §brief · docs/cli.md §The envelope (generated surfaces stay true).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PASS_TABLE } from "@wikiwright/core";
import { renderPlaybook } from "../../../tools/render-playbook.ts";
import { parseInvocation } from "../src/argv.ts";
import { WORKFLOW_SLOTS } from "../src/brief.ts";
import { COMMANDS } from "../src/commands.ts";
import { ROLE_RANK } from "../src/spec.ts";

const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));
const SKILLS = ["wikiwright-maintain", "wikiwright-write"];
const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function skillFiles(skill: string): string[] {
  return readdirSync(join(SKILLS_DIR, skill), { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".md"),
  );
}

/** The generated half of the manual: not hand-written, so not grepped for verbs. */
const GENERATED = new Set(["lint-response.md"]);

function handWritten(skill: string): string[] {
  return skillFiles(skill).filter((f) => !GENERATED.has(f.split("/").at(-1) ?? ""));
}

function mentionedVerbs(text: string): string[] {
  const verbs = new Set<string>();
  for (const m of text.matchAll(/`wikiwright ([a-z-]+)/g)) {
    const verb = m[1];
    if (verb !== undefined) verbs.add(verb);
  }
  return [...verbs];
}

describe("shipped skills exist with honest frontmatter (docs/cli.md §brief, 23)", () => {
  for (const skill of SKILLS) {
    it(`${skill}/SKILL.md exists with name and description`, () => {
      const path = join(SKILLS_DIR, skill, "SKILL.md");
      assert.equal(existsSync(path), true);
      const text = readFileSync(path, "utf8");
      assert.equal(text.startsWith("---\n"), true);
      assert.equal(text.includes(`name: ${skill}`), true);
      assert.equal(text.includes("description:"), true);
    });

    it(`${skill}/SKILL.md is at most 80 lines of judgment (docs/cli.md §skills)`, () => {
      const text = readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      const body = text.split("---\n").slice(2).join("---\n");
      const lines = body.split("\n").filter((l) => l.trim() !== "").length;
      assert.equal(lines <= 80, true, `${skill}/SKILL.md carries ${lines} non-blank lines`);
    });
  }

  it("two hand-written files replace six (docs/cli.md §skills)", () => {
    const hand = SKILLS.flatMap((s) => handWritten(s));
    assert.equal(hand.length, 2, `hand-written skill files: ${JSON.stringify(hand)}`);
  });
});

describe("the no-verbs-in-prose grep (docs/architecture.md §The invariants)", () => {
  it("no hand-written skill file names a verb", () => {
    for (const skill of SKILLS) {
      for (const file of handWritten(skill)) {
        const hits = mentionedVerbs(readFileSync(join(SKILLS_DIR, skill, file), "utf8"));
        assert.deepEqual(
          hits,
          [],
          `${skill}/${file} names ${JSON.stringify(hits)} — the verbs live in the generated brief`,
        );
      }
    }
  });

  it("each hand-written skill points at the generated brief by path", () => {
    for (const skill of SKILLS) {
      for (const file of handWritten(skill)) {
        assert.match(
          readFileSync(join(SKILLS_DIR, skill, file), "utf8"),
          /generated\/BRIEF\.md/u,
          `${skill}/${file} does not name the file that carries the verbs`,
        );
      }
    }
  });

  it("every relative markdown link inside a skill resolves to a shipped file", () => {
    for (const skill of SKILLS) {
      for (const file of skillFiles(skill)) {
        const text = readFileSync(join(SKILLS_DIR, skill, file), "utf8");
        for (const m of text.matchAll(/\]\((?!https?:)([^)#]+)\)/g)) {
          const target = m[1];
          if (target === undefined) continue;
          assert.equal(
            existsSync(join(dirname(join(SKILLS_DIR, skill, file)), target)),
            true,
            `${skill}/${file} links missing file ${target}`,
          );
        }
      }
    }
  });
});

describe("the playbook is generated, and the generator ran (docs/architecture.md §The invariants)", () => {
  it("lint-response.md is byte-identical to what the generator renders", () => {
    const found = readFileSync(join(SKILLS_DIR, "wikiwright-maintain", "lint-response.md"), "utf8");
    assert.equal(
      found,
      renderPlaybook(),
      "run `bun tools/render-playbook.ts` — the playbook has exactly one generator",
    );
  });

  it("so naming every id the binary prints is a tautology, and here is the guard", () => {
    const playbook = readFileSync(
      join(SKILLS_DIR, "wikiwright-maintain", "lint-response.md"),
      "utf8",
    );
    for (const row of PASS_TABLE) {
      assert.equal(playbook.includes(`\`${row.id}\``), true, `the playbook omits ${row.id}`);
    }
  });
});

describe("the reverse gate: every writer verb has a workflow slot (docs/architecture.md §The invariants)", () => {
  it("a writer-role verb the brief does not render fails here", () => {
    for (const command of COMMANDS) {
      if (ROLE_RANK[command.role] > ROLE_RANK.writer) continue;
      assert.notEqual(
        WORKFLOW_SLOTS[command.name],
        undefined,
        `"${command.name}" is a writer verb with no workflow slot in the brief`,
      );
    }
  });

  it("and a slot naming no verb fails too — the map is closed in both directions", () => {
    const names = new Set(COMMANDS.map((c) => c.name));
    for (const name of Object.keys(WORKFLOW_SLOTS)) {
      assert.equal(
        names.has(name),
        true,
        `the brief renders a slot for the unknown verb "${name}"`,
      );
    }
  });
});

describe("init installs the skills into the vault (docs/cli.md §brief, docs/cli.md §init)", () => {
  it("copies both skills under .claude/skills/", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-skill-"));
    try {
      const r = spawnSync(process.execPath, [CLI, "init", "--root", tmp], { encoding: "utf8" });
      assert.equal(r.status, 0);
      for (const skill of SKILLS) {
        assert.equal(existsSync(join(tmp, `.claude/skills/${skill}/SKILL.md`)), true);
      }
      // docs/cli.md §brief: the install lands the verbs beside the judgment.
      assert.equal(existsSync(join(tmp, "generated/BRIEF.md")), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * Shell-style split of a documented invocation: `<placeholder text>` becomes one
 * dummy argument BEFORE splitting (a placeholder may contain spaces), quotes
 * group words and are dropped.
 */
function tokenize(invocation: string): string[] {
  const text = invocation.replace(/<[^>]+>/g, "PLACEHOLDER");
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let inToken = false;
  for (const ch of text) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (ch === " ") {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

describe("every documented invocation is a legal invocation (docs/cli.md §skills)", () => {
  const byName = new Map(COMMANDS.map((c) => [c.name, c]));

  // The hand-written skills name no verb, so the population this gate
  // walks is the GENERATED half — the brief and the playbook — plus every
  // example the registry itself renders. A documented invocation that does not
  // parse is the same defect wherever it is written.
  it("each backticked `wikiwright …` the engine renders parses under its own parser", () => {
    let seen = 0;
    {
      const text = [
        readFileSync(join(SKILLS_DIR, "wikiwright-maintain", "lint-response.md"), "utf8"),
        // An example may carry a trailing `# comment`; the gate parses the
        // invocation, which is what an agent would run.
        ...COMMANDS.flatMap((c) => c.examples.map((e) => `\`${e.replace(/\s+#.*$/u, "")}\``)),
      ].join("\n");
      for (const m of text.matchAll(/`wikiwright ([^`]+)`/g)) {
        const invocation = m[1];
        if (invocation === undefined) continue;
        const [verb, ...rest] = tokenize(invocation);
        // `--version` and `-v` are spellings main.ts resolves to
        // the `version` verb before the registry is consulted.
        const resolved = verb === "--version" || verb === "-v" ? "version" : verb;
        const spec = resolved === undefined ? undefined : byName.get(resolved);
        assert.notEqual(spec, undefined, `unknown verb in \`wikiwright ${invocation}\``);
        if (spec === undefined) continue;
        const parsed = parseInvocation(spec, rest, COMMANDS);
        assert.equal(
          parsed.ok,
          true,
          `\`wikiwright ${invocation}\` does not parse: ${
            parsed.ok ? "" : JSON.stringify(parsed.result.envelope)
          }`,
        );
        seen += 1;
      }
    }
    assert.equal(seen > 10, true, `the gate saw the skills' invocations (${seen})`);
  });

  it("the tokenizer honors quotes and placeholders", () => {
    assert.deepEqual(tokenize('new <type> "<title>" --dest <path>'), [
      "new",
      "PLACEHOLDER",
      "PLACEHOLDER",
      "--dest",
      "PLACEHOLDER",
    ]);
    assert.deepEqual(tokenize("lint --stdin --path <would-be path>"), [
      "lint",
      "--stdin",
      "--path",
      "PLACEHOLDER",
    ]);
    assert.deepEqual(tokenize('search "Some Hub"'), ["search", "Some Hub"]);
  });
});
