// docs/cli.md §new (the typed write-path gate: write only after validation
// succeeds; the skeleton write meets `write`'s own identity gate; a
// destination outside the content roots is usage; the draft lint sees
// wikilinks; a title is rendered literally; folder tags are seeded at new, and
// folder-tag aliases seed the governing tag) · docs/cli.md §init (every
// shipped code type is creatable)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { grantKit, installKit, runKit } from "./fixtures/kit-code.ts";
import { layMemoryLaw } from "./fixtures/memory-law.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

function run(
  cwd: string,
  args: string[],
  opts?: { stdin?: string },
): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK },
    input: opts?.stdin,
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function errorOf(envelope: Record<string, unknown>): Record<string, unknown> {
  return (envelope["error"] ?? {}) as Record<string, unknown>;
}

function findingsOf(envelope: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = envelope["data"] as Record<string, unknown> | undefined;
  return (data?.["findings"] as Array<Record<string, unknown>> | undefined) ?? [];
}

/** minimal-vault, copied; the deliberately broken page pruned unless asked for. */
function vault(pruneBroken = true): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-new-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  if (pruneBroken) rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  return tmp;
}

describe("new — the typed write-path gate (docs/cli.md §new)", () => {
  it("rejects an unknown type as not_found with valid_values", () => {
    const r = run(FIXTURE, ["new", "no-such-type", "Some title", "--dest", "wiki/x.md"]);
    assert.equal(r.status, 3);
    const details = errorOf(r.envelope)["details"] as { valid_values?: string[] };
    assert.equal(details.valid_values?.includes("test-case"), true);
  });

  it("creates a page that immediately lints clean, folder tags included (docs/cli.md §new)", () => {
    const tmp = vault(false);
    try {
      const dest = "wiki/test-execution/cold-boot.md";
      const r = run(tmp, ["new", "test-case", "Cold boot pass", "--dest", dest]);
      assert.equal(r.status, 0);
      const written = readFileSync(join(tmp, dest), "utf8");
      assert.equal(written.includes("type: test-case"), true);
      assert.equal(written.includes("# Cold boot pass"), true);
      assert.equal(written.includes("test-execution"), true);
      const relint = run(tmp, ["lint", "--page", dest]);
      assert.equal(relint.status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing page as conflict", () => {
    const r = run(FIXTURE, [
      "new",
      "test-case",
      "Warm reset under load",
      "--dest",
      "wiki/test-execution/warm-reset.md",
    ]);
    assert.equal(r.status, 4);
    assert.equal(existsSync(join(FIXTURE, "wiki/test-execution/warm-reset.md")), true);
  });
});

describe("every shipped code type is creatable (docs/cli.md §init)", () => {
  // The starter is a bundle over the code kit (docs/extending.md §The code
  // kit): one fresh vault, installed and granted once; an anchored type is
  // created with its pin, and a type with an obligation with the relation it
  // requires — the typed write path, not a fallback seed.
  const PIN = "0123456789abcdef0123456789abcdef01234567";
  const ANCHOR = ["--set", `pin=${PIN}`, "--set", "origin=.", "--set", 'covers=["src/"]'];
  // Every type but the decision is anchored, and every part carries part_of
  // (the overview is the top, the source map is the map).
  const PART = ["--item", "Relations: part_of [[architecture]]"];
  const CASES: [string, string, string[]][] = [
    ["architecture-overview", "wiki/architecture.md", ANCHOR],
    ["code-concept", "wiki/identity.md", [...ANCHOR, ...PART]],
    ["decision", "wiki/D-001.md", ["--set", "decision_id=D-001", "--set", "decided=2026-09-04"]],
    ["integration", "wiki/github.md", [...ANCHOR, ...PART]],
    ["ops-reference", "wiki/commands-reference.md", [...ANCHOR, ...PART]],
    ["quickstart", "wiki/quickstart.md", [...ANCHOR, ...PART]],
    ["source-map", "wiki/layout.md", ANCHOR],
    [
      "subsystem",
      "wiki/core.md",
      [...ANCHOR, "--item", "Relations: mapped_in [[layout]]", ...PART],
    ],
    ["testing-guide", "wiki/testing.md", [...ANCHOR, ...PART]],
  ];
  let tmp = "";
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "ww-rf-code-"));
    const init = runKit(tmp, ["init", "--constitution", "code"]);
    assert.equal(init.status, 0, JSON.stringify(init.envelope));
    installKit(tmp);
    grantKit(tmp);
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  for (const [type, dest, extra] of CASES) {
    it(`new ${type} succeeds — the kit's template satisfies the type's headings`, () => {
      const r = runKit(tmp, ["new", type, `Page for ${type}`, "--dest", dest, ...extra]);
      assert.equal(r.status, 0, `new ${type} must succeed: ${JSON.stringify(r.envelope)}`);
      assert.equal(runKit(tmp, ["lint", "--page", dest]).status, 0, `${type} lints clean`);
    });
  }
});

