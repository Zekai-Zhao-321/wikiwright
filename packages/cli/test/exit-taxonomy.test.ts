// docs/cli.md §The envelope (constitution failures and page findings never blur:
// type `constitution` exits 2, type `findings` exits 5) (the closed
// exit taxonomy) · a malformed registry is exit 2, page violations 5
//.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const CLI_SRC = fileURLToPath(new URL("../src/", import.meta.url));

interface Run {
  status: number;
  envelope: {
    ok?: boolean;
    error?: { type?: string; code?: string };
    data?: unknown;
  };
}

function run(cwd: string, args: string[]): Run {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Run["envelope"] };
}

const GOOD_TYPES = JSON.stringify(
  documentOf({ types: { note: { extends: "concept", description: "A note." } } }),
);

/** A constitution whose type extends nothing that exists — a load-time family. */
const BAD_TYPES = JSON.stringify(
  documentOf({ types: { note: { extends: "no-such-type", description: "A note." } } }),
);

function vault(types: string, engine: Record<string, unknown> = {}): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-exit-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki"));
  writeFileSync(join(tmp, "config", "constitution.json"), types);
  writeFileSync(
    join(tmp, "config", "engine.json"),
    JSON.stringify({ content_roots: ["wiki"], ...engine }),
  );
  writeFileSync(
    join(tmp, "wiki", "clean.md"),
    "---\ntype: note\ntitle: Clean\ndescription: A clean page.\ntags: []\n---\n\n# Clean\n\nBody.\n",
  );
  return tmp;
}

describe("exit 2 vs exit 5 never blur (docs/cli.md §The envelope)", () => {
  it("an invalid registry exits 2 with type constitution under lint, check, new, search", () => {
    const tmp = vault(BAD_TYPES);
    try {
      for (const args of [
        ["lint"],
        ["check"],
        ["new", "note", "Draft", "--dest", "wiki/draft.md"],
        ["search", "clean"],
      ]) {
        const r = run(tmp, args);
        assert.equal(r.status, 2, `${args[0]}: ${JSON.stringify(r.envelope)}`);
        assert.equal(r.envelope.error?.type, "constitution", `${args[0]} carries the type`);
        assert.equal(r.envelope.error?.code, "constitution-invalid");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an unknown engine.json key is a constitution failure, not a page verdict", () => {
    const tmp = vault(GOOD_TYPES, { no_such_key: true });
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.type, "constitution");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("unparseable registry JSON is a constitution failure too", () => {
    const tmp = vault(GOOD_TYPES);
    try {
      writeFileSync(join(tmp, "config", "constitution.json"), "{ not json");
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.type, "constitution");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a valid registry with a failing page still exits 5 with type findings", () => {
    const tmp = vault(GOOD_TYPES);
    try {
      writeFileSync(
        join(tmp, "wiki", "rogue.md"),
        "---\ntype: no-such-type\ntitle: Rogue\ndescription: x.\ntags: []\n---\n\n# Rogue\n",
      );
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.type, "findings");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a missing constitution stays not_found (3) — absent is not malformed", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-exit-"));
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 3, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.type, "not_found");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/** Every `fail(<command>, "<type>", "<code>", …)` the CLI's sources spell out. */
function refusals(): { file: string; type: string; code: string }[] {
  const out: { file: string; type: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(abs, "utf8");
        for (const m of text.matchAll(/\bfail\(\s*[^,()]+,\s*"([a-z_]+)",\s*"([^"]+)"/gu)) {
          out.push({ file: entry.name, type: m[1] ?? "", code: m[2] ?? "" });
        }
      }
    }
  };
  walk(CLI_SRC);
  return out;
}

describe("the error-code taxonomy: one code, one meaning (docs/cli.md §The envelope)", () => {
  it("every code is kebab-case, and maps to exactly one exit type across every verb", () => {
    const found = refusals();
    assert.equal(found.length > 40, true, `the scan found the refusal sites (${found.length})`);
    const typesOf = new Map<string, Set<string>>();
    for (const { file, type, code } of found) {
      assert.match(code, /^[a-z]+(-[a-z]+)*$/u, `${file}: code "${code}" is not kebab-case`);
      typesOf.set(code, new Set([...(typesOf.get(code) ?? []), type]));
    }
    for (const [code, types] of typesOf) {
      assert.equal(
        types.size,
        1,
        `code "${code}" is failed under ${[...types].join(" and ")} — one code, one meaning`,
      );
    }
  });
});
