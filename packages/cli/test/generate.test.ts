// docs/cli.md §check (generated artifacts; running twice produces no diff; registry +
// lint + generated rebuild comparison; derived-only --write) · docs/cli.md §brief
// (generated files: one generator, deletable, byte-reproducible) · docs/architecture.md §Directories (canonical
// writer, atomic all-or-nothing) · docs/concepts.md (generated drift = error).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

function run(args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function tempVault(pruneBroken = false): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-gen-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  if (pruneBroken) rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  return tmp;
}

describe("check --write — generated artifacts (docs/cli.md §check, docs/cli.md §brief)", () => {
  it("writes manifest and tag catalog; two writes are byte-identical", () => {
    const tmp = tempVault(true);
    try {
      const first = run(["check", "--write", "--root", tmp]);
      assert.equal(first.status, 0);
      const manifest1 = readFileSync(join(tmp, "generated/manifest.json"));
      const catalog1 = readFileSync(join(tmp, "generated/tag-catalog.md"));
      const second = run(["check", "--write", "--root", tmp]);
      assert.equal(second.status, 0);
      assert.equal(manifest1.equals(readFileSync(join(tmp, "generated/manifest.json"))), true);
      assert.equal(catalog1.equals(readFileSync(join(tmp, "generated/tag-catalog.md"))), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("delete-and-rebuild reproduces identical bytes (docs/architecture.md §The invariants)", () => {
    const tmp = tempVault();
    try {
      run(["check", "--write", "--root", tmp]);
      const before = readFileSync(join(tmp, "generated/manifest.json"));
      rmSync(join(tmp, "generated"), { recursive: true, force: true });
      run(["check", "--write", "--root", tmp]);
      assert.equal(before.equals(readFileSync(join(tmp, "generated/manifest.json"))), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("manifest lists pages with type, title, and tags, sorted by path", () => {
    const tmp = tempVault();
    try {
      run(["check", "--write", "--root", tmp]);
      const manifest = JSON.parse(readFileSync(join(tmp, "generated/manifest.json"), "utf8")) as {
        schema: string;
        pages: Array<{ path: string; type: string | null; title: string | null; tags: string[] }>;
      };
      assert.equal(manifest.schema, "wikiwright/manifest");
      const paths = manifest.pages.map((p) => p.path);
      assert.deepEqual(
        paths,
        [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
      const warm = manifest.pages.find((p) => p.path.endsWith("warm-reset.md"));
      assert.equal(warm?.type, "test-case");
      assert.deepEqual(warm?.tags, ["reset", "test-execution"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--write produces exactly the declared files, no temporaries", () => {
    const tmp = tempVault(true);
    try {
      run(["check", "--write", "--root", tmp]);
      const generated = readFileSync(join(tmp, "generated/manifest.json"), "utf8");
      assert.equal(generated.length > 0, true);
      const entries = readdirSync(join(tmp, "generated")).join("\n");
      assert.equal(/tmp/.test(entries), false, "no temp files left behind");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("stores NFC paths in generated artifacts regardless of filesystem form", () => {
    const tmp = tempVault(true);
    try {
      const nfd = "cafe\u0301";
      writeFileSync(
        join(tmp, `wiki/${nfd}.md`),
        "---\ntype: concept\ntitle: Cafe page\ndescription: x.\ntags: []\n---\n\n# Cafe page\n",
      );
      run(["check", "--write", "--root", tmp]);
      const manifest = readFileSync(join(tmp, "generated/manifest.json"), "utf8");
      assert.equal(manifest.includes("caf\u00e9.md"), true, "path stored NFC");
      assert.equal(manifest.includes("cafe\u0301.md"), false, "no NFD bytes in artifacts");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("check — the aggregate pass (docs/cli.md §check)", () => {
  it("exits 0 on a clean, freshly written vault", () => {
    const tmp = tempVault(true);
    try {
      run(["check", "--write", "--root", tmp]);
      const r = run(["check", "--root", tmp]);
      assert.equal(r.status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("exits 5 when page findings exist, findings still in data", () => {
    const tmp = tempVault();
    try {
      run(["check", "--write", "--root", tmp]);
      const r = run(["check", "--root", tmp]);
      assert.equal(r.status, 5);
      const data = r.envelope["data"] as { findings: Array<{ ruleId: string }> };
      assert.equal(
        data.findings.some((f) => f.ruleId === "unknown-tag"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports generated drift as an error finding (docs/concepts.md)", () => {
    const tmp = tempVault(true);
    try {
      run(["check", "--write", "--root", tmp]);
      writeFileSync(join(tmp, "generated/manifest.json"), '{ "tampered": true }\n');
      const r = run(["check", "--root", tmp]);
      assert.equal(r.status, 5);
      const data = r.envelope["data"] as { findings: Array<{ ruleId: string; path: string }> };
      assert.equal(
        data.findings.some(
          (f) => f.ruleId === "generated-drift" && f.path === "generated/manifest.json",
        ),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("check --write refreshes derived artifacts and then passes", () => {
    const tmp = tempVault(true);
    try {
      const r1 = run(["check", "--root", tmp]);
      assert.equal(r1.status, 5); // generated files missing = drift
      const r2 = run(["check", "--root", tmp, "--write"]);
      assert.equal(r2.status, 0);
      const r3 = run(["check", "--root", tmp]);
      assert.equal(r3.status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("source_roots reaches graph generation", () => {
  // e2e:source_roots — declared evidence roots turn a body link into a citation
  // edge in the generated graph.
  it("engine.json → wikiwright check --write → graph.json emits cites for a body link", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-src-"));
    try {
      mkdirSync(join(tmp, "config"));
      mkdirSync(join(tmp, "wiki"));
      mkdirSync(join(tmp, "raw"));
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify(
          documentOf({ types: { note: { extends: "concept", description: "A note." } } }),
        ),
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({ content_roots: ["wiki", "raw"], source_roots: ["raw"] }),
      );
      writeFileSync(
        join(tmp, "wiki", "model.md"),
        "---\ntype: note\ntitle: Model\ndescription: d.\ntags: []\n---\n\n# model\n\nSee [[capture]].\n",
      );
      writeFileSync(
        join(tmp, "raw", "capture.md"),
        "---\ntype: note\ntitle: capture\ndescription: c.\ntags: []\n---\n\n# capture\n",
      );
      const b = run(["check", "--write", "--root", tmp]);
      assert.equal(b.status, 0, JSON.stringify(b.envelope));
      const graph = JSON.parse(readFileSync(join(tmp, "generated", "graph.json"), "utf8")) as {
        edges: Array<Record<string, unknown>>;
      };
      assert.equal(
        graph.edges.some((e) => e["kind"] === "cites" && e["to"] === "raw/capture.md"),
        true,
        "the declared source root reached generation",
      );
      assert.equal(
        graph.edges.some((e) => e["kind"] === "wikilink" && e["to"] === "raw/capture.md"),
        false,
      );
      // docs/concepts.md §Generated artifacts: the manifest counts by kind and keys
      // adjacency by the names the spec promises.
      const manifest = JSON.parse(
        readFileSync(join(tmp, "generated", "manifest.json"), "utf8"),
      ) as { by_kind: Record<string, number>; pages: Array<Record<string, unknown>> };
      assert.deepEqual(manifest.by_kind, { cites: 1 });
      const model = manifest.pages.find((p) => p["path"] === "wiki/model.md");
      assert.deepEqual(model?.["outbound"], { cites: ["raw/capture.md"] });
      assert.equal(model?.["out"], undefined);
      // a second check must agree, or the byte-gate contradicts itself.
      const c = run(["check", "--root", tmp]);
      assert.equal(c.status, 0, JSON.stringify(c.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
