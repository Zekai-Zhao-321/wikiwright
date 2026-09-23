// docs/cli.md §brief: `brief` is a consumer verb, so every role may print its own
// brief, and "The loop" is the role's: the consumer's names no verb and its
// verb list holds no writing verb, the writer's is the five steps it has always
// been, and the maintainer's is the writer's five and two more.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";
import { ROLE_RANK } from "../src/spec.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

/** The writer's loop as the brief printed it before the loop depended on the role. */
const WRITER_LOOP = [
  "1. `search` every name form, in both scripts, before you create anything.",
  "2. `type show <type> --brief` — the contract, with live counts.",
  "3. Draft the Markdown, then `write <path> --dry-run` and read the findings.",
  "4. `write` for real; the engine stamps the dates and writes the History line.",
  "5. Commit. The gate runs the same judge over what the commit would contain.",
];

const MAINTAINER_EXTRA = [
  "6. A finding with `queue` is a judgment: adjudicate it or change the law, and never lower a severity to quiet it.",
  "7. Commit `generated/` with the pages it describes.",
];

/** The brief a role prints over the minimal fixture, under a session of that role. */
function briefOf(role: string): { status: number; text: string } {
  const r = spawnSync(process.execPath, [CLI, "brief", "--role", role, "--root", FIXTURE], {
    encoding: "utf8",
    env: { ...process.env, WIKIWRIGHT_ROLE: role },
  });
  const envelope = JSON.parse(r.stdout) as { data?: { brief?: string } };
  return { status: r.status ?? -1, text: envelope.data?.brief ?? "" };
}

/** The lines of one `## ` section, without its heading and blank lines. */
function section(text: string, heading: string): string[] {
  const lines = text.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `the brief has no "## ${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line !== "");
}

/** The verbs a `## Verbs` section renders, by their `### \`name\`` headings. */
function listedVerbs(text: string): string[] {
  return section(text, "Verbs")
    .map((line) => /^### `([^`]+)`/u.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

describe("every role prints its own brief (docs/cli.md §brief)", () => {
  let consumer = { status: -1, text: "" };
  before(() => {
    consumer = briefOf("consumer");
  });

  it("a consumer session prints the consumer's brief", () => {
    assert.equal(consumer.status, 0, consumer.text);
    assert.match(consumer.text, /^# wikiwright — the consumer's brief$/mu);
  });

  it("the consumer's verb list holds no writing verb, and only verbs a consumer may run", () => {
    const listed = listedVerbs(consumer.text);
    const writing = COMMANDS.filter((c) => c.writes).map((c) => c.name);
    assert.deepEqual(
      listed.filter((name) => writing.includes(name)),
      [],
    );
    assert.deepEqual(
      listed,
      COMMANDS.filter((c) => c.role === "consumer")
        .map((c) => c.name)
        .sort(),
    );
    assert.equal(listed.includes("brief"), true, "the consumer's list names the brief itself");
  });

  it("the consumer's loop names no verb above the consumer's rank as a command", () => {
    const loop = section(consumer.text, "The loop");
    assert.equal(loop.length, 5, loop.join("\n"));
    const above = COMMANDS.filter((c) => ROLE_RANK[c.role] > ROLE_RANK.consumer).map((c) => c.name);
    for (const name of ["write", "new", "fix", "check"]) assert.ok(above.includes(name), name);
    for (const name of above) {
      const named = loop.filter((line) => new RegExp(`\`${name}[\\s\`]`, "u").test(line));
      assert.deepEqual(named, [], `the consumer's loop names \`${name}\``);
    }
  });

  it("the writer's loop is the five steps, verbatim", () => {
    const writer = briefOf("writer");
    assert.equal(writer.status, 0, writer.text);
    assert.deepEqual(section(writer.text, "The loop"), WRITER_LOOP);
  });

  it("the maintainer's loop is the writer's five, then two more", () => {
    const maintainer = briefOf("maintainer");
    assert.equal(maintainer.status, 0, maintainer.text);
    assert.deepEqual(section(maintainer.text, "The loop"), [...WRITER_LOOP, ...MAINTAINER_EXTRA]);
  });
});
