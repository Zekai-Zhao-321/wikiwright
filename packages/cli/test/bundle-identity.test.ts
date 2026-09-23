// docs/cli.md §The envelope: every envelope of a verb that reads a vault's law
// names the bundle it read — its label, its real root, the commit it sits at,
// whether it differs from that commit, a digest of its law and one of its
// content — on an ok envelope and a refusal alike; the verbs that answer about
// the engine name none. docs/cli.md §brief: the brief's header prints the same
// law digest.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const CONFORMANCE = fileURLToPath(new URL("../../../fixtures/conformance/", import.meta.url));
const PROBE = "@wikiwright-fixture/probe";

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
  const r = spawnSync(process.execPath, [CLI, ...argv], {
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

const CONSTITUTION = documentOf({
  types: { note: { extends: "concept", description: "A gardening note." } },
});

const PAGE =
  "---\ntype: note\ntitle: Pruning roses\ndescription: When and how to cut roses back.\ntags: []\n---\n\n# Pruning roses\n\nCut back to an outward-facing bud in late winter.\n";

/** A small bundle at `<parent>/<name>`, outside any repository. */
function layBundle(parent: string, name: string): string {
  const root = join(parent, name);
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "wiki"), { recursive: true });
  writeFileSync(join(root, "config", "constitution.json"), `${JSON.stringify(CONSTITUTION)}\n`);
  writeFileSync(join(root, "config", "engine.json"), '{ "content_roots": ["wiki"] }\n');
  writeFileSync(join(root, "wiki", "pruning-roses.md"), PAGE);
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

describe("every envelope over a vault names the bundle it read (docs/cli.md §The envelope)", () => {
  let tmp = "";
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "ww-bundle-"));
  });
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("label is the root's basename and root its real path, however the root was spelled", () => {
    const parent = join(tmp, "label");
    const root = layBundle(parent, "orchard");
    const bundle = bundleOf(parent, ["lint", "--root", "orchard"]);
    assert.equal(bundle.label, "orchard");
    assert.equal(bundle.root, realpathSync(root));
    assert.match(bundle.law, HEX);
    assert.match(bundle.content, HEX);
    if (process.platform === "win32") return; // a directory link needs developer mode there
    symlinkSync(root, join(parent, "linked"), "dir");
    const linked = bundleOf(parent, ["lint", "--root", "linked"]);
    assert.equal(linked.label, "orchard", "the label is the real directory's, not the link's");
    assert.equal(linked.root, realpathSync(root));
  });

  it("head and dirty: null outside a repository, then HEAD and whether anything moved", () => {
    const root = layBundle(join(tmp, "git"), "orchard");
    // Whatever encloses the temporary directory on this machine, git looks no
    // higher than the bundle's parent, so "no repository" is this case's own.
    const ceiling = { GIT_CEILING_DIRECTORIES: realpathSync(join(tmp, "git")) };
    const outside = bundleOf(root, ["lint"], ceiling);
    assert.equal(outside.head, null);
    assert.equal(outside.dirty, null);

    git(root, "init", "-q");
    const unborn = bundleOf(root, ["lint"]);
    assert.equal(unborn.head, null, "a repository with no commit names no head");
    assert.equal(unborn.dirty, true, "untracked pages are a difference");

    git(root, "add", "-A");
    git(root, "commit", "-qm", "seed");
    const head = git(root, "rev-parse", "HEAD").trim();
    const clean = bundleOf(root, ["lint"]);
    assert.equal(clean.head, head);
    assert.equal(clean.dirty, false);
    assert.equal(clean.content, outside.content, "git state is not content");
    assert.equal(clean.law, outside.law);

    appendFileSync(join(root, "wiki", "pruning-roses.md"), "\nSeal large cuts.\n");
    const edited = bundleOf(root, ["lint"]);
    assert.equal(edited.head, head, "an uncommitted edit leaves HEAD where it was");
    assert.equal(edited.dirty, true);
    assert.notEqual(edited.content, clean.content, "the content digest reads the working tree");
    assert.equal(edited.law, clean.law, "a page edit is not a law edit");
  });

  it("law moves when engine.json changes and when the constitution changes; content does not", () => {
    const root = layBundle(join(tmp, "law"), "orchard");
    const first = bundleOf(root, ["type", "list"]);

    writeFileSync(
      join(root, "config", "engine.json"),
      '{ "content_roots": ["wiki"], "engine": ">=0.1.0" }\n',
    );
    const engineMoved = bundleOf(root, ["type", "list"]);
    assert.notEqual(engineMoved.law, first.law, "engine.json is part of the law");
    assert.equal(engineMoved.content, first.content);

    const grown = documentOf({
      types: {
        note: { extends: "concept", description: "A gardening note." },
        seedling: { extends: "concept", description: "A plant raised from seed." },
      },
    });
    writeFileSync(join(root, "config", "constitution.json"), `${JSON.stringify(grown)}\n`);
    const constitutionMoved = bundleOf(root, ["type", "list"]);
    assert.notEqual(constitutionMoved.law, engineMoved.law, "the constitution is part of the law");
    assert.notEqual(constitutionMoved.law, first.law);
    assert.equal(constitutionMoved.content, first.content);
  });

  it("identical bytes in two directories give identical content and law", () => {
    const parent = join(tmp, "twins");
    const one = layBundle(parent, "orchard");
    const two = join(parent, "allotment");
    cpSync(one, two, { recursive: true });
    const a = bundleOf(parent, ["lint", "--root", one]);
    const b = bundleOf(parent, ["lint", "--root", two]);
    assert.equal(a.content, b.content);
    assert.equal(a.law, b.law);
    assert.notEqual(a.root, b.root);
    assert.deepEqual([a.label, b.label], ["orchard", "allotment"]);
  });

  it("a refusal from a vault verb carries the bundle too", () => {
    const root = layBundle(join(tmp, "refusal"), "orchard");
    const missing = run(root, ["type", "show", "no-such-type"]);
    assert.equal(missing.envelope.ok, false);
    assert.equal(missing.status, 3, JSON.stringify(missing.envelope));
    assert.equal(missing.envelope.metadata.bundle?.label, "orchard");

    writeFileSync(
      join(root, "wiki", "rogue.md"),
      "---\ntype: no-such-type\ntitle: Rogue\ndescription: A page of no type.\ntags: []\n---\n\n# Rogue\n",
    );
    const findings = run(root, ["lint"]);
    assert.equal(findings.status, 5, JSON.stringify(findings.envelope));
    assert.equal(findings.envelope.metadata.bundle?.root, realpathSync(root));
  });

  it("a directory without a constitution names no bundle", () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty, { recursive: true });
    const r = run(empty, ["lint"]);
    assert.equal(r.envelope.error?.["code"], "registry-not-found");
    assert.equal(r.envelope.metadata.bundle, undefined);
  });

  it("a content root that resolves outside the vault leaves the block off, and the refusal stands", () => {
    if (process.platform === "win32") return; // a directory link needs developer mode there
    const parent = join(tmp, "outside");
    const root = layBundle(parent, "orchard");
    const elsewhere = join(parent, "elsewhere");
    cpSync(join(root, "wiki"), elsewhere, { recursive: true });
    rmSync(join(root, "wiki"), { recursive: true, force: true });
    symlinkSync(elsewhere, join(root, "wiki"), "dir");
    const r = run(root, ["lint"]);
    assert.equal(r.envelope.error?.["code"], "content-root-outside", JSON.stringify(r.envelope));
    assert.equal(r.envelope.metadata.bundle, undefined, "no identity is stated in part");
  });

  it("an envelope answered before the verb runs names no bundle", () => {
    const root = layBundle(join(tmp, "before"), "orchard");
    const help = run(root, ["lint", "--help"]);
    assert.equal(help.envelope.ok, true, JSON.stringify(help.envelope));
    const flag = run(root, ["lint", "--no-such-flag"]);
    assert.equal(flag.envelope.error?.["code"], "unknown-flag");
    const role = run(root, ["lint"], { WIKIWRIGHT_ROLE: "consumer" });
    assert.equal(role.envelope.error?.["code"], "role-forbidden");
    for (const r of [help, flag, role]) assert.equal(r.envelope.metadata.bundle, undefined);
  });

  it("version, schema and trust answer about the engine and name no bundle, even over a vault", () => {
    const root = layBundle(join(tmp, "engine"), "orchard");
    const store = join(tmp, "engine", "trust.json");
    for (const argv of [["version"], ["schema"], ["trust", "list"]]) {
      const r = run(root, [...argv, "--root", root], { WIKIWRIGHT_TRUST_FILE: store });
      assert.equal(r.envelope.ok, true, JSON.stringify(r.envelope));
      assert.equal(r.envelope.metadata.bundle, undefined, `${argv[0]} names a bundle`);
      assert.deepEqual(Object.keys(r.envelope.metadata).sort(), ["command", "engine"]);
    }
  });

  it("the brief prints the law digest the envelope carries", () => {
    const root = layBundle(join(tmp, "brief"), "orchard");
    const printed = run(root, ["brief"]);
    const law = printed.envelope.metadata.bundle?.law ?? "";
    assert.match(law, HEX);
    assert.ok(
      String(printed.envelope.data?.["brief"]).includes(`\nLaw digest: \`${law}\`\n`),
      "the printed brief's header names the envelope's law digest",
    );
    const written = run(root, ["check", "--write"]);
    assert.equal(written.envelope.metadata.bundle?.law, law);
    assert.ok(
      readFileSync(join(root, "generated", "BRIEF.md"), "utf8").includes(
        `\nLaw digest: \`${law}\`\n`,
      ),
      "the generated brief's header names it too",
    );
  });
});

