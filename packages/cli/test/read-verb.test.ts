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
});
