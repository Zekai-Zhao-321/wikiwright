// docs/constitution.md §exports: the plan of one export — every file its copy
// holds, and the findings that refuse or qualify it — computed from the
// source's pages and files, never from the clock or the machine.
//
// In process, over gardening bundles and copies of the orchard handbook under
// os.tmpdir().
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parsedPages } from "@wikiwright/core";
import { contentDigestOf, lawDigest } from "../src/bundle.ts";
import { COMMANDS } from "../src/commands.ts";
import {
  type ExportPlan,
  exportPlans,
  fsExportSource,
  planExport,
  pluginManifests,
  SKILL_PATH,
} from "../src/exports.ts";
import { rootsOf, type VaultOk } from "../src/law.ts";
import { MARKER_PATH } from "../src/marker.ts";
import { declaredModulesOf, preloadModules } from "../src/moduleload.ts";
import { fsState } from "../src/state.ts";
import { loadVault } from "../src/vaultio.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const ORCHARD = join(REPO, "fixtures", "handbooks", "orchard");
const KIT_GARDEN = fileURLToPath(new URL("./fixtures/kit-garden", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-export-plan-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A one-pixel PNG, the bytes of an image a page embeds. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let serial = 0;

function write(root: string, files: Record<string, string | Buffer>): void {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
}

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: {
    tags: {
      mode: "registered",
      entries: {
        compost: { description: "Making and using compost." },
        beds: { description: "The beds and what grows in them." },
      },
    },
  },
  types: { note: { extends: "concept", description: "A gardening note." } },
};

const note = (title: string, tags: string[], body: string): string =>
  `---\ntype: note\ntitle: ${title}\ndescription: ${title}, briefly.\ntags: [${tags.join(", ")}]\n---\n\n# ${title}\n\n${body}\n`;

/** A gardening bundle under the scratch directory. */
function garden(
  engine: Record<string, unknown>,
  files: Record<string, string | Buffer>,
  constitution: Record<string, unknown> = CONSTITUTION,
): string {
  const root = join(SCRATCH, `garden-${++serial}`);
  write(root, {
    "config/constitution.json": `${JSON.stringify(constitution, null, 2)}\n`,
    "config/engine.json": `${JSON.stringify(engine, null, 2)}\n`,
    ...files,
  });
  return root;
}

async function loaded(root: string): Promise<VaultOk> {
  const declarations = declaredModulesOf(root);
  if (declarations.length > 0) await preloadModules(root, declarations);
  const vault = await loadVault("check", root);
  assert.equal(vault.ok, true, vault.ok ? "" : JSON.stringify(vault.result.envelope));
  if (!vault.ok) throw new Error("unreachable");
  return vault;
}

/** Every export the bundle at `root` declares, planned from its working tree under `label`. */
async function plans(root: string, label: string): Promise<ExportPlan[]> {
  const vault = await loaded(root);
  const source = fsExportSource(root, parsedPages(fsState(root, rootsOf(vault))));
  const declared = exportPlans(vault, label);
  return declared.map((declaration) =>
    planExport({ vault, source, declaration, label, commands: COMMANDS, siblings: declared }),
  );
}

function text(plan: ExportPlan, path: string): string {
  const file = plan.files?.find((f) => f.path === path);
  assert.notEqual(file, undefined, `${plan.export.name} carries no ${path}`);
  return file?.bytes.toString("utf8") ?? "";
}

const paths = (plan: ExportPlan): string[] => (plan.files ?? []).map((f) => f.path);
const rules = (plan: ExportPlan): string[] => plan.findings.map((f) => f.ruleId);

describe("the plan of an export (docs/constitution.md §exports)", () => {
  it("a whole handbook: its pages, its config verbatim, the marker, the skill text and the regenerated artifacts", async () => {
    const root = join(SCRATCH, `orchard-${++serial}`);
    cpSync(ORCHARD, root, { recursive: true });
    const [whole, pruning] = await plans(root, "orchard");
    assert.ok(whole !== undefined && pruning !== undefined);
    assert.deepEqual(rules(whole), []);
    assert.deepEqual(paths(whole), [
      "SKILL.md",
      "config/constitution.json",
      "config/engine.json",
      "config/export.json",
      "generated/BRIEF.md",
      "generated/graph.json",
      "generated/manifest.json",
      "generated/tag-catalog.md",
      "wiki/pruning-roses.md",
      "wiki/start-here.md",
      "wiki/thinning-apples.md",
    ]);
    for (const path of ["config/constitution.json", "config/engine.json", "wiki/start-here.md"]) {
      assert.equal(text(whole, path), readFileSync(join(root, path), "utf8"), `${path} verbatim`);
    }
    // The whole bundle's artifacts are the source's own.
    for (const path of ["generated/graph.json", "generated/manifest.json"]) {
      assert.equal(text(whole, path), readFileSync(join(root, path), "utf8"), path);
    }
    const brief = text(whole, "generated/BRIEF.md");
    assert.match(brief, /^# wikiwright — the consumer's brief$/mu);
    assert.match(brief, /^Export: `orchard`, a read-only copy of the bundle `orchard`\.$/mu);

    // The marker: its keys in order, no commit and no date.
    const marker = JSON.parse(text(whole, MARKER_PATH)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(marker), [
      "schema",
      "version",
      "name",
      "bundle",
      "select",
      "sources",
      "output",
      "links",
      "cut",
      "pages",
      "source",
      "contribution",
      "guide",
      "license",
      "engine",
    ]);
    const vault = await loaded(root);
    assert.deepEqual(marker["source"], {
      repository: null,
      law: lawDigest(root, vault.lawText.constitution, vault.lawText.engine, []),
      content: contentDigestOf(
        ["wiki/pruning-roses.md", "wiki/start-here.md", "wiki/thinning-apples.md"].map((path) => ({
          path,
          bytes: readFileSync(join(root, path)),
        })),
      ),
    });
    assert.equal(marker["pages"], 3);
    assert.deepEqual(marker["cut"], { links: 0, citations: 0, attachments: 0 });
    assert.equal(text(whole, MARKER_PATH).endsWith("}\n"), true);

    // The skill text: the frontmatter a host reads, the guide, the mode.
    const skill = text(whole, SKILL_PATH);
    assert.match(skill, /^name: orchard$/mu);
    assert.match(
      skill,
      /^description: "wikiwright bundle: How to use the orchard handbook, and what it covers\. — 3 pages, 2 types"$/mu,
    );
    assert.match(skill, /^ {2}wikiwright-contribution: "none"$/mu);
    assert.match(skill, /Read `wiki\/start-here\.md` first\./u);
    assert.match(skill, /`\$\{CLAUDE_SKILL_DIR\}` is this directory/u);
    assert.doesNotMatch(skill, /partial copy/u);
    assert.ok(skill.split("\n").length < 100, "the skill text stays under 100 lines");

    // The subset: one page, and the whole copy named.
    assert.deepEqual(
      paths(pruning).filter((p) => p.startsWith("wiki/")),
      ["wiki/pruning-roses.md"],
    );
    const subset = text(pruning, SKILL_PATH);
    assert.match(subset, /This is a partial copy: 0 links and 0 citations/u);
    assert.match(subset, /The whole bundle is the export `orchard`\./u);
    assert.match(subset, /^description: "wikiwright bundle: Cut roses back in late winter/mu);
  });

  it("renders the same bytes twice", async () => {
    const root = join(SCRATCH, `orchard-${++serial}`);
    cpSync(ORCHARD, root, { recursive: true });
    const first = await plans(root, "orchard");
    const second = await plans(root, "orchard");
    assert.deepEqual(
      first.map((p) => p.files?.map((f) => [f.path, f.bytes.toString("base64")])),
      second.map((p) => p.files?.map((f) => [f.path, f.bytes.toString("base64")])),
    );
  });

  it("links to pages left out are counted in the source; closed withholds the export as a judgment, cut carries them", async () => {
    const root = garden(
      {
        content_roots: ["wiki", "raw"],
        source_roots: ["raw"],
        exports: [
          {
            name: "closed",
            select: { kind: "tag", tags: ["compost"] },
            contribution: { mode: "none" },
          },
          {
            name: "cut",
            select: { kind: "tag", tags: ["compost"] },
            links: "cut",
            contribution: { mode: "none" },
          },
        ],
      },
      {
        "wiki/turning-compost.md": note(
          "Turning compost",
          ["compost"],
          "Turn it weekly; see [[raised-beds]] and the trial in [[heap-trial]].",
        ),
        "wiki/raised-beds.md": note("Raised beds", ["beds"], "Beds edged in timber."),
        "raw/heap-trial.md": note("Heap trial", ["compost"], "A season's temperatures."),
      },
    );
    const [closed, cut] = await plans(root, "garden");
    assert.ok(closed !== undefined && cut !== undefined);
    // raw/heap-trial.md carries the tag, and sources are excluded by default:
    // the citation to it is cut too.
    assert.deepEqual(rules(closed), ["export-not-closed"]);
    const finding = closed.findings[0];
    assert.equal(finding?.severity, "warning");
    assert.match(finding?.message ?? "", /raised-beds\.md/u);
    assert.match(finding?.message ?? "", /so it was not rendered/u);
    // A judgment, not a gate: queued, and nothing rendered until it is made.
    assert.equal(closed.files, undefined, "a closed export with a cut link was rendered");
    assert.deepEqual(cut.marker.cut, { links: 1, citations: 1, attachments: 0 });
    assert.deepEqual(rules(cut), []);
  });

  it("the selection's shape is judged when it is planned: an unknown tag, a guide outside it, a fragment in the wrong place", async () => {
    const root = garden(
      {
        content_roots: ["wiki"],
        exports: [
          { name: "a", select: { kind: "tag", tags: ["mulch"] }, contribution: { mode: "none" } },
          {
            name: "b",
            select: { kind: "tag", tags: ["compost"] },
            guide: "wiki/raised-beds.md",
            contribution: { mode: "none" },
          },
          {
            name: "c",
            select: { kind: "all" },
            skill: "wiki/turning-compost.md",
            contribution: { mode: "none" },
          },
          {
            name: "d",
            select: { kind: "all" },
            skill: "meta/absent.md",
            contribution: { mode: "none" },
          },
        ],
      },
      {
        "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
        "wiki/raised-beds.md": note("Raised beds", ["beds"], "Beds edged in timber."),
      },
    );
    const planned = await plans(root, "garden");
    assert.deepEqual(
      planned.map((p) => [p.export.name, rules(p), p.files === undefined]),
      [
        ["a", ["export-tag-unknown"], true],
        ["b", ["export-guide-outside"], true],
        ["c", ["export-skill-invalid"], true],
        ["d", ["export-skill-invalid"], true],
      ],
    );
    for (const plan of planned) {
      assert.equal(plan.findings[0]?.path, "config/engine.json");
      assert.equal(plan.findings[0]?.details?.["export"], plan.export.name);
    }
  });

  it("the maintainer's fragment is copied into the skill text, its frontmatter left out", async () => {
    const root = garden(
      {
        content_roots: ["wiki"],
        exports: [
          {
            name: "garden",
            select: { kind: "all" },
            skill: "meta/skill.md",
            license: "CC-BY-4.0",
            repository: "https://example.invalid/garden",
            contribution: { mode: "issues" },
          },
        ],
      },
      {
        "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
        "meta/skill.md": "---\ntitle: fragment\n---\n\nAsk before you cite the heap trial.\n",
      },
    );
    const [plan] = await plans(root, "garden");
    assert.ok(plan !== undefined);
    const skill = text(plan, SKILL_PATH);
    assert.match(skill, /## From the maintainer\n\nAsk before you cite the heap trial\.\n/u);
    assert.doesNotMatch(skill, /title: fragment/u);
    assert.match(skill, /^license: "CC-BY-4\.0"$/mu);
    assert.match(skill, /issue at https:\/\/example\.invalid\/garden/u);
    assert.deepEqual(plan.marker.contribution, {
      mode: "issues",
      repository: "https://example.invalid/garden",
    });
    assert.equal(plan.marker.source.repository, "https://example.invalid/garden");
  });

  it("an embedded image travels with its page; one that resolves to nothing is counted", async () => {
    const root = garden(
      {
        content_roots: ["wiki"],
        exports: [
          { name: "all", select: { kind: "all" }, contribution: { mode: "none" } },
          {
            name: "beds",
            select: { kind: "tag", tags: ["beds"] },
            links: "cut",
            contribution: { mode: "none" },
          },
        ],
      },
      {
        "wiki/raised-beds.md": note(
          "Raised beds",
          ["beds"],
          "![[bed.png]]\n\n![A row](img/row.png)\n\n![[missing.png]]\n\n```\n![[fenced.png]]\n```",
        ),
        "wiki/assets/bed.png": PNG,
        "wiki/img/row.png": PNG,
        "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
      },
    );
    const [all, beds] = await plans(root, "garden");
    assert.ok(all !== undefined && beds !== undefined);
    for (const plan of [all, beds]) {
      assert.deepEqual(
        paths(plan).filter((p) => p.endsWith(".png")),
        ["wiki/assets/bed.png", "wiki/img/row.png"],
      );
      assert.equal(plan.marker.cut.attachments, 1, "the missing embed, and not the fenced one");
    }
    const bed = beds.files?.find((f) => f.path === "wiki/assets/bed.png");
    assert.equal(bed?.bytes.equals(PNG), true, "bytes copied, not text");
  });

  it("templates and examples the loader validates travel at their declared paths", async () => {
    const constitution = {
      ...CONSTITUTION,
      types: {
        note: {
          extends: "concept",
          description: "A gardening note.",
          template: "templates/note.md",
          example: "wiki/examples/turning-compost.md",
        },
      },
    };
    const root = garden(
      {
        content_roots: ["wiki"],
        exports: [
          {
            name: "beds",
            select: { kind: "tag", tags: ["beds"] },
            links: "cut",
            contribution: { mode: "none" },
          },
        ],
      },
      {
        "templates/note.md":
          "---\ntype: note\ntitle: \ndescription: \ntags: []\n---\n\n# {{ title }}\n",
        "templates/unused.md": "not declared anywhere\n",
        "wiki/examples/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
        "wiki/raised-beds.md": note("Raised beds", ["beds"], "Beds edged in timber."),
      },
      constitution,
    );
    const [plan] = await plans(root, "garden");
    assert.ok(plan !== undefined);
    assert.deepEqual(rules(plan), []);
    const carried = paths(plan);
    assert.equal(carried.includes("templates/note.md"), true);
    assert.equal(carried.includes("templates/unused.md"), false);
    // The example is a page the loader needs, so it joins the copy's pages.
    assert.equal(carried.includes("wiki/examples/turning-compost.md"), true);
    assert.equal(plan.marker.pages, 2);
  });

  it("sources: include carries every file under the source roots", async () => {
    const root = garden(
      {
        content_roots: ["wiki"],
        source_roots: ["sources"],
        exports: [
          {
            name: "garden",
            select: { kind: "all" },
            sources: "include",
            contribution: { mode: "none" },
          },
        ],
      },
      {
        "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
        "sources/heap-log.csv": "week,temperature\n1,48\n",
        "sources/.obsidian/workspace.json": "{}\n",
      },
    );
    const [plan] = await plans(root, "garden");
    assert.deepEqual(
      paths(plan as ExportPlan).filter((p) => p.startsWith("sources/")),
      ["sources/heap-log.csv"],
    );
  });

  it("a kit declared by path travels whole at its path, its own dependencies left out", async () => {
    const root = garden(
      {
        content_roots: ["wiki"],
        modules: [{ package: "kit-garden", version: "^1.0.0", path: "kit/garden" }],
        exports: [{ name: "garden", select: { kind: "all" }, contribution: { mode: "none" } }],
      },
      {
        "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly."),
      },
    );
    cpSync(KIT_GARDEN, join(root, "kit", "garden"), { recursive: true });
    write(root, { "kit/garden/node_modules/dep/index.js": "export default {};\n" });
    const [plan] = await plans(root, "garden");
    assert.deepEqual(
      paths(plan as ExportPlan).filter((p) => p.startsWith("kit/")),
      ["kit/garden/fixture.json", "kit/garden/index.js", "kit/garden/package.json"],
    );
  });

  it("a link inside the bundle is read through, and the copy carries its bytes", async () => {
    if (process.platform === "win32") return;
    const root = garden(
      {
        content_roots: ["wiki"],
        exports: [{ name: "garden", select: { kind: "all" }, contribution: { mode: "none" } }],
      },
      {
        "wiki/turning-compost.md": note("Turning compost", ["compost"], "![[bed.png]]"),
        "outside.png": PNG,
      },
    );
    symlinkSync(join(root, "outside.png"), join(root, "wiki", "bed.png"));
    const [plan] = await plans(root, "garden");
    assert.deepEqual(rules(plan as ExportPlan), []);
    assert.deepEqual(plan?.files?.find((file) => file.path === "wiki/bed.png")?.bytes, PNG);
  });

  it("a link that leaves the bundle is not carried: the export is refused, naming it", async () => {
    if (process.platform === "win32") return;
    const root = garden(
      {
        content_roots: ["wiki"],
        exports: [{ name: "garden", select: { kind: "all" }, contribution: { mode: "none" } }],
      },
      { "wiki/turning-compost.md": note("Turning compost", ["compost"], "![[shed.png]]") },
    );
    const elsewhere = join(SCRATCH, `shed-${serial}.png`);
    writeFileSync(elsewhere, PNG);
    symlinkSync(elsewhere, join(root, "wiki", "shed.png"));
    const [plan] = await plans(root, "garden");
    assert.deepEqual(rules(plan as ExportPlan), ["export-symlink"]);
    assert.equal(plan?.files, undefined);
    assert.match(plan?.findings[0]?.message ?? "", /leaves the bundle: wiki\/shed\.png/u);
  });

  it("a skill's description is cut at a word, within 1024 characters", async () => {
    const long = `${"A long description of compost ".repeat(60).trim()}.`;
    const root = garden(
      {
        content_roots: ["wiki"],
        exports: [
          {
            name: "garden",
            select: { kind: "all" },
            guide: "wiki/turning-compost.md",
            contribution: { mode: "none" },
          },
        ],
      },
      {
        "wiki/turning-compost.md": `---\ntype: note\ntitle: Turning compost\ndescription: ${long}\ntags: [compost]\n---\n\n# Turning compost\n\nTurn it.\n`,
      },
    );
    const [plan] = await plans(root, "garden");
    const line = text(plan as ExportPlan, SKILL_PATH)
      .split("\n")
      .find((l) => l.startsWith("description: "));
    const description = JSON.parse((line ?? "").slice("description: ".length)) as string;
    assert.ok(description.length <= 1024, `${description.length} characters`);
    assert.ok(description.endsWith("…"));
    assert.ok(!/\s…$/u.test(description), "cut at a word, with no space before the ellipsis");
  });

  it("the plugin manifests carry the declared strings and nothing else", async () => {
    const root = garden(
      {
        content_roots: ["wiki"],
        plugin: { name: "garden-handbook", version: "1.0.0", description: "A gardening handbook." },
      },
      { "wiki/turning-compost.md": note("Turning compost", ["compost"], "Turn it weekly.") },
    );
    const manifests = pluginManifests(await loaded(root));
    assert.deepEqual(
      manifests.map((m) => [m.path, JSON.parse(m.bytes.toString("utf8"))]),
      [
        [
          ".claude-plugin/plugin.json",
          { name: "garden-handbook", version: "1.0.0", description: "A gardening handbook." },
        ],
        [
          "plugin.json",
          {
            $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
            name: "garden-handbook",
            version: "1.0.0",
            description: "A gardening handbook.",
          },
        ],
      ],
    );
  });
});
