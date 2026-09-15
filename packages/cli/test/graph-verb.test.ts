// docs/cli.md §graph (the query verb: --kind, --label, --inbound/--outbound,
// --missing; exit 0 for any well-formed query, 3 with `nearest` for an unknown
// type, kind or label; answered from the working tree, never from the artifact)
// docs/concepts.md §Generated artifacts The bundle's five real questions, one line each.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Run {
  status: number;
  data: Record<string, unknown>;
  error: Record<string, unknown>;
}

function run(cwd: string, args: string[]): Run {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  const envelope = JSON.parse(r.stdout) as { data?: Record<string, unknown>; error?: unknown };
  return {
    status: r.status ?? -1,
    data: envelope.data ?? {},
    error: (envelope.error ?? {}) as Record<string, unknown>,
  };
}

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: { mode: "registered", entries: {} },
    relations: {
      mode: "registered",
      entries: {
        "traces-to": { description: "the source that establishes this page", range: ["source"] },
        implements: { description: "implements the requirement", range: ["requirement"] },
        "diverges-from": { description: "diverges from the requirement", range: ["requirement"] },
        covers: { description: "explains the requirement", range: ["requirement"] },
        supersedes: { description: "replaces the target" },
      },
    },
  },
  types: {
    source: { extends: "reference", description: "A captured source." },
    requirement: {
      extends: "reference",
      description: "One requirement.",
      sections: { list: [{ heading: "Relations", grammar: "relations", vocabulary: "relations" }] },
    },
    "rtl-module": {
      extends: "reference",
      description: "One RTL module.",
      sections: { list: [{ heading: "Relations", grammar: "relations", vocabulary: "relations" }] },
    },
    "design-note": {
      extends: "concept",
      description: "One design note.",
      sections: { list: [{ heading: "Relations", grammar: "relations", vocabulary: "relations" }] },
    },
  },
};

