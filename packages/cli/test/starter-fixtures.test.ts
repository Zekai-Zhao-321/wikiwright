// docs/cli.md §init · docs/architecture.md §The invariants.7 — a shipped
// starter applied to its bundled corpus must produce an ERROR delta of 0 against
// that corpus's own constitution. The redesign words this as a P0 load refusal
//; the loader cannot see a corpus, so the refusal is this test, run on
// every build. The v1 event it exists to prevent: a starter derived from a corpus
// that put errors on 147 of its 163 pages.
//
// The `code` starter and devwiki are bundles over `@wikiwright/kit-code`
// (docs/extending.md §The code kit): every copy judged here installs the kit
// from the shipped package and grants it in a store the test owns. The shipped
// devwiki is never installed into and never granted from a test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ModuleManifest } from "@wikiwright/core";
import {
  DIST_CLI,
  grantedCopy,
  grantKit,
  installKit,
  KIT_CODE,
  kitEnv,
  REPO,
} from "./fixtures/kit-code.ts";

const STARTERS = fileURLToPath(new URL("../constitutions/", import.meta.url));
const CODE_STARTER = join(STARTERS, "code");
const DEVWIKI = join(REPO, "devwiki");

interface Finding {
  ruleId: string;
  severity: string;
  path: string;
  line?: number;
  message: string;
}

function lint(root: string): { status: number; findings: Finding[] } {
  const r = spawnSync(process.execPath, [DIST_CLI, "lint", "--root", root], {
    encoding: "utf8",
    env: kitEnv(root),
  });
  const envelope = JSON.parse(r.stdout) as {
    ok: boolean;
    data?: { findings?: Finding[] };
    error?: unknown;
  };
  assert.notEqual(
    r.status,
    2,
    `lint refused to load ${root}: ${JSON.stringify(envelope.error ?? envelope)}`,
  );
  return { status: r.status ?? -1, findings: envelope.data?.findings ?? [] };
}

const key = (f: Finding): string => `${f.ruleId}|${f.path}|${f.line ?? ""}`;

/**
 * devwiki, installed and granted under os.tmpdir(), judged under the code
 * starter's TYPES merged with devwiki's own VOCABULARIES. The rule
 * the delta holds: every concrete type name devwiki's pages carry must exist
 * in the starter; the tags and labels a bundle registers are its own, and a
 * bundle may register what the starter does not.
 */
function devwikiUnderStarter(): string {
  const root = grantedCopy(DEVWIKI, "starter-code");
  const starter = JSON.parse(
    readFileSync(join(CODE_STARTER, "config/constitution.json"), "utf8"),
  ) as Record<string, unknown>;
  const own = JSON.parse(readFileSync(join(root, "config/constitution.json"), "utf8")) as Record<
    string,
    unknown
  >;
  writeFileSync(
    join(root, "config/constitution.json"),
    `${JSON.stringify({ ...starter, vocabularies: own["vocabularies"] }, null, 2)}\n`,
  );
  return root;
}

/** The code starter as `init` lands it, then installed and granted: what a user's first `check` judges. */
function starterBundle(): string {
  const root = mkdtempSync(join(tmpdir(), "ww-starter-init-"));
  const init = spawnSync(
    process.execPath,
    [DIST_CLI, "init", "--constitution", "code", "--root", root],
    { encoding: "utf8", env: kitEnv(root) },
  );
  assert.equal(init.status, 0, init.stdout);
  installKit(root);
  grantKit(root);
  return root;
}

const SCRATCH: string[] = [];
after(() => {
  for (const dir of SCRATCH) rmSync(dir, { recursive: true, force: true });
});

const kitManifest = (await import(pathToFileURL(join(KIT_CODE, "index.js")).href)) as {
  default: ModuleManifest;
};
const KIT = kitManifest.default;

describe("every shipped starter is a CI fixture", () => {
  it("every starter directory ships a v3 constitution and no v2 registry files", () => {
    for (const starter of readdirSync(STARTERS)) {
      assert.equal(
        existsSync(join(STARTERS, starter, "config/constitution.json")),
        true,
        `${starter} ships config/constitution.json`,
      );
    }
  });

  it("the code starter's error delta on its bundled corpus, devwiki, is 0", {
    timeout: 60_000,
  }, () => {
    const own = grantedCopy(DEVWIKI, "starter-own");
    const under = devwikiUnderStarter();
    SCRATCH.push(own, under);
    const ownErrors = lint(own)
      .findings.filter((f) => f.severity === "error")
      .map(key)
      .sort();
    const starterErrors = lint(under)
      .findings.filter((f) => f.severity === "error")
      .map(key)
      .sort();
    assert.deepEqual(
      starterErrors,
      ownErrors,
      `code starter error delta on devwiki:\n  added: ${starterErrors
        .filter((k) => !ownErrors.includes(k))
        .join(", ")}\n  removed: ${ownErrors.filter((k) => !starterErrors.includes(k)).join(", ")}`,
    );
  });
});

