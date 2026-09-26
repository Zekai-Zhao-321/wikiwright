// docs/cli.md §The envelope, v2 contracts §7: every envelope of a verb that
// reads a bundle's law names the bundle it read — engine.json's label, its
// real root, the commit it sits at, whether it differs from that commit, the
// digest of its law and of its content — on an ok envelope and a refusal
// alike; `version` and an envelope answered before the verb runs name none.
// The generated brief's header prints the same law digest.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { noteEngine, writeAt, writeNoteBundle } from "./fixtures/note-bundle.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Bundle {
  label: string;
  root: string;
  head: string | null;
  dirty: boolean | null;
  law: string;
  content: string;
}

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
  metadata: { command: string; engine: string; bundle?: Bundle };
}

function run(
  cwd: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = {},
): { status: number; envelope: Envelope } {
  const r = runCli([CLI, ...argv], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, ...env },
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

/** The bundle block of one run, asserted present. */
function bundleOf(cwd: string, argv: readonly string[], env: NodeJS.ProcessEnv = {}): Bundle {
  const { envelope } = run(cwd, argv, env);
  const bundle = envelope.metadata.bundle;
  assert.ok(bundle !== undefined, `no bundle on ${JSON.stringify(envelope)}`);
  return bundle;
}

const PAGE =
  "---\ntype: note\ntitle: Pruning roses\n---\n\n# Pruning roses\n\nCut back to an outward-facing bud in late winter.\n";

/** A note bundle labelled `orchard` at `<parent>/<name>`, outside any repository. */
function layBundle(parent: string, name: string): string {
  const root = join(parent, name);
  writeNoteBundle(root, [], { label: "orchard" });
  writeAt(root, "wiki/pruning-roses.md", PAGE);
  return root;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

const HEX = /^[0-9a-f]{64}$/u;

describe("every envelope over a bundle names the bundle it read (docs/cli.md §The envelope)", () => {
  let tmp = "";
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "ww-bundle-"));
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("label is engine.json's and root the real path, however the root was spelled", () => {
    const parent = join(tmp, "label");
    const root = layBundle(parent, "kitchen");
    const bundle = bundleOf(parent, ["check", "--root", "kitchen"]);
    assert.equal(bundle.label, "orchard", "the label is engine.json's, not the directory's");
    assert.equal(bundle.root, realpathSync(root));
    assert.match(bundle.law, HEX);
    assert.match(bundle.content, HEX);
    if (process.platform === "win32") return; // a directory link needs developer mode there
    symlinkSync(root, join(parent, "linked"), "dir");
    const linked = bundleOf(parent, ["check", "--root", "linked"]);
    assert.equal(linked.root, realpathSync(root), "the root is the real directory, not the link");
  });

  it("head and dirty: null outside a repository, then HEAD and whether anything moved", () => {
    const root = layBundle(join(tmp, "git"), "orchard");
    // Whatever encloses the temporary directory on this machine, git looks no
    // higher than the bundle's parent, so "no repository" is this case's own.
    const ceiling = { GIT_CEILING_DIRECTORIES: realpathSync(join(tmp, "git")) };
    const outside = bundleOf(root, ["check"], ceiling);
    assert.equal(outside.head, null);
    assert.equal(outside.dirty, null);

    git(root, "init", "-q");
    const unborn = bundleOf(root, ["check"]);
    assert.equal(unborn.head, null, "a repository with no commit names no head");
    assert.equal(unborn.dirty, true, "untracked pages are a difference");

    git(root, "add", "-A");
    git(root, "commit", "-qm", "seed");
    const head = git(root, "rev-parse", "HEAD").trim();
    const clean = bundleOf(root, ["check"]);
    assert.equal(clean.head, head);
    assert.equal(clean.dirty, false);
    assert.equal(clean.content, outside.content, "git state is not content");
    assert.equal(clean.law, outside.law);

    appendFileSync(join(root, "wiki", "pruning-roses.md"), "\nSeal large cuts.\n");
    const edited = bundleOf(root, ["check"]);
    assert.equal(edited.head, head, "an uncommitted edit leaves HEAD where it was");
    assert.equal(edited.dirty, true);
    assert.notEqual(edited.content, clean.content, "the content digest reads the working tree");
    assert.equal(edited.law, clean.law, "a page edit is not a law edit");
  });

  it("law moves when engine.json changes and when a type document changes; content does not", () => {
    const root = layBundle(join(tmp, "law"), "orchard");
    const first = bundleOf(root, ["type", "list"]);

    writeFileSync(
      join(root, "config", "engine.json"),
      noteEngine({ label: "orchard", engine: ">=0.1.0" }),
    );
    const engineMoved = bundleOf(root, ["type", "list"]);
    assert.notEqual(engineMoved.law, first.law, "engine.json is part of the law");
    assert.equal(engineMoved.content, first.content);

    writeAt(
      root,
      "constitution/types/seedling.yaml",
      "type: seedling\nrole: concept\ndescription: A plant raised from seed.\n",
    );
    const lawMoved = bundleOf(root, ["type", "list"]);
    assert.notEqual(lawMoved.law, engineMoved.law, "the constitution is part of the law");
    assert.notEqual(lawMoved.law, first.law);
    assert.equal(lawMoved.content, first.content);
  });

  it("identical bytes in two directories give identical content and law", () => {
    const parent = join(tmp, "twins");
    const one = layBundle(parent, "orchard");
    const two = join(parent, "allotment");
    cpSync(one, two, { recursive: true });
    const a = bundleOf(parent, ["check", "--root", one]);
    const b = bundleOf(parent, ["check", "--root", two]);
    assert.equal(a.content, b.content);
    assert.equal(a.law, b.law);
    assert.notEqual(a.root, b.root);
  });

  it("a refusal from a verb that read the law carries the bundle too", () => {
    const root = layBundle(join(tmp, "refusal"), "orchard");
    const missing = run(root, ["type", "show", "no-such-type"]);
    assert.equal(missing.envelope.ok, false);
    assert.equal(missing.status, 3, JSON.stringify(missing.envelope));
    assert.equal(missing.envelope.metadata.bundle?.label, "orchard");

    writeFileSync(
      join(root, "wiki", "rogue.md"),
      "---\ntype: no-such-type\ntitle: Rogue\n---\n\n# Rogue\n",
    );
    const findings = run(root, ["check"]);
    assert.equal(findings.status, 5, JSON.stringify(findings.envelope));
    assert.equal(findings.envelope.metadata.bundle?.root, realpathSync(root));
  });

  it("a directory without config/engine.json names no bundle", () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty, { recursive: true });
    const r = run(empty, ["check"]);
    assert.equal(r.envelope.error?.["code"], "bundle-not-found");
    assert.equal(r.envelope.metadata.bundle, undefined);
  });

  it("a content root that is a link is not read, and the block still names the bundle", () => {
    if (process.platform === "win32") return; // a directory link needs developer mode there
    const parent = join(tmp, "outside");
    const root = layBundle(parent, "orchard");
    const elsewhere = join(parent, "elsewhere");
    cpSync(join(root, "wiki"), elsewhere, { recursive: true });
    rmSync(join(root, "wiki"), { recursive: true, force: true });
    symlinkSync(elsewhere, join(root, "wiki"), "dir");
    const r = run(root, ["check", "--all"]);
    const findings = (r.envelope.data?.["findings"] ?? []) as { rule: string; path: string }[];
    const skipped = findings.filter((f) => f.rule === "path-skipped");
    assert.deepEqual(
      skipped.map((f) => f.path),
      ["wiki"],
    );
    assert.equal(r.envelope.metadata.bundle?.label, "orchard");
  });

  it("an envelope answered before the verb runs names no bundle", () => {
    const root = layBundle(join(tmp, "before"), "orchard");
    const help = run(root, ["check", "--help"]);
    assert.equal(help.envelope.ok, true, JSON.stringify(help.envelope));
    const flag = run(root, ["check", "--no-such-flag"]);
    assert.equal(flag.envelope.error?.["code"], "unknown-flag");
    for (const r of [help, flag]) assert.equal(r.envelope.metadata.bundle, undefined);
  });

  it("version and --help --json answer about the engine and name no bundle, even over a bundle", () => {
    const root = layBundle(join(tmp, "engine"), "orchard");
    for (const argv of [["version"], ["check", "--help", "--json"]]) {
      const r = run(root, [...argv, "--root", root]);
      assert.equal(r.envelope.ok, true, JSON.stringify(r.envelope));
      assert.equal(r.envelope.metadata.bundle, undefined, `${argv.join(" ")} names a bundle`);
      assert.deepEqual(Object.keys(r.envelope.metadata).sort(), ["command", "engine"]);
    }
  });

  it("the generated brief prints the law digest the envelope carries", () => {
    const root = layBundle(join(tmp, "brief"), "orchard");
    const written = run(root, ["check", "--write"]);
    const law = written.envelope.metadata.bundle?.law ?? "";
    assert.match(law, HEX);
    assert.ok(
      readFileSync(join(root, "generated", "BRIEF.md"), "utf8").includes(
        `\nLaw digest: \`${law}\`\n`,
      ),
      "the generated brief's header names it",
    );
  });
});
