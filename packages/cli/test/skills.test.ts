// docs/cli.md §skills (the write and maintain skills are JUDGMENT ONLY and name
// no verb; the consume skill is the runtime skill a bundle skill requires and
// names the consumer's commands, each of which must parse; the rest of the
// verbs live in the generated brief, and the rule-by-rule playbook is
// generated from PASS_TABLE and the fixer registry) · docs/architecture.md §The invariants (the
// no-verbs-in-prose grep, the reverse gate, and the generator guard)
// docs/cli.md §brief · docs/cli.md §The envelope (generated surfaces stay true).

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PASS_TABLE } from "@wikiwright/core";
import { renderPlaybook } from "../../../tools/render-playbook.ts";

const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));
const SKILLS = ["wikiwright-consume", "wikiwright-maintain", "wikiwright-write"];

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

    it(`${skill}/SKILL.md stays short (docs/cli.md §skills)`, () => {
      const text = readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      if (skill === "wikiwright-consume") {
        // The runtime skill carries the setup and the commands every bundle
        // skill leaves to it: under 200 lines, the whole file.
        const lines = text.split("\n").length;
        assert.equal(lines < 200, true, `${skill}/SKILL.md is ${lines} lines`);
        return;
      }
      // The maintain skill's export practices are a section of their own,
      // under 60 lines; the judgment around them keeps its 80.
      const exporting = /^## Exporting[^\n]*\n[\s\S]*?(?=^## )/mu.exec(text)?.[0] ?? "";
      if (skill === "wikiwright-maintain") {
        assert.notEqual(exporting, "", "the maintain skill has its export practices");
        const section = exporting.split("\n").length;
        assert.equal(section < 60, true, `the export practices are ${section} lines`);
      }
      const body = text.replace(exporting, "").split("---\n").slice(2).join("---\n");
      const lines = body.split("\n").filter((l) => l.trim() !== "").length;
      assert.equal(lines <= 80, true, `${skill}/SKILL.md carries ${lines} non-blank lines`);
    });
  }

  it("three hand-written files replace six (docs/cli.md §skills)", () => {
    const hand = SKILLS.flatMap((s) => handWritten(s));
    assert.equal(hand.length, 3, `hand-written skill files: ${JSON.stringify(hand)}`);
  });

  it("the shipped skills are these three, one for each way of working with a bundle", () => {
    assert.deepEqual(readdirSync(SKILLS_DIR).sort(), SKILLS);
    // Each description opens on its own work, so reading, writing and
    // maintaining a bundle each call for one skill and not the others.
    const openings = SKILLS.map((skill) => {
      const text = readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      return /^description: Judgment for ([a-z]+) /mu.exec(text)?.[1];
    });
    assert.deepEqual(openings, ["using", "maintaining", "writing"]);
  });

  it("each skill states the principle once: the engine to decide, write and attribute; your own tools to look", () => {
    for (const skill of SKILLS) {
      const text = readFileSync(join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
      const count =
        text.split(
          "Use the engine to decide, to write and to attribute; use your own tools to look.",
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

  it("the consume skill is the runtime skill: setup first, the brief is the engine's to print", () => {
    const text = readFileSync(join(SKILLS_DIR, "wikiwright-consume", "SKILL.md"), "utf8");
    assert.match(text, /generated\/BRIEF\.md/u);
    assert.match(
      text,
      /the engine prints that same brief\s+for it from the copy's directory, named by `--root`/u,
    );
    // The engine runs from the caller's directory, never the clone's.
    assert.match(text, /`bun <clone>\/packages\/cli\/dist\/main\.js`/u);
    assert.match(text, /Never `cd` into the clone/u);
    // The one route that exists, and that no published package does.
    assert.match(text, /no published package exists yet/u);
    for (const step of ["`bun install`", "`bun run build`"]) {
      assert.equal(text.includes(step), true, `the setup names ${step}`);
    }
    const headings = [...text.matchAll(/^## (.+)$/gmu)].map((m) => m[1]);
    assert.deepEqual(headings.slice(0, 5), [
      "1. Setup",
      "2. What a bundle skill is",
      "3. The commands, and the discipline",
      "4. A problem with the knowledge is a proposal",
      "5. Without the engine",
    ]);
    assert.doesNotMatch(text, /connected/u);
    assert.match(
      text,
      /Which bundle an answer came from, and at which version, is part of the answer/u,
    );
    assert.match(text, /## Loading this skill grants nothing/u);
  });
});

/**
 * The verbs a hand-written skill may name. The runtime skill names the
 * consumer's commands, since a bundle skill leaves them to it; the maintain
 * skill's export practices name `export`; the rest live in the generated brief.
 */

describe("the maintain skill's export practices (docs/cli.md §skills)", () => {
  it("say which output fits, that an external export is no redaction boundary, and what to review", () => {
    const text = readFileSync(join(SKILLS_DIR, "wikiwright-maintain", "SKILL.md"), "utf8");
    for (const said of [
      "`output: skills`",
      "`output: external`",
      "**An external export is not a redaction boundary.**",
      "the configuration is copied verbatim",
      "`wikiwright export <name> --to <dir> --dry-run`",
      "port it into the source by hand",
      "a reason to refuse the export, never to rewrite the\nconfiguration",
    ]) {
      assert.equal(text.includes(said), true, said);
    }
  });
});

describe("the skills point at the brief (docs/architecture.md §The invariants)", () => {
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
