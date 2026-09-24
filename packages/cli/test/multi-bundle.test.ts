// docs/cli.md §bundles, §read: the two-bundle scenario, end to end, in one
// place. An agent working in a directory that is no vault has two gardening
// handbooks installed as bundle skills — each a plain copy of the handbook's
// rendered export in the user's skill directory — which hold one page path
// with different guidance; the orchard handbook's own checkout sits beside
// them. It:
//
//   1. finds both by name with nothing registered;
//   2. is refused `registry-not-found` when it names no bundle, and reads each
//      handbook's steps by name, the envelope saying which answered;
//   3. can compare the two: distinct climates in the frontmatter, distinct
//      content digests;
//   4. under a consumer session reads, searches and prints its own brief
//      against either bundle, and is refused a write;
//   5. sees an uncommitted edit in the checkout move the page's digest and the
//      content digest, mark it dirty and leave its head where it was, and an
//      edit to an installed copy mark that copy changed since export;
//   6. is refused a write or a dry run into an installed copy;
//   7. finds both in the listing, with where a problem with each goes;
//   8. reads under a budget that leaves a section out by its address;
//   9. hands a child that address, and the child — a second process under a
//      consumer session — reads the same bytes under the same page digest.
//
// Overlap with discovery.test.ts and read-verb.test.ts is deliberate: those
// hold each mechanism; this holds the scenario. Everything runs on temporary
// copies of the two handbooks, never the shipped fixtures, with HOME under the
// temporary directory.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const HANDBOOKS = fileURLToPath(new URL("../../../fixtures/handbooks/", import.meta.url));
const PAGE = "wiki/pruning-roses.md";

interface Section {
  heading: string | null;
  address: string;
  line: number;
  end_line: number;
  bytes: number;
  text?: string;
}

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; details?: Record<string, unknown> };
  metadata: { bundle?: Record<string, unknown> };
}

let tmp = "";
let elsewhere = "";
let orchard = "";
let installedOrchard = "";
let installedAllotment = "";
let env: NodeJS.ProcessEnv = {};

