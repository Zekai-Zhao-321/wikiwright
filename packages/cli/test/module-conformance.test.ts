// docs/extending.md §Declaring a module, docs/extending.md §The determinism fixture, docs/extending.md §Adopting a new version
// docs/architecture.md §The invariants
//
// e2e:modules — `config/engine.json` declares a module package, the package is
// resolved from the bundle's own `node_modules`, pinned by the bundle's own
// granted on this machine, scanned, loaded, proved against its own
// fixture, and then GOVERNS the vault: its grammar parses, its arms fire, its
// severity ratchets, its findings route to its own lane, and its coverage rows
// are counted. Bytes on disk to a verdict, with nothing hard-coded in between.
//
// The fixture module is domain-neutral test infrastructure. It is not a domain
// model, not a recommended shape and not a product kit: it exists so this suite
// can prove that an EXTERNAL package reaches every extension surface through the
// public API, and nothing else.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadModules } from "@wikiwright/core";
import { lawFor } from "../src/law.ts";
import { loadVault } from "../src/vaultio.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CONFORMANCE = join(REPO, "fixtures", "conformance");
const CLI = fileURLToPath(new URL("../src/main.ts", import.meta.url));

/** A machine-local trust store this suite owns, so a grant here is not the developer's. */
const TRUST = join(mkdtempSync(join(tmpdir(), "ww-conformance-trust-")), "trust.json");

/**
 * The shipped fixture's own bytes, taken before any case runs. Several cases
 * mutate an installed COPY of this package; if one of them ever writes through
 * to the original again, this fails by name rather than leaving a mutation in
 * the working tree for a reader to find later.
 */
const FIXTURE_FILES = ["index.js", "fixture.json", "package.json"] as const;
const FIXTURE_BEFORE = FIXTURE_FILES.map((f) =>
  readFileSync(join(CONFORMANCE, "module-fixture", f), "utf8"),
);

after(() => {
  rmSync(TRUST, { recursive: true, force: true });
  rmSync(BUNDLE_A, { recursive: true, force: true });
  rmSync(BUNDLE_B, { recursive: true, force: true });
  FIXTURE_FILES.forEach((file, i) => {
    assert.equal(
      readFileSync(join(CONFORMANCE, "module-fixture", file), "utf8"),
      FIXTURE_BEFORE[i],
      `this suite mutated the shipped fixture's ${file} — a test may not write to the tree it tests`,
    );
  });
});

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

function run(root: string, argv: readonly string[]): { status: number; envelope: Envelope } {
  const result = execFileSync(process.execPath, [CLI, ...argv, "--root", root], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, WIKIWRIGHT_TRUST_FILE: TRUST },
    // A non-zero exit is a VERDICT here, not a harness failure.
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: 0, envelope: JSON.parse(result) as Envelope };
}

/** The same, tolerating the engine's own non-zero exits (2 = constitution, 5 = findings). */
function runAny(root: string, argv: readonly string[]): { status: number; envelope: Envelope } {
  try {
    return run(root, argv);
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    assert.equal(typeof e.stdout, "string", `the CLI printed no envelope: ${String(error)}`);
    return { status: e.status ?? -1, envelope: JSON.parse(e.stdout ?? "{}") as Envelope };
  }
}

/** Install the fixture module into a bundle, offline: it is a `file:` dependency. */
function install(root: string): void {
  if (existsSync(join(root, "node_modules", "@wikiwright-fixture", "probe"))) return;
  execFileSync("bun", ["install"], { cwd: root, stdio: "ignore" });
}