describe("the law digest names the loaded modules (docs/cli.md §The envelope)", () => {
  let tmp = "";
  let root = "";
  let env: NodeJS.ProcessEnv = {};
  const installed = (): string => join(root, "node_modules", ...PROBE.split("/"));
  before(() => {
    // The neutral module fixture, placed in the bundle's own node_modules by
    // copy and granted in a store this test owns.
    tmp = mkdtempSync(join(tmpdir(), "ww-bundle-module-"));
    root = join(tmp, "bundle-a");
    for (const part of ["config", "wiki", "package.json"]) {
      cpSync(join(CONFORMANCE, "bundle-a", part), join(root, part), { recursive: true });
    }
    cpSync(join(CONFORMANCE, "module-fixture"), installed(), { recursive: true });
    env = { WIKIWRIGHT_TRUST_FILE: join(tmp, "trust.json") };
  });
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const grant = (): void => {
    const r = run(root, ["trust", "grant", `module:${PROBE}`], env);
    assert.equal(r.envelope.ok, true, JSON.stringify(r.envelope));
  };

  it("a module's bytes move the law, and a verb that empties the preload still names it", () => {
    grant();
    const first = bundleOf(root, ["type", "list"], env);
    // `modules plan` forgets the preloaded set before it returns; the law it
    // names is the one the verb ran under, not the empty cache it left.
    const planned = bundleOf(
      root,
      ["modules", "plan", "--package", PROBE, "--candidate", root],
      env,
    );
    assert.equal(planned.law, first.law);

    writeFileSync(join(installed(), "NOTES.txt"), "a file the grant did not see\n");
    grant();
    const moved = bundleOf(root, ["type", "list"], env);
    assert.notEqual(moved.law, first.law, "the module digest is part of the law");
    assert.equal(moved.content, first.content);
  });
});
