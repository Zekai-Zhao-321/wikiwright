// docs/cli.md §brief: `brief` is a consumer verb, so every role may print its own
// brief, and without `--role` it prints the session's. "The loop" and
// "Findings" are the role's: the consumer's loop names no verb, its verb list
// holds no verb that writes a bundle and its Findings runs nothing; every
// role's loop opens on one principle line, after which the writer's is the five
// steps it has always been and the maintainer's is the writer's five and two
// more; the writer and the maintainer read one Findings paragraph.

import { beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { LEGACY_COMMANDS } from "../src/commands.ts";
import { ROLE_RANK } from "../src/spec.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

/** The line every role's loop opens with: the engine to decide, write and attribute; your own tools to look. */
const PRINCIPLE =
  "Use the engine to decide, to write and to attribute; use your own tools to look.";

/** The writer's five steps as the brief printed them before the loop depended on the role. */
const WRITER_LOOP = [
  "1. `search` every name form, in both scripts, before you create anything.",
  "2. `type show <type> --brief` — the contract, with live counts.",
  "3. Draft the Markdown, then `write <path> --dry-run` and read the findings.",
  "4. `write` for real; the engine stamps the dates and writes the History line.",
  "5. Commit. The gate runs the same judge over what the commit would contain.",
];

/** The writer's Findings paragraph as the brief printed it before it depended on the role. */
const WRITER_FINDINGS = [
  "If a finding has `fix`, run its `argv` (fill any placeholders first). If it has",
  "`queue`, it is not yours — continue. A queued finding on a line you did not write",
  "is a warning, not a block.",
];

/** Every role keeps these two in its Findings section. */
const CAPS_SENTENCE = [
  "One sentence on search: not-found is only as good as the coverage block. Never",
  "claim absence while `caps.hit` is true — the cap cut the list before the end.",
];

const MAINTAINER_EXTRA = [
  "6. A finding with `queue` is a judgment: adjudicate it or change the law, and never lower a severity to quiet it.",
  "7. Commit `generated/` with the pages it describes.",
];

/** `brief` over the minimal fixture, with the session's `WIKIWRIGHT_ROLE` set or removed. */
function brief(
  argv: readonly string[],
  sessionRole: string | undefined,
): { status: number; role: string; text: string } {
  const env = { ...process.env };
  if (sessionRole === undefined) delete env["WIKIWRIGHT_ROLE"];
  else env["WIKIWRIGHT_ROLE"] = sessionRole;
  const r = runCli([CLI, "brief", ...argv, "--root", FIXTURE], {
    encoding: "utf8",
    env,
  });
  const envelope = JSON.parse(r.stdout) as { data?: { role?: string; brief?: string } };
  return {
    status: r.status ?? -1,
    role: envelope.data?.role ?? "",
    text: envelope.data?.brief ?? "",
  };
}

/** The brief a role prints over the minimal fixture, under a session of that role. */
function briefOf(role: string): { status: number; text: string } {
  return brief(["--role", role], role);
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
  beforeAll(() => {
    consumer = briefOf("consumer");
  });

  it("a consumer session prints the consumer's brief", () => {
    assert.equal(consumer.status, 0, consumer.text);
    assert.match(consumer.text, /^# wikiwright — the consumer's brief$/mu);
  });

  it("the consumer's verb list holds no verb that writes a bundle, and only verbs a consumer may run", () => {
    const listed = listedVerbs(consumer.text);
    const writing = LEGACY_COMMANDS.filter((c) => c.writes).map((c) => c.name);
    // A consumer runs no writing verb: `bundles` lists what the skill
    // directories hold and writes nothing (docs/cli.md §bundles). A writing
    // verb in the list fails here, so adding one is a decision.
    assert.deepEqual(
      listed.filter((name) => writing.includes(name)),
      [],
    );
    assert.deepEqual(
      listed,
      LEGACY_COMMANDS.filter((c) => c.role === "consumer")
        .map((c) => c.name)
        .sort(),
    );
    assert.equal(listed.includes("brief"), true, "the consumer's list names the brief itself");
  });

  it("the consumer's loop names no verb above the consumer's rank as a command", () => {
    const loop = section(consumer.text, "The loop");
    assert.equal(loop.length, 6, loop.join("\n"));
    assert.equal(loop[0], PRINCIPLE);
    const above = LEGACY_COMMANDS.filter((c) => ROLE_RANK[c.role] > ROLE_RANK.consumer).map(
      (c) => c.name,
    );
    for (const name of ["write", "new", "fix", "check"]) assert.ok(above.includes(name), name);
    for (const name of above) {
      const named = loop.filter((line) => new RegExp(`\`${name}[\\s\`]`, "u").test(line));
      assert.deepEqual(named, [], `the consumer's loop names \`${name}\``);
    }
  });

  it("the writer's loop is the principle, then the five steps, verbatim", () => {
    const writer = briefOf("writer");
    assert.equal(writer.status, 0, writer.text);
    assert.deepEqual(section(writer.text, "The loop"), [PRINCIPLE, ...WRITER_LOOP]);
  });

  it("the maintainer's loop is the principle, the writer's five, then two more", () => {
    const maintainer = briefOf("maintainer");
    assert.equal(maintainer.status, 0, maintainer.text);
    assert.deepEqual(section(maintainer.text, "The loop"), [
      PRINCIPLE,
      ...WRITER_LOOP,
      ...MAINTAINER_EXTRA,
    ]);
  });

  it("the consumer's Findings tells it to run nothing, and keeps the pass count and caps.hit", () => {
    const findings = section(consumer.text, "Findings");
    const text = findings.join("\n");
    assert.equal(/\b[Rr]un (?:its|the|this|that) `?argv/u.test(text), false, text);
    assert.equal(text.includes("run its `argv`"), false, text);
    assert.match(text, /report the finding and run nothing/u);
    assert.match(text, /^Of \d+ passes, \d+ name a fixer; the rest are queues or census rows\.$/mu);
    assert.deepEqual(findings.slice(-2), CAPS_SENTENCE);
  });

  it("the writer's and the maintainer's Findings are the paragraph they always were", () => {
    for (const role of ["writer", "maintainer"]) {
      const findings = section(briefOf(role).text, "Findings");
      assert.deepEqual(findings.slice(0, 3), WRITER_FINDINGS, role);
      assert.deepEqual(findings.slice(-2), CAPS_SENTENCE, role);
    }
  });
});

describe("without --role, the brief is the session's (docs/cli.md §brief)", () => {
  it("a consumer session gets the consumer's brief", () => {
    const r = brief([], "consumer");
    assert.equal(r.status, 0, r.text);
    assert.equal(r.role, "consumer");
    assert.match(r.text, /^# wikiwright — the consumer's brief$/mu);
  });

  it("a session that declares no role gets the writer's, and an explicit flag wins", () => {
    const unset = brief([], undefined);
    assert.equal(unset.status, 0, unset.text);
    assert.equal(unset.role, "writer");
    const flagged = brief(["--role", "maintainer"], "consumer");
    assert.equal(flagged.status, 0, flagged.text);
    assert.equal(flagged.role, "maintainer");
  });
});
