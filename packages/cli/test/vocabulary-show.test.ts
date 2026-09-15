// docs/cli.md §vocabulary (the mirror of `type show` — entries with what they
// admit, the sections that bind the vocabulary, and the vault's own census) ·
// docs/constitution.md §Vocabularies (the closed name set, the mode axis) ·
// docs/constitution.md (the `code` starter is the reference bundle; an
// abstract type is uninstantiable) · docs/architecture.md §Directories
// (deterministic output; byte-identical under bun and node).
//
// A bundle author could declare a `range` and had no way to ask what it
// admits — the widest possible range and a range naming a type nobody extends
// read identically in the file.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";
import { grantKit, installKit, kitEnv } from "./fixtures/kit-code.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface DeclaredEntry {
  name: string;
  description: string | null;
  aliases: string[];
  status: string;
  replaced_by: string[] | null;
  /** The registering module's own properties, verbatim. */
  properties: Record<string, unknown>;
  /** Per declared `typeRefs`/`tagRefs` path: the names it holds and, for types, the concrete ones. */
  references: Record<string, { types: string[]; concrete: string[] } | { tags: string[] }>;
  required_by: { type: string; section: string; min: number; max?: number; with: string[] }[];
}

interface Observation {
  label: string;
  count: number;
  on_types: string[];
  registered: boolean;
}

interface VocabularyData {
  name: string;
  mode: string;
  entries: number;
  form: string | null;
  note?: string;
  bound_by: { type: string; section: string; severity: string; require?: unknown[] }[];
  declared: DeclaredEntry[];
  observed: Observation[];
  target?: {
    type: string;
    entries: {
      name: string;
      through: string[];
      references: DeclaredEntry["references"];
      required_by: unknown[];
      sources: { type: string; section: string; severity: string }[];
    }[];
  };
}

interface Envelope {
  ok: boolean;
  data?: VocabularyData;
  error?: { code: string; type: string; details?: Record<string, unknown> };
}

function raw(cwd: string, args: string[], exe = process.execPath): string {
  return spawnSync(exe, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: kitEnv(cwd),
  }).stdout;
}

function run(cwd: string, args: string[]): { status: number; envelope: Envelope } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: kitEnv(cwd),
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

function data(cwd: string, args: string[]): VocabularyData {
  const r = run(cwd, args);
  assert.equal(r.status, 0, JSON.stringify(r.envelope));
  assert.notEqual(r.envelope.data, undefined);
  return r.envelope.data as VocabularyData;
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** The code starter as `init` lands it, with its kit installed and granted (docs/extending.md §The code kit). */
function codeVault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-vocab-code-"));
  const init = spawnSync(process.execPath, [CLI, "init", "--constitution", "code", "--root", "."], {
    cwd: tmp,
    encoding: "utf8",
    env: kitEnv(tmp),
  });
  assert.equal(init.status, 0, init.stdout);
  installKit(tmp);
  grantKit(tmp);
  return tmp;
}

/**
 * An abstract base with two concrete descendants, one ranged label and one
 * label with no range at all — the two cases a declaration cannot distinguish
 * on its own.
 */
const SCRATCH = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: { mode: "registered", entries: { meta: { description: "The wiki about the wiki." } } },
    relations: {
      mode: "registered",
      entries: {
        works_at: { description: "The organization this person works at.", range: ["org"] },
        knows: { description: "Anyone this page knows.", aliases: ["acquainted_with"] },
      },
    },
  },
  types: {
    org: {
      extends: "concept",
      description: "Abstract base for every kind of organization.",
      abstract: true,
      sections: {
        depth: 2,
        list: [{ heading: "Relations", grammar: "relations", vocabulary: "relations" }],
      },
    },
    company: { extends: "org", description: "A company." },
    charity: { extends: "org", description: "A charity." },
    person: {
      extends: "concept",
      description: "One human being.",
      sections: {
        depth: 2,
        list: [
          {
            heading: "Relations",
            grammar: "relations",
            vocabulary: "relations",
            require: [{ labels: ["works_at"], min: 1 }],
            severity: "error",
          },
        ],
      },
    },
  },
};

