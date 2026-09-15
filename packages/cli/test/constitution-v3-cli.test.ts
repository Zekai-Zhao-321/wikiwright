// docs/constitution.md §config/constitution.json (the one document a bundle carries;
// type show renders it) · docs/cli.md
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

function run(cwd: string, args: string[]): { status: number; envelope: Envelope } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const V3 = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: {
      mode: "registered",
      form: "^[a-z0-9][a-z0-9-]*$",
      entries: { meta: { description: "The wiki about the wiki.", requires_link: "Charter" } },
    },
    categories: {
      mode: "registered",
      entries: {
        identity: { class: "supersede", description: "Who or what the entity is." },
        preference: { class: "accumulate", description: "Taste." },
      },
    },
    relations: { mode: "census" },
  },
  fragments: {
    "entity-shape": {
      description: "The body every entity carries.",
      fields: { created: { kind: "date", auto: "on-create" } },
      sections: {
        depth: 2,
        list: [
          {
            heading: "Facts",
            grammar: "claims",
            vocabulary: "categories",
            history: "History",
            severity: "warning",
          },
          { heading: "History", grammar: "claims", role: "history", vocabulary: "categories" },
        ],
      },
    },
  },
  types: {
    entity: {
      extends: "concept",
      description: "Abstract base.",
      abstract: true,
      fragments: ["entity-shape"],
    },
    person: {
      extends: "entity",
      description: "One human being.",
      sections: { list: [{ heading: "Facts", min: 1 }] },
    },
    charter: {
      extends: "reference",
      description: "The one page that says what this wiki is for.",
      instances: { min: 1, max: 1, severity: "warning" },
    },
  },
};

function v3Vault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-v3-"));
  write(tmp, "config/constitution.json", `${JSON.stringify(V3, null, 2)}\n`);
  write(
    tmp,
    "config/engine.json",
    `${JSON.stringify({ content_roots: ["wiki"], folder_tags: { mode: "off" } }, null, 2)}\n`,
  );
  write(
    tmp,
    "wiki/Ada.md",
    "---\ntype: person\ntitle: Ada\ndescription: One human being.\ntags: []\n---\n\n## Facts\n\n- [identity] full name: Ada (stated 2026-01-01)\n",
  );
  return tmp;
}

