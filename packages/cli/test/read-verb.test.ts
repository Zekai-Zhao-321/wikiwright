// docs/cli.md §read: a page's sections, cut at its type's section depth, each
// the page's own lines verbatim with its address; the page's digest over its
// raw bytes; a budget that returns sections in page order while they fit and
// lists the rest by address; the envelope's bundle block as the attribution.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const HANDBOOKS = fileURLToPath(new URL("../../../fixtures/handbooks/", import.meta.url));
const ORCHARD = join(HANDBOOKS, "orchard");
const ALLOTMENT = join(HANDBOOKS, "allotment");
const PAGE = "wiki/pruning-roses.md";

interface Section {
  heading: string | null;
  address: string;
  occurrence?: number;
  line: number;
  end_line: number;
  bytes: number;
  text?: string;
  reason?: string;
}

interface ReadData {
  page: Record<string, unknown>;
  sections: Section[];
  omitted: Section[];
  coverage: Record<string, unknown>;
}

interface Envelope {
  ok: boolean;
  data?: ReadData;
  error?: { code?: string; details?: Record<string, unknown>; message?: string };
  metadata: { bundle?: Record<string, unknown> };
}

let tmp = "";
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "ww-read-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function read(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
): {
  status: number;
  envelope: Envelope;
} {
  const r = spawnSync(process.execPath, [CLI, "read", ...argv], {
    cwd: tmp,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, ...env },
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

function dataOf(argv: readonly string[], env: NodeJS.ProcessEnv = {}): ReadData {
  const r = read(argv, env);
  assert.equal(r.status, 0, JSON.stringify(r.envelope));
  assert.ok(r.envelope.data !== undefined);
  return r.envelope.data;
}

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A file's lines with their line endings, as `read` slices them. */
function linesOf(path: string): string[] {
  return readFileSync(path, "utf8").split(/(?<=\n)/u);
}

/**
 * A text's lines, each with its own ending, where the Markdown parser ends a
 * line: at CRLF, at LF, and at a CR that no LF follows. A plain walk, so the
 * test does not share the verb's own split.
 */
function parserLines(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

describe("read returns a page's sections with attribution (docs/cli.md §read)", () => {
  it("a whole page: the lead, then each section, the page's own lines verbatim", () => {
    const r = read([PAGE, "--root", ORCHARD]);
    assert.equal(r.status, 0, JSON.stringify(r.envelope));
    const data = r.envelope.data;
    assert.ok(data !== undefined);
    assert.deepEqual(Object.keys(data), ["page", "sections", "omitted", "coverage"]);
    assert.equal(
      r.envelope.metadata.bundle?.["label"],
      "orchard",
      "the attribution is the envelope's",
    );

    const file = join(ORCHARD, PAGE);
    const { page } = data;
    assert.equal(page["path"], PAGE);
    assert.equal(page["name"], "pruning-roses");
    assert.equal(page["resolved_via"], "path");
    assert.equal(page["type"], "procedure-page");
    assert.deepEqual(page["chain"], ["procedure-page", "procedure"]);
    assert.equal(page["title"], "Pruning roses");
    assert.equal(page["status"], "active");
    assert.equal((page["frontmatter"] as Record<string, unknown>)["applies_to"], "temperate");
    assert.equal(page["digest"], sha256(readFileSync(file)), "the digest is over the raw bytes");

    assert.deepEqual(
      data.sections.map((s) => s.heading),
      [null, "Steps", "Notes"],
    );
    const lines = linesOf(file);
    for (const [i, section] of data.sections.entries()) {
      assert.equal(section.text, lines.slice(section.line - 1, section.end_line).join(""));
      assert.equal(section.bytes, Buffer.byteLength(section.text ?? "", "utf8"));
      assert.equal(section.address, section.heading === null ? PAGE : `${PAGE}#${section.heading}`);
      const next: Section | undefined = data.sections[i + 1];
      if (next !== undefined)
        assert.equal(next.line, section.end_line + 1, "sections are contiguous");
    }
    // Everything after the frontmatter, byte for byte, trailing blank lines kept.
    assert.equal(data.sections.at(-1)?.end_line, lines.length);
    const fence = lines.indexOf("---\n", 1);
    assert.equal(data.sections.map((s) => s.text).join(""), lines.slice(fence + 1).join(""));
    assert.deepEqual(data.omitted, []);
    assert.deepEqual(data.coverage, {
      sections: 3,
      returned: 3,
      bytes_returned: data.sections.reduce((n, s) => n + s.bytes, 0),
      budget: null,
    });
  });

  it("the page's digest is its line in the content digest", () => {
    const r = read([PAGE, "--root", ORCHARD]);
    const digest = r.envelope.data?.page["digest"];
    const pages = ["wiki/pruning-roses.md", "wiki/start-here.md", "wiki/thinning-apples.md"];
    const lines = pages.map((p) =>
      p === PAGE ? `${p} ${String(digest)}` : `${p} ${sha256(readFileSync(join(ORCHARD, p)))}`,
    );
    assert.equal(r.envelope.metadata.bundle?.["content"], sha256(lines.join("\n")));
  });

  it("resolves a path, a name, an alias and a title, and says which", () => {
    for (const [wanted, via] of [
      [PAGE, "path"],
      ["pruning-roses", "name"],
      ["Rose pruning", "alias"],
      ["Pruning roses", "title"],
    ] as const) {
      const { page } = dataOf([wanted, "--root", ORCHARD]);
      assert.equal(page["path"], PAGE, wanted);
      assert.equal(page["resolved_via"], via, wanted);
    }
  });

  it("a guide page is its lead and its one section, under its own type", () => {
    const data = dataOf(["start-here", "--root", ORCHARD]);
    assert.deepEqual(data.page["chain"], ["guide-page", "hub"]);
    assert.deepEqual(
      data.sections.map((s) => s.heading),
      [null, "How to use this handbook"],
    );
  });

  it("a page with no heading at the section depth is one lead section", () => {
    const vault = join(tmp, "flat");
    cpSync(ORCHARD, vault, { recursive: true });
    writeFileSync(
      join(vault, "wiki", "notes.md"),
      "---\ntype: procedure-page\ntitle: Notes\ndescription: Loose notes.\ntags: [fruit]\napplies_to: temperate\n---\n\n# Notes\n\nA page with no steps yet.\n\n### A subheading\n\nIt stays in the lead.\n",
    );
    const data = dataOf(["notes", "--root", vault]);
    assert.deepEqual(
      data.sections.map((s) => [s.heading, s.line]),
      [[null, 8]],
    );
    assert.match(data.sections[0]?.text ?? "", /### A subheading/u);
  });

  it("--section returns that section alone", () => {
    const data = dataOf([PAGE, "--section", "steps", "--root", ORCHARD]);
    assert.deepEqual(
      data.sections.map((s) => s.heading),
      ["Steps"],
    );
    assert.equal(data.coverage["returned"], 1);
    assert.equal(data.coverage["sections"], 3, "coverage counts the page's sections");
  });

  it("a budget returns sections in page order while they fit, and lists the rest by address", () => {
    const whole = dataOf([PAGE, "--root", ORCHARD]).sections;
    const [lead, steps, notes] = whole;
    assert.ok(lead !== undefined && steps !== undefined && notes !== undefined);
    const cut = dataOf([PAGE, "--budget", String(lead.bytes + steps.bytes), "--root", ORCHARD]);
    assert.deepEqual(
      cut.sections.map((s) => s.heading),
      [null, "Steps"],
    );
    assert.deepEqual(cut.omitted, [
      {
        heading: "Notes",
        address: `${PAGE}#Notes`,
        line: notes.line,
        end_line: notes.end_line,
        bytes: notes.bytes,
        reason: "budget",
      },
    ]);
    assert.equal(cut.coverage["bytes_returned"], lead.bytes + steps.bytes);
    assert.equal(cut.coverage["budget"], lead.bytes + steps.bytes);

    // The first section that does not fit stops the page: a later one that
    // would fit is omitted too, so what returns is a prefix of the page.
    assert.ok(notes.bytes < steps.bytes, "the fixture's Notes is shorter than its Steps");
    const stopped = dataOf([
      PAGE,
      "--budget",
      String(lead.bytes + steps.bytes - 1),
      "--root",
      ORCHARD,
    ]);
    assert.deepEqual(
      stopped.sections.map((s) => s.heading),
      [null],
    );
    assert.deepEqual(
      stopped.omitted.map((s) => s.heading),
      ["Steps", "Notes"],
    );
  });

  it("a budget smaller than the first section returns nothing and omits every section", () => {
    const data = dataOf([PAGE, "--budget", "10", "--root", ORCHARD]);
    assert.deepEqual(data.sections, []);
    assert.deepEqual(
      data.omitted.map((s) => [s.heading, s.reason]),
      [
        [null, "budget"],
        ["Steps", "budget"],
        ["Notes", "budget"],
      ],
    );
    assert.equal(data.coverage["returned"], 0);
    const one = dataOf([PAGE, "--section", "Steps", "--budget", "10", "--root", ORCHARD]);
    assert.deepEqual(
      one.omitted.map((s) => s.address),
      [`${PAGE}#Steps`],
    );
  });

  it("an unknown section lists the page's headings at the section depth", () => {
    const r = read([PAGE, "--section", "Pests", "--root", ORCHARD]);
    assert.equal(r.status, 3, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "section-not-found");
    assert.deepEqual(r.envelope.error?.details?.["valid_values"], ["Steps", "Notes"]);
  });

  it("an unknown page says what was tried and names no page", () => {
    const r = read(["grafting-pears", "--root", ORCHARD]);
    assert.equal(r.status, 3, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "page-not-found");
    assert.deepEqual(r.envelope.error?.details, { tried: ["path", "name", "alias", "title"] });
    assert.doesNotMatch(JSON.stringify(r.envelope.error), /pruning|thinning|start-here/u);
  });

  it("a budget that is not a whole number of bytes is invalid-value", () => {
    // `--budget=<v>`, so a value that starts with a hyphen reaches the verb.
    for (const budget of ["-1", "12kb", "1.5", ""]) {
      const r = read([PAGE, `--budget=${budget}`, "--root", ORCHARD]);
      assert.equal(r.status, 2, `${budget}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "invalid-value");
    }
  });

  it("a title the bundle derives is the title read reports and resolves, as the manifest spells it", () => {
    // A bundle whose `field_sources` derive the title from the basename and the
    // description from the lede, and a page that carries neither.
    const vault = join(tmp, "derived");
    cpSync(ORCHARD, vault, { recursive: true });
    writeFileSync(
      join(vault, "config", "engine.json"),
      `${JSON.stringify({
        content_roots: ["wiki"],
        field_sources: { title: "basename", description: "lede" },
      })}\n`,
    );
    writeFileSync(
      join(vault, "wiki", "Mulching beds.md"),
      "---\ntype: procedure-page\ntags: [fruit]\napplies_to: temperate\n---\n\nSpread a mulch over bare soil in late spring.\n\n## Steps\n\n1. Weed the bed.\n2. Spread the mulch.\n",
    );
    const written = spawnSync(process.execPath, [CLI, "check", "--write", "--root", vault], {
      encoding: "utf8",
    });
    assert.equal(written.status, 0, written.stdout);
    const manifest = JSON.parse(
      readFileSync(join(vault, "generated", "manifest.json"), "utf8"),
    ) as { pages: { path: string; title: string; description: string }[] };
    const listed = manifest.pages.find((p) => p.path === "wiki/Mulching beds.md");
    assert.ok(listed !== undefined);

    const { page } = dataOf([listed.title, "--root", vault]);
    assert.equal(page["path"], "wiki/Mulching beds.md");
    // The one derivation is the basename, which the name form finds first.
    assert.equal(page["resolved_via"], "name");
    assert.equal(page["title"], listed.title);
    assert.equal(page["description"], listed.description);
    assert.equal(page["description"], "Spread a mulch over bare soil in late spring.");
  });

  it("one path in two handbooks: two digests, two bundles, told apart by the envelope", () => {
    const registry = join(tmp, "registry");
    mkdirSync(registry, { recursive: true });
    const env = { WIKIWRIGHT_BUNDLES_FILE: join(registry, "bundles.json") };
    for (const [root, name] of [
      [ORCHARD, "orchard"],
      [ALLOTMENT, "allotment"],
    ] as const) {
      const r = spawnSync(process.execPath, [CLI, "bundles", "add", root, "--name", name], {
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
      assert.equal(r.status, 0, r.stdout);
    }
    const orchard = read([PAGE, "--bundle", "orchard"], env);
    const allotment = read([PAGE, "--bundle", "allotment"], env);
    assert.equal(orchard.status, 0, JSON.stringify(orchard.envelope));
    assert.equal(allotment.status, 0, JSON.stringify(allotment.envelope));
    assert.equal(orchard.envelope.data?.page["path"], allotment.envelope.data?.page["path"]);
    assert.notEqual(orchard.envelope.data?.page["digest"], allotment.envelope.data?.page["digest"]);
    assert.equal(orchard.envelope.metadata.bundle?.["label"], "orchard");
    assert.equal(allotment.envelope.metadata.bundle?.["label"], "allotment");
    const climate = (e: Envelope): unknown =>
      ((e.data?.page["frontmatter"] ?? {}) as Record<string, unknown>)["applies_to"];
    assert.deepEqual(
      [climate(orchard.envelope), climate(allotment.envelope)],
      ["temperate", "arid"],
    );
  });

  it("a heading the type admits twice: each occurrence numbered, and --section returns both", () => {
    // The handbook's type admits `Steps` up to twice, and the page uses both:
    // a conformant page, not an invalid one.
    const vault = join(tmp, "repeated");
    cpSync(ORCHARD, vault, { recursive: true });
    const constitution = join(vault, "config", "constitution.json");
    const law = JSON.parse(readFileSync(constitution, "utf8")) as {
      types: Record<string, { sections: { list: { heading: string; max?: number }[] } }>;
    };
    const steps = law.types["procedure-page"]?.sections.list.find((s) => s.heading === "Steps");
    assert.ok(steps !== undefined);
    steps.max = 2;
    writeFileSync(constitution, `${JSON.stringify(law, null, 2)}\n`);
    const page = join(vault, PAGE);
    writeFileSync(
      page,
      readFileSync(page, "utf8").replace(
        "## Notes",
        "## Steps\n\n1. Water the bush well once it is pruned.\n\n## Notes",
      ),
    );
    const lint = spawnSync(process.execPath, [CLI, "lint", "--page", PAGE, "--root", vault], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, ...PINNED_CLOCK },
    });
    assert.equal(lint.status, 0, lint.stdout);
    assert.deepEqual(
      (JSON.parse(lint.stdout) as { data: { findings: unknown[] } }).data.findings,
      [],
    );

    const whole = dataOf([PAGE, "--root", vault]);
    assert.deepEqual(
      whole.sections.map((s) => [s.heading, s.address, s.occurrence]),
      [
        [null, PAGE, undefined],
        ["Steps", `${PAGE}#Steps`, 1],
        ["Steps", `${PAGE}#Steps`, 2],
        ["Notes", `${PAGE}#Notes`, undefined],
      ],
    );
    const [lead, first, second, notes] = whole.sections;
    assert.ok(
      lead !== undefined && first !== undefined && second !== undefined && notes !== undefined,
    );
    assert.equal("occurrence" in lead, false, "the lead carries no occurrence");
    assert.equal("occurrence" in notes, false, "a heading that appears once carries none");
    assert.deepEqual(Object.keys(first), [
      "heading",
      "address",
      "occurrence",
      "line",
      "end_line",
      "bytes",
      "text",
    ]);
    assert.match(second.text ?? "", /Water the bush well/u);
    assert.equal(whole.coverage["sections"], 4);

    // --section returns every occurrence, in page order.
    const both = dataOf([PAGE, "--section", "Steps", "--root", vault]);
    assert.deepEqual(both.sections, [first, second]);
    assert.deepEqual(both.omitted, []);
    assert.equal(both.coverage["sections"], 4, "coverage still counts the page's sections");
    assert.equal(both.coverage["returned"], 2);

    // A budget that holds only the first lists the second by its address and
    // its occurrence, and asking for that address again returns it beside its sibling.
    const cut = dataOf([
      PAGE,
      "--section",
      "Steps",
      "--budget",
      String(first.bytes),
      "--root",
      vault,
    ]);
    assert.deepEqual(cut.sections, [first]);
    assert.deepEqual(cut.omitted, [
      {
        heading: "Steps",
        address: `${PAGE}#Steps`,
        occurrence: 2,
        line: second.line,
        end_line: second.end_line,
        bytes: second.bytes,
        reason: "budget",
      },
    ]);
    const paged = dataOf([PAGE, "--budget", String(lead.bytes + first.bytes), "--root", vault]);
    assert.deepEqual(
      paged.omitted.map((s) => [s.address, s.occurrence]),
      [
        [`${PAGE}#Steps`, 2],
        [`${PAGE}#Notes`, undefined],
      ],
    );
  });

  it("a CR-only body and a CRLF page are cut on the parser's lines, their endings kept", () => {
    // Two pages the parser reads, and lint passes, with endings other than LF:
    // pruning-roses keeps its LF frontmatter and ends every body line with a
    // lone CR; thinning-apples is CRLF throughout.
    const vault = join(tmp, "endings");
    cpSync(ORCHARD, vault, { recursive: true });
    const roses = join(vault, PAGE);
    const lf = readFileSync(roses, "utf8");
    const fence = lf.indexOf("\n---\n") + "\n---\n".length;
    writeFileSync(roses, lf.slice(0, fence) + lf.slice(fence).replaceAll("\n", "\r"));
    const apples = join(vault, "wiki", "thinning-apples.md");
    writeFileSync(apples, readFileSync(apples, "utf8").replaceAll("\n", "\r\n"));

    const lint = spawnSync(process.execPath, [CLI, "lint", "--root", vault], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, ...PINNED_CLOCK },
    });
    assert.equal(lint.status, 0, lint.stdout);

    for (const [page, ending, bodyStart] of [
      [PAGE, "\r", fence],
      ["wiki/thinning-apples.md", "\r\n", -1],
    ] as const) {
      const raw = readFileSync(join(vault, page), "utf8");
      const lines = parserLines(raw);
      const data = dataOf([page, "--root", vault]);
      assert.deepEqual(
        data.sections.map((s) => s.heading),
        [null, "Steps", "Notes"],
        page,
      );
      for (const [i, section] of data.sections.entries()) {
        const text = section.text ?? "";
        assert.equal(text, lines.slice(section.line - 1, section.end_line).join(""), page);
        assert.equal(section.bytes, Buffer.byteLength(text, "utf8"), page);
        assert.ok(section.end_line >= section.line, `${page}: ${section.address}`);
        if (section.heading !== null) {
          assert.equal(text.startsWith(`## ${section.heading}${ending}`), true, text);
        }
        const next: Section | undefined = data.sections[i + 1];
        if (next !== undefined) assert.equal(next.line, section.end_line + 1, page);
      }
      // Everything after the frontmatter, byte for byte, in the page's endings.
      const after =
        bodyStart >= 0
          ? raw.slice(bodyStart)
          : raw.slice(raw.indexOf(`${ending}---${ending}`) + ending.length * 2 + 3);
      assert.equal(data.sections.map((s) => s.text).join(""), after, page);
      if (ending === "\r") assert.doesNotMatch(after, /\n/u);

      const steps = dataOf([page, "--section", "Steps", "--root", vault]).sections;
      assert.equal(steps.length, 1, page);
      const whole = data.sections.find((s) => s.heading === "Steps");
      assert.ok(steps[0] !== undefined && whole !== undefined);
      assert.notEqual(steps[0].text, "", `${page}: --section Steps returned no text`);
      assert.equal(steps[0].text, whole.text, page);
      assert.equal(steps[0].bytes, Buffer.byteLength(steps[0].text ?? "", "utf8"), page);
    }
  });
});
