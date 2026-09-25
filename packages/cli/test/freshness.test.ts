// docs/cli.md §freshness, docs/constitution.md §Shapes: a pin is measured
// against the local repository — origin "." is the repository enclosing the
// vault — and a pin naming any other origin is reported unmeasured, with no
// contact: remote freshness was removed. Hermetic: nothing here needs the network.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLI_RUNTIME } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));

interface Run {
  status: number;
  data: Record<string, unknown>;
  error: Record<string, unknown>;
}

function run(cwd: string, args: string[]): Run {
  const r = spawnSync(CLI_RUNTIME, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  const envelope = JSON.parse(r.stdout) as { data?: Record<string, unknown>; error?: unknown };
  return {
    status: r.status ?? -1,
    data: envelope.data ?? {},
    error: (envelope.error ?? {}) as Record<string, unknown>,
  };
}

const findings = (r: Run): Array<Record<string, unknown>> =>
  (r.data["findings"] ?? []) as Array<Record<string, unknown>>;
const ids = (r: Run): string[] => findings(r).map((f) => String(f["ruleId"]));
const entries = (r: Run): Array<Record<string, unknown>> =>
  (r.data["entries"] ?? []) as Array<Record<string, unknown>>;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const CONSTITUTION = {
  schema: "wikiwright/constitution",
  schema_version: 3,
  vocabularies: { tags: { mode: "registered", entries: {} } },
  types: {
    source: {
      extends: "reference",
      description: "A captured source: origin, pinned commit, the paths it covers.",
      fields: {
        locator: { kind: "string", required: true },
        commit: { kind: "pin", origin: "locator", covers: "covers", required: true },
        covers: { kind: "list", item: { kind: "string" } },
      },
    },
    note: { extends: "concept", description: "A note." },
  },
};

function source(name: string, locator: string, commit: string, covers: readonly string[]): string {
  return `---\ntype: source\ntitle: ${name}\ndescription: A capture.\ntags: []\nlocator: ${JSON.stringify(locator)}\ncommit: ${commit}\ncovers: ${JSON.stringify(covers)}\n---\n\n# ${name}\n\nCaptured.\n`;
}

/** A vault with one source page per origin, and a note that cites the first. */
function vault(
  sources: Array<{ name: string; locator: string; commit: string; covers: string[] }>,
) {
  const tmp = mkdtempSync(join(tmpdir(), "ww-fresh-"));
  write(tmp, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
  write(
    tmp,
    "config/engine.json",
    `${JSON.stringify({ content_roots: ["wiki", "raw"], source_roots: ["raw"] })}\n`,
  );
  for (const s of sources)
    write(tmp, `raw/${s.name}.md`, source(s.name, s.locator, s.commit, s.covers));
  const first = sources[0]?.name ?? "none";
  write(
    tmp,
    "wiki/Notes.md",
    `---\ntype: note\ntitle: Notes\ndescription: Notes on the thing.\ntags: []\n---\n\n# Notes\n\nSee [[${first}]].\n`,
  );
  return tmp;
}

/** A repository holding `src/thing.ts` and `src/other.ts`, the vault at its root, pinned to ".". */
function selfPinned(): { tmp: string; pin: string } {
  const tmp = vault([{ name: "Thing", locator: ".", commit: "0".repeat(40), covers: [] }]);
  git(tmp, ["init", "-q"]);
  git(tmp, ["config", "user.email", "t@e.com"]);
  git(tmp, ["config", "user.name", "T"]);
  write(tmp, "src/thing.ts", "1\n");
  write(tmp, "src/other.ts", "1\n");
  git(tmp, ["add", "-A"]);
  git(tmp, ["commit", "-qm", "origin state"]);
  const pin = git(tmp, ["rev-parse", "HEAD"]);
  write(tmp, "raw/Thing.md", source("Thing", ".", pin, ["src/thing.ts"]));
  git(tmp, ["add", "-A"]);
  git(tmp, ["commit", "-qm", "the capture"]);
  return { tmp, pin };
}

function commitFile(tmp: string, file: string, text: string, message: string): string {
  write(tmp, file, text);
  git(tmp, ["add", "-A"]);
  git(tmp, ["commit", "-qm", message]);
  return git(tmp, ["rev-parse", "HEAD"]);
}

describe("a remote origin is not measured (docs/roadmap.md: remote freshness was removed)", () => {
  it("a pin naming a URL is unmeasured, with the reason, no finding and no contact", () => {
    // The URL names nothing that exists: were it contacted, the run would
    // have reported it unreachable.
    const url = pathToFileURL(join(tmpdir(), "ww-no-such-origin.git")).href;
    const tmp = vault([{ name: "Gone", locator: url, commit: "a".repeat(40), covers: [] }]);
    try {
      const r = run(tmp, ["freshness"]);
      assert.equal(r.status, 0, JSON.stringify(r));
      assert.deepEqual(r.data["origins"], [{ origin: url, reachable: false, head: null }]);
      assert.equal(entries(r)[0]?.["state"], "unmeasured");
      assert.match(String(entries(r)[0]?.["reason"]), /^remote-origin: /u);
      assert.deepEqual(r.data["pins"], {
        current: 0,
        unchanged: 0,
        stale: 0,
        unknown: 0,
        unmeasured: 1,
      });
      assert.deepEqual(findings(r), []);
      assert.equal(existsSync(join(tmp, ".wikiwright")), false, "no cache is kept");
      assert.equal(existsSync(join(tmp, "generated", "freshness.json")), true);
      assert.equal("depth" in r.data, false, "there is one depth, and no field names it");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--fetch is not a flag any more", () => {
    const tmp = vault([{ name: "Self", locator: ".", commit: "b".repeat(40), covers: [] }]);
    try {
      const r = run(tmp, ["freshness", "--fetch"]);
      assert.equal(r.status, 2, JSON.stringify(r));
      assert.equal(r.error["code"], "unknown-flag");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the local repository answers distance, the covering diff and the history (docs/constitution.md §Shapes)", () => {
  it("an empty covering diff is unchanged; a touched one is stale, one hop into citing pages", () => {
    const { tmp, pin } = selfPinned();
    try {
      const clean = run(tmp, ["freshness"]);
      assert.equal(clean.status, 0, JSON.stringify(clean));
      const entry = entries(clean)[0];
      assert.equal(entry?.["state"], "unchanged", "the read holds: the word says so");
      assert.equal(entry?.["known"], true);
      assert.equal(entry?.["behind"], 1);
      assert.equal(entry?.["stale"], false);
      assert.deepEqual(entry?.["covering_touched"], []);
      assert.equal(entry?.["measured_against"], "origin");
      assert.deepEqual(findings(clean), []);

      const head = commitFile(tmp, "src/thing.ts", "2\n", "the capture moved");
      const stale = run(tmp, ["freshness"]);
      assert.equal(stale.status, 0, "warnings never gate");
      const capture = findings(stale).find((f) => f["ruleId"] === "stale-capture");
      assert.equal(capture?.["path"], "raw/Thing.md");
      assert.equal(capture?.["severity"], "warning");
      assert.equal(
        capture?.["queue"],
        "source-review",
        "no fixer: a stale pin never fast-forwards",
      );
      assert.match(String(capture?.["message"]), /src\/thing\.ts/);
      const hop = findings(stale).find((f) => f["ruleId"] === "stale-source-cited");
      assert.equal(hop?.["path"], "wiki/Notes.md", "propagated over the graph's cites edge");
      assert.equal(entries(stale)[0]?.["state"], "stale");
      assert.equal(entries(stale)[0]?.["behind"], 2);
      assert.equal((stale.data["origins"] as Array<{ head: string }>)[0]?.head, head);
      assert.notEqual(head, pin);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a pin off the head's history is pin-unknown-to-origin", () => {
    const { tmp } = selfPinned();
    try {
      write(tmp, "raw/Thing.md", source("Thing", ".", "e".repeat(40), ["src/thing.ts"]));
      const r = run(tmp, ["freshness"]);
      assert.equal(r.status, 0, JSON.stringify(r));
      assert.deepEqual(
        findings(r).map((x) => [x["ruleId"], x["severity"]]),
        [["pin-unknown-to-origin", "warning"]],
      );
      assert.equal(entries(r)[0]?.["known"], false);
      assert.equal(
        entries(r)[0]?.["state"],
        "unknown",
        "neither current nor behind: off the history",
      );
      assert.equal(entries(r)[0]?.["behind"], null, "distance is meaningless off the history");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--fast-forward advances a clean pin through the Writer and leaves a stale one alone", () => {
    const { tmp, pin } = selfPinned();
    try {
      const head = git(tmp, ["rev-parse", "HEAD"]);
      const planned = run(tmp, ["freshness", "--fast-forward", "--dry-run"]);
      assert.equal(planned.status, 0, JSON.stringify(planned));
      const ops = (planned.data["ops"] as Array<{ kind: string; path: string }>).map(
        (o) => `${o.kind} ${o.path}`,
      );
      assert.deepEqual(ops, ["write generated/freshness.json", "write raw/Thing.md"]);
      assert.equal(existsSync(join(tmp, "generated", "freshness.json")), false, "wrote nothing");

      const before = readFileSync(join(tmp, "raw", "Thing.md"), "utf8");
      const ff = run(tmp, ["freshness", "--fast-forward"]);
      assert.equal(ff.status, 0, JSON.stringify(ff));
      assert.deepEqual(ff.data["advanced"], [
        { path: "raw/Thing.md", field: "commit", from: pin, to: head },
      ]);
      const after = readFileSync(join(tmp, "raw", "Thing.md"), "utf8");
      assert.equal(after, before.replace(`commit: ${pin}`, `commit: ${head}`), "one line moved");
      assert.deepEqual(
        entries(ff).map((e) => e["state"]),
        ["current"],
        "the report reflects the post-advance state",
      );

      // A stale pin never advances.
      commitFile(tmp, "src/thing.ts", "2\n", "the capture moved");
      const stale = run(tmp, ["freshness", "--fast-forward"]);
      assert.equal(stale.status, 0);
      assert.deepEqual(stale.data["advanced"], []);
      assert.equal(ids(stale).includes("stale-capture"), true);
      assert.equal(readFileSync(join(tmp, "raw", "Thing.md"), "utf8"), after);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('origin "." is the repository enclosing the vault', () => {
  it("a vault at the repository root measures against it with repo-root-relative covers", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-fresh-self-"));
    try {
      git(tmp, ["init", "-q"]);
      git(tmp, ["config", "user.email", "t@e.com"]);
      git(tmp, ["config", "user.name", "T"]);
      write(tmp, "src/thing.ts", "1\n");
      git(tmp, ["add", "-A"]);
      git(tmp, ["commit", "-qm", "origin state"]);
      const pin = git(tmp, ["rev-parse", "HEAD"]);
      write(tmp, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
      write(tmp, "config/engine.json", `${JSON.stringify({ content_roots: ["raw"] })}\n`);
      write(tmp, "raw/Thing.md", source("Thing", ".", pin, ["src/thing.ts"]));
      git(tmp, ["add", "-A"]);
      git(tmp, ["commit", "-qm", "vault pages"]);
      const behind = run(tmp, ["freshness"]);
      assert.equal(behind.status, 0, JSON.stringify(behind));
      assert.equal(entries(behind)[0]?.["behind"], 1, "the local objects answer the distance");
      assert.equal(entries(behind)[0]?.["stale"], false);
      assert.equal(entries(behind)[0]?.["state"], "unchanged");
      write(tmp, "src/thing.ts", "2\n");
      git(tmp, ["add", "-A"]);
      git(tmp, ["commit", "-qm", "moved"]);
      assert.equal(ids(run(tmp, ["freshness"])).includes("stale-capture"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a vault in a directory of the repository it documents measures against the enclosing work tree", () => {
    // The code-wiki layout: `devwiki/` inside the engine's own repository, a
    // page pinned to the commit it read `packages/core/src/judge/` at.
    const repo = mkdtempSync(join(tmpdir(), "ww-fresh-embedded-"));
    try {
      git(repo, ["init", "-q"]);
      git(repo, ["config", "user.email", "t@e.com"]);
      git(repo, ["config", "user.name", "T"]);
      write(repo, "packages/core/src/judge/index.ts", "export const judge = 1;\n");
      write(repo, "packages/cli/src/main.ts", "1\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-qm", "the code"]);
      const pin = git(repo, ["rev-parse", "HEAD"]);
      const vaultRoot = join(repo, "devwiki");
      write(vaultRoot, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
      write(vaultRoot, "config/engine.json", `${JSON.stringify({ content_roots: ["raw"] })}\n`);
      write(vaultRoot, "raw/Judge.md", source("Judge", ".", pin, ["packages/core/src/judge/"]));
      // The page is not committed: at its pin, the head IS the pin.
      const current = run(vaultRoot, ["freshness"]);
      assert.equal(current.status, 0, JSON.stringify(current));
      assert.deepEqual(current.data["origins"], [{ origin: ".", reachable: true, head: pin }]);
      assert.equal(entries(current)[0]?.["state"], "current");
      assert.equal(entries(current)[0]?.["behind"], 0);
      assert.equal(entries(current)[0]?.["stale"], false);
      assert.deepEqual(findings(current), []);
      // A commit outside the covered path: the read holds — unchanged.
      write(repo, "packages/cli/src/main.ts", "2\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-qm", "elsewhere"]);
      const elsewhere = run(vaultRoot, ["freshness"]);
      assert.equal(entries(elsewhere)[0]?.["state"], "unchanged");
      assert.equal(entries(elsewhere)[0]?.["behind"], 1);
      assert.equal(entries(elsewhere)[0]?.["stale"], false);
      assert.deepEqual(entries(elsewhere)[0]?.["covering_touched"], []);
      // A commit touching the covered path: the covering diff names the file,
      // repository-root-relative, and the page is stale.
      write(repo, "packages/core/src/judge/index.ts", "export const judge = 2;\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-qm", "the judge moved"]);
      const moved = run(vaultRoot, ["freshness"]);
      assert.equal(entries(moved)[0]?.["state"], "stale");
      assert.equal(entries(moved)[0]?.["behind"], 2);
      assert.equal(entries(moved)[0]?.["stale"], true);
      assert.deepEqual(entries(moved)[0]?.["covering_touched"], [
        "packages/core/src/judge/index.ts",
      ]);
      assert.deepEqual(ids(moved), ["stale-capture"]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("a root file, a covered file's name and a bare line are citations; what names no path is reported", () => {
    const repo = mkdtempSync(join(tmpdir(), "ww-fresh-forms-"));
    try {
      git(repo, ["init", "-q"]);
      git(repo, ["config", "user.email", "t@e.com"]);
      git(repo, ["config", "user.name", "T"]);
      write(repo, "LICENSE", "one\n");
      write(repo, "packages/core/src/judge/index.ts", "one\ntwo\nthree\n");
      write(repo, "packages/a/dup.ts", "a\n");
      write(repo, "packages/b/dup.ts", "b\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-qm", "the code"]);
      const pin = git(repo, ["rev-parse", "HEAD"]);
      const vaultRoot = join(repo, "devwiki");
      write(vaultRoot, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
      write(vaultRoot, "config/engine.json", `${JSON.stringify({ content_roots: ["raw"] })}\n`);
      const page = (title: string, covers: string[], body: string[]): string =>
        [
          "---",
          "type: source",
          `title: ${title}`,
          "description: A capture that cites.",
          "tags: []",
          'locator: "."',
          `commit: ${pin}`,
          `covers: ${JSON.stringify(covers)}`,
          "---",
          "",
          `# ${title}`,
          "",
          ...body,
          "",
        ].join("\n");
      write(
        vaultRoot,
        "raw/Forms.md",
        page(
          "Forms",
          [
            "packages/core/src/judge/index.ts",
            "packages/a/dup.ts",
            "packages/b/dup.ts",
            "packages/core/src/judge/",
          ],
          [
            "A root file: `LICENSE:1`. A covered file by name: `index.ts:2`.",
            "A line alone names the path cited before it: `:3`, and a range `:1-3`.",
            "A directory is a citation and holds no line, so after",
            "`packages/core/src/judge/` a bare `:1` still means the file.",
            "A covered directory's bare name is prose: `judge` is not a path, and",
            "neither is a name with no suffix.",
            "Two covered paths share a name, so `dup.ts:1` names neither.",
            "Neither `index.ts:0` nor `index.ts:3-1` is a range that counts up.",
          ],
        ),
      );
      write(
        vaultRoot,
        "raw/Alone.md",
        page("Alone", ["packages/core/src/judge/index.ts"], ["`:5` is cited before any path."]),
      );
      const r = run(vaultRoot, ["freshness"]);
      assert.equal(r.status, 0, JSON.stringify(r));
      const rows = entries(r) as {
        path: string;
        citations: { checked: number; unresolved: unknown[] };
      }[];
      const forms = rows.find((e) => e.path.endsWith("Forms.md"));
      assert.deepEqual(forms?.citations, {
        checked: 5,
        unresolved: [
          { path: "dup.ts:1", line: null, reason: "ambiguous" },
          { path: "index.ts:0", line: null, reason: "malformed" },
          { path: "index.ts:3-1", line: null, reason: "malformed" },
        ],
      });
      const alone = rows.find((e) => e.path.endsWith("Alone.md"));
      assert.deepEqual(alone?.citations, {
        checked: 0,
        unresolved: [{ path: ":5", line: null, reason: "unattached" }],
      });
      const messages = findings(r)
        .filter((f) => f["ruleId"] === "citation-unresolved")
        .map((f) => String(f["message"]));
      assert.equal(messages.length, 4, JSON.stringify(messages));
      assert.ok(
        messages.some((m) => m.includes("names no file")),
        JSON.stringify(messages),
      );
      assert.ok(
        messages.some((m) => m.includes("more than one covered path")),
        JSON.stringify(messages),
      );
      assert.ok(
        messages.some((m) => m.includes("counts up")),
        JSON.stringify(messages),
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("a page's repository-path citations are held to the pin: a missing file and a line past the end are each named once", () => {
    // The covering diff cannot see a citation to a path that never
    // existed at the pin; the objects can.
    const repo = mkdtempSync(join(tmpdir(), "ww-fresh-cite-"));
    try {
      git(repo, ["init", "-q"]);
      git(repo, ["config", "user.email", "t@e.com"]);
      git(repo, ["config", "user.name", "T"]);
      write(repo, "packages/core/src/judge/index.ts", "one\ntwo\nthree\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-qm", "the code"]);
      const pin = git(repo, ["rev-parse", "HEAD"]);
      const vaultRoot = join(repo, "devwiki");
      write(vaultRoot, "config/constitution.json", `${JSON.stringify(CONSTITUTION, null, 2)}\n`);
      write(vaultRoot, "config/engine.json", `${JSON.stringify({ content_roots: ["raw"] })}\n`);
      write(
        vaultRoot,
        "raw/Judge.md",
        [
          "---",
          "type: source",
          "title: Judge",
          "description: A capture that cites.",
          "tags: []",
          'locator: "."',
          `commit: ${pin}`,
          'covers: ["packages/core/src/judge/"]',
          "---",
          "",
          "# Judge",
          "",
          "Read `packages/core/src/judge/index.ts:2` and `packages/core/src/judge/index.ts:1-3`;",
          "`packages/core/src/judge/index.ts:9` is past the end and",
          "`packages/core/src/judge/missing.ts` never existed — cited twice:",
          "`packages/core/src/judge/missing.ts`. The directory `packages/core/src/judge/` is real.",
          "Not paths: `wiki/Notes.md` (no such top-level entry), `https://example.invalid/a/b`,",
          "`packages/*/src`, `{a}/b`, `<dir>/x`, `$HOME/x`, `a b/c` and `README`.",
          "A span that wraps over a line break, like `this",
          "one`, leaves the spans after it paired: `packages/core/src/judge/absent.ts` is cited.",
          "",
          "```sh",
          "cat packages/core/src/judge/index.ts",
          "```",
          "",
          "After a fence, `packages/core/src/judge/index.ts:1` is still read.",
          "",
        ].join("\n"),
      );
      const r = run(vaultRoot, ["freshness"]);
      assert.equal(r.status, 0, JSON.stringify(r));
      assert.equal(entries(r)[0]?.["state"], "current");
      assert.deepEqual(entries(r)[0]?.["citations"], {
        checked: 7,
        unresolved: [
          { path: "packages/core/src/judge/absent.ts", line: null, reason: "missing" },
          { path: "packages/core/src/judge/index.ts", line: 9, reason: "past-end" },
          { path: "packages/core/src/judge/missing.ts", line: null, reason: "missing" },
        ],
      });
      const cited = findings(r).filter((f) => f["ruleId"] === "citation-unresolved");
      assert.deepEqual(
        cited.map((f) => [f["path"], f["severity"], f["queue"]]),
        [
          ["raw/Judge.md", "warning", "source-review"],
          ["raw/Judge.md", "warning", "source-review"],
          ["raw/Judge.md", "warning", "source-review"],
        ],
        "each unresolved citation once, queued, never a gate",
      );
      assert.match(String(cited[0]?.["message"]), /absent\.ts`, which does not exist at pin/u);
      assert.match(String(cited[1]?.["message"]), /index\.ts:9`, past the end/u);
      assert.match(String(cited[2]?.["message"]), /missing\.ts`, which does not exist at pin/u);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('a vault that is not a repository cannot answer for ".", and a headless one has nothing to be fresh against', () => {
    const tmp = vault([{ name: "Self", locator: ".", commit: "b".repeat(40), covers: [] }]);
    try {
      const noRepo = run(tmp, ["freshness"]);
      assert.equal(noRepo.status, 0, JSON.stringify(noRepo));
      assert.deepEqual(ids(noRepo), ["origin-unreachable"]);
      git(tmp, ["init", "-q"]);
      const headless = run(tmp, ["freshness"]);
      assert.equal(headless.status, 0, JSON.stringify(headless));
      assert.deepEqual(findings(headless), [], "no commit yet is not a failure");
      assert.deepEqual(headless.data["origins"], [{ origin: ".", reachable: true, head: null }]);
      assert.equal(entries(headless)[0]?.["current"], null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the snapshot-internal half is every verb's (docs/constitution.md §Shapes)", () => {
  it("a well-formed external commit id is never malformed-pin; a short or absent-origin one is, and it is queued to source-review", () => {
    const tmp = vault([
      { name: "Ok", locator: "https://example.invalid/x.git", commit: "c".repeat(40), covers: [] },
    ]);
    try {
      const fine = run(tmp, ["lint"]);
      assert.equal(fine.status, 0, JSON.stringify(fine));
      const coverage = (
        fine.data["coverage"] as { passes: Record<string, Record<string, unknown>> }
      ).passes;
      assert.equal(
        coverage["malformed-pin"]?.["evaluated"],
        1,
        "judged on the page declaring a pin",
      );
      write(tmp, "raw/Short.md", source("Short", "https://example.invalid/y.git", "abc123", []));
      const short = run(tmp, ["lint", "--page", "raw/Short.md"]);
      assert.equal(short.status, 5);
      const f = findings(short).find((x) => x["ruleId"] === "malformed-pin");
      assert.equal(f?.["severity"], "error");
      assert.equal(f?.["queue"], "source-review");
      assert.match(String(f?.["message"]), /40 or 64 lowercase hex digits/);
      writeFileSync(
        join(tmp, "raw", "Short.md"),
        `---\ntype: source\ntitle: Short\ndescription: d.\ntags: []\ncommit: ${"d".repeat(40)}\n---\n\n# Short\n`,
      );
      const noOrigin = run(tmp, ["lint", "--page", "raw/Short.md"]);
      assert.equal(
        findings(noOrigin).some(
          (x) =>
            x["ruleId"] === "malformed-pin" &&
            /origin field "locator" is absent/.test(String(x["message"])),
        ),
        true,
        JSON.stringify(findings(noOrigin)),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("check contacts no origin: the origin rows read external-origin, present with or without .git", () => {
    const tmp = vault([
      { name: "Ok", locator: "https://example.invalid/x.git", commit: "c".repeat(40), covers: [] },
    ]);
    try {
      assert.equal(run(tmp, ["check", "--write"]).status, 0, "the artifacts land first");
      for (const withGit of [false, true]) {
        if (withGit) git(tmp, ["init", "-q"]);
        const check = run(tmp, ["check"]);
        assert.equal(check.status, 0, JSON.stringify(check));
        assert.deepEqual(
          findings(check).filter((f) => f["severity"] !== "info"),
          [],
          "a scratch vault carries no brief; nothing else fires",
        );
        const passes = (
          check.data["coverage"] as { passes: Record<string, Record<string, unknown>> }
        ).passes;
        for (const id of [
          "stale-capture",
          "stale-source-cited",
          "pin-unknown-to-origin",
          "origin-unreachable",
        ]) {
          assert.equal(passes[id]?.["reason"], "external-origin", `${id} with .git ${withGit}`);
          assert.equal(passes[id]?.["evaluated"], 0, id);
        }
        assert.equal(passes["freshness-unavailable"]?.["reason"], "capability-unavailable");
        assert.equal(existsSync(join(tmp, "generated", "freshness.json")), false);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