describe("new closes its gate holes (docs/cli.md §new)", () => {
  it("rejects a duplicate title at the identity gate, before any write", () => {
    const tmp = vault();
    try {
      const r = run(tmp, [
        "new",
        "test-case",
        "Warm reset under load",
        "--dest",
        "wiki/test-execution/other-name.md",
      ]);
      // `new` is a write: the collision meets `write`'s own identity gate, which
      // names the candidate and asks for `--not-any-of` (exit 10).
      assert.equal(r.status, 10, JSON.stringify(r.envelope));
      assert.equal((r.envelope["error"] as Record<string, unknown>)["code"], "identity-candidates");
      assert.equal(existsSync(join(tmp, "wiki/test-execution/other-name.md")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects a destination outside the content roots as usage", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["new", "test-case", "Orphan", "--dest", "notes/orphan.md"]);
      assert.equal(r.status, 2);
      assert.equal(existsSync(join(tmp, "notes/orphan.md")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("draft lint sees wikilinks: an alias-targeted template link blocks creation", () => {
    const tmp = vault(false);
    try {
      const aliased = readFileSync(join(tmp, "wiki/test-execution/broken-case.md"), "utf8")
        .replace(
          "tags: [mystery, test-execution]",
          'tags: [test-execution]\naliases: ["Broken Alias"]',
        )
        .replace("rogue_key: true\n", "");
      writeFileSync(join(tmp, "wiki/test-execution/broken-case.md"), `${aliased}\n## Execution\n`);
      writeFileSync(
        join(tmp, "templates/wiki/test-case.md"),
        '---\ntype: test-case\ntitle: "Template seed"\ndescription: ""\ncase_id: ""\ntags: []\n---\n\n# {{ title }}\n\nSee [[Broken Alias]].\n\n## Purpose\n\n## Execution\n',
      );
      const r = run(tmp, ["new", "test-case", "Linky", "--dest", "wiki/test-execution/linky.md"]);
      assert.equal(r.status, 5, "alias-targeted link in draft must block the write");
      assert.equal(existsSync(join(tmp, "wiki/test-execution/linky.md")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("renders titles containing replacement patterns literally", () => {
    const tmp = vault();
    try {
      const r = run(tmp, [
        "new",
        "test-case",
        "Save $$ now",
        "--dest",
        "wiki/test-execution/save.md",
      ]);
      assert.equal(r.status, 0);
      const written = readFileSync(join(tmp, "wiki/test-execution/save.md"), "utf8");
      assert.equal(written.includes("# Save $$ now"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("new honors folder-tag aliases under the declared mode", () => {
  it("creating a page in an aliased folder seeds the governing tag", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-alias-new-"));
    try {
      mkdirSync(join(tmp, "config"));
      mkdirSync(join(tmp, "journal", "daily"), { recursive: true });
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify(
          documentOf({
            tags: { "journal-daily": { description: "Daily notes." } },
            types: { daily: { extends: "reference", description: "One day." } },
          }),
        ),
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({
          content_roots: ["journal"],
          folder_tag_aliases: { daily: "journal-daily" },
          folder_tags: { mode: "validate" },
          field_sources: { title: "basename", description: "lede" },
        }),
      );
      const r = run(tmp, ["new", "daily", "2026-09-02", "--dest", "journal/daily/2026-09-02.md"]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const written = readFileSync(join(tmp, "journal", "daily", "2026-09-02.md"), "utf8");
      assert.match(written, /"journal-daily"/, "the ALIASED tag is seeded, not the raw segment");
      assert.equal(written.includes(`"daily"`), false, "the raw segment is not seeded");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("pre-write gates make the identical identity judgment", () => {
  function derivedVault(): string {
    const tmp = mkdtempSync(join(tmpdir(), "ww-idgate-"));
    mkdirSync(join(tmp, "config"));
    mkdirSync(join(tmp, "wiki"));
    writeFileSync(
      join(tmp, "config", "constitution.json"),
      JSON.stringify(
        documentOf({ types: { note: { extends: "concept", description: "A note." } } }),
      ),
    );
    writeFileSync(
      join(tmp, "config", "engine.json"),
      JSON.stringify({
        content_roots: ["wiki"],
        field_sources: { title: "basename", description: "lede" },
      }),
    );
    writeFileSync(
      join(tmp, "wiki", "alpha.md"),
      "---\ntype: note\ntags: []\n---\n\n# alpha\n\nDerives its title.\n",
    );
    return tmp;
  }

  it("new refuses a title colliding with another page's DERIVED title, as write would", () => {
    const tmp = derivedVault();
    try {
      // `new` is the skeleton write: the identity gate it meets is `write`'s own
      // — the candidate tiers first, and the judge's `identity-collision` once
      // every candidate is ruled out. No second reading of identity lives in `new`.
      const r = run(tmp, ["new", "note", "alpha", "--dest", "wiki/beta.md"]);
      assert.equal(r.status, 10, JSON.stringify(r.envelope));
      assert.equal((r.envelope["error"] as Record<string, unknown>)["code"], "identity-candidates");
      const forced = run(tmp, [
        "new",
        "note",
        "alpha",
        "--dest",
        "wiki/beta.md",
        "--not-any-of",
        "alpha",
      ]);
      assert.equal(forced.status, 5, JSON.stringify(forced.envelope));
      assert.equal(
        findingsOf(forced.envelope).some((f) => f["ruleId"] === "identity-collision"),
        true,
        JSON.stringify(forced.envelope),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("lint --stdin reports the same collision new refuses", () => {
    const tmp = derivedVault();
    try {
      const draft = "---\ntype: note\ntitle: alpha\ndescription: d.\ntags: []\n---\n\n# beta\n";
      const r = run(tmp, ["lint", "--stdin", "--path", "wiki/beta.md"], { stdin: draft });
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "identity-collision"),
        true,
        "the two pre-write gates give one verdict",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("one collision is one finding — never double-reported", () => {
    const tmp = derivedVault();
    try {
      mkdirSync(join(tmp, "wiki", "b"));
      writeFileSync(
        join(tmp, "wiki", "b", "alpha.md"),
        "---\ntype: note\ntags: []\n---\n\n# alpha again\n\nLede.\n",
      );
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 5);
      const collisions = findingsOf(r.envelope).filter((f) => f["ruleId"] === "identity-collision");
      assert.equal(collisions.length, 1, JSON.stringify(collisions));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("new --set fills the skeleton's frontmatter, typed by each field's shape (docs/cli.md §new)", () => {
  /**
   * The shape of a program wiki's `requirement`: a patterned required id and
   * a required page-ref list — the type `new` could never create from its own
   * skeleton, because the `""` stub fails both shapes.
   */
  function programVault(): string {
    const tmp = mkdtempSync(join(tmpdir(), "ww-new-set-"));
    mkdirSync(join(tmp, "config"));
    mkdirSync(join(tmp, "wiki", "spec"), { recursive: true });
    mkdirSync(join(tmp, "raw"));
    writeFileSync(
      join(tmp, "config", "constitution.json"),
      JSON.stringify({
        schema: "wikiwright/constitution",
        schema_version: 3,
        vocabularies: {
          tags: {
            mode: "registered",
            entries: {
              spec: { description: "Requirements." },
              reviewed: { description: "Read by a second pair of eyes." },
            },
          },
        },
        types: {
          source: { extends: "reference", description: "A captured source." },
          requirement: {
            extends: "reference",
            description: "One numbered requirement.",
            fields: {
              req_id: { kind: "string", required: true, pattern: "^REQ-[0-9]{3}$" },
              sources: {
                kind: "page-ref-list",
                target_root: "raw",
                target_type: "source",
                required: true,
              },
              priority: { kind: "integer", min: 1, max: 5 },
              verified: { kind: "boolean" },
              notes: { kind: "list", item: { kind: "string" } },
              pin: { kind: "pin", origin: "origin" },
              origin: { kind: "string" },
            },
            sections: { depth: 2, list: [{ heading: "Statement", min: 1, max: 1 }] },
          },
        },
      }),
    );
    writeFileSync(
      join(tmp, "config", "engine.json"),
      JSON.stringify({ content_roots: ["wiki", "raw"], folder_tags: { mode: "validate" } }),
    );
    writeFileSync(
      join(tmp, "raw", "datasheet.md"),
      "---\ntype: source\ntitle: Datasheet\ndescription: The datasheet.\ntags: []\n---\n\n# Datasheet\n",
    );
    return tmp;
  }

  const DEST = "wiki/spec/REQ-002.md";
  const NEW = ["new", "requirement", "Reset vector", "--dest", DEST];

  it("tags takes a JSON list whatever its declared shape, merged with the folder tags; a bare word is refused with the list form", () => {
    // `tags` is an engine key whose shape the engine knows — a list —
    // so the text `["kernel"]` is a list and never a quoted YAML string.
    const tmp = programVault();
    try {
      // The bare word first: the destination is free, so the refusal is the
      // value's, not the page's.
      const bare = run(tmp, [...NEW, "--set", "tags=kernel"]);
      assert.equal(bare.status, 2, JSON.stringify(bare.envelope));
      assert.equal(errorOf(bare.envelope)["code"], "invalid-value");
      assert.match(String(errorOf(bare.envelope)["hint"]), /--set tags='\["one", "two"\]'/u);
      assert.deepEqual((errorOf(bare.envelope)["details"] as { kind: string }).kind, "list");
      const r = run(tmp, [
        ...NEW,
        "--set",
        "req_id=REQ-002",
        "--set",
        'sources=["datasheet"]',
        "--set",
        'tags=["reviewed"]',
      ]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const written = readFileSync(join(tmp, DEST), "utf8");
      assert.equal(
        written.includes('tags: ["spec", "reviewed"]\n'),
        true,
        `folder tag first, then --set: ${written}`,
      );
      assert.equal(run(tmp, ["lint", "--page", DEST]).status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a refused skeleton carries the preview the accepted dry run prints", () => {
    const tmp = programVault();
    try {
      const r = run(tmp, NEW);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      const preview = String((r.envelope["data"] as Record<string, unknown>)["preview"]);
      assert.match(preview, /^# Reset vector$/mu, "the judged draft, as bytes");
      assert.match(preview, /^req_id: ""$/mu, "the stub the refusal is about is visible");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a pin takes its commit id as text, like every other string-valued kind", () => {
    const tmp = programVault();
    try {
      const pin = "0123456789abcdef0123456789abcdef01234567";
      const r = run(tmp, [
        ...NEW,
        "--set",
        "req_id=REQ-002",
        "--set",
        'sources=["datasheet"]',
        "--set",
        `pin=${pin}`,
        "--set",
        "origin=.",
      ]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const text = readFileSync(join(tmp, DEST), "utf8");
      assert.match(text, new RegExp(`^pin: ${pin}$`, "mu"));
      assert.match(text, /^origin: \.$/mu);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("without --set the skeleton is refused, and the refusal names the fields --set would fill", () => {
    const tmp = programVault();
    try {
      const r = run(tmp, NEW);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      const error = errorOf(r.envelope);
      assert.equal(error["code"], "draft-invalid");
      assert.match(String(error["hint"]), /--set req_id=<value> --set sources=<json>/);
      const set = (error["details"] as { set: Array<Record<string, string>> }).set;
      assert.deepEqual(set, [
        { field: "req_id", kind: "string", value: "the raw text" },
        { field: "sources", kind: "page-ref-list", value: "JSON" },
      ]);
      assert.equal(existsSync(join(tmp, DEST)), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a string shape takes the raw value and a list shape takes JSON; the page lands and lints clean", () => {
    const tmp = programVault();
    try {
      const r = run(tmp, [...NEW, "--set", "req_id=REQ-002", "--set", 'sources=["datasheet"]']);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const written = readFileSync(join(tmp, DEST), "utf8");
      assert.equal(written.includes("req_id: REQ-002\n"), true, written);
      assert.equal(written.includes('sources: ["datasheet"]\n'), true, written);
      assert.equal(written.includes('tags: ["spec"]\n'), true, "the folder tag is still seeded");
      assert.equal(run(tmp, ["lint", "--page", DEST]).status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a number, a boolean and a list of strings render as YAML the shapes accept", () => {
    const tmp = programVault();
    try {
      const r = run(tmp, [
        ...NEW,
        "--set",
        "req_id=REQ-002",
        "--set",
        'sources=["datasheet"]',
        "--set",
        "priority=3",
        "--set",
        "verified=true",
        "--set",
        'notes=["a: b", "c"]',
        "--set",
        "description=Where the CPU starts: FFFF0h.",
      ]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const written = readFileSync(join(tmp, DEST), "utf8");
      assert.equal(written.includes("priority: 3\n"), true, written);
      assert.equal(written.includes("verified: true\n"), true, written);
      assert.equal(written.includes('notes: ["a: b","c"]\n'), true, written);
      // A scalar with `: ` is quoted by the Writer's own renderer.
      assert.equal(
        written.includes('description: "Where the CPU starts: FFFF0h."\n'),
        true,
        written,
      );
      assert.equal(run(tmp, ["lint", "--page", DEST]).status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an undeclared field is usage with the declared fields listed; a non-JSON list is usage too", () => {
    const tmp = programVault();
    try {
      const unknown = run(tmp, [...NEW, "--set", "owner=someone"]);
      assert.equal(unknown.status, 2, JSON.stringify(unknown.envelope));
      assert.equal(errorOf(unknown.envelope)["code"], "unknown-field");
      const details = errorOf(unknown.envelope)["details"] as { valid_values: string[] };
      // The type's own fields and the engine's, since every one is settable.
      assert.deepEqual(details.valid_values, [
        "aliases",
        "description",
        "exceptions",
        "notes",
        "origin",
        "pin",
        "priority",
        "req_id",
        "sources",
        "status",
        "superseded_by",
        "supersedes",
        "tags",
        "verified",
      ]);
      const notJson = run(tmp, [...NEW, "--set", "req_id=REQ-002", "--set", "sources=[datasheet]"]);
      assert.equal(notJson.status, 2, JSON.stringify(notJson.envelope));
      assert.equal(errorOf(notJson.envelope)["code"], "invalid-value");
      assert.match(String(errorOf(notJson.envelope)["hint"]), /--set sources='\["one", "two"\]'/);
      assert.equal(existsSync(join(tmp, DEST)), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a value the shape refuses is judged like any draft, and --dry-run previews the rendered value", () => {
    const tmp = programVault();
    try {
      const bad = run(tmp, [...NEW, "--set", "req_id=REQ-9", "--set", 'sources=["datasheet"]']);
      assert.equal(bad.status, 5, JSON.stringify(bad.envelope));
      const shape = findingsOf(bad.envelope).find((f) => f["ruleId"] === "field-shape");
      assert.match(String(shape?.["message"]), /req_id/);
      assert.equal(
        errorOf(bad.envelope)["hint"],
        undefined,
        "nothing left to --set: the hint is about stubs, not about a value the shape refused",
      );
      const dry = run(tmp, [
        ...NEW,
        "--set",
        "req_id=REQ-002",
        "--set",
        'sources=["datasheet"]',
        "--dry-run",
      ]);
      assert.equal(dry.status, 0, JSON.stringify(dry.envelope));
      const data = dry.envelope["data"] as { wrote: boolean; preview: string };
      assert.equal(data.wrote, false);
      assert.match(data.preview, /req_id: REQ-002/);
      assert.equal(existsSync(join(tmp, DEST)), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("new --item: a line under a declared section of the skeleton", () => {
  it("lands each line under its section, adds a missing heading, and the type's grammar judges it", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-new-item-"));
    try {
      layMemoryLaw(tmp);
      mkdirSync(join(tmp, "wiki", "Folk"), { recursive: true });
      const dest = "wiki/Folk/Zed.md";
      const r = run(tmp, [
        "new",
        "person",
        "Zed",
        "--dest",
        dest,
        "--item",
        "Relations: knows [[Charter]]",
        "--item",
        "Notes: A note in prose.",
        "--item",
        "Facts: [identity] Zed is a person (stated 2026-01-01)",
      ]);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
      const written = readFileSync(join(tmp, dest), "utf8");
      assert.match(
        written,
        /## Relations\n\n- knows \[\[Charter\]\]/u,
        "a bare line gets the item marker",
      );
      assert.match(written, /## Notes\n\nA note in prose\./u, "prose is verbatim, heading added");
      assert.match(written, /## Facts\n\n- \[identity\] Zed is a person \(stated 2026-01-01\)/u);
      const data = r.envelope["data"] as { items?: { section: string; created: boolean }[] };
      assert.deepEqual(
        data.items?.map((i) => [i.section, i.created]),
        [
          ["Relations", false],
          ["Notes", true],
          ["Facts", false],
        ],
      );
      assert.equal(run(tmp, ["lint", "--page", dest]).status, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("an item the section's grammar cannot parse is a draft-invalid finding, never a private parse", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-new-item-"));
    try {
      layMemoryLaw(tmp);
      // The memory law reports an unparsed item as a warning; the kit that
      // asked for this flag gates its Relations at `error`, so ratchet the
      // fragment the same way and the refusal is the grammar's own finding.
      const law = join(tmp, "config", "constitution.json");
      const doc = JSON.parse(readFileSync(law, "utf8")) as {
        fragments: Record<string, { sections: { list: Record<string, unknown>[] } }>;
      };
      const relations = doc.fragments["entity-body"]?.sections.list.find(
        (e) => e["heading"] === "Relations",
      );
      if (relations !== undefined) relations["severity"] = "error";
      writeFileSync(law, `${JSON.stringify(doc, null, 2)}\n`);
      const r = run(tmp, [
        "new",
        "person",
        "Zed",
        "--dest",
        "wiki/Zed.md",
        "--item",
        "Relations: not a relation at all",
      ]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      assert.equal(
        findingsOf(r.envelope).some((f) => f["ruleId"] === "grammar-unparsed"),
        true,
      );
      assert.equal(existsSync(join(tmp, "wiki/Zed.md")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a heading the type does not declare is refused with the declared sections listed", () => {
    const tmp = vault();
    try {
      const r = run(tmp, [
        "new",
        "test-case",
        "X",
        "--dest",
        "wiki/test-execution/x.md",
        "--item",
        "Bogus: a line",
      ]);
      assert.equal(r.status, 2, JSON.stringify(r.envelope));
      assert.equal(errorOf(r.envelope)["code"], "unknown-section");
      assert.deepEqual(
        (errorOf(r.envelope)["details"] as { valid_values?: string[] })["valid_values"],
        ["Purpose", "Execution"],
      );
      const malformed = run(tmp, [
        "new",
        "test-case",
        "X",
        "--dest",
        "wiki/test-execution/x.md",
        "--item",
        "no separator here",
      ]);
      assert.equal(errorOf(malformed.envelope)["code"], "invalid-value");
      assert.equal(existsSync(join(tmp, "wiki/test-execution/x.md")), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
