// Registered extension namespaces and the extension census — the x- escape
// stops being an unbounded shadow schema — and templates and golden examples
// as contracts evaluated continuously: declared files exist, examples lint
// clean against their own type, placeholders are known, orphans are surfaced.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function run(cwd: string, args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function findingsOf(envelope: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = envelope["data"] as Record<string, unknown> | undefined;
  return (data?.["findings"] as Array<Record<string, unknown>> | undefined) ?? [];
}

function vault(opts: {
  engine?: unknown;
  typeExtras?: Record<string, unknown>;
  pageFrontmatter?: string;
  files?: Record<string, string>;
}): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-ext-"));
  mkdirSync(join(tmp, "config"));
  mkdirSync(join(tmp, "wiki"));
  mkdirSync(join(tmp, "templates"));
  writeFileSync(
    join(tmp, "config", "constitution.json"),
    JSON.stringify(
      documentOf({
        types: { note: { extends: "concept", description: "A note.", ...(opts.typeExtras ?? {}) } },
      }),
    ),
  );
  writeFileSync(
    join(tmp, "config", "engine.json"),
    JSON.stringify({ content_roots: ["wiki"], ...((opts.engine as object | undefined) ?? {}) }),
  );
  writeFileSync(
    join(tmp, "wiki", "page.md"),
    `---\ntype: note\ntitle: Page\ndescription: d.\ntags: []\n${opts.pageFrontmatter ?? ""}---\n\n# Page\n`,
  );
  for (const [rel, content] of Object.entries(opts.files ?? {})) {
    mkdirSync(join(tmp, rel, ".."), { recursive: true });
    writeFileSync(join(tmp, rel), content);
  }
  return tmp;
}

describe("extension fields are registered, not unbounded", () => {
  it("open mode (the default) keeps today's behavior: any x- field passes", () => {
    const tmp = vault({ pageFrontmatter: "x-anything: 1\n" });
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // e2e:extensions — the declared namespace set decides which x- fields pass.
  it("registered mode admits declared namespaces and refuses the rest", () => {
    const tmp = vault({
      engine: { extensions: { mode: "registered", namespaces: ["x-acme-"] } },
      pageFrontmatter: "x-acme-owner: someone\n",
    });
    try {
      const ok = run(tmp, ["lint"]);
      assert.equal(ok.status, 0, JSON.stringify(ok.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    const bad = vault({
      engine: { extensions: { mode: "registered", namespaces: ["x-acme-"] } },
      pageFrontmatter: "x-freelance: yes\n",
    });
    try {
      const r = run(bad, ["lint"]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "unregistered-extension"),
        true,
      );
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });

  it("the manifest carries an extension census", () => {
    const tmp = vault({ pageFrontmatter: "x-owner: a\nx-cost: 3\n" });
    try {
      run(tmp, ["check", "--write"]);
      const manifest = JSON.parse(
        readFileSync(join(tmp, "generated", "manifest.json"), "utf8"),
      ) as { extensions?: Record<string, number> };
      assert.deepEqual(manifest.extensions, { "x-cost": 1, "x-owner": 1 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("templates and examples are contracts, evaluated", () => {
  it("a golden example that fails its own type's contract is a load error", () => {
    const tmp = vault({
      typeExtras: {
        example: "templates/note.example.md",
        sections: { list: [{ heading: "Log", min: 1 }] },
      },
      files: {
        "templates/note.example.md":
          "---\ntype: note\ntitle: Example\ndescription: e.\ntags: []\n---\n\n# Example\n",
      },
    });
    try {
      const r = run(tmp, ["lint"]);
      // A golden example failing its own contract is a constitution failure.
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.match(JSON.stringify(r.envelope), /example/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a conforming example loads clean", () => {
    const tmp = vault({
      typeExtras: {
        example: "templates/note.example.md",
        rules: [
          {
            id: "needs-log",
            checker: "required-headings",
            config: { headings: ["Log"] },
            severity: "error",
            fixability: "mechanical",
          },
        ],
      },
      files: {
        "templates/note.example.md":
          "---\ntype: note\ntitle: Example\ndescription: e.\ntags: []\n---\n\n# Example\n\n## Log\n",
      },
    });
    try {
      const r = run(tmp, ["lint"]);
      // The vault page itself lacks ## Log; the EXAMPLE must not add findings.
      assert.equal(
        findingsOf(r.envelope).some((f) => String(f["path"]).includes("example")),
        false,
        JSON.stringify(r.envelope),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a corpus example does not make sibling content an orphan template", () => {
    const tmp = vault({
      engine: { content_roots: ["wiki", "raw/source"] },
      typeExtras: { example: "raw/source/example.md" },
      files: {
        "raw/source/example.md":
          "---\ntype: note\ntitle: Example\ndescription: e.\ntags: []\n---\n\n# Example\n",
        "raw/source/sibling.md":
          "---\ntype: note\ntitle: Sibling\ndescription: s.\ntags: []\n---\n\n# Sibling\n",
      },
    });
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "template-orphan"),
        false,
        JSON.stringify(r.envelope),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a missing declared example remains a load error", () => {
    const tmp = vault({ typeExtras: { example: "templates/missing.example.md" } });
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.match(JSON.stringify(r.envelope), /template-missing/u);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an example declaring the wrong type is a load error", () => {
    const tmp = vault({
      typeExtras: { example: "templates/note.example.md" },
      files: {
        "templates/note.example.md":
          "---\ntype: concept\ntitle: Example\ndescription: e.\ntags: []\n---\n\n# Example\n",
      },
    });
    try {
      const r = run(tmp, ["lint"]);
      // An example declaring the wrong type is a constitution failure.
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.match(JSON.stringify(r.envelope), /type/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an unknown template placeholder is surfaced as a warning", () => {
    const tmp = vault({
      typeExtras: { template: "templates/note.md" },
      files: { "templates/note.md": "# {{ title }}\n\nOwner: {{ owner }}\n" },
    });
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "template-placeholder-unknown"),
        true,
        JSON.stringify(r.envelope),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a template frontmatter key the type does not declare is surfaced as a warning", () => {
    // `owner` seeds nothing and names no field; `title` and `tags` are the
    // engine's and never do.
    const tmp = vault({
      typeExtras: { template: "templates/note.md" },
      files: {
        "templates/note.md":
          '---\ntype: note\ntitle: "Seed"\ntags: []\nowner: bob\n---\n\n# {{ title }}\n',
      },
    });
    try {
      const r = run(tmp, ["lint"]);
      const rows = findingsOf(r.envelope).filter((f) => f["ruleId"] === "template-field-unknown");
      assert.deepEqual(
        rows.map((f) => [f["path"], f["severity"], String(f["message"])]),
        [["templates/note.md", "warning", 'frontmatter key "owner" is not a field of note']],
        JSON.stringify(r.envelope),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a stray file beside a declared template is surfaced as an orphan", () => {
    // The scan follows the bundle's own declarations: a type declares
    // templates/note.md, so templates/ is scanned and the stray shows up. A
    // bundle declaring no templates is scanned nowhere.
    const tmp = vault({
      typeExtras: { template: "templates/note.md" },
      files: { "templates/note.md": "# {{ title }}\n", "templates/stray.md": "# {{ title }}\n" },
    });
    try {
      const r = run(tmp, ["lint"]);
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "template-orphan"),
        true,
        JSON.stringify(r.envelope),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
