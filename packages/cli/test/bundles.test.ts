// docs/cli.md §bundles: a machine-local registry connects a vault by name, and
// `--bundle <name>` names the target of any verb in place of `--root`. Listing
// loads nothing and shows each connection's identity; the registry refuses a
// taken name and a root connected twice; an installed copy refuses every
// writing verb before it runs, dry runs included, and says where a change goes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";
import { MACHINE_LOCAL_WRITERS } from "../src/connections.ts";
import { PINNED_CLOCK } from "./fixtures/clock.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const HANDBOOKS = fileURLToPath(new URL("../../../fixtures/handbooks/", import.meta.url));
const CONFORMANCE = fileURLToPath(new URL("../../../fixtures/conformance/", import.meta.url));
const ORCHARD = join(HANDBOOKS, "orchard");
const ALLOTMENT = join(HANDBOOKS, "allotment");
const ORCHARD_FEEDBACK = "return the proposal to the caller";
const ALLOTMENT_FEEDBACK = "send a proposal to the allotment handbook's maintainers";

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; type?: string; message?: string; details?: Record<string, unknown> };
  metadata: { bundle?: Record<string, unknown> };
}

interface Row {
  name: string;
  root: string;
  realpath: string | null;
  present: boolean;
  kind: string;
  feedback: string | null;
  guide: string | null;
  content_roots: string[] | null;
  identity?: Record<string, unknown> | null;
}

let tmp = "";
before(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "ww-bundles-")));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A fresh registry under the test's temporary directory, and the env that points at it. */
function registry(name: string): { file: string; env: NodeJS.ProcessEnv } {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "bundles.json");
  return { file, env: { WIKIWRIGHT_BUNDLES_FILE: file } };
}

function run(
  cwd: string,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  input = "",
): { status: number; envelope: Envelope } {
  const r = spawnSync(CLI_RUNTIME, [CLI, ...argv], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...PINNED_CLOCK, ...env },
    input,
  });
  assert.equal(typeof r.stdout, "string", `the CLI printed no envelope: ${r.stderr}`);
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

/** Connect both handbooks the way a session would: orchard maintained, allotment installed. */
function connectBoth(env: NodeJS.ProcessEnv): void {
  const orchard = run(
    HANDBOOKS,
    [
      "bundles",
      "add",
      "orchard",
      "--name",
      "orchard",
      "--feedback",
      ORCHARD_FEEDBACK,
      "--guide",
      "wiki/start-here.md",
    ],
    env,
  );
  assert.equal(orchard.status, 0, JSON.stringify(orchard.envelope));
  const allotment = run(
    tmp,
    [
      "bundles",
      "add",
      ALLOTMENT,
      "--name",
      "allotment",
      "--kind",
      "installed",
      "--feedback",
      ALLOTMENT_FEEDBACK,
    ],
    env,
  );
  assert.equal(allotment.status, 0, JSON.stringify(allotment.envelope));
}

function rowsOf(envelope: Envelope): Row[] {
  return (envelope.data?.["bundles"] ?? []) as Row[];
}

/** sha256 over every file under `dir`, so a refused write is proved not to have landed. */
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { encoding: "utf8" }).sort()) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(`${path}\0`).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