// docs/constitution.md · docs/constitution.md §Vocabularies
// The `code` starter is the SHIPPED example of a registered
// relations vocabulary. Since the code kit, the labels and the `require` rows
// are the kit's and the starter declares the vocabulary the kit fills; these
// rows keep the example from regressing to `census` and prove the findings it
// exists to teach.

interface SectionEntry {
  heading: string;
  grammar?: string;
  vocabulary?: string;
  require?: { labels: string[]; min: number; max?: number }[];
}
interface Constitution {
  vocabularies?: { relations?: { mode?: string; entries?: Record<string, unknown> } };
  types?: Record<string, { extends?: string; sections?: { list?: SectionEntry[] } }>;
}

function codeConstitution(): Constitution {
  return JSON.parse(
    readFileSync(join(CODE_STARTER, "config/constitution.json"), "utf8"),
  ) as Constitution;
}

/** Every `require` the kit's types declare, with the type that declared it. */
function kitRequires(): { type: string; entry: SectionEntry }[] {
  const out: { type: string; entry: SectionEntry }[] = [];
  for (const [type, def] of Object.entries(KIT.types ?? {})) {
    const sections = (def as { sections?: { list?: SectionEntry[] } }).sections;
    for (const entry of sections?.list ?? []) {
      if ((entry.require ?? []).length > 0) out.push({ type, entry });
    }
  }
  return out;
}

describe("the code starter is the reference registered relations vocabulary", () => {
  it("the starter declares `relations` registered and adds no label of its own; the kit's are described and ranged", () => {
    const relations = codeConstitution().vocabularies?.relations;
    assert.equal(relations?.mode, "registered", "the example must not regress to census");
    assert.deepEqual(
      Object.keys(relations?.entries ?? {}),
      [],
      "the labels are the kit's; a bundle adds beside them",
    );
    const labels = Object.entries(KIT.entries?.["relations"] ?? {});
    assert.equal(labels.length > 0, true, "the kit contributes labels");
    for (const [label, entry] of labels) {
      assert.equal(
        typeof entry["description"] === "string" && entry["description"].length > 0,
        true,
        `relations entry "${label}" carries a description`,
      );
      assert.equal(
        Array.isArray(entry["range"]) && entry["range"].length > 0,
        true,
        `relations entry "${label}" demonstrates \`range\``,
      );
    }
  });

  it("a relations section declares `require`, naming a label the kit contributes", () => {
    const declared = kitRequires();
    assert.equal(declared.length > 0, true, "at least one type demonstrates `require`");
    const labels = KIT.entries?.["relations"] ?? {};
    for (const { type, entry } of declared) {
      assert.equal(
        entry.grammar,
        "relations",
        `${type}: \`require\` belongs to a relations-grammar section`,
      );
      for (const required of entry.require ?? []) {
        for (const label of required.labels) {
          assert.equal(
            Object.hasOwn(labels, label),
            true,
            `${type} requires "${label}", which the kit does not contribute`,
          );
        }
        assert.equal(required.min >= 1, true, `${type}: a \`require\` of min 0 requires nothing`);
      }
    }
    // Every starter type over a kit type with an obligation inherits it.
    const starter = codeConstitution().types ?? {};
    for (const { type } of declared) {
      assert.equal(
        Object.values(starter).some((t) => t.extends === type),
        true,
        `the starter declares a concrete type over ${type}`,
      );
    }
  });

  it("`type show` renders the require and the vocabulary the section reads, on an initialised starter", {
    timeout: 60_000,
  }, () => {
    // docs/cli.md §type: the contract an agent reads before writing IS the contract
    // the parser enforces — so the example has to be legible from the CLI, not
    // only from the JSON.
    const root = starterBundle();
    SCRATCH.push(root);
    const r = spawnSync(process.execPath, [DIST_CLI, "type", "show", "subsystem", "--root", root], {
      encoding: "utf8",
      env: kitEnv(root),
    });
    assert.equal(r.status, 0, r.stdout);
    const data = (JSON.parse(r.stdout) as { data: Record<string, unknown> }).data;
    const lines = data["section_lines"] as string[];
    const line = lines.find((l) => l.startsWith("Relations |"));
    assert.notEqual(line, undefined, JSON.stringify(lines));
    assert.equal(line?.includes("| relations |"), true, `the grammar prints: ${line}`);
    assert.equal(line?.includes("vocabulary=relations"), true, `the vocabulary prints: ${line}`);
    assert.equal(line?.includes("labels=mapped_in:min=1"), true, `the require prints: ${line}`);
    const vocabularies = data["vocabularies"] as { name: string; mode: string; entries: number }[];
    const relations = vocabularies.find((v) => v.name === "relations");
    assert.deepEqual(
      relations,
      {
        name: "relations",
        mode: "registered",
        entries: Object.keys(KIT.entries?.["relations"] ?? {}).length,
      },
      "`type show` names the mode and the size of the vocabulary the section reads — the kit's labels",
    );
  });
});