function page(type: string, title: string, relations: readonly string[]): string {
  const body =
    relations.length === 0
      ? ""
      : `\n## Relations\n\n${relations.map((r) => `- ${r}`).join("\n")}\n`;
  return `---\ntype: ${type}\ntitle: ${title}\ndescription: A ${type}.\ntags: []\n---\n\n# ${title}\n${body}`;
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** A program vault: two sources, three requirements, three modules, one design note. */
function vault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-graph-"));
  write(tmp, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
  write(
    tmp,
    "config/engine.json",
    `${JSON.stringify({ content_roots: ["wiki", "raw"], source_roots: ["raw"] })}\n`,
  );
  write(tmp, "raw/SST.md", page("source", "SST", []));
  write(tmp, "raw/Unused.md", page("source", "Unused", []));
  for (const n of [1, 2, 3]) {
    write(tmp, `wiki/REQ-${n}.md`, page("requirement", `REQ-${n}`, ["traces-to [[SST]]"]));
  }
  write(
    tmp,
    "wiki/Core.md",
    page("rtl-module", "Core", ["traces-to [[SST]]", "implements [[REQ-1]]"]),
  );
  write(
    tmp,
    "wiki/ALU.md",
    page("rtl-module", "ALU", ["traces-to [[SST]]", "diverges-from [[REQ-2]]"]),
  );
  write(tmp, "wiki/Idle.md", page("rtl-module", "Idle", ["traces-to [[SST]]"]));
  write(
    tmp,
    "wiki/DN-1.md",
    page("design-note", "DN-1", ["traces-to [[SST]]", "covers [[REQ-1]]"]),
  );
  return tmp;
}

const paths = (r: Run, key: "missing" | "edges"): string[] =>
  ((r.data[key] ?? []) as Array<Record<string, unknown>>).map((row) =>
    String(row["path"] ?? `${String(row["from"])}→${String(row["to"])}`),
  );

describe("graph edges answers the coverage questions (docs/cli.md §graph)", () => {
  it("requirements with neither implements nor diverges-from inbound", () => {
    const tmp = vault();
    try {
      const r = run(tmp, [
        "graph",
        "edges",
        "--label",
        "implements",
        "--label",
        "diverges-from",
        "--inbound",
        "requirement",
        "--missing",
      ]);
      assert.equal(r.status, 0, JSON.stringify(r));
      assert.deepEqual(r.data["missing"], [{ path: "wiki/REQ-3.md", type: "requirement" }]);
      assert.deepEqual(r.data["totals"], { edges: 2, pages: 3, missing: 1 });
      // The answer names the side it enumerated.
      assert.equal(r.data["side"], "target", "--inbound lists the targets no edge reaches");
      assert.deepEqual(r.data["query"], {
        kind: "relation",
        labels: ["implements", "diverges-from"],
        inbound: "requirement",
        outbound: null,
        missing: true,
      });
      assert.equal(r.data["edges"], undefined, "with --missing the edges are not listed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("modules that implement or diverge from nothing; requirements with no design note; uncited sources", () => {
    const tmp = vault();
    try {
      const modules = run(tmp, [
        "graph",
        "edges",
        "--label",
        "implements",
        "--label",
        "diverges-from",
        "--outbound",
        "rtl-module",
        "--missing",
      ]);
      assert.deepEqual(paths(modules, "missing"), ["wiki/Idle.md"]);
      assert.equal(modules.data["side"], "source", "--outbound lists the sources that carry none");
      const notes = run(tmp, [
        "graph",
        "edges",
        "--label",
        "covers",
        "--inbound",
        "requirement",
        "--missing",
      ]);
      assert.deepEqual(paths(notes, "missing"), ["wiki/REQ-2.md", "wiki/REQ-3.md"]);
      const sources = run(tmp, [
        "graph",
        "edges",
        "--kind",
        "relation",
        "--inbound",
        "source",
        "--missing",
      ]);
      assert.deepEqual(paths(sources, "missing"), ["raw/Unused.md"]);
      assert.deepEqual(sources.data["totals"], { edges: 7, pages: 2, missing: 1 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("without --missing the edges themselves are listed, filterable by kind and side", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["graph", "edges", "--kind", "relation", "--outbound", "design-note"]);
      assert.equal(r.status, 0);
      assert.deepEqual(r.data["edges"], [
        { from: "wiki/DN-1.md", to: "raw/SST.md", kind: "relation", label: "traces-to" },
        { from: "wiki/DN-1.md", to: "wiki/REQ-1.md", kind: "relation", label: "covers" },
      ]);
      assert.deepEqual(r.data["totals"], { edges: 2, pages: 1 });
      // A relation line's body link into a source root is a second, `cites`
      // edge — different kind, both true, told apart by --kind.
      const cites = run(tmp, ["graph", "edges", "--kind", "cites", "--outbound", "design-note"]);
      assert.deepEqual(paths(cites, "edges"), ["wiki/DN-1.md→raw/SST.md"]);
      assert.equal((cites.data["query"] as Record<string, unknown>)["kind"], "cites");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a registered but unused label is a legitimate empty answer, exit 0", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["graph", "edges", "--label", "supersedes"]);
      assert.equal(r.status, 0, JSON.stringify(r));
      assert.deepEqual(r.data["edges"], []);
      assert.deepEqual(r.data["totals"], { edges: 0, pages: 9 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the cap is reported, and --all lifts it", () => {
    const tmp = vault();
    try {
      const capped = run(tmp, ["graph", "edges", "--kind", "relation", "--limit", "2"]);
      assert.equal((capped.data["edges"] as unknown[]).length, 2);
      assert.deepEqual(capped.data["caps"], { limit: 2, truncated: true });
      assert.equal((capped.data["totals"] as Record<string, number>)["edges"], 10);
      const all = run(tmp, ["graph", "edges", "--kind", "relation", "--limit", "2", "--all"]);
      assert.equal((all.data["edges"] as unknown[]).length, 10);
      assert.deepEqual(all.data["caps"], { limit: 2, truncated: false });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("answers from the working tree: no artifact is needed, and a drifted one cannot lie", () => {
    const tmp = vault();
    try {
      assert.equal(existsSync(join(tmp, "generated")), false);
      assert.equal(run(tmp, ["check", "--write"]).status, 0);
      // The artifact now says Idle implements nothing; the page says otherwise.
      write(
        tmp,
        "wiki/Idle.md",
        page("rtl-module", "Idle", ["traces-to [[SST]]", "implements [[REQ-3]]"]),
      );
      const r = run(tmp, [
        "graph",
        "edges",
        "--label",
        "implements",
        "--label",
        "diverges-from",
        "--inbound",
        "requirement",
        "--missing",
      ]);
      assert.deepEqual(r.data["missing"], []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("a malformed query is refused; an unknown name is not_found with its neighbours (docs/cli.md §graph)", () => {
  it("--missing needs exactly one side", () => {
    const tmp = vault();
    try {
      const neither = run(tmp, ["graph", "edges", "--missing"]);
      assert.equal(neither.status, 2);
      assert.equal(neither.error["code"], "missing-side");
      const both = run(tmp, [
        "graph",
        "edges",
        "--missing",
        "--inbound",
        "requirement",
        "--outbound",
        "rtl-module",
      ]);
      assert.equal(both.status, 2);
      assert.equal(both.error["code"], "missing-side");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an unknown type, kind or label exits 3 and names the nearest", () => {
    const tmp = vault();
    try {
      const type = run(tmp, ["graph", "edges", "--inbound", "requirment"]);
      assert.equal(type.status, 3);
      assert.equal(type.error["code"], "unknown-type");
      const typeDetails = type.error["details"] as { valid_values: string[]; nearest: string[] };
      assert.equal(typeDetails.valid_values.includes("requirement"), true);
      assert.deepEqual(typeDetails.nearest, ["requirement"]);

      const kind = run(tmp, ["graph", "edges", "--kind", "relatoin"]);
      assert.equal(kind.status, 3);
      assert.equal(kind.error["code"], "unknown-kind");
      const kindDetails = kind.error["details"] as { valid_values: string[]; nearest: string[] };
      assert.deepEqual(kindDetails.nearest, ["relation"]);
      for (const known of ["cites", "relation", "supersedes", "tagged", "wikilink", "claim"]) {
        assert.equal(kindDetails.valid_values.includes(known), true, known);
      }

      const label = run(tmp, ["graph", "edges", "--label", "implement"]);
      assert.equal(label.status, 3);
      assert.equal(label.error["code"], "unknown-label");
      const labelDetails = label.error["details"] as { nearest: string[] };
      assert.deepEqual(labelDetails.nearest, ["implements"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an unknown subcommand is refused by the registry with the legal set", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["graph", "nodes"]);
      assert.equal(r.status, 2);
      assert.equal(r.error["code"], "unknown-subcommand");
      assert.deepEqual((r.error["details"] as { valid_values: string[] }).valid_values, ["edges"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the registry derives it: schema lists graph with its subcommand, as a consumer verb", () => {
    const tmp = vault();
    try {
      const schema = run(tmp, ["schema"]);
      const commands = schema.data["commands"] as Array<Record<string, unknown>>;
      const graph = commands.find((c) => c["name"] === "graph");
      assert.equal(graph?.["role"], "consumer");
      assert.equal(graph?.["writes"], false);
      assert.deepEqual(graph?.["subcommands"], ["edges"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