describe("bundles connects a vault by name (docs/cli.md §bundles)", () => {
  it("add connects both handbooks; list shows them sorted, with their identity", () => {
    const { file, env } = registry("add");
    connectBoth(env);
    const listed = run(tmp, ["bundles", "list"], env);
    assert.equal(listed.status, 0, JSON.stringify(listed.envelope));
    assert.equal(listed.envelope.data?.["registry"], file);
    const rows = rowsOf(listed.envelope);
    assert.deepEqual(
      rows.map((r) => r.name),
      ["allotment", "orchard"],
    );
    const [allotment, orchard] = rows;
    assert.ok(allotment !== undefined && orchard !== undefined);
    assert.deepEqual(Object.keys(orchard), [
      "name",
      "root",
      "realpath",
      "present",
      "kind",
      "feedback",
      "guide",
      "content_roots",
      "identity",
    ]);
    // Given as a relative path, stored absolute; the real path beside it.
    assert.equal(orchard.root, ORCHARD);
    assert.equal(orchard.realpath, realpathSync(ORCHARD));
    assert.equal(orchard.present, true);
    assert.equal(orchard.kind, "maintained");
    assert.equal(orchard.feedback, ORCHARD_FEEDBACK);
    assert.equal(orchard.guide, "wiki/start-here.md");
    assert.equal(allotment.kind, "installed");
    assert.equal(allotment.guide, null);
    assert.deepEqual(orchard.content_roots, ["wiki"]);
    assert.deepEqual(Object.keys(orchard.identity ?? {}), [
      "label",
      "head",
      "dirty",
      "law",
      "content",
    ]);
    assert.equal(orchard.identity?.["label"], "orchard");
    assert.equal(allotment.identity?.["label"], "allotment");
    // The identity a listing shows is the one a verb over that root carries.
    const read = run(tmp, ["type", "list", "--root", ORCHARD], env).envelope.metadata.bundle;
    assert.equal(orchard.identity?.["law"], read?.["law"]);
    assert.equal(orchard.identity?.["content"], read?.["content"]);

    // `--records` is the same rows without the identity, for a caller that
    // only routes: nothing of a bundle's pages is read for it.
    const records = rowsOf(run(tmp, ["bundles", "list", "--records"], env).envelope);
    assert.deepEqual(
      records,
      rows.map(({ identity: _identity, ...record }) => record),
    );

    const stored = JSON.parse(readFileSync(file, "utf8")) as {
      schema: string;
      schema_version: number;
      bundles: Record<string, unknown>[];
    };
    assert.equal(stored.schema, "wikiwright/bundles");
    assert.equal(stored.schema_version, 1);
    assert.deepEqual(
      stored.bundles.map((b) => Object.keys(b)),
      [
        ["name", "root", "kind", "feedback", "guide"],
        ["name", "root", "kind", "feedback", "guide"],
      ],
    );
  });

  it("a name already taken and a root already connected are refused by name", () => {
    const { file, env } = registry("taken");
    connectBoth(env);
    const before = readFileSync(file, "utf8");
    const taken = run(tmp, ["bundles", "add", ALLOTMENT, "--name", "orchard"], env);
    assert.equal(taken.status, 4, JSON.stringify(taken.envelope));
    assert.equal(taken.envelope.error?.code, "bundle-name-taken");
    const twice = run(tmp, ["bundles", "add", ORCHARD, "--name", "orchard-two"], env);
    assert.equal(twice.status, 4, JSON.stringify(twice.envelope));
    assert.equal(twice.envelope.error?.code, "bundle-root-registered");
    assert.equal(twice.envelope.error?.details?.["name"], "orchard");
    if (process.platform !== "win32") {
      // The same directory under another spelling is the same root.
      const link = join(tmp, "taken", "orchard-link");
      symlinkSync(ORCHARD, link, "dir");
      const linked = run(tmp, ["bundles", "add", link, "--name", "orchard-three"], env);
      assert.equal(linked.envelope.error?.code, "bundle-root-registered");
    }
    assert.equal(readFileSync(file, "utf8"), before, "a refused add wrote the registry");
  });

  it("a bad name, a kind, a directory that is no vault and a missing guide are refused", () => {
    const { file, env } = registry("refusals");
    const cases: [string[], number, string][] = [
      [["bundles", "add", ORCHARD, "--name", "Orchard Handbook"], 2, "bundle-name-invalid"],
      [["bundles", "add", ORCHARD, "--name", "orchard", "--kind", "borrowed"], 2, "invalid-kind"],
      [["bundles", "add", tmp, "--name", "nothing"], 3, "vault-not-found"],
      [
        ["bundles", "add", ORCHARD, "--name", "orchard", "--guide", "wiki/no-such-page.md"],
        3,
        "guide-not-found",
      ],
      [
        [
          "bundles",
          "add",
          ORCHARD,
          "--name",
          "orchard",
          "--guide",
          "../allotment/wiki/start-here.md",
        ],
        3,
        "guide-not-found",
      ],
    ];
    for (const [argv, status, code] of cases) {
      const r = run(tmp, argv, env);
      assert.equal(r.status, status, JSON.stringify(r.envelope));
      assert.equal(r.envelope.error?.code, code);
    }
    assert.equal(existsSync(file), false, "a refused add created the registry");
  });

  it("a guide is a page the consumer can read: Markdown under a content root", () => {
    // A copy of the orchard handbook with a Markdown file outside its content
    // roots, and a second copy whose engine.json starts with a byte order mark:
    // the roots are read as the loader reads them.
    const copy = join(tmp, "guides", "orchard");
    cpSync(ORCHARD, copy, { recursive: true });
    mkdirSync(join(copy, "notes"), { recursive: true });
    cpSync(join(copy, "wiki", "start-here.md"), join(copy, "notes", "start-here.md"));
    const marked = join(tmp, "guides", "marked");
    cpSync(ORCHARD, marked, { recursive: true });
    const engine = join(marked, "config", "engine.json");
    writeFileSync(engine, `\ufeff${readFileSync(engine, "utf8")}`);
    mkdirSync(join(marked, "notes"), { recursive: true });
    cpSync(join(marked, "wiki", "start-here.md"), join(marked, "notes", "start-here.md"));

    const { file, env } = registry("guides");
    for (const [root, guide] of [
      [copy, "config/engine.json"],
      [copy, "notes/start-here.md"],
      [marked, "notes/start-here.md"],
    ] as const) {
      const r = run(tmp, ["bundles", "add", root, "--name", "guided", "--guide", guide], env);
      assert.equal(r.status, 2, `${guide}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "guide-not-a-page");
      assert.deepEqual(r.envelope.error?.details, { guide, content_roots: ["wiki"] });
    }
    assert.equal(existsSync(file), false, "a refused add created the registry");

    // A page under a content root is accepted, and the consumer reads it.
    for (const [root, name] of [
      [copy, "guided"],
      [marked, "marked"],
    ] as const) {
      const added = run(
        tmp,
        ["bundles", "add", root, "--name", name, "--guide", "wiki/start-here.md"],
        env,
      );
      assert.equal(added.status, 0, JSON.stringify(added.envelope));
      const read = run(tmp, ["read", "wiki/start-here.md", "--bundle", name], {
        ...env,
        WIKIWRIGHT_ROLE: "consumer",
      });
      assert.equal(read.status, 0, JSON.stringify(read.envelope));
    }
  });

  it("remove removes a connection, and a name that is not one lists the valid names", () => {
    const { env } = registry("remove");
    connectBoth(env);
    const removed = run(tmp, ["bundles", "remove", "orchard"], env);
    assert.equal(removed.status, 0, JSON.stringify(removed.envelope));
    assert.deepEqual(
      rowsOf(run(tmp, ["bundles", "list"], env).envelope).map((r) => r.name),
      ["allotment"],
    );
    const missing = run(tmp, ["bundles", "remove", "orchard"], env);
    assert.equal(missing.status, 3, JSON.stringify(missing.envelope));
    assert.equal(missing.envelope.error?.code, "bundle-not-found");
    assert.deepEqual(missing.envelope.error?.details?.["valid_values"], ["allotment"]);
  });

  it("add --dry-run writes nothing and plans the registry's absolute path", () => {
    const { file, env } = registry("dry-run");
    const dry = run(tmp, ["bundles", "add", ORCHARD, "--name", "orchard", "--dry-run"], env);
    assert.equal(dry.status, 0, JSON.stringify(dry.envelope));
    assert.equal(dry.envelope.data?.["wrote"], false);
    const ops = (dry.envelope.data?.["ops"] ?? []) as { kind: string; path: string }[];
    assert.deepEqual(
      ops.map((op) => [op.kind, op.path]),
      [["create", file]],
    );
    assert.equal(existsSync(file), false, "a dry run wrote the registry");
  });

  it("a connection whose root is gone lists as not present, with no identity", () => {
    const { env } = registry("gone");
    const copy = join(tmp, "gone", "orchard-copy");
    cpSync(ORCHARD, copy, { recursive: true });
    const added = run(tmp, ["bundles", "add", copy, "--name", "orchard"], env);
    assert.equal(added.status, 0, JSON.stringify(added.envelope));
    rmSync(copy, { recursive: true, force: true });
    const [row] = rowsOf(run(tmp, ["bundles", "list"], env).envelope);
    assert.equal(row?.present, false);
    assert.equal(row?.realpath, null);
    assert.equal(row?.identity, null);
  });

  it("a consumer session may list the connections and connect one", () => {
    const { env } = registry("consumer");
    const consumer = { ...env, WIKIWRIGHT_ROLE: "consumer" };
    const added = run(tmp, ["bundles", "add", ORCHARD, "--name", "orchard"], consumer);
    assert.equal(added.status, 0, JSON.stringify(added.envelope));
    const listed = run(tmp, ["bundles", "list"], consumer);
    assert.equal(listed.status, 0, JSON.stringify(listed.envelope));
    assert.equal(rowsOf(listed.envelope).length, 1);
  });
});

describe("--bundle names the target of any verb (docs/cli.md §bundles)", () => {
  let env: NodeJS.ProcessEnv = {};
  before(() => {
    env = registry("target").env;
    connectBoth(env);
  });

  it("resolves a verb against the connection's root, and the envelope says which", () => {
    const orchard = run(tmp, ["type", "list", "--bundle", "orchard"], env);
    assert.equal(orchard.status, 0, JSON.stringify(orchard.envelope));
    assert.equal(orchard.envelope.metadata.bundle?.["label"], "orchard");
    assert.equal(orchard.envelope.metadata.bundle?.["root"], realpathSync(ORCHARD));
    const allotment = run(tmp, ["type", "list", "--bundle", "allotment"], env);
    assert.equal(allotment.status, 0, JSON.stringify(allotment.envelope));
    assert.equal(allotment.envelope.metadata.bundle?.["label"], "allotment");
    assert.notEqual(
      allotment.envelope.metadata.bundle?.["law"],
      orchard.envelope.metadata.bundle?.["law"],
      "two handbooks, two laws",
    );
  });

  it("--bundle with --root is one target too many", () => {
    const r = run(tmp, ["type", "list", "--bundle", "orchard", "--root", ORCHARD], env);
    assert.equal(r.status, 2, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "one-target");
    assert.equal(r.envelope.metadata.bundle, undefined);
  });

  it("an unknown name is refused with the names that are connected", () => {
    const r = run(tmp, ["type", "list", "--bundle", "vineyard"], env);
    assert.equal(r.status, 3, JSON.stringify(r.envelope));
    assert.equal(r.envelope.error?.code, "bundle-not-found");
    assert.deepEqual(r.envelope.error?.details?.["valid_values"], ["allotment", "orchard"]);
  });

  it("an installed copy refuses every writing verb before it runs, dry runs included", () => {
    // The writes are attempted against a copy, connected as installed in its
    // own registry: if the guard ever let one through, it would land here and
    // not in the shipped fixture.
    const copy = join(tmp, "installed", "allotment");
    cpSync(ALLOTMENT, copy, { recursive: true });
    const own = registry("installed").env;
    const added = run(
      tmp,
      [
        "bundles",
        "add",
        copy,
        "--name",
        "allotment",
        "--kind",
        "installed",
        "--feedback",
        ALLOTMENT_FEEDBACK,
      ],
      own,
    );
    assert.equal(added.status, 0, JSON.stringify(added.envelope));
    const before = treeHash(copy);
    const draft = readFileSync(join(copy, "wiki", "pruning-roses.md"), "utf8");
    const writes: [string[], string][] = [
      [["new", "procedure-page", "Mulching", "--dest", "wiki/mulching.md"], ""],
      [["write", "wiki/pruning-roses.md"], `${draft}\nA line the draft adds.\n`],
      [["write", "wiki/pruning-roses.md", "--dry-run"], `${draft}\nA line the draft adds.\n`],
    ];
    for (const [argv, input] of writes) {
      const r = run(tmp, [...argv, "--bundle", "allotment"], own, input);
      assert.equal(r.status, 2, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "bundle-readonly");
      assert.equal(r.envelope.error?.details?.["kind"], "installed");
      assert.equal(r.envelope.error?.details?.["feedback"], ALLOTMENT_FEEDBACK);
    }
    assert.equal(treeHash(copy), before, "a refused write touched the installed copy");
    // Reading it is what an installed copy is for.
    const read = run(tmp, ["search", "pruning", "--bundle", "allotment"], own);
    assert.equal(read.status, 0, JSON.stringify(read.envelope));
    assert.equal(read.envelope.metadata.bundle?.["label"], "allotment");
  });
});

describe("the readonly guard refuses the verbs that write a vault (docs/cli.md §bundles)", () => {
  let env: NodeJS.ProcessEnv = {};
  before(() => {
    // A copy, connected as installed: if the guard ever let a verb through,
    // what it wrote would land here and not in the shipped fixture.
    const copy = join(tmp, "guard", "allotment");
    cpSync(ALLOTMENT, copy, { recursive: true });
    const r = registry("guard");
    env = { ...r.env, WIKIWRIGHT_TRUST_FILE: join(tmp, "guard", "trust.json") };
    const added = run(tmp, ["bundles", "add", copy, "--name", "copy", "--kind", "installed"], env);
    assert.equal(added.status, 0, JSON.stringify(added.envelope));
  });

  it("every writing verb but this machine's store writers is refused on an installed copy", () => {
    for (const spec of COMMANDS.filter((c) => c.writes)) {
      const lead = spec.subcommands === undefined ? [] : [spec.subcommands[0] ?? ""];
      const r = run(tmp, [spec.name, ...lead, "--bundle", "copy"], env);
      if (MACHINE_LOCAL_WRITERS.has(spec.name)) {
        assert.notEqual(r.envelope.error?.code, "bundle-readonly", spec.name);
      } else {
        assert.equal(
          r.envelope.error?.code,
          "bundle-readonly",
          `${spec.name}: ${JSON.stringify(r.envelope)}`,
        );
      }
    }
  });

  it("bundles and trust answer over an installed copy: their writes are this machine's", () => {
    for (const argv of [
      ["bundles", "list"],
      ["trust", "list"],
    ]) {
      const r = run(tmp, [...argv, "--bundle", "copy"], env);
      assert.equal(r.status, 0, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
    }
    const refused = run(tmp, ["new", "procedure-page", "Mulching", "--bundle", "copy"], env);
    assert.equal(refused.envelope.error?.code, "bundle-readonly");
  });
});

describe("a machine-local store that does not parse is a named refusal (docs/cli.md §Exit codes)", () => {
  it("a bundles registry of junk, or with a record of a bad kind, is bundles-registry-malformed", () => {
    const { file, env } = registry("malformed");
    writeFileSync(file, "this is not a registry\n");
    for (const argv of [
      ["bundles", "list"],
      ["type", "list", "--bundle", "orchard"],
    ]) {
      const r = run(tmp, argv, env);
      assert.equal(r.status, 4, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "bundles-registry-malformed");
      assert.equal(r.envelope.error?.details?.["file"], file);
    }
    writeFileSync(
      file,
      `${JSON.stringify({
        schema: "wikiwright/bundles",
        schema_version: 1,
        bundles: [
          { name: "orchard", root: ORCHARD, kind: "borrowed", feedback: null, guide: null },
        ],
      })}\n`,
    );
    const bad = run(tmp, ["bundles", "list"], env);
    assert.equal(bad.status, 4, JSON.stringify(bad.envelope));
    assert.equal(bad.envelope.error?.code, "bundles-registry-malformed");
    assert.equal(bad.envelope.error?.details?.["record"], 0);
    assert.match(String(bad.envelope.error?.message ?? ""), /bundle 0 has the kind "borrowed"/u);
  });

  it("a record whose root is relative is bundles-registry-malformed, from every directory", () => {
    // Two directories that each hold a `vault/`, distinguishable handbooks: a
    // relative root resolved against the working directory would read one or
    // the other under the same name. It is refused instead, from either one.
    const { file, env } = registry("relative-root");
    for (const [dir, handbook] of [
      ["alpha", ORCHARD],
      ["beta", ALLOTMENT],
    ] as const) {
      cpSync(handbook, join(tmp, "relative-root", dir, "vault"), { recursive: true });
    }
    writeFileSync(
      file,
      `${JSON.stringify({
        schema: "wikiwright/bundles",
        schema_version: 1,
        bundles: [
          { name: "handbook", root: "vault", kind: "installed", feedback: null, guide: null },
        ],
      })}\n`,
    );
    for (const dir of ["alpha", "beta"]) {
      const cwd = join(tmp, "relative-root", dir);
      for (const argv of [
        ["read", "wiki/start-here.md", "--bundle", "handbook"],
        ["bundles", "list"],
      ]) {
        const r = run(cwd, argv, env);
        assert.equal(r.status, 4, `${dir}: ${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
        assert.equal(r.envelope.error?.code, "bundles-registry-malformed");
        assert.equal(r.envelope.error?.details?.["file"], file);
        assert.equal(r.envelope.error?.details?.["record"], 0);
        assert.match(
          String(r.envelope.error?.message ?? ""),
          /bundle 0 has a root that is not an absolute path/u,
        );
        assert.equal(r.envelope.data, undefined);
      }
    }
  });

  it("two records with one name, or one real root, are bundles-registry-malformed", () => {
    // `add` refuses both under the lock; a registry restored by hand can hold
    // them, and `--bundle` would answer with whichever came first.
    const { file, env } = registry("duplicates");
    const copy = join(tmp, "duplicates", "orchard");
    cpSync(ORCHARD, copy, { recursive: true });
    const link = join(tmp, "duplicates", "orchard-link");
    symlinkSync(copy, link, "dir");
    const record = (name: string, root: string): Record<string, unknown> => ({
      name,
      root,
      kind: "maintained",
      feedback: null,
      guide: null,
    });
    for (const [bundles, message] of [
      [
        [record("orchard", copy), record("orchard", ALLOTMENT)],
        /bundle 1 has the name "orchard" of bundle 0/u,
      ],
      [[record("orchard", copy), record("pears", copy)], /bundle 1 has the root of bundle 0/u],
      [[record("orchard", copy), record("pears", link)], /bundle 1 has the root of bundle 0/u],
    ] as const) {
      writeFileSync(
        file,
        `${JSON.stringify({ schema: "wikiwright/bundles", schema_version: 1, bundles })}\n`,
      );
      for (const argv of [
        ["bundles", "list"],
        ["read", "wiki/start-here.md", "--bundle", "orchard"],
      ]) {
        const r = run(tmp, argv, env);
        assert.equal(r.status, 4, `${argv.join(" ")}: ${JSON.stringify(r.envelope)}`);
        assert.equal(r.envelope.error?.code, "bundles-registry-malformed");
        assert.equal(r.envelope.error?.details?.["record"], 1);
        assert.match(String(r.envelope.error?.message ?? ""), message);
      }
    }
  });

  it("a relative store override is made absolute: a plan names the file it would write", () => {
    const cwd = join(tmp, "relative-stores");
    mkdirSync(cwd, { recursive: true });
    const copy = join(cwd, "orchard");
    cpSync(ORCHARD, copy, { recursive: true });
    const env = {
      WIKIWRIGHT_BUNDLES_FILE: join("stores", "bundles.json"),
      WIKIWRIGHT_TRUST_FILE: join("stores", "trust.json"),
    };
    const planned = run(cwd, ["bundles", "add", copy, "--name", "orchard", "--dry-run"], env);
    assert.equal(planned.status, 0, JSON.stringify(planned.envelope));
    const ops = (planned.envelope.data?.["ops"] ?? []) as { path: string }[];
    assert.deepEqual(
      ops.map((op) => op.path),
      [join(cwd, "stores", "bundles.json")],
    );

    // The trust store too: a record read through the relative override, and
    // the revocation's plan, both name the absolute file.
    mkdirSync(join(cwd, "stores"), { recursive: true });
    writeFileSync(
      join(cwd, "stores", "trust.json"),
      `${JSON.stringify({
        schema: "wikiwright/trust",
        schema_version: 2,
        grants: [
          {
            vault: realpathSync(copy),
            path: "module:garden-guidance",
            sha256: "0".repeat(64),
            granted: "2026-09-04",
          },
        ],
      })}\n`,
    );
    const listed = run(cwd, ["trust", "list", "--all", "--root", copy], env);
    assert.equal(listed.status, 0, JSON.stringify(listed.envelope));
    assert.equal(listed.envelope.data?.["store"], join(cwd, "stores", "trust.json"));
    const records = (listed.envelope.data?.["records"] ?? []) as { record: string }[];
    const id = records[0]?.record;
    assert.ok(id !== undefined);
    const revoke = run(cwd, ["trust", "revoke", "--record", id, "--dry-run"], env);
    assert.equal(revoke.status, 0, JSON.stringify(revoke.envelope));
    assert.deepEqual(
      ((revoke.envelope.data?.["ops"] ?? []) as { path: string }[]).map((op) => op.path),
      [join(cwd, "stores", "trust.json")],
    );
  });

  it("a trust store of junk, or with a record of no shape, is trust-store-malformed", () => {
    const store = join(tmp, "malformed-trust", "trust.json");
    mkdirSync(join(tmp, "malformed-trust"), { recursive: true });
    const env = { WIKIWRIGHT_TRUST_FILE: store };
    writeFileSync(store, "{ not json\n");
    const junk = run(tmp, ["trust", "list", "--root", ORCHARD], env);
    assert.equal(junk.status, 4, JSON.stringify(junk.envelope));
    assert.equal(junk.envelope.error?.code, "trust-store-malformed");
    assert.equal(junk.envelope.error?.details?.["file"], store);
    writeFileSync(
      store,
      `${JSON.stringify({
        schema: "wikiwright/trust",
        schema_version: 2,
        grants: [{ path: "module:@example/kit", sha256: "0".repeat(64) }],
      })}\n`,
    );
    const bad = run(tmp, ["trust", "list", "--root", ORCHARD], env);
    assert.equal(bad.envelope.error?.code, "trust-store-malformed");
    assert.equal(bad.envelope.error?.details?.["record"], 0);

    // The module loader reads no store: a vault verb over a bundle whose module
    // is installed loads it and judges, whatever the store holds.
    const bundle = join(tmp, "malformed-trust", "bundle-a");
    for (const part of ["config", "wiki"]) {
      cpSync(join(CONFORMANCE, "bundle-a", part), join(bundle, part), { recursive: true });
    }
    cpSync(
      join(CONFORMANCE, "module-fixture"),
      join(bundle, "node_modules", "@wikiwright-fixture", "probe"),
      { recursive: true },
    );
    const loaded = run(tmp, ["type", "list", "--root", bundle], env);
    assert.equal(loaded.status, 0, JSON.stringify(loaded.envelope));
    assert.equal(loaded.envelope.metadata.bundle?.["label"], "bundle-a");
  });
});

describe("a verb that loads a vault names its target or refuses (docs/cli.md §bundles)", () => {
  it("from a directory that is no vault, with neither --root nor --bundle: registry-not-found", () => {
    const elsewhere = join(tmp, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    const { env } = registry("elsewhere");
    for (const argv of [["search", "pruning"], ["lint"], ["read", "pruning-roses"]]) {
      const r = run(elsewhere, argv, env);
      assert.equal(r.status, 3, `${argv[0]}: ${JSON.stringify(r.envelope)}`);
      assert.equal(r.envelope.error?.code, "registry-not-found");
    }
  });
});