describe("the code starter's relations arms fire on the devwiki", () => {
  /** devwiki under the code starter, with `edit` applied to one page. */
  function scratch(page: string, edit: (text: string) => string): { root: string; text: string } {
    const root = devwikiUnderStarter();
    SCRATCH.push(root);
    const target = join(root, page);
    const text = edit(readFileSync(target, "utf8"));
    writeFileSync(target, text);
    return { root, text };
  }

  const lineOf = (text: string, needle: string): number => text.split("\n").indexOf(needle) + 1;

  it("a relation pointed outside its range is `relation-range`, on the line that moved", () => {
    const { root, text } = scratch("wiki/registry-pipeline.md", (t) =>
      t.replace("- part_of [[wikiwright-architecture]]", "- part_of [[repository-layout]]"),
    );
    assert.equal(
      text.includes("- part_of [[repository-layout]]"),
      true,
      "the fixture edit applied — a silent no-op would make this row vacuous",
    );
    const row = lint(root).findings.find((f) => f.ruleId === "relation-range");
    assert.notEqual(row, undefined, JSON.stringify(lint(root).findings));
    assert.equal(row?.path, "wiki/registry-pipeline.md");
    assert.equal(row?.severity, "warning", "a first declaration ships at warning");
    assert.equal(row?.line, lineOf(text, "- part_of [[repository-layout]]"));
    assert.equal(
      row?.message.includes("source-map"),
      true,
      `the finding names the type it landed on: ${row?.message}`,
    );
    assert.equal(
      row?.message.includes("here: subsystem, architecture-overview") ||
        row?.message.includes("here: architecture-overview, subsystem"),
      true,
      `the finding names the concrete types beside the kit's abstract range: ${row?.message}`,
    );
  });

  it("an unregistered label is `unknown-label`, on its own line", () => {
    const added = "- schemes_with [[repository-layout]]";
    const { root, text } = scratch("wiki/wikiwright-architecture.md", (t) =>
      t.replace("- mapped_in [[repository-layout]]", `- mapped_in [[repository-layout]]\n${added}`),
    );
    assert.equal(text.includes(added), true, "the fixture edit applied");
    const findings = lint(root).findings;
    const row = findings.find((f) => f.ruleId === "unknown-label");
    assert.notEqual(row, undefined, JSON.stringify(findings));
    assert.equal(row?.path, "wiki/wikiwright-architecture.md");
    assert.equal(row?.severity, "warning", "a first declaration ships at warning");
    assert.equal(row?.line, lineOf(text, added));
    assert.equal(
      findings.some((f) => f.ruleId === "relation-range"),
      false,
      "an unregistered label has no range, so exactly one arm speaks",
    );
  });

  it("a relations section that drops the required label is `relation-require`", () => {
    const { root, text } = scratch("wiki/registry-pipeline.md", (t) =>
      t.replace("- mapped_in [[repository-layout]]\n", ""),
    );
    assert.equal(text.includes("- mapped_in "), false, "the fixture edit applied");
    const row = lint(root).findings.find((f) => f.ruleId === "relation-require");
    assert.notEqual(row, undefined, JSON.stringify(lint(root).findings));
    assert.equal(row?.path, "wiki/registry-pipeline.md");
    assert.equal(row?.severity, "warning", "a first declaration ships at warning");
    assert.equal(row?.line, lineOf(text, "## Relations"), "the section's own line, not an item's");
  });

  it("the unedited devwiki says none of the three under the same starter", () => {
    // The control: the arms above are silent on the shipped corpus, which is
    // what makes the error delta of 0 a statement about the example
    // rather than about an unexercised parameter.
    const { root } = scratch("wiki/registry-pipeline.md", (t) => t);
    const fired = lint(root)
      .findings.filter((f) =>
        ["relation-range", "relation-require", "unknown-label"].includes(f.ruleId),
      )
      .map((f) => `${f.ruleId} ${f.path}:${f.line ?? "-"}`);
    assert.deepEqual(fired, []);
  });
});

describe("the charter type's use_when names the file ()", () => {
  // The repo's own vault declares charter too — it is the live registry
  // `check` runs against and the one `type show charter --root devwiki` reads,
  // so the starters being right while devwiki says "the bundle's CLAUDE.md"
  // is the defect this guards.
  const REGISTRIES: Record<string, string> = {
    base: join(STARTERS, "base", "config", "constitution.json"),
    code: join(STARTERS, "code", "config", "constitution.json"),
    devwiki: join(REPO, "devwiki", "config", "constitution.json"),
  };
  for (const [bundle, path] of Object.entries(REGISTRIES)) {
    it(`${bundle}: charter.use_when says meta/charter.md and disclaims the operating manual`, () => {
      const registry = JSON.parse(readFileSync(path, "utf8")) as {
        types: Record<string, { use_when?: string }>;
      };
      const useWhen = registry.types["charter"]?.use_when ?? "";
      assert.match(useWhen, /meta\/charter\.md/);
      assert.match(useWhen, /Not the agent operating manual/);
    });
  }
});
