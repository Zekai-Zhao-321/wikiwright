// docs/skills (the write and maintain skills are JUDGMENT ONLY and name no
// verb; the consume skill names the reader's commands, each of which must
// parse; the rest of the verbs live in the generated brief, and the
// code-by-code playbook is generated from the verdict table) ·
// docs/architecture.md §The invariants (the no-verbs-in-prose grep and the
// generator guard).

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERDICT_TABLE } from "@wikiwright/core";
import { renderPlaybook } from "../../../tools/render-playbook.ts";
import { parseInvocation } from "../src/argv.ts";
import { COMMANDS } from "../src/commands.ts";

const SKILLS_DIR = fileURLToPath(new URL("../../../docs/skills", import.meta.url));
const SKILLS = ["wikiwright-consume", "wikiwright-maintain", "wikiwright-write"];
const PLAYBOOK = join(SKILLS_DIR, "wikiwright-maintain", "finding-response.md");

function skillFiles(skill: string): string[] {
  return readdirSync(join(SKILLS_DIR, skill), { recursive: true, encoding: "utf8" }).filter((f) =>
    f.endsWith(".md"),
  );
}

/** The generated half of the manual: not hand-written, so not grepped for verbs. */
const GENERATED = new Set(["finding-response.md"]);

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

describe("the three skill documents (docs/skills)", () => {
  for (const skill of SKILLS) {
    it(`${skill}/SKILL.md exists with name and description`, () => {
      const path = join(SKILLS_DIR, skill, "SKILL.md");
      assert.equal(existsSync(path), true);
      const text = readFileSync(path, "utf8");
      assert.equal(text.startsWith("---\n"), true);
      assert.equal(text.includes(`name: ${skill}`), true);
      assert.equal(text.includes("description:"), true);
    });

    it(`${skill}/SKILL.md stays short`, () => {
      const text = readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      const body = text.split("---\n").slice(2).join("---\n");
      const lines = body.split("\n").filter((l) => l.trim() !== "").length;
      // The reader's skill carries the setup and the commands: 100 lines; the
      // judgment of the other two keeps its 80.
      const bound = skill === "wikiwright-consume" ? 100 : 80;
      assert.equal(lines <= bound, true, `${skill}/SKILL.md carries ${lines} non-blank lines`);
    });
  }

  it("three hand-written files, one for each way of working with a bundle", () => {
    assert.deepEqual(readdirSync(SKILLS_DIR).sort(), SKILLS);
    const hand = SKILLS.flatMap((s) => handWritten(s));
    assert.equal(hand.length, 3, `hand-written skill files: ${JSON.stringify(hand)}`);
    // Each description opens on its own work, so reading, writing and
    // maintaining a bundle each call for one skill and not the others.
    const openings = SKILLS.map((skill) => {
      const text = readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      return /^description: Judgment for ([a-z]+) /mu.exec(text)?.[1];
    });
    assert.deepEqual(openings, ["using", "maintaining", "writing"]);
  });

  it("each skill distinguishes governed decisions from source inspection once", () => {
    for (const skill of SKILLS) {
      const text = readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      const count =
        text.split(
          "Use the engine for governed decisions; use your own tools to inspect source context.",
        ).length - 1;
      assert.equal(count, 1, skill);
    }
  });

  it("the write skill is called for a session that began writing part-way through another task", () => {
    const text = readFileSync(join(SKILLS_DIR, "wikiwright-write", "SKILL.md"), "utf8");
    const description = /^description: (.*)$/mu.exec(text)?.[1] ?? "";
    assert.match(
      description,
      /a session that has begun writing pages part-way through another task/u,
    );
  });

  it("the consume skill is the reader's: setup first, then the commands and their discipline", () => {
    const text = readFileSync(join(SKILLS_DIR, "wikiwright-consume", "SKILL.md"), "utf8");
    // The engine runs from the caller's directory, never the clone's.
    assert.match(text, /`bun <clone>\/packages\/cli\/dist\/main\.js`/u);
    assert.match(text, /Never `cd` into the clone/u);
    // The one route that exists, and that no published package does.
    assert.match(text, /no published package exists yet/u);
    for (const step of ["`bun install`", "`bun run build`"]) {
      assert.equal(text.includes(step), true, `the setup names ${step}`);
    }
    const headings = [...text.matchAll(/^## (.+)$/gmu)].map((m) => m[1]);
    assert.deepEqual(headings.slice(0, 4), [
      "1. Setup",
      "2. The commands, and the discipline",
      "3. A problem with the knowledge is a proposal",
      "4. Without the engine",
    ]);
    assert.match(
      text,
      /Which bundle an answer came from, and at which version, is part of the answer/u,
    );
    // v2 contracts §9.5: a reader is shown a page's status.
    assert.match(text, /Read each page's `status`/u);
    assert.match(text, /## Loading this skill grants nothing/u);
  });
});

/**
 * The verbs a hand-written skill may name: the reader's skill names the
 * reader's commands; the other two name none, and point at the brief.
 */
const NAMED: Readonly<Record<string, readonly string[]>> = {
  "wikiwright-consume": ["read", "search", "type", "version"],
  "wikiwright-maintain": [],
  "wikiwright-write": [],
};

describe("the no-verbs-in-prose grep (docs/architecture.md §The invariants)", () => {
  it("no hand-written skill file names a verb beyond the ones it is for", () => {
    for (const skill of SKILLS) {
      for (const file of handWritten(skill)) {
        const hits = mentionedVerbs(readFileSync(join(SKILLS_DIR, skill, file), "utf8")).filter(
          (verb) => !(NAMED[skill] ?? []).includes(verb),
        );
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

  it("every relative markdown link inside a skill resolves to a file beside it", () => {
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
  it("finding-response.md is byte-identical to what the generator renders", () => {
    assert.equal(
      readFileSync(PLAYBOOK, "utf8"),
      renderPlaybook(),
      "run `bun tools/render-playbook.ts` — the playbook has exactly one generator",
    );
  });

  it("so naming every code the binary prints is a tautology, and here is the guard", () => {
    const playbook = readFileSync(PLAYBOOK, "utf8");
    for (const row of VERDICT_TABLE) {
      assert.equal(playbook.includes(`\`${row.id}\``), true, `the playbook omits ${row.id}`);
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

describe("every documented invocation is a legal invocation (docs/skills)", () => {
  const byName = new Map(COMMANDS.map((c) => [c.name, c]));

  // The population this gate walks: the playbook, the hand-written skills that
  // name a verb, and every example the registry itself renders. A documented
  // invocation that does not parse is the same defect wherever it is written.
  it("each backticked `wikiwright …` parses under the parser", () => {
    let seen = 0;
    const text = [
      readFileSync(PLAYBOOK, "utf8"),
      ...SKILLS.map((skill) => readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf8")),
      // An example may carry a trailing `# comment`; the gate parses the
      // invocation, which is what an agent would run.
      ...COMMANDS.flatMap((c) => c.examples.map((e) => `\`${e.replace(/\s+#.*$/u, "")}\``)),
    ].join("\n");
    for (const m of text.matchAll(/`wikiwright ([^`]+)`/g)) {
      const invocation = m[1];
      if (invocation === undefined) continue;
      const [verb, ...rest] = tokenize(invocation);
      // `--version` and `-v` are spellings main.ts resolves to the `version`
      // verb before the registry is consulted.
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
    assert.equal(seen > 10, true, `the gate saw the documented invocations (${seen})`);
  });

  it("the tokenizer honors quotes and placeholders", () => {
    assert.deepEqual(tokenize('write --from "<drafts dir>" --root <dir>'), [
      "write",
      "--from",
      "PLACEHOLDER",
      "--root",
      "PLACEHOLDER",
    ]);
  });
});