function run(
  argv: readonly string[],
  extra: NodeJS.ProcessEnv = {},
  input = "",
): { status: number; envelope: Envelope } {
  const r = spawnSync(CLI_RUNTIME, [CLI, ...argv], {
    cwd: elsewhere,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, ...env, ...extra },
    input,
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

function ok(argv: readonly string[], extra: NodeJS.ProcessEnv = {}): Envelope {
  const r = run(argv, extra);
  assert.equal(r.status, 0, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
  return r.envelope;
}

function page(envelope: Envelope): Record<string, unknown> {
  return (envelope.data?.["page"] ?? {}) as Record<string, unknown>;
}

function sections(envelope: Envelope, key: "sections" | "omitted" = "sections"): Section[] {
  return (envelope.data?.[key] ?? []) as Section[];
}

/** A handbook copy under version control, so its head and its dirt mean something. */
function checkout(name: string): string {
  const root = join(tmp, "handbooks", name);
  cpSync(join(HANDBOOKS, name), root, { recursive: true });
  const git = (...args: string[]): void => {
    execFileSync(
      "git",
      [
        "-c",
        "user.name=T",
        "-c",
        "user.email=t@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, stdio: "ignore" },
    );
  };
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", `the ${name} handbook`);
  return root;
}

describe("two handbooks from an unrelated directory, end to end (docs/cli.md §bundles)", () => {
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "ww-multi-bundle-"));
    elsewhere = join(tmp, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    orchard = checkout("orchard");
    const home = join(tmp, "home");
    const skills = join(home, ".claude", "skills");
    mkdirSync(skills, { recursive: true });
    // A host installs a bundle skill by copying its directory: the handbook's
    // rendered export, and nothing else.
    installedOrchard = join(skills, "orchard");
    cpSync(join(HANDBOOKS, "orchard", "skills", "orchard"), installedOrchard, { recursive: true });
    installedAllotment = join(skills, "allotment");
    cpSync(join(HANDBOOKS, "allotment", "skills", "allotment"), installedAllotment, {
      recursive: true,
    });
    env = { HOME: home, WIKIWRIGHT_SKILL_DIRS: "" };
  });
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("1. finds both by name, with nothing registered", () => {
    for (const name of ["orchard", "allotment"]) {
      const found = ok(["type", "list", "--bundle", name]);
      assert.equal(found.metadata.bundle?.["label"], name);
      const exported = found.metadata.bundle?.["export"] as { name?: string } | undefined;
      assert.equal(exported?.name, name);
    }
  });

  it("2. names no bundle and is refused; names each and reads its own steps", () => {
    const untargeted = run(["read", "pruning-roses"]);
    assert.equal(untargeted.status, 3, JSON.stringify(untargeted.envelope));
    assert.equal(untargeted.envelope.error?.code, "registry-not-found");

    const fromOrchard = ok(["read", "pruning-roses", "--bundle", "orchard"]);
    const fromAllotment = ok(["read", "pruning-roses", "--bundle", "allotment"]);
    assert.equal(fromOrchard.metadata.bundle?.["label"], "orchard");
    assert.equal(fromAllotment.metadata.bundle?.["label"], "allotment");
    const steps = (e: Envelope): string =>
      sections(e).find((s) => s.heading === "Steps")?.text ?? "";
    assert.match(steps(fromOrchard), /by about a third, to an outward-facing bud/u);
    assert.match(steps(fromAllotment), /by no more than a quarter/u);
    assert.equal(page(fromOrchard)["path"], page(fromAllotment)["path"]);
    assert.notEqual(page(fromOrchard)["digest"], page(fromAllotment)["digest"]);
  });

  it("3. compares them: distinct climates, distinct content", () => {
    const fromOrchard = ok(["read", PAGE, "--bundle", "orchard"]);
    const fromAllotment = ok(["read", PAGE, "--bundle", "allotment"]);
    const climate = (e: Envelope): unknown =>
      ((page(e)["frontmatter"] ?? {}) as Record<string, unknown>)["applies_to"];
    assert.deepEqual([climate(fromOrchard), climate(fromAllotment)], ["temperate", "arid"]);
    assert.notEqual(
      fromOrchard.metadata.bundle?.["content"],
      fromAllotment.metadata.bundle?.["content"],
    );
  });

  it("4. a consumer session reads, searches, lists and prints its brief, and may not write", () => {
    const consumer = { WIKIWRIGHT_ROLE: "consumer" };
    for (const name of ["orchard", "allotment"]) {
      assert.equal(ok(["read", PAGE, "--bundle", name], consumer).metadata.bundle?.["label"], name);
      ok(["search", "pruning", "--bundle", name], consumer);
      const brief = ok(["brief", "--role", "consumer", "--bundle", name], consumer);
      assert.match(String(brief.data?.["brief"]), /^# wikiwright — the consumer's brief$/mu);
    }
    const write = run(["write", PAGE, "--bundle", "orchard"], consumer, "a draft\n");
    assert.equal(write.status, 2, JSON.stringify(write.envelope));
    assert.equal(write.envelope.error?.code, "role-forbidden");
  });

  it("5. an uncommitted edit moves the digests and marks the checkout dirty; a copy says it changed", () => {
    const before = ok(["read", PAGE, "--root", orchard]);
    assert.equal(before.metadata.bundle?.["dirty"], false);
    appendFileSync(join(orchard, PAGE), "\nA note added and not yet committed.\n");
    const after = ok(["read", PAGE, "--root", orchard]);
    assert.notEqual(page(after)["digest"], page(before)["digest"]);
    assert.notEqual(after.metadata.bundle?.["content"], before.metadata.bundle?.["content"]);
    assert.equal(after.metadata.bundle?.["head"], before.metadata.bundle?.["head"]);
    assert.equal(after.metadata.bundle?.["dirty"], true);
    // A copy has no head of its own; an edit to it shows against its marker.
    const copy = ok(["read", PAGE, "--bundle", "allotment"]);
    assert.equal(copy.metadata.bundle?.["head"], null);
    appendFileSync(join(installedAllotment, PAGE), "\nA note added in the copy.\n");
    const edited = ok(["read", PAGE, "--bundle", "allotment"]);
    const exported = edited.metadata.bundle?.["export"] as { intact?: boolean } | undefined;
    assert.equal(exported?.intact, false);
  });

  it("6. an installed copy refuses a write and a dry run", () => {
    const draft = `${readFileSync(join(installedOrchard, PAGE), "utf8")}\nA line the draft adds.\n`;
    for (const [argv, input] of [
      [["new", "procedure-page", "Mulching", "--dest", "wiki/mulching.md"], ""],
      [["write", PAGE, "--dry-run"], draft],
    ] as const) {
      const r = run([...argv, "--bundle", "orchard"], {}, input);
      assert.equal(r.status, 2, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "bundle-readonly");
    }
  });

  it("7. the listing names both, with where a problem with each goes", () => {
    const rows = (ok(["bundles", "list"]).data?.["bundles"] ?? []) as {
      name: string;
      tier: string;
      contribution: { mode: string };
    }[];
    assert.deepEqual(
      rows.map((r) => [r.name, r.tier, r.contribution.mode]),
      [
        ["allotment", "user", "none"],
        ["orchard", "user", "none"],
      ],
    );
  });

  it("8. a budget on the longer page leaves Notes out, by its address", () => {
    const whole = sections(ok(["read", PAGE, "--bundle", "orchard"]));
    const budget = whole
      .filter((s) => s.heading !== "Notes")
      .reduce((total, s) => total + s.bytes, 0);
    const cut = ok(["read", PAGE, "--budget", String(budget), "--bundle", "orchard"]);
    assert.deepEqual(
      sections(cut).map((s) => s.heading),
      [null, "Steps"],
    );
    assert.deepEqual(
      sections(cut, "omitted").map((s) => s.address),
      [`${PAGE}#Notes`],
    );
  });

  it("9. a child handed the omitted address reads the same bytes under the same digest", () => {
    const parent = ok(["read", PAGE, "--budget", "0", "--bundle", "orchard"]);
    const handed = sections(parent, "omitted").find((s) => s.heading === "Notes");
    assert.ok(handed !== undefined, "the parent has Notes by address only");
    const [path, heading] = handed.address.split("#");
    assert.ok(path !== undefined && heading !== undefined);
    const child = ok(["read", path, "--section", heading, "--bundle", "orchard"], {
      WIKIWRIGHT_ROLE: "consumer",
    });
    const [section] = sections(child);
    assert.ok(section !== undefined);
    const lines = readFileSync(join(installedOrchard, path), "utf8").split(/(?<=\n)/u);
    assert.equal(section.text, lines.slice(handed.line - 1, handed.end_line).join(""));
    assert.equal(section.bytes, handed.bytes);
    assert.equal(page(child)["digest"], page(parent)["digest"]);
    assert.equal(child.metadata.bundle?.["content"], parent.metadata.bundle?.["content"]);
  });
});