describe("the v3 document loads and lints (docs/constitution.md §config/constitution.json)", () => {
  it("a clean bundle lints with no error finding", () => {
    const tmp = v3Vault();
    try {
      const r = run(tmp, ["lint"]);
      const findings = (r.envelope.data?.["findings"] ?? []) as Array<Record<string, unknown>>;
      assert.equal(
        findings.filter((f) => f["severity"] === "error").length,
        0,
        JSON.stringify(findings),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("abstract, instances, and the tag entry's requires_link", () => {
  it("a page typed with an abstract type is abstract-type, error", () => {
    const tmp = v3Vault();
    try {
      write(
        tmp,
        "wiki/Base.md",
        "---\ntype: entity\ntitle: Base\ndescription: nope\ntags: []\n---\n\n## Facts\n\n- [identity] x (stated 2026-01-01)\n",
      );
      const r = run(tmp, ["lint"]);
      const findings = (r.envelope.data?.["findings"] ?? []) as Array<Record<string, unknown>>;
      assert.equal(
        findings.some((f) => f["ruleId"] === "abstract-type" && f["severity"] === "error"),
        true,
        JSON.stringify(findings),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("instances reports a vault-level cardinality at its declared severity", () => {
    const tmp = v3Vault();
    try {
      const r = run(tmp, ["lint"]);
      const findings = (r.envelope.data?.["findings"] ?? []) as Array<Record<string, unknown>>;
      const row = findings.find((f) => f["ruleId"] === "instances");
      assert.notEqual(row, undefined, JSON.stringify(findings));
      assert.equal(row?.["severity"], "warning");
      assert.equal(String(row?.["message"]).includes("charter"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("requires_link on a tag entry is tag-requires-link on a page carrying the tag", () => {
    const tmp = v3Vault();
    try {
      write(
        tmp,
        "wiki/Meta note.md",
        "---\ntype: person\ntitle: Meta note\ndescription: d\ntags: [meta]\n---\n\n## Facts\n\n- [identity] x (stated 2026-01-01)\n",
      );
      const r = run(tmp, ["lint"]);
      const findings = (r.envelope.data?.["findings"] ?? []) as Array<Record<string, unknown>>;
      assert.equal(
        findings.some(
          (f) => f["ruleId"] === "tag-requires-link" && f["path"] === "wiki/Meta note.md",
        ),
        true,
        JSON.stringify(findings),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a tag failing the vocabulary's form is tag-form", () => {
    const tmp = v3Vault();
    try {
      const bad = structuredClone(V3) as Record<string, unknown>;
      const vocab = (bad["vocabularies"] as Record<string, Record<string, unknown>>)["tags"];
      if (vocab !== undefined) {
        (vocab["entries"] as Record<string, unknown>)["Meta_Bad"] = { description: "x" };
      }
      write(tmp, "config/constitution.json", `${JSON.stringify(bad, null, 2)}\n`);
      write(tmp, "config/engine.json", `${JSON.stringify({ content_roots: ["wiki"] }, null, 2)}\n`);
      write(
        tmp,
        "wiki/Shouty.md",
        "---\ntype: person\ntitle: Shouty\ndescription: d\ntags: [Meta_Bad]\n---\n\n## Facts\n\n- [identity] x (stated 2026-01-01)\n",
      );
      const r = run(tmp, ["lint"]);
      const findings = (r.envelope.data?.["findings"] ?? []) as Array<Record<string, unknown>>;
      assert.equal(
        findings.some((f) => f["ruleId"] === "tag-form"),
        true,
        JSON.stringify(findings),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("type show renders v3 (docs/constitution.md §config/constitution.json)", () => {
  it("names the fragments, the vocabularies a section reads, abstract and instances", () => {
    const tmp = v3Vault();
    try {
      const r = run(tmp, ["type", "show", "person"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const data = r.envelope.data as Record<string, unknown>;
      assert.deepEqual(
        (data["fragments"] as Array<Record<string, unknown>>).map((f) => f["value"]),
        ["entity-shape"],
      );
      assert.equal(data["abstract"], false);
      const vocabularies = data["vocabularies"] as Array<Record<string, unknown>>;
      const categories = vocabularies.find((v) => v["name"] === "categories");
      assert.equal(categories?.["mode"], "registered");
      assert.equal(categories?.["entries"], 2);
      const lines = (data["section_lines"] as string[]).join("\n");
      assert.equal(lines.includes("categories"), true);

      const base = run(tmp, ["type", "show", "entity"]);
      assert.equal((base.envelope.data as Record<string, unknown>)["abstract"], true);
      const charter = run(tmp, ["type", "show", "charter"]);
      assert.deepEqual((charter.envelope.data as Record<string, unknown>)["instances"], {
        min: 1,
        max: 1,
        severity: "warning",
        contributedBy: "charter",
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("init writes v3 (docs/cli.md §init)", () => {
  for (const starter of ["base", "code"]) {
    it(`init --constitution ${starter} scaffolds config/constitution.json and lints clean`, () => {
      const tmp = mkdtempSync(join(tmpdir(), `ww-init-${starter}-`));
      try {
        const r = run(tmp, ["init", "--constitution", starter]);
        assert.equal(r.status, 0, JSON.stringify(r.envelope));
        assert.equal(existsSync(join(tmp, "config/constitution.json")), true);
        const parsed = JSON.parse(readFileSync(join(tmp, "config/constitution.json"), "utf8")) as {
          schema_version: number;
        };
        assert.equal(parsed.schema_version, 3);
        const lint = run(tmp, ["lint"]);
        const findings = (lint.envelope.data?.["findings"] ?? []) as Array<Record<string, unknown>>;
        assert.deepEqual(
          findings.filter((f) => f["severity"] === "error"),
          [],
          `${starter} starter must init to a green vault`,
        );
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});