function page(type: string, title: string, relations: string[]): string {
  const body = relations.map((r) => `- ${r}`).join("\n");
  return `---\ntype: ${type}\ntitle: ${title}\ndescription: A ${type}.\ntags: []\n---\n\n## Relations\n\n${body}\n`;
}

function scratchVault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-vocab-"));
  write(tmp, "config/constitution.json", `${JSON.stringify(SCRATCH, null, 2)}\n`);
  write(tmp, "config/engine.json", `${JSON.stringify({ content_roots: ["wiki"] }, null, 2)}\n`);
  write(tmp, "wiki/Ada.md", page("person", "Ada", ["works_at [[Acme]]", "knows [[Bob]]"]));
  write(
    tmp,
    "wiki/Bob.md",
    page("person", "Bob", ["works_at [[Acme]]", "schemes_with [[Ada]]", "knows [[Ada]]"]),
  );
  write(tmp, "wiki/Acme.md", page("company", "Acme", ["knows [[Ada]]"]));
  return tmp;
}

describe("vocabulary show on the shipped code starter (docs/cli.md §vocabulary)", () => {
  it("the header names the vocabulary, its mode and its entry count", () => {
    const tmp = codeVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      assert.equal(d.name, "relations");
      assert.equal(d.mode, "registered");
      // The kit's four labels, contributed into the standard library's vocabulary.
      assert.equal(d.entries, 4);
      assert.deepEqual(
        d.declared.map((e) => e.name),
        ["decided_by", "mapped_in", "part_of", "verified_by"],
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("bound_by names every type whose sections read the vocabulary, with the effective severity", () => {
    const tmp = codeVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      // Every kit type with a Relations section, abstract and concrete alike,
      // and the two the starter anchors of its own accord.
      assert.deepEqual(
        d.bound_by.map((b) => `${b.type}/${b.section}/${b.severity}`),
        [
          "architecture-overview/Relations/warning",
          "code-concept/Relations/warning",
          "code/architecture-overview/Relations/warning",
          "code/concept/Relations/warning",
          "code/integration/Relations/warning",
          "code/ops-reference/Relations/warning",
          "code/quickstart/Relations/warning",
          "code/source-map/Relations/warning",
          "code/subsystem/Relations/warning",
          "code/testing-guide/Relations/warning",
          "integration/Relations/warning",
          "ops-reference/Relations/warning",
          "quickstart/Relations/warning",
          "source-map/Relations/warning",
          "subsystem/Relations/warning",
          "testing-guide/Relations/warning",
        ],
      );
      // No section authors a `severity`, so the reported value is
      // the one the arms actually emit — not `undefined`.
      const subsystem = d.bound_by.find((b) => b.type === "subsystem");
      assert.deepEqual(subsystem?.require, [
        { labels: ["mapped_in"], min: 1 },
        { labels: ["part_of"], min: 1 },
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("admits resolves the kit's abstract ranges to the starter's concrete types", () => {
    const tmp = codeVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      const verifiedBy = d.declared.find((e) => e.name === "verified_by");
      assert.deepEqual(verifiedBy?.properties, {
        range: ["code/testing-guide", "code/quickstart"],
      });
      // The range is matched THROUGH the extends chain, and this is the line
      // that says so out loud — read off the `typeRefs` the relations module
      // declared, never off the property's name: the kit names its abstract
      // types, the vault answers with the concrete ones a page can carry.
      assert.deepEqual(verifiedBy?.references, {
        range: {
          types: ["code/testing-guide", "code/quickstart"],
          concrete: ["quickstart", "testing-guide"],
        },
      });
      const partOf = d.declared.find((e) => e.name === "part_of");
      assert.deepEqual(partOf?.references, {
        range: {
          types: ["code/subsystem", "code/architecture-overview"],
          concrete: ["architecture-overview", "subsystem"],
        },
      });
      const mappedIn = d.declared.find((e) => e.name === "mapped_in");
      assert.deepEqual(mappedIn?.required_by, [
        { type: "code/subsystem", section: "Relations", min: 1, with: [] },
        { type: "subsystem", section: "Relations", min: 1, with: [] },
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("tags reports its entries and says why no section binds it", () => {
    const tmp = codeVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "tags"]);
      assert.deepEqual(
        d.declared.map((e) => e.name),
        ["meta"],
      );
      assert.deepEqual(d.bound_by, []);
      assert.equal(String(d.note).includes("no section binds `tags`"), true, d.note);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a vocabulary the constitution does not declare is empty with a note, never omitted", () => {
    const tmp = codeVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "sources"]);
      assert.equal(d.mode, "census");
      assert.equal(d.entries, 0);
      assert.deepEqual(d.declared, []);
      assert.deepEqual(d.observed, []);
      assert.deepEqual(d.bound_by, []);
      assert.equal(String(d.note).includes("declares no `sources` vocabulary"), true, d.note);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("admits over an abstract base", () => {
  it("lists the concrete descendants and not the abstract base", () => {
    const tmp = scratchVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      const worksAt = d.declared.find((e) => e.name === "works_at");
      assert.deepEqual(worksAt?.properties, { range: ["org"] });
      // `org` is in its own chain and would match the predicate; it is excluded
      // because no page can carry it, which is what "concrete" has to mean.
      assert.deepEqual(worksAt?.references, {
        range: { types: ["org"], concrete: ["charity", "company"] },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an entry with no type-valued property declares no reference, and says so by absence", () => {
    const tmp = scratchVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      const knows = d.declared.find((e) => e.name === "knows");
      assert.deepEqual(knows?.properties, {});
      assert.deepEqual(knows?.references, {});
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("bound_by reports the authored severity where a section ratcheted", () => {
    const tmp = scratchVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      assert.deepEqual(
        d.bound_by.map((b) => `${b.type}/${b.severity}`),
        ["charity/warning", "company/warning", "org/warning", "person/error"],
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("--label and --target (docs/cli.md §vocabulary)", () => {
  it("--label narrows the entries block to one entry", () => {
    const tmp = scratchVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations", "--label", "works_at"]);
      assert.deepEqual(
        d.declared.map((e) => e.name),
        ["works_at"],
      );
      // The header still describes the whole vocabulary.
      assert.equal(d.entries, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--label resolves an alias, and an unknown entry is not_found with the nearest names", () => {
    const tmp = scratchVault();
    try {
      const alias = data(tmp, ["vocabulary", "show", "relations", "--label", "acquainted_with"]);
      assert.deepEqual(
        alias.declared.map((e) => e.name),
        ["knows"],
      );
      const r = run(tmp, ["vocabulary", "show", "relations", "--label", "works-at"]);
      assert.equal(r.status, 3, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.code, "unknown-entry");
      assert.deepEqual(r.envelope.error?.details?.["nearest"], ["works_at"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--target prints the inbound view: every label that admits the type", () => {
    const tmp = scratchVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations", "--target", "company"]);
      assert.equal(d.target?.type, "company");
      // The inbound view lists the entries whose DECLARED type-valued property
      // names the type or an ancestor: `knows` names none and is not inbound.
      assert.deepEqual(
        d.target?.entries.map((l) => [l.name, l.through]),
        [["works_at", ["range"]]],
      );
      const worksAt = d.target?.entries.find((l) => l.name === "works_at");
      assert.deepEqual(worksAt?.required_by, [
        { type: "person", section: "Relations", min: 1, with: [] },
      ]);
      // Where such a line may be written at all — with the severity it lands at.
      assert.deepEqual(worksAt?.sources, [
        { type: "charity", section: "Relations", severity: "warning" },
        { type: "company", section: "Relations", severity: "warning" },
        { type: "org", section: "Relations", severity: "warning" },
        { type: "person", section: "Relations", severity: "error" },
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--target on an abstract type admits nothing, and says why", () => {
    const tmp = scratchVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations", "--target", "org"]);
      assert.deepEqual(d.target?.entries, []);
      assert.equal(String(d.note).includes("abstract"), true, d.note);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--target is a usage error on a vocabulary whose module declares no type-valued property", () => {
    const tmp = scratchVault();
    try {
      const r = run(tmp, ["vocabulary", "show", "tags", "--target", "person"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.code, "target-not-applicable");
      // The vocabularies that do declare one, read off the manifests.
      assert.deepEqual(r.envelope.error?.details?.["valid_values"], ["categories", "relations"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--target names an unknown type as not_found", () => {
    const tmp = scratchVault();
    try {
      const r = run(tmp, ["vocabulary", "show", "relations", "--target", "no-such-type"]);
      assert.equal(r.status, 3, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.code, "unknown-type");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the observed census (docs/constitution.md §Vocabularies)", () => {
  it("counts what the vault writes, sorted by count then label, with the types", () => {
    const tmp = scratchVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      assert.deepEqual(
        d.observed.map((o) => [o.label, o.count]),
        [
          ["knows", 3],
          ["works_at", 2],
          ["schemes_with", 1],
        ],
      );
      assert.deepEqual(d.observed.find((o) => o.label === "knows")?.on_types, [
        "company",
        "person",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an observed label the vocabulary does not register is marked, and that is the drift", () => {
    const tmp = scratchVault();
    try {
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      assert.equal(d.observed.find((o) => o.label === "schemes_with")?.registered, false);
      assert.equal(d.observed.find((o) => o.label === "works_at")?.registered, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the census prints in census mode too — that is what a census is for", () => {
    const tmp = scratchVault();
    try {
      const doc = structuredClone(SCRATCH) as unknown as Record<string, unknown>;
      const vocabularies = doc["vocabularies"] as Record<string, Record<string, unknown>>;
      const relations = vocabularies["relations"];
      if (relations !== undefined) relations["mode"] = "census";
      write(tmp, "config/constitution.json", `${JSON.stringify(doc, null, 2)}\n`);
      write(tmp, "config/engine.json", `${JSON.stringify({ content_roots: ["wiki"] }, null, 2)}\n`);
      const d = data(tmp, ["vocabulary", "show", "relations"]);
      assert.equal(d.mode, "census");
      assert.equal(d.observed.length, 3);
      assert.equal(d.observed.find((o) => o.label === "schemes_with")?.registered, false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("tags are counted from the frontmatter, where that vocabulary lives", () => {
    const tmp = scratchVault();
    try {
      write(
        tmp,
        "wiki/Notes.md",
        "---\ntype: person\ntitle: Notes\ndescription: d\ntags: [meta, sprawl]\n---\n\n## Relations\n\n- knows [[Ada]]\n",
      );
      const d = data(tmp, ["vocabulary", "show", "tags"]);
      assert.deepEqual(
        d.observed.map((o) => [o.label, o.count, o.registered]),
        [
          ["meta", 1, true],
          ["sprawl", 1, false],
        ],
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("vocabulary is a read, and its envelope is deterministic", () => {
  it("the same envelope, byte for byte, under bun and node", () => {
    const tmp = scratchVault();
    try {
      for (const args of [
        ["vocabulary", "show", "relations"],
        ["vocabulary", "show", "relations", "--target", "company"],
        ["vocabulary", "show", "tags"],
      ]) {
        const underNode = raw(tmp, args);
        const underBun = raw(tmp, args, "bun");
        assert.equal(underNode.length > 0, true, `node produced an envelope for ${args.join(" ")}`);
        assert.equal(underBun, underNode, `${args.join(" ")} is byte-identical across runtimes`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("running it twice writes nothing and prints the same bytes", () => {
    const tmp = scratchVault();
    try {
      const first = raw(tmp, ["vocabulary", "show", "relations"]);
      const second = raw(tmp, ["vocabulary", "show", "relations"]);
      assert.equal(second, first);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("`vocabulary show` with no name is a usage error listing the registered names", () => {
    const tmp = scratchVault();
    try {
      const bare = run(tmp, ["vocabulary"]);
      assert.equal(bare.status, 2, JSON.stringify(bare.envelope));
      assert.equal(bare.envelope.error?.code, "missing-argument");
      assert.deepEqual(bare.envelope.error?.details?.["valid_values"], ["show"]);
      const r = run(tmp, ["vocabulary", "show"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.code, "missing-argument");
      // The names are the loaded modules' registrations, listed in
      // code-unit order — a closed four-name constant is what a kit's
      // vocabulary could never join.
      assert.deepEqual(r.envelope.error?.details?.["valid_values"], [
        "categories",
        "relations",
        "sources",
        "tags",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a name outside the closed set is a usage error, not a not_found", () => {
    const tmp = scratchVault();
    try {
      const r = run(tmp, ["vocabulary", "show", "rubrics"]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.code, "unknown-vocabulary");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("two answers a bundle author asked to keep", () => {
  const SCRATCH = join(mkdtempSync(join(tmpdir(), "ww-vocab-keep-")), "vault");

  /** A bundle that declares no `relations` vocabulary at all. */
  function bareVault(): string {
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(join(SCRATCH, "config"), { recursive: true });
    mkdirSync(join(SCRATCH, "wiki"), { recursive: true });
    writeFileSync(
      join(SCRATCH, "config", "constitution.json"),
      JSON.stringify(
        documentOf({ types: { note: { extends: "concept", description: "A note." } } }),
      ),
    );
    writeFileSync(
      join(SCRATCH, "config", "engine.json"),
      JSON.stringify({
        content_roots: ["wiki"],
        field_sources: { title: "basename", description: "lede" },
      }),
    );
    writeFileSync(
      join(SCRATCH, "wiki", "a.md"),
      "---\ntype: note\ntags: []\n---\n\n# a\n\nA note.\n",
    );
    return SCRATCH;
  }

  it("an empty answer explains itself: no relations vocabulary, so nothing can be unknown", () => {
    const dir = bareVault();
    try {
      const r = spawnSync(
        process.execPath,
        [CLI, "vocabulary", "show", "relations", "--root", "."],
        { cwd: dir, encoding: "utf8" },
      );
      assert.equal(r.status, 0, r.stdout);
      const data = (JSON.parse(r.stdout) as { data: Record<string, unknown> }).data;
      assert.deepEqual(data["declared"], []);
      assert.equal(data["entries"], 0);
      // An empty answer that does not explain itself is a finding, not a style
      // choice: the note says WHY it is empty rather than leaving a reader to
      // wonder whether the verb broke.
      assert.match(
        String(data["note"] ?? ""),
        /declares no `relations` vocabulary, so nothing is registered and no entry can be unknown/u,
      );
    } finally {
      rmSync(SCRATCH, { recursive: true, force: true });
    }
  });

  it("--target says which block is the answer", () => {
    const dir = bareVault();
    try {
      const r = spawnSync(
        process.execPath,
        [CLI, "vocabulary", "show", "relations", "--target", "note", "--root", "."],
        { cwd: dir, encoding: "utf8" },
      );
      assert.equal(r.status, 0, r.stdout);
      const data = (JSON.parse(r.stdout) as { data: Record<string, unknown> }).data;
      assert.match(
        String(data["note"] ?? ""),
        /the answer to --target is the `target` block; `declared` is the whole vocabulary, unfiltered/u,
      );
      assert.notEqual(data["target"], undefined);
    } finally {
      rmSync(SCRATCH, { recursive: true, force: true });
    }
  });
});

describe("relation-range names the concrete types beside an abstract range", () => {
  it("a range naming an abstract type says which concrete types satisfy it here", () => {
    const tmp = scratchVault();
    try {
      write(tmp, "wiki/Cy.md", page("person", "Cy", ["works_at [[Ada]]"]));
      const r = run(tmp, ["lint", "--page", "wiki/Cy.md"]);
      const findings = (
        r.envelope.data as unknown as { findings: { ruleId: string; message: string }[] }
      ).findings;
      const range = findings.find((f) => f.ruleId === "relation-range");
      assert.notEqual(range, undefined, JSON.stringify(findings));
      assert.equal(
        range?.message,
        '"works_at" points at a person; its range is org (here: charity, company)',
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