function grant(root: string): Envelope {
  install(root);
  const r = runAny(root, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
  assert.equal(r.envelope.ok, true, JSON.stringify(r.envelope));
  return r.envelope;
}

/**
 * The shipped bundle, copied under os.tmpdir and installed THERE. Every
 * test writes under the temp directory and never in the repo: installing in
 * the shipped fixture left a `bun.lock` and a `node_modules/` in the tree
 * after every run. The shipped `package.json` names the fixture module by a
 * path relative to its own location, so the copy names it absolutely.
 */
function installedCopy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ww-${name}-`));
  cpSync(join(CONFORMANCE, name), dir, { recursive: true });
  const manifest = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
    dependencies: Record<string, string>;
  };
  pkg.dependencies["@wikiwright-fixture/probe"] = `file:${join(CONFORMANCE, "module-fixture")}`;
  writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
  install(dir);
  return dir;
}

const BUNDLE_A = installedCopy("bundle-a");
const BUNDLE_B = installedCopy("bundle-b");

/**
 * A throwaway copy of a bundle, with its install carried over — and with every
 * symlink inside it REPLACED by the bytes it pointed at.
 *
 * That last part is not tidiness. A `file:` install links each of the package's
 * files at an absolute path back into this repository, `cpSync` copies those
 * links even under `dereference: true`, and a test that then writes to the copy
 * writes THROUGH to the shipped fixture. It did, on the first run of this file
 * under the node runner: three fixture files came back mutated. A test that can
 * corrupt the tree it is testing is worse than no test.
 */
function copyOf(source: string): string {
  install(source);
  const dir = mkdtempSync(join(tmpdir(), "ww-bundle-"));
  cpSync(source, dir, { recursive: true, dereference: true });
  materialize(dir);
  return dir;
}

/** Replace every symlink under `dir` with the bytes it points at. */
function materialize(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true, encoding: "utf8" })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const bytes = readFileSync(path);
      rmSync(path, { force: true });
      writeFileSync(path, bytes);
      continue;
    }
    if (entry.isDirectory()) materialize(path);
  }
}

function findings(envelope: Envelope): { ruleId: string; severity: string; queue?: string }[] {
  return (envelope.data?.["findings"] ?? []) as {
    ruleId: string;
    severity: string;
    queue?: string;
  }[];
}

// ---------------------------------------------------------------------------

describe("a bundle loads a module package from its own node_modules (docs/extending.md §Declaring a module)", () => {
  // e2e:modules — the key's whole path, written here rather than asserted from
  // the shipped fixture: this case WRITES `config/engine.json`, so the walk sees
  // a test that goes from bytes on disk to a verdict rather than from a fixture
  // somebody may have edited into agreement.
  it("the `modules` key in engine.json is what makes a module load at all", () => {
    const bundle = copyOf(BUNDLE_A);
    try {
      runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      const config = join(bundle, "config", "engine.json");
      // With the key: the module's census arm fires on the bundle's page.
      writeFileSync(
        config,
        JSON.stringify(
          {
            content_roots: ["wiki"],
            modules: [{ package: "@wikiwright-fixture/probe", version: "^1.0.0" }],
          },
          null,
          2,
        ),
      );
      const withKey = findings(runAny(bundle, ["lint", "--all"]).envelope);
      assert.equal(
        withKey.some((f) => f.ruleId === "@wikiwright-fixture/probe/measured"),
        true,
        JSON.stringify(withKey),
      );
      // Without it, the bundle's own type extends a type nothing contributes,
      // and the constitution does not load. A declaration nothing reads would
      // have left this green.
      writeFileSync(config, JSON.stringify({ content_roots: ["wiki"] }, null, 2));
      const withoutKey = runAny(bundle, ["lint", "--all"]);
      assert.equal(withoutKey.envelope.ok, false, JSON.stringify(withoutKey.envelope));
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("refuses an untrusted module by name, before it can judge anything", () => {
    install(BUNDLE_A);
    // A fresh store: this is what a reviewer's machine looks like the first time.
    rmSync(TRUST, { force: true });
    const listed = runAny(BUNDLE_A, ["modules", "list"]);
    const refused = (listed.envelope.data?.["refused"] ?? []) as { code: string; grant: string }[];
    assert.deepEqual(
      refused.map((r) => [r.code, r.grant]),
      [["module-untrusted", "missing"]],
      JSON.stringify(listed.envelope),
    );
    // …and a verb that would judge the vault refuses too, rather than judging it
    // under the standard library alone.
    const linted = runAny(BUNDLE_A, ["lint", "--all"]);
    assert.equal(linted.envelope.ok, false);
    assert.equal(linted.envelope.error?.["code"], "module-untrusted");
  });

  it("a granted module resolves and reports what it registered", () => {
    const granted = grant(BUNDLE_A);
    // docs/extending.md §The determinism fixture: the grant is written only after the module's own fixture
    // ran, twice, and agreed with itself — and the grant envelope says so.
    assert.deepEqual(granted.data?.["fixture"], {
      package: "@wikiwright-fixture/probe",
      pages: 1,
      findings: 3,
    });
    const listed = run(BUNDLE_A, ["modules", "list"]);
    const loaded = (listed.envelope.data?.["loaded"] ?? []) as Record<string, unknown>[];
    assert.equal(loaded.length, 1, JSON.stringify(listed.envelope));
    const row = loaded[0];
    assert.equal(row?.["package"], "@wikiwright-fixture/probe");
    assert.equal(row?.["version"], "1.0.0");
    // The whole of what the module contributed, and how the bundle
    // names it — the `file:` spelling from its package.json, the range
    // engine.json declares, the resolved path, and the grant's standing.
    const contributes = row?.["contributes"] as Record<string, string[]>;
    assert.deepEqual(contributes["grammars"], ["@wikiwright-fixture/probe/measures"]);
    assert.deepEqual(contributes["vocabularies"], ["@wikiwright-fixture/probe/sizes"]);
    assert.deepEqual(contributes["checks"], ["@wikiwright-fixture/probe/has-id"]);
    assert.deepEqual(contributes["lanes"], ["@wikiwright-fixture/probe/review"]);
    assert.deepEqual(contributes["types"], ["@wikiwright-fixture/probe/subject"]);
    assert.deepEqual(contributes["fragments"], ["@wikiwright-fixture/probe/identified"]);
    assert.deepEqual(contributes["templates"], ["@wikiwright-fixture/probe/subject.md"]);
    assert.deepEqual(contributes["skills"], ["Measures"]);
    const resolved = row?.["resolved"] as Record<string, unknown>;
    assert.match(String(resolved["spec"]), /^file:.*module-fixture$/u);
    assert.equal(resolved["path"], "node_modules/@wikiwright-fixture/probe");
    assert.equal(row?.["grant"], "granted");
    // docs/extending.md §The determinism fixture: the module's own fixture ran, twice, and agreed with itself.
    assert.deepEqual(row?.["fixture"], {
      package: "@wikiwright-fixture/probe",
      pages: 1,
      findings: 3,
    });
  });

  it("a module edited after its grant is refused, and the refusal says which", () => {
    grant(BUNDLE_A);
    const bundle = copyOf(BUNDLE_A);
    const entry = join(bundle, "node_modules", "@wikiwright-fixture", "probe", "index.js");
    const original = readFileSync(entry, "utf8");
    try {
      writeFileSync(entry, `${original}\n// edited after the grant\n`);
      const listed = runAny(bundle, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as { code: string }[];
      // The COPY has a different vault key, so it is untrusted rather than
      // modified — which is the same law from the other side: a grant covers one
      // vault at one content hash, and neither may drift.
      assert.equal(refused.length, 1, JSON.stringify(listed.envelope));
      assert.equal(refused[0]?.code, "module-untrusted");
      // Grant the copy as it stands, then edit it: now it is `module-modified`.
      runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      writeFileSync(entry, `${original}\n// edited AFTER the grant\n`);
      const again = runAny(bundle, ["modules", "list"]);
      const second = (again.envelope.data?.["refused"] ?? []) as { code: string }[];
      assert.deepEqual(
        second.map((r) => r.code),
        ["module-modified"],
        JSON.stringify(again.envelope),
      );
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  // ---- the two ways the package boundary leaked ----------------------------

  it("a dot-prefixed entry is inside the grant, not beside it", () => {
    // The hole: `moduleFiles` skipped every dot-prefixed name, so a package
    // could name `.hidden.mjs` as its entry, load it, and edit it afterwards
    // with the digest unmoved. Reproduced against a real install before the fix:
    // the grant hashed TWO files and the entry was not one of them.
    const bundle = copyOf(BUNDLE_A);
    const pkg = join(bundle, "node_modules", "@wikiwright-fixture", "probe");
    try {
      renameSync(join(pkg, "index.js"), join(pkg, ".hidden.mjs"));
      const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
        wikiwright: { module: string };
      };
      manifest.wikiwright.module = "./.hidden.mjs";
      writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest, null, 2));

      const granted = runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      assert.equal(granted.envelope.ok, true, JSON.stringify(granted.envelope));
      // Three files, not two: package.json, fixture.json AND the hidden entry.
      assert.equal(granted.envelope.data?.["files"], 3, JSON.stringify(granted.envelope.data));
      const listed = runAny(bundle, ["modules", "list"]);
      const loaded = (listed.envelope.data?.["loaded"] ?? []) as unknown[];
      assert.equal(loaded.length, 1, JSON.stringify(listed.envelope));

      // A PURE edit — a comment, nothing the purity scan would catch on its own.
      // Before the boundary fix this left the digest identical and the grant standing.
      const hidden = join(pkg, ".hidden.mjs");
      writeFileSync(hidden, `${readFileSync(hidden, "utf8")}\n// edited after the grant\n`);
      const again = runAny(bundle, ["modules", "list"]);
      const refused = (again.envelope.data?.["refused"] ?? []) as { code: string }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-modified"],
        JSON.stringify(again.envelope),
      );
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("an entry outside the package does not resolve, and never imports", () => {
    // The hole: `join(root, contract.module)` and `existsSync`. An entry of
    // "../../../outside.mjs" existed, imported and RAN, with its bytes in
    // neither the digest nor the purity scan.
    const bundle = copyOf(BUNDLE_A);
    const pkg = join(bundle, "node_modules", "@wikiwright-fixture", "probe");
    try {
      const outside = join(bundle, "outside.mjs");
      writeFileSync(outside, readFileSync(join(pkg, "index.js"), "utf8"));
      const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
        wikiwright: { module: string; fixture: string };
      };
      manifest.wikiwright.module = "../../../outside.mjs";
      writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest, null, 2));
      runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      const listed = runAny(bundle, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as {
        code: string;
        message: string;
      }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-malformed"],
        JSON.stringify(listed.envelope),
      );
      assert.match(refused[0]?.message ?? "", /does not resolve to a file inside the package/u);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("a fixture outside the package is refused by the same question", () => {
    const bundle = copyOf(BUNDLE_A);
    const pkg = join(bundle, "node_modules", "@wikiwright-fixture", "probe");
    try {
      writeFileSync(join(bundle, "outside.json"), readFileSync(join(pkg, "fixture.json"), "utf8"));
      const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
        wikiwright: { fixture: string };
      };
      manifest.wikiwright.fixture = "../../../outside.json";
      writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest, null, 2));
      runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      const listed = runAny(bundle, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as {
        code: string;
        message: string;
      }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-fixture-missing"],
        JSON.stringify(listed.envelope),
      );
      assert.match(refused[0]?.message ?? "", /inside the package/u);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("a module that reaches for the clock is refused by the purity scan, with the line", () => {
    const bundle = copyOf(BUNDLE_A);
    const entry = join(bundle, "node_modules", "@wikiwright-fixture", "probe", "index.js");
    try {
      writeFileSync(entry, `${readFileSync(entry, "utf8")}\nexport const when = Date.now();\n`);
      const listed = runAny(bundle, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as {
        code: string;
        message: string;
      }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-impure"],
        JSON.stringify(listed.envelope),
      );
      assert.match(refused[0]?.message ?? "", /index\.js:\d+ reads the clock/u);
      // …and `trust grant` refuses it too: a grant on a module the engine would
      // refuse anyway reads as approval and buys nothing.
      const granted = runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      assert.equal(granted.envelope.ok, false);
      assert.equal(granted.envelope.error?.["code"], "module-impure");
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("a declared module the bundle does not have installed fails closed", () => {
    const bundle = copyOf(BUNDLE_A);
    try {
      rmSync(join(bundle, "node_modules"), { recursive: true, force: true });
      const linted = runAny(bundle, ["lint", "--all"]);
      assert.equal(linted.envelope.ok, false);
      assert.equal(linted.envelope.error?.["code"], "module-unresolved");
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("a package installed only above the bundle boundary is unresolved", () => {
    const parent = copyOf(BUNDLE_A);
    const child = join(parent, "child");
    try {
      mkdirSync(child);
      cpSync(join(parent, "config"), join(child, "config"), { recursive: true });
      cpSync(join(parent, "wiki"), join(child, "wiki"), { recursive: true });
      cpSync(join(parent, "package.json"), join(child, "package.json"));

      const listed = runAny(child, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as { code: string }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-unresolved"],
        JSON.stringify(listed.envelope),
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("a module built for another engine fails closed, naming both versions", () => {
    const bundle = copyOf(BUNDLE_A);
    const manifest = join(bundle, "node_modules", "@wikiwright-fixture", "probe", "package.json");
    try {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        wikiwright: { engine?: string };
      };
      parsed.wikiwright.engine = ">=9.0.0";
      writeFileSync(manifest, JSON.stringify(parsed, null, 2));
      const listed = runAny(bundle, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as {
        code: string;
        message: string;
      }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-incompatible"],
      );
      assert.match(refused[0]?.message ?? "", />=9\.0\.0/u);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("the installed version must satisfy the range config/engine.json declares", () => {
    const bundle = copyOf(BUNDLE_A);
    const file = join(bundle, "node_modules", "@wikiwright-fixture", "probe", "package.json");
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { version: string };
      parsed.version = "9.9.9";
      writeFileSync(file, JSON.stringify(parsed, null, 2));
      // The grant loads the module it approves, so a version the bundle's own
      // range rejects is refused there — a grant the loader would refuse anyway
      // reads as approval and buys nothing.
      const granted = runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      assert.equal(granted.envelope.ok, false, JSON.stringify(granted.envelope));
      assert.equal(granted.envelope.error?.["code"], "module-version-mismatch");

      const listed = runAny(bundle, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as {
        code: string;
        message: string;
      }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-version-mismatch"],
        JSON.stringify(listed.envelope),
      );
      assert.match(refused[0]?.message ?? "", /\^1\.0\.0.*9\.9\.9/u);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("the declared entry is purity-scanned even when its suffix is .cts", () => {
    const bundle = copyOf(BUNDLE_A);
    const pkg = join(bundle, "node_modules", "@wikiwright-fixture", "probe");
    try {
      renameSync(join(pkg, "index.js"), join(pkg, "index.cts"));
      writeFileSync(
        join(pkg, "index.cts"),
        `${readFileSync(join(pkg, "index.cts"), "utf8")}\nexport const readClock = Date.now();\n`,
      );
      const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
        wikiwright: { module: string };
      };
      manifest.wikiwright.module = "./index.cts";
      writeFileSync(join(pkg, "package.json"), JSON.stringify(manifest, null, 2));

      const granted = runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      assert.equal(granted.envelope.ok, false, JSON.stringify(granted.envelope));
      assert.equal(granted.envelope.error?.["code"], "module-impure");
      assert.match(String(granted.envelope.error?.["message"]), /index\.cts:\d+ reads the clock/u);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("portable .mjs and .cjs entries load, while a pure .cts entry is refused by shape", () => {
    for (const extension of ["mjs", "cjs"]) {
      const bundle = copyOf(BUNDLE_A);
      const pkg = join(bundle, "node_modules", "@wikiwright-fixture", "probe");
      try {
        const entry = join(pkg, `index.${extension}`);
        let source = readFileSync(join(pkg, "index.js"), "utf8");
        if (extension === "cjs") source = source.replace("export default {", "module.exports = {");
        writeFileSync(entry, source);
        rmSync(join(pkg, "index.js"));
        const packageJson = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
          wikiwright: { module: string };
        };
        packageJson.wikiwright.module = `./index.${extension}`;
        writeFileSync(join(pkg, "package.json"), JSON.stringify(packageJson, null, 2));
        const granted = runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
        assert.equal(
          granted.envelope.ok,
          true,
          `${extension}: ${JSON.stringify(granted.envelope)}`,
        );
        const listed = runAny(bundle, ["modules", "list"]);
        assert.equal(
          ((listed.envelope.data?.["loaded"] ?? []) as unknown[]).length,
          1,
          `${extension}: ${JSON.stringify(listed.envelope)}`,
        );
      } finally {
        rmSync(bundle, { recursive: true, force: true });
      }
    }

    const bundle = copyOf(BUNDLE_A);
    const pkg = join(bundle, "node_modules", "@wikiwright-fixture", "probe");
    try {
      renameSync(join(pkg, "index.js"), join(pkg, "index.cts"));
      const packageJson = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
        wikiwright: { module: string };
      };
      packageJson.wikiwright.module = "./index.cts";
      writeFileSync(join(pkg, "package.json"), JSON.stringify(packageJson, null, 2));
      // Refused by shape at the grant, and by the same law at every load after.
      const granted = runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      assert.equal(granted.envelope.ok, false, JSON.stringify(granted.envelope));
      assert.equal(granted.envelope.error?.["code"], "module-malformed");
      const listed = runAny(bundle, ["modules", "list"]);
      const refused = (listed.envelope.data?.["refused"] ?? []) as { code: string }[];
      assert.deepEqual(
        refused.map((r) => r.code),
        ["module-malformed"],
      );
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("a module whose own fixture disagrees with this engine is not granted", () => {
    const bundle = copyOf(BUNDLE_A);
    const fixture = join(bundle, "node_modules", "@wikiwright-fixture", "probe", "fixture.json");
    try {
      runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      const parsed = JSON.parse(readFileSync(fixture, "utf8")) as { expected: string[] };
      parsed.expected = [];
      writeFileSync(fixture, JSON.stringify(parsed, null, 2));
      // The fixture is not executable code, so the digest changes and the grant
      // is stale. The re-grant is where the fixture runs — and it refuses.
      const regrant = runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      assert.equal(regrant.envelope.ok, false, JSON.stringify(regrant.envelope));
      assert.equal(regrant.envelope.error?.["code"], "module-fixture-failed");
      // No grant landed for the edited bytes, so the vault stays unjudgeable
      // under the stale one: the module is `modified`, not silently loaded.
      const linted = runAny(bundle, ["lint", "--all"]);
      assert.equal(linted.envelope.ok, false);
      assert.equal(linted.envelope.error?.["code"], "module-modified");
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------

describe("the module governs the vault, end to end (docs/extending.md §A check)", () => {
  it("its grammar parses, its arms fire, and its findings route to its own lane", () => {
    grant(BUNDLE_B);
    const bundle = copyOf(BUNDLE_B);
    try {
      runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      writeFileSync(
        join(bundle, "wiki", "Beta.md"),
        [
          "---",
          "type: gadget",
          "title: Beta",
          "description: A page bundle B measures.",
          "tags: [probe]",
          "probe_id: WRONG-1",
          "---",
          "",
          "# Beta",
          "",
          "A page bundle B measures.",
          "",
          "## Measures",
          "",
          "- size: large",
          "- weight: enormous",
          "",
        ].join("\n"),
      );
      const linted = runAny(bundle, ["lint", "--all"]);
      const found = findings(linted.envelope);
      const byRule = new Map(found.map((f) => [f.ruleId, f] as const));

      // The module's own grammar parsed both items — neither is `grammar-unparsed`.
      assert.equal(byRule.has("grammar-unparsed"), false, JSON.stringify(found));
      // Its vocabulary law fired on the value the BUNDLE did not declare.
      assert.equal(byRule.get("@wikiwright-fixture/probe/unknown-size")?.severity, "error");
      // Its section allow-list fired, at the severity the section declared.
      assert.equal(byRule.get("@wikiwright-fixture/probe/not-allowed")?.severity, "error");
      // Its check fired, at the severity the ATTACHMENT declared.
      assert.equal(byRule.get("@wikiwright-fixture/probe/has-id")?.severity, "error");
      // Its census row is `info`, and the section's `severity: error` does not
      // reach it — a count is not a verdict.
      assert.equal(byRule.get("@wikiwright-fixture/probe/measured")?.severity, "info");
      // docs/concepts.md §Findings and routing: every non-info finding of the module queues to the
      // module's OWN lane, and none of them carries a fix.
      for (const rule of [
        "@wikiwright-fixture/probe/unknown-size",
        "@wikiwright-fixture/probe/not-allowed",
        "@wikiwright-fixture/probe/has-id",
      ]) {
        assert.equal(byRule.get(rule)?.queue, "@wikiwright-fixture/probe/review", rule);
      }
      // …and the coverage block counts the module's arms and its check.
      const coverage = (linted.envelope.data?.["coverage"] ?? {}) as {
        passes?: Record<string, { evaluated: number }>;
      };
      assert.equal(coverage.passes?.["@wikiwright-fixture/probe/unknown-size"]?.evaluated, 1);
      assert.equal(coverage.passes?.["@wikiwright-fixture/probe/has-id"]?.evaluated, 1);
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("a module that throws is one attributed error, not a crash", () => {
    const bundle = copyOf(BUNDLE_A);
    const entry = join(bundle, "node_modules", "@wikiwright-fixture", "probe", "index.js");
    try {
      // The arm throws only on a key the module's OWN fixture page does not
      // carry, so the fixture still passes and this case is about the blast
      // radius of a bug rather than about the fixture gate.
      const before = readFileSync(entry, "utf8");
      const source = before.replace(
        '            const probe = asProbe(item);\n            if (probe === undefined) return;\n            ctx.emit(\n              "@wikiwright-fixture/probe/measured",',
        '            const probe = asProbe(item);\n            if (probe === undefined) return;\n            if (probe.key === "weight") throw new Error("a stranger\'s bug");\n            ctx.emit(\n              "@wikiwright-fixture/probe/measured",',
      );
      assert.notEqual(source, before, "the mutation landed");
      writeFileSync(entry, source);
      runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      const linted = runAny(bundle, ["lint", "--all"]);
      // The verdict EXISTS — the vault was judged — and the failure is one
      // finding naming the module and the arm.
      const failure = findings(linted.envelope).find((f) => f.ruleId === "module-failure");
      assert.notEqual(failure, undefined, JSON.stringify(linted.envelope));
      assert.equal(failure?.severity, "error");
      assert.equal(failure?.queue, "module-review");
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------

describe("two bundles consume one module and stay independent (docs/extending.md §The manifest)", () => {
  it("each declares its own vocabulary entries, and the module reads each bundle's", () => {
    grant(BUNDLE_A);
    grant(BUNDLE_B);
    // `medium` is bundle A's entry alone; `large` is bundle B's alone. Same
    // module, same arm, two answers — which is the whole point of a kit.
    const a = copyOf(BUNDLE_A);
    const b = copyOf(BUNDLE_B);
    try {
      for (const bundle of [a, b]) {
        runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      }
      const page = (type: string, id: string, value: string): string =>
        [
          "---",
          `type: ${type}`,
          "title: Probe",
          "description: A probed page.",
          "tags: [probe]",
          `probe_id: ${id}`,
          "---",
          "",
          "# Probe",
          "",
          "A probed page.",
          "",
          "## Measures",
          "",
          `- size: ${value}`,
          "",
        ].join("\n");
      writeFileSync(join(a, "wiki", "Alpha.md"), page("widget", "A-1", "medium"));
      writeFileSync(join(b, "wiki", "Beta.md"), page("gadget", "B-1", "medium"));

      const aFound = findings(runAny(a, ["lint", "--all"]).envelope);
      assert.equal(
        aFound.some((f) => f.ruleId === "@wikiwright-fixture/probe/unknown-size"),
        false,
        "bundle A declares `medium`",
      );
      const bFound = findings(runAny(b, ["lint", "--all"]).envelope);
      assert.equal(
        bFound.some((f) => f.ruleId === "@wikiwright-fixture/probe/unknown-size"),
        true,
        "bundle B does not",
      );
      // …and `tiny` is the MODULE's entry, so both bundles carry it unasked.
      writeFileSync(join(a, "wiki", "Alpha.md"), page("widget", "A-1", "tiny"));
      writeFileSync(join(b, "wiki", "Beta.md"), page("gadget", "B-1", "tiny"));
      for (const [bundle, name] of [
        [a, "A"],
        [b, "B"],
      ] as const) {
        assert.equal(
          findings(runAny(bundle, ["lint", "--all"]).envelope).some(
            (f) => f.ruleId === "@wikiwright-fixture/probe/unknown-size",
          ),
          false,
          `bundle ${name} reads the module's shipped entry`,
        );
      }
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("a bundle may tighten the module's shared section and may not weaken it", () => {
    grant(BUNDLE_B);
    const bundle = copyOf(BUNDLE_B);
    try {
      runAny(bundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      // Bundle B's `allow: ["small"]` is a tightening of a section the MODULE
      // declared with no allow-list at all, and it bites.
      writeFileSync(
        join(bundle, "wiki", "Beta.md"),
        [
          "---",
          "type: gadget",
          "title: Beta",
          "description: A probed page.",
          "tags: [probe]",
          "probe_id: B-1",
          "---",
          "",
          "# Beta",
          "",
          "A probed page.",
          "",
          "## Measures",
          "",
          "- size: large",
          "",
        ].join("\n"),
      );
      const found = findings(runAny(bundle, ["lint", "--all"]).envelope);
      assert.equal(
        found.some((f) => f.ruleId === "@wikiwright-fixture/probe/not-allowed"),
        true,
        "`large` is a registered size that this section does not admit",
      );

      // And the other direction: quieting the module's check is a LOAD error.
      const constitution = join(bundle, "config", "constitution.json");
      const parsed = JSON.parse(readFileSync(constitution, "utf8")) as {
        types: Record<string, { checks?: { severity?: string }[] }>;
      };
      const gadget = parsed.types["gadget"];
      assert.notEqual(gadget?.checks?.[0], undefined);
      parsed.types["tighter"] = {
        extends: "gadget",
        description: "A subtype that tries to quiet an inherited check.",
        checks: [
          {
            use: "@wikiwright-fixture/probe/has-id",
            config: { prefix: "B-" },
            severity: "warning",
          },
        ],
      } as never;
      writeFileSync(constitution, JSON.stringify(parsed, null, 2));
      const refused = runAny(bundle, ["lint", "--all"]);
      assert.equal(refused.envelope.ok, false);
      const issues = (refused.envelope.data?.["issues"] ?? []) as { code: string }[];
      assert.equal(
        issues.some((i) => i.code === "check-relaxed"),
        true,
        JSON.stringify(refused.envelope),
      );
    } finally {
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("both bundles are green on their own corpora, and the verdicts are reproducible", () => {
    grant(BUNDLE_A);
    grant(BUNDLE_B);
    for (const root of [BUNDLE_A, BUNDLE_B]) {
      const first = runAny(root, ["lint", "--all"]);
      const second = runAny(root, ["lint", "--all"]);
      assert.equal(first.envelope.ok, true, `${root}: ${JSON.stringify(first.envelope)}`);
      assert.deepEqual(
        first.envelope.data?.["findings"],
        second.envelope.data?.["findings"],
        `${root}: the same bytes twice`,
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe("adopting another version reports its whole delta first (docs/extending.md §Adopting a new version)", () => {
  it("`modules plan` names every finding that appears and every one that goes", () => {
    grant(BUNDLE_A);
    // The candidate is a bundle with a DIFFERENT build of the same package
    // installed — nothing here reaches the network.
    const candidateBundle = copyOf(BUNDLE_A);
    const candidateEntry = join(
      candidateBundle,
      "node_modules",
      "@wikiwright-fixture",
      "probe",
      "index.js",
    );
    try {
      // The candidate's census arm stops firing. That is a whole-corpus delta a
      // reader must see before adopting, and it is exactly what a silent module
      // upgrade would hide.
      writeFileSync(
        candidateEntry,
        readFileSync(candidateEntry, "utf8").replace(
          '              "a measure was recorded",',
          '              "a measure was recorded (v2)",',
        ),
      );
      runAny(candidateBundle, ["trust", "grant", "module:@wikiwright-fixture/probe"]);
      const planned = runAny(BUNDLE_A, [
        "modules",
        "plan",
        "--package",
        "@wikiwright-fixture/probe",
        "--candidate",
        candidateBundle,
      ]);
      assert.equal(planned.envelope.ok, true, JSON.stringify(planned.envelope));
      const delta = planned.envelope.data?.["delta"] as {
        added: string[];
        removed: string[];
      };
      // The message changed, not the finding's identity, so the delta is empty —
      // and the plan says so rather than reporting a change it cannot see.
      assert.deepEqual(delta.added, []);
      assert.deepEqual(delta.removed, []);
      assert.equal(
        planned.envelope.data?.["adopt"],
        "the candidate changes no finding on this corpus",
      );
    } finally {
      rmSync(candidateBundle, { recursive: true, force: true });
    }
  });

  it("…and a candidate that changes a verdict reports the finding, not a count", () => {
    grant(BUNDLE_A);
    const candidateBundle = copyOf(BUNDLE_A);
    const candidateEntry = join(
      candidateBundle,
      "node_modules",
      "@wikiwright-fixture",
      "probe",
      "index.js",
    );
    try {
      // A candidate whose census arm no longer fires: two findings disappear.
      writeFileSync(
        candidateEntry,
        readFileSync(candidateEntry, "utf8").replace(
          '            const probe = asProbe(item);\n            if (probe === undefined) return;\n            ctx.emit(\n              "@wikiwright-fixture/probe/measured",',
          '            const probe = asProbe(item);\n            if (probe !== undefined) return;\n            ctx.emit(\n              "@wikiwright-fixture/probe/measured",',
        ),
      );
      const granted = runAny(candidateBundle, [
        "trust",
        "grant",
        "module:@wikiwright-fixture/probe",
      ]);
      const planned = runAny(BUNDLE_A, [
        "modules",
        "plan",
        "--package",
        "@wikiwright-fixture/probe",
        "--candidate",
        candidateBundle,
      ]);
      // The candidate's own fixture pins the arm's behaviour, so a candidate
      // that changes it fails its fixture at the grant — which is the stricter,
      // and correct, answer: it never becomes a candidate at all.
      if (granted.envelope.ok) {
        assert.equal(planned.envelope.ok, true, JSON.stringify(planned.envelope));
        const delta = planned.envelope.data?.["delta"] as { removed: string[] };
        assert.equal(delta.removed.length > 0, true, JSON.stringify(planned.envelope));
      } else {
        assert.equal(
          granted.envelope.error?.["code"],
          "module-fixture-failed",
          JSON.stringify(granted.envelope),
        );
        assert.equal(
          planned.envelope.error?.["code"],
          "candidate-unresolved",
          JSON.stringify(planned.envelope),
        );
      }
    } finally {
      rmSync(candidateBundle, { recursive: true, force: true });
    }
  });
});

// docs/architecture.md §How a verdict is produced (one loaded law reaches every judge) · docs/extending.md §What a module registers: the shell composes
// modules and hands one registry to the kernel; it does not reconstruct the
// standard library at each consumer. The cases above prove it through the
// binary with a real package; this one holds the in-process seam by identity.
describe("the shell composes one module registry (docs/extending.md §What a module registers)", () => {
  it("judges with the registry carried by the loaded vault", () => {
    const vault = loadVault("lint", join(REPO, "fixtures", "minimal-vault"));
    assert.equal(vault.ok, true);
    if (!vault.ok) throw new Error("unreachable");

    // A fixture grammar parses nothing: it declares no kind and declines every item.
    const declarative = { kinds: [] as readonly string[], parse: () => undefined };
    const loaded = loadModules([
      {
        id: "acme/test",
        grammars: { "acme/test/items": { ...declarative, params: {}, arms: [] } },
      },
    ]);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) throw new Error("unreachable");

    const carried = { ...vault, modules: loaded.registry };
    assert.equal(lawFor(carried).modules, loaded.registry);
  });
});

// docs/concepts.md §Findings and routing: `fix` routes by the COMPOSED table — the kernel's rows plus
// one per registered arm and check — the same table the judge routes by, so a
// module arm's row is found by the verb exactly as the kernel's are. Stated
// residue: no module arm can carry a fixer today, because `fixerRegistered`
// admits only a kernel fixer whose closed rule list names the arm's id; what
// this proves is that the verb reads the composed rows, which is the seam.
describe("fix reads the composed rows the judge routes by (docs/concepts.md §Findings and routing)", () => {
  it("a kit arm's id is a rule of this vault; an id no row carries is refused by name", () => {
    grant(BUNDLE_A);
    const known = runAny(BUNDLE_A, [
      "fix",
      "--rule",
      "@wikiwright-fixture/probe/unknown-size",
      "--expect",
      "any",
      "--dry-run",
    ]);
    assert.equal(known.status, 0, JSON.stringify(known.envelope));
    const unknown = runAny(BUNDLE_A, [
      "fix",
      "--rule",
      "no-such-rule",
      "--expect",
      "any",
      "--dry-run",
    ]);
    assert.equal(unknown.status, 2, JSON.stringify(unknown.envelope));
    assert.equal(unknown.envelope.error?.["code"], "unknown-rule");
    const details = unknown.envelope.error?.["details"] as { valid_values: string[] } | undefined;
    const valid = details?.valid_values ?? [];
    assert.equal(valid.includes("@wikiwright-fixture/probe/unknown-size"), true);
    assert.equal(valid.includes("section-depth"), true, "the kernel's rows are in the same table");
  });
});
