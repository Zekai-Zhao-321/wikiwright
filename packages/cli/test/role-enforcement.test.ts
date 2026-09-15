// docs/cli.md §brief (the two planes as roles: a consumer never writes) · 09
// docs/cli.md §skills (WIKIWRIGHT_ROLE=consumer refuses a maintainer verb
// with role-forbidden and a role-filtered valid_commands; an unrecognised value
// is a usage error, never a silent maintainer)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Run {
  status: number;
  envelope: {
    ok?: boolean;
    data?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
}

function run(args: string[], env?: Record<string, string>): Run {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(env ?? {}) } as Record<string, string>,
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Run["envelope"] };
}

describe("WIKIWRIGHT_ROLE=consumer bounds the surface (docs/cli.md §brief)", () => {
  const consumerVerbs = COMMANDS.filter((c) => c.role === "consumer").map((c) => c.name);

  it("a maintainer verb exits 2 with role-forbidden and the consumer surface", () => {
    const r = run(["lint"], { WIKIWRIGHT_ROLE: "consumer" });
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.["code"], "role-forbidden");
    assert.equal(r.envelope.error?.["type"], "usage");
    const details = (r.envelope.error?.["details"] ?? {}) as Record<string, unknown>;
    assert.deepEqual(details["valid_commands"], consumerVerbs);
    assert.equal(details["role"], "consumer");
  });

  it("a consumer verb runs unchanged", () => {
    const r = run(["schema"], { WIKIWRIGHT_ROLE: "consumer" });
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
  });

  it("the default and an explicit maintainer are unchanged", () => {
    for (const env of [{}, { WIKIWRIGHT_ROLE: "maintainer" }]) {
      const r = run(["lint", "--help"], env);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    }
  });

  it("an unrecognised role is a usage error, never a silent maintainer", () => {
    // `writer` was added between the two, so the unrecognised value here is
    // one that is still not a role — the point of the case is the refusal, not
    // the particular spelling.
    const r = run(["lint", "--help"], { WIKIWRIGHT_ROLE: "editor" });
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.["code"], "role-unknown");
    const details = (r.envelope.error?.["details"] ?? {}) as Record<string, unknown>;
    assert.deepEqual(details["valid_values"], ["consumer", "writer", "maintainer"]);
  });
});
