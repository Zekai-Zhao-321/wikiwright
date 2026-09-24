// docs/cli.md §bundles: this machine's registry is read, changed and written as
// ONE operation under a lock beside it. Two connections made at the same moment
// each keep the other's record; a lock no live process holds is broken rather
// than waited out, and a lock a live process holds is never taken.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Connection, readConnections, updateConnections } from "../src/connections.ts";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const MINIMAL = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));
const SCRATCH = realpathSync(mkdtempSync(join(tmpdir(), "ww-store-lock-")));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

let serial = 0;
const fresh = (name: string): string => join(SCRATCH, `${name}-${++serial}`);

function registryFile(): string {
  const file = join(fresh("registry"), "bundles.json");
  mkdirSync(join(file, ".."), { recursive: true });
  return file;
}

/** The in-process API reads the registry path from the environment, as the verb does. */
function withRegistry<T>(file: string, run: () => T): T {
  const before = process.env["WIKIWRIGHT_BUNDLES_FILE"];
  process.env["WIKIWRIGHT_BUNDLES_FILE"] = file;
  try {
    return run();
  } finally {
    if (before === undefined) delete process.env["WIKIWRIGHT_BUNDLES_FILE"];
    else process.env["WIKIWRIGHT_BUNDLES_FILE"] = before;
  }
}

/** A connection to a root under the scratch directory; the root need not exist to be recorded. */
const connectionOf = (name: string): Connection => ({
  name,
  root: join(SCRATCH, "roots", name),
  kind: "maintained",
  feedback: null,
  guide: null,
});

const add = (name: string) => (store: ReturnType<typeof readConnections>) => ({
  store: { ...store, bundles: [...store.bundles, connectionOf(name)] },
  result: undefined,
});

const namesIn = (file: string): string[] =>
  (JSON.parse(readFileSync(file, "utf8")) as { bundles: { name: string }[] }).bundles
    .map((b) => b.name)
    .sort();

describe("a registry update reads what is there, not what was there", () => {
  it("keeps a connection that landed after an earlier read", () => {
    const file = registryFile();
    withRegistry(file, () => {
      // The snapshot a caller read before doing its slow work.
      const early = readConnections();
      assert.deepEqual(early.bundles, []);
      // Another process connects a bundle in the meantime.
      writeFileSync(
        file,
        `${JSON.stringify({
          schema: "wikiwright/bundles",
          schema_version: 1,
          bundles: [connectionOf("allotment")],
        })}\n`,
      );
      updateConnections(add("orchard"));
      assert.deepEqual(namesIn(file), ["allotment", "orchard"]);
    });
  });

  it("writes nothing when the change asks for nothing", () => {
    const file = registryFile();
    withRegistry(file, () => {
      const answer = updateConnections(() => ({ result: "nothing to do" }));
      assert.equal(answer, "nothing to do");
      assert.equal(existsSync(file), false);
      assert.equal(existsSync(`${file}.lock`), false, "the lock outlived the update");
    });
  });

  it("breaks a lock whose process is gone from this machine", () => {
    const file = registryFile();
    withRegistry(file, () => {
      const lock = `${file}.lock`;
      // A process that has exited: its pid names nothing here any more.
      const gone = spawnSync(process.execPath, ["-e", ""]);
      writeFileSync(lock, `${JSON.stringify({ pid: gone.pid, host: hostname() })}\n`);
      updateConnections(add("orchard"));
      assert.deepEqual(namesIn(file), ["orchard"]);
      assert.equal(existsSync(lock), false);
    });
  });

  it("breaks a lock nobody ever claimed, once it is past the instant of writing it", () => {
    const file = registryFile();
    withRegistry(file, () => {
      const lock = `${file}.lock`;
      // The window between creating the lock file and naming its holder.
      writeFileSync(lock, "");
      const past = Date.now() / 1000 - 600;
      utimesSync(lock, past, past);
      updateConnections(add("orchard"));
      assert.deepEqual(namesIn(file), ["orchard"]);
    });
  });

  it("never takes a lock a running process holds, however old the lock is", () => {
    const file = registryFile();
    withRegistry(file, () => {
      const lock = `${file}.lock`;
      // This very process holds it, and the lock is an hour old: age is no
      // evidence, and breaking a live holder's lock is how two writers both
      // write.
      writeFileSync(lock, `${JSON.stringify({ pid: process.pid, host: hostname() })}\n`);
      const past = Date.now() / 1000 - 3600;
      utimesSync(lock, past, past);
      assert.throws(() => updateConnections(add("orchard"), { waitMs: 150 }), /is updating/u);
      assert.equal(existsSync(file), false, "the registry was written behind a live lock");
      assert.equal(existsSync(lock), true, "a live holder's lock was taken");
    });
  });

  it("reads a holder on another machine as one it cannot ask about", () => {
    const file = registryFile();
    withRegistry(file, () => {
      // A registry on a shared home directory: a pid from another host means
      // nothing here, and a pid that happens to exist here is not that holder.
      writeFileSync(
        `${file}.lock`,
        `${JSON.stringify({ pid: process.pid, host: `${hostname()}-elsewhere` })}\n`,
      );
      assert.throws(
        () => updateConnections(() => ({ result: undefined }), { waitMs: 150 }),
        /is updating/u,
      );
    });
  });

  it("waits for a lock another process holds, then writes", () => {
    const file = registryFile();
    withRegistry(file, () => {
      const lock = `${file}.lock`;
      writeFileSync(lock, "1\n");
      const releaser = spawn(
        process.execPath,
        [
          "-e",
          `setTimeout(() => require("node:fs").rmSync(${JSON.stringify(lock)}, { force: true }), 400)`,
        ],
        { stdio: "ignore" },
      );
      releaser.unref();
      const started = Date.now();
      updateConnections(add("orchard"));
      const waited = Date.now() - started;
      assert.deepEqual(namesIn(file), ["orchard"]);
      assert.ok(waited >= 300, `the update did not wait for the lock (${String(waited)} ms)`);
    });
  });

  it("four connections made at once all land", { timeout: 60_000 }, async () => {
    const file = registryFile();
    const roots = ["one", "two", "three", "four"].map((name) => {
      const root = fresh(`vault-${name}`);
      cpSync(MINIMAL, root, { recursive: true });
      return { name, root };
    });
    const codes = await Promise.all(
      roots.map(
        ({ name, root }) =>
          new Promise<number>((resolve) => {
            const child = spawn(CLI_RUNTIME, [CLI, "bundles", "add", root, "--name", name], {
              env: {
                ...process.env,
                WIKIWRIGHT_BUNDLES_FILE: file,
                WIKIWRIGHT_TODAY: "2026-09-11",
              },
              stdio: "ignore",
            });
            child.on("exit", (code) => resolve(code ?? -1));
          }),
      ),
    );
    assert.deepEqual(codes, [0, 0, 0, 0]);
    assert.deepEqual(namesIn(file), ["four", "one", "three", "two"]);
  });
});
