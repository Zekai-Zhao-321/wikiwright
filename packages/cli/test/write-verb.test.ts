// docs/cli.md §write · docs/concepts.md §The judge and its states · docs/concepts.md §Section grammar · docs/constitution.md §Shapes
// docs/cli.md §skills The verb the whole slice exists for: every envelope here is an
// instruction a weaker model follows literally, so each is asserted by shape
// rather than by "it did not crash".
// `write` stamps `updated` from `--date`, and from the shell's clock when the
// flag is absent. Tests in one `describe` share a vault, so a write stamped from
// the wall clock would leave today's date for the next case to trip over — the
// `--replace-core` case below asserts the splice moves no other byte, and once
// passed on one day and failed the next. The spawn helper therefore pins the
// clock through `WIKIWRIGHT_TODAY`, and the argvs pin `--date` where a case's
// dates carry meaning.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PINNED_CLOCK, TODAY } from "./fixtures/clock.ts";
import { grantKit, installKit, kitEnv } from "./fixtures/kit-code.ts";
import { layMemoryLaw } from "./fixtures/memory-law.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const SCRATCH = mkdtempSync(join(tmpdir(), "ww-write-test-"));

interface Run {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
  error: Record<string, unknown>;
}

function run(cwd: string, args: string[], stdin?: string, env?: NodeJS.ProcessEnv): Run {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    env: env ?? { ...process.env, ...PINNED_CLOCK },
    input: stdin ?? "",
  });
  const envelope = JSON.parse(r.stdout) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
  return {
    status: r.status ?? -1,
    ok: envelope.ok,
    data: envelope.data ?? {},
    error: envelope.error ?? {},
  };
}

const PERSON = [
  "---",
  "type: person",
  "tags: []",
  "---",
  "Chen Jing — a designer.",
  "",
  "## Facts",
  "- [identity] full name: Chen Jing (stated 2026-01-01)",
  "- [role] designer at a studio (stated 2026-01-02)",
  "- [preference] likes hotpot, one of several (stated 2026-01-03)",
  "",
  "## Relations",
  "- knows [[Charter]]",
  "",
  "## History",
  "",
].join("\n");

/** A vault under the memory law, in a git repository of its own. */
function vault(name: string): string {
  const dir = join(SCRATCH, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  layMemoryLaw(dir);
  writeFileSync(join(dir, "wiki", "Chen Jing.md"), PERSON);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "seed"], { cwd: dir });
  return dir;
}

function page(dir: string, rel = "wiki/Chen Jing.md"): string {
  return readFileSync(join(dir, rel), "utf8");
}

function handleOf(dir: string, category: string): string {
  const r = run(
    dir,
    ["write", "wiki/Chen Jing.md", "--dry-run", "--date", "2026-09-03"],
    page(dir),
  );
  const claims = r.data["claims"] as { id: string; category: string }[];
  const hit = claims.find((c) => c.category === category);
  assert.notEqual(hit, undefined, `no ${category} claim`);
  return hit?.id ?? "";
}

describe("docs/cli.md §write — the whole-page form", () => {
  let dir = "";
  before(() => {
    dir = vault("whole");
  });
  after(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it("with no --date the stamp is the shell's clock, which WIKIWRIGHT_TODAY pins", () => {
    const draft = PERSON.replace("Chen Jing — a designer.", "Ana Ruiz — a pilot.").replace(
      /Chen Jing/g,
      "Ana Ruiz",
    );
    const r = run(dir, ["write", "wiki/Ana Ruiz.md"], draft);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data["date"], TODAY, "the envelope reports the pinned date");
    const written = page(dir, "wiki/Ana Ruiz.md");
    assert.equal(written.includes(`created: ${TODAY}`), true);
    assert.equal(written.includes(`updated: ${TODAY}`), true);
    // A malformed pin is refused before anything is stamped.
    const bad = spawnSync(process.execPath, [CLI, "write", "wiki/Ana Ruiz.md", "--root", "."], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, WIKIWRIGHT_TODAY: "yesterday" },
      input: draft,
    });
    assert.notEqual(bad.status, 0, "an unreadable clock is not a date");
    assert.equal(page(dir, "wiki/Ana Ruiz.md"), written, "and nothing moved");
  });

  it("stamps created on create and updated on write, and no other frontmatter", () => {
    const draft = PERSON.replace("Chen Jing — a designer.", "Bo Lin — an engineer.").replace(
      /Chen Jing/g,
      "Bo Lin",
    );
    const r = run(dir, ["write", "wiki/Bo Lin.md", "--date", "2026-09-03"], draft);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const written = page(dir, "wiki/Bo Lin.md");
    assert.equal(written.includes("created: 2026-09-03"), true);
    assert.equal(written.includes("updated: 2026-09-03"), true);
    // The engine authors those two and nothing else: every other line is the
    // draft's, in the draft's order.
    const draftKeys = draft.split("\n").slice(1, 3);
    assert.deepEqual(written.split("\n").slice(1, 3), draftKeys);
  });

  it("a create whose name an existing page answers to is exit 10 with its tiers", () => {
    const draft = PERSON.replace("type: person", "type: person");
    const r = run(dir, ["write", "wiki/Chen Jing (designer).md", "--date", "2026-09-03"], draft);
    assert.equal(r.status, 10);
    assert.equal(r.error["code"], "identity-candidates");
    const details = r.error["details"] as { candidates: { tier: string; path: string }[] };
    assert.equal(
      details.candidates.some((c) => c.tier === "stem" || c.tier === "exact"),
      true,
      JSON.stringify(details.candidates),
    );
  });

  it("--not-any-of clears the gate and the envelope records what was checked", () => {
    const draft = PERSON.replace("Chen Jing — a designer.", "A second designer.");
    const r = run(
      dir,
      [
        "write",
        "wiki/Chen Jing (designer).md",
        "--not-any-of",
        "Chen Jing",
        "--dry-run",
        "--date",
        "2026-09-03",
      ],
      draft,
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.data["resolve_checked"], ["Chen Jing"]);
  });

  it("a removal that lands nowhere is refused, not reported", () => {
    const dropped = PERSON.split("\n")
      .filter((l) => !l.startsWith("- [role]"))
      .join("\n");
    const r = run(dir, ["write", "wiki/Chen Jing.md", "--date", "2026-09-03"], dropped);
    assert.equal(r.status, 4);
    assert.equal(r.error["code"], "removed-illegally");
    assert.match(String(r.error["hint"]), /--replace-core/u);
    assert.equal(page(dir).includes("- [role] designer at a studio"), true);
  });

  it("--base is compare-and-swap against the page on disk", () => {
    const r = run(
      dir,
      ["write", "wiki/Chen Jing.md", "--base", "0".repeat(64), "--date", "2026-09-03"],
      PERSON,
    );
    assert.equal(r.status, 4);
    assert.equal(r.error["code"], "stale-base");
  });
});

describe("docs/cli.md §write — the section forms", () => {
  let dir = "";
  before(() => {
    dir = vault("sections");
  });
  after(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it("--append splices at the tail and leaves every other byte alone", () => {
    const was = page(dir);
    const r = run(
      dir,
      ["write", "wiki/Chen Jing.md", "--section", "Facts", "--append", "--date", "2026-09-03"],
      "- [habit] runs on Sundays (stated 2026-09-03)\n  - said in passing\n",
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const now = page(dir);
    // The two item lines, plus the one auto stamp the engine is allowed to
    // author. Nothing else moved.
    const added = now.split("\n").filter((l) => !was.split("\n").includes(l));
    assert.deepEqual(added, [
      "updated: 2026-09-03",
      "- [habit] runs on Sundays (stated 2026-09-03)",
      "  - said in passing",
    ]);
    // The rationale line travelled with its item, and it sits under it.
    const lines = now.split("\n");
    const at = lines.indexOf("- [habit] runs on Sundays (stated 2026-09-03)");
    assert.equal(lines[at + 1], "  - said in passing");
  });

  it("a supersede-class append over an open same-category claim is exit 10 with legal[]", () => {
    const r = run(
      dir,
      ["write", "wiki/Chen Jing.md", "--section", "Facts", "--append", "--date", "2026-09-03"],
      "- [role] staff designer (stated 2026-09-03)\n",
    );
    assert.equal(r.status, 10);
    assert.equal(r.error["code"], "open-claim-of-category");
    const details = r.error["details"] as {
      claims: { id: string }[];
      legal: string[][];
    };
    assert.equal(details.claims.length >= 1, true);
    assert.equal(details.legal.length, 2);
    assert.equal(details.legal[0]?.includes("--replace-core"), true);
    assert.equal(details.legal[1]?.includes("--coexist"), true);
  });

  it("--coexist admits the second claim and records its reason on the page", () => {
    const r = run(
      dir,
      [
        "write",
        "wiki/Chen Jing.md",
        "--section",
        "Facts",
        "--append",
        "--coexist",
        "she holds both roles at once",
        // Pinned like every sibling: without it the verb stamps `updated` from
        // the wall clock, and the next test — which asserts the splice moves no
        // other byte — sees that stamp change on any day but 2026-09-03.
        "--date",
        "2026-09-03",
      ],
      "- [role] staff designer (stated 2026-09-03)\n",
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.match(page(dir), /^ {2}- coexists with #[0-9a-f]{8}: she holds both roles at once$/mu);
  });

  it("--replace-core renders the History line and moves no other byte", () => {
    const handle = handleOf(dir, "identity");
    const was = page(dir).split("\n");
    const r = run(
      dir,
      [
        "write",
        "wiki/Chen Jing.md",
        "--section",
        "Facts",
        "--replace-core",
        handle,
        "--date",
        "2026-09-03",
      ],
      "- [identity] full name: 陈静 (stated 2026-09-03)\n",
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const now = page(dir).split("\n");
    assert.equal(
      now.includes(
        "- [identity] full name: Chen Jing (stated 2026-01-01) (valid 2026-01-01→2026-09-02, superseded 2026-09-03)",
      ),
      true,
      now.join("\n"),
    );
    // Exactly one line left and two arrived; everything else is byte-identical.
    const gone = was.filter((l) => !now.includes(l));
    assert.deepEqual(gone, ["- [identity] full name: Chen Jing (stated 2026-01-01)"]);
    assert.equal((r.data["dispositions"] as Record<string, number>)["superseded"], 1);
  });

  it("the close date rule: Y is the day before Z, and X is omitted when undated", () => {
    const r = run(
      dir,
      ["write", "wiki/Chen Jing.md", "--section", "Facts", "--append", "--date", "2026-09-03"],
      "- [housing] 城市: 西安 (inferred, raw/web/x/)\n",
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const handle = handleOf(dir, "housing");
    const close = run(
      dir,
      [
        "write",
        "wiki/Chen Jing.md",
        "--section",
        "Facts",
        "--replace-core",
        handle,
        "--date",
        "2026-09-09",
      ],
      "- [housing] 城市: 上海 (inferred, raw/web/y/)\n",
    );
    assert.equal(close.ok, true, JSON.stringify(close.error));
    assert.match(page(dir), /\(valid →2026-09-08, superseded 2026-09-09\)/u);
  });

  it("--date at or before the retired claim's own date is refused", () => {
    const handle = handleOf(dir, "identity");
    const r = run(
      dir,
      [
        "write",
        "wiki/Chen Jing.md",
        "--section",
        "Facts",
        "--replace-core",
        handle,
        "--date",
        "2026-09-03",
      ],
      "- [identity] full name: x (stated 2026-09-03)\n",
    );
    assert.equal(r.status, 4);
    assert.equal(r.error["code"], "date-not-after");
  });

  it("an accumulate category under --replace-core is exit 4 with the legal[]", () => {
    const handle = handleOf(dir, "preference");
    const r = run(
      dir,
      [
        "write",
        "wiki/Chen Jing.md",
        "--section",
        "Facts",
        "--replace-core",
        handle,
        "--date",
        "2026-09-10",
      ],
      "- [preference] loves hotpot now (stated 2026-09-10)\n",
    );
    assert.equal(r.status, 4);
    assert.equal(r.error["code"], "class-forbids-supersede");
    const data = r.data as { legal: string[][]; claims: { id: string }[] };
    assert.equal(data.legal.length, 2);
    assert.equal(data.legal[0]?.includes("--append"), true);
    assert.equal(data.legal[1]?.includes("--retract"), true);
  });

  it("--retract moves the claim to History with retracted Z", () => {
    const handle = handleOf(dir, "preference");
    const r = run(dir, [
      "write",
      "wiki/Chen Jing.md",
      "--section",
      "Facts",
      "--retract",
      handle,
      "--date",
      "2026-09-10",
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.match(
      page(dir),
      /likes hotpot, one of several \(stated 2026-01-03\) \(retracted 2026-09-10\)/u,
    );
    assert.equal((r.data["dispositions"] as Record<string, number>)["retracted"], 1);
  });

  it("--correct inside the tolerance rewrites the core and nothing else", () => {
    const r0 = run(
      dir,
      ["write", "wiki/Chen Jing.md", "--section", "Facts", "--append", "--date", "2026-09-03"],
      "- [address] lives in Shangai, near the park (stated 2026-09-03)\n",
    );
    assert.equal(r0.ok, true, JSON.stringify(r0.error));
    const handle = handleOf(dir, "address");
    const r = run(dir, [
      "write",
      "wiki/Chen Jing.md",
      "--section",
      "Facts",
      "--correct",
      handle,
      "--core",
      "lives in Shanghai, near the park",
      "--date",
      "2026-09-03",
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.match(page(dir), /lives in Shanghai, near the park \(stated 2026-09-03\)/u);
    assert.equal((r.data["dispositions"] as Record<string, number>)["corrected"], 1);
  });

  it("--correct outside the tolerance is refused and names --replace-core", () => {
    const handle = handleOf(dir, "address");
    const r = run(dir, [
      "write",
      "wiki/Chen Jing.md",
      "--section",
      "Facts",
      "--correct",
      handle,
      "--core",
      "lives in Beijing, near the river",
      "--date",
      "2026-09-03",
    ]);
    assert.equal(r.status, 4);
    assert.equal(r.error["code"], "not-a-correction");
    assert.equal(JSON.stringify(r.data).includes("--replace-core"), true);
  });

  it("an undeclared section is a usage error naming the type and its declared sections", () => {
    const r = run(
      dir,
      ["write", "wiki/Chen Jing.md", "--section", "Invented", "--append", "--date", "2026-09-03"],
      "- [habit] x (stated 2026-09-03)\n",
    );
    assert.equal(r.status, 2);
    assert.equal(r.error["code"], "unknown-section");
    assert.deepEqual((r.error["details"] as { valid_values?: string[] })["valid_values"], [
      "Facts",
      "Relations",
      "Timeline",
      "Notes",
      "History",
    ]);
  });

  it("--append on a declared section the page lacks adds the heading, in declared order", () => {
    // `person` declares Timeline (entries) between Relations and Notes; the
    // page carries Facts, Relations and History and no Timeline.
    const was = page(dir);
    assert.equal(was.includes("## Timeline"), false);
    // A claims form needs the claim on the page: a declared, absent section is
    // `section-absent`, not `unknown-section`, and the page is untouched.
    const retract = run(dir, [
      "write",
      "wiki/Chen Jing.md",
      "--section",
      "Timeline",
      "--retract",
      "#nope",
      "--date",
      "2026-09-04",
    ]);
    assert.equal(retract.status, 2, JSON.stringify(retract.error));
    assert.equal(retract.error["code"], "section-absent");
    assert.equal(page(dir), was);
    const r = run(
      dir,
      ["write", "wiki/Chen Jing.md", "--section", "Timeline", "--append", "--date", "2026-09-03"],
      "- 2026-09-03 — met at the studio\n",
    );
    assert.equal(r.status, 0, JSON.stringify(r.error));
    const now = page(dir);
    const lines = now.split("\n");
    const heading = lines.indexOf("## Timeline");
    assert.notEqual(heading, -1, now);
    assert.equal(lines[heading + 2], "- 2026-09-03 — met at the studio");
    assert.equal(
      heading > lines.indexOf("## Relations") && heading < lines.indexOf("## History"),
      true,
      "placed between the declared neighbours the page carries",
    );
    assert.deepEqual(r.data["rendered"], ["- 2026-09-03 — met at the studio"]);
  });

  it("on a page out of declared order, the heading follows its nearest declared predecessor", () => {
    // Facts, History, Relations on the page; `person` declares Facts, Relations,
    // Timeline, Notes, History. Timeline's nearest declared predecessor the page
    // carries is Relations, so it lands after Relations — at the page's end —
    // and never between Facts and History.
    const out = "wiki/Out of Order.md";
    writeFileSync(
      join(dir, out),
      [
        "---",
        "type: person",
        "tags: []",
        "---",
        "Out of order.",
        "",
        "## Facts",
        "- [identity] full name: Out Of Order (stated 2026-01-01)",
        "",
        "## History",
        "",
        "## Relations",
        "- knows [[Charter]]",
        "",
      ].join("\n"),
    );
    const r = run(
      dir,
      ["write", out, "--section", "Timeline", "--append", "--date", "2026-09-03"],
      "- 2026-09-03 — first seen\n",
    );
    assert.equal(r.status, 0, JSON.stringify(r.error));
    const lines = page(dir, out).split("\n");
    assert.deepEqual(lines.slice(lines.indexOf("## Relations")), [
      "## Relations",
      "- knows [[Charter]]",
      "",
      "## Timeline",
      "",
      "- 2026-09-03 — first seen",
      "",
    ]);
  });

  it("prose lands verbatim under a new heading", () => {
    const r = run(
      dir,
      ["write", "wiki/Chen Jing.md", "--section", "Notes", "--append", "--date", "2026-09-03"],
      "A free note.\n",
    );
    assert.equal(r.status, 0, JSON.stringify(r.error));
    assert.match(
      page(dir),
      /## Notes\n\nA free note\./u,
      "prose lands verbatim under the new heading",
    );
  });

  it("--dry-run returns the plan, the claims and the rendered lines, and writes nothing", () => {
    const before_ = page(dir);
    const handle = handleOf(dir, "role");
    const r = run(
      dir,
      [
        "write",
        "wiki/Chen Jing.md",
        "--section",
        "Facts",
        "--replace-core",
        handle,
        "--date",
        "2026-10-01",
        "--dry-run",
      ],
      "- [role] principal designer (stated 2026-10-01)\n",
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data["wrote"], false);
    assert.equal((r.data["rendered"] as string[]).length, 2);
    assert.equal((r.data["claims"] as unknown[]).length > 0, true);
    assert.equal(page(dir), before_);
  });
});

describe("docs/cli.md §write — --append on a prose section", () => {
  let dir = "";
  before(() => {
    dir = vault("prose");
    const withNotes = `${PERSON.replace(/Chen Jing/g, "Li Wei").replace("## History\n", "## Notes\n\nMet at the studio.\n\n## History\n")}`;
    const r = run(dir, ["write", "wiki/Li Wei.md", "--date", "2026-09-01"], withNotes);
    assert.equal(r.ok, true, JSON.stringify(r.error));
  });
  after(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it("the lines land verbatim at the section's tail, and nothing else moves", () => {
    const was = page(dir, "wiki/Li Wei.md");
    const r = run(
      dir,
      ["write", "wiki/Li Wei.md", "--section", "Notes", "--append", "--date", "2026-09-03"],
      "\nPrefers mornings.\n",
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.data["rendered"], ["", "Prefers mornings."]);
    const now = page(dir, "wiki/Li Wei.md");
    const added = now.split("\n").filter((l) => !was.split("\n").includes(l));
    assert.deepEqual(added, ["updated: 2026-09-03", "Prefers mornings."]);
    const lines = now.split("\n");
    const at = lines.indexOf("Prefers mornings.");
    assert.equal(lines[at - 2], "Met at the studio.", "below the section's last line");
    assert.equal(lines[at + 2], "## History", "and above the next heading");
    // A bullet is prose too: no grammar, no item parse, no refusal.
    const bullet = run(
      dir,
      ["write", "wiki/Li Wei.md", "--section", "Notes", "--append", "--date", "2026-09-04"],
      "- an excerpt\n",
    );
    assert.equal(bullet.ok, true, JSON.stringify(bullet.error));
    assert.equal(page(dir, "wiki/Li Wei.md").includes("Prefers mornings.\n- an excerpt\n"), true);
  });

  it("a grammar section keeps its item parse, and says what an item is", () => {
    const r = run(
      dir,
      ["write", "wiki/Li Wei.md", "--section", "Facts", "--append", "--date", "2026-09-03"],
      "Not a list item.\n",
    );
    assert.equal(r.status, 4, JSON.stringify(r.error));
    assert.equal(r.error["code"], "grammar-unparsed");
    assert.match(String(r.error["message"]), /"Facts" is a claims section/);
    assert.match(String(r.error["message"]), /an item is one top-level `- ` line/);
  });
});

describe("docs/cli.md §brief — the writer bound", () => {
  let dir = "";
  before(() => {
    dir = vault("roles");
  });
  after(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  function asRole(role: string, args: string[]): Run {
    const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...PINNED_CLOCK, WIKIWRIGHT_ROLE: role },
    });
    const envelope = JSON.parse(r.stdout) as {
      ok: boolean;
      data?: Record<string, unknown>;
      error?: Record<string, unknown>;
    };
    return {
      status: r.status ?? -1,
      ok: envelope.ok,
      data: envelope.data ?? {},
      error: envelope.error ?? {},
    };
  }

  it("a writer may call write, and a consumer may not", () => {
    assert.equal(asRole("writer", ["write", "--help"]).ok, true);
    const denied = asRole("consumer", ["write", "--help"]);
    assert.equal(denied.status, 2);
    assert.equal(denied.error["code"], "role-forbidden");
  });

  it("a writer calling a maintainer verb exits 2 with role-filtered valid_commands", () => {
    const r = asRole("writer", ["init", "--help"]);
    assert.equal(r.status, 2);
    assert.equal(r.error["code"], "role-forbidden");
    const details = r.error["details"] as { role: string; valid_commands: string[] };
    assert.equal(details.role, "writer");
    assert.equal(details.valid_commands.includes("write"), true);
    assert.equal(details.valid_commands.includes("init"), false);
    assert.equal(details.valid_commands.includes("hook"), false);
  });

  it("the consumer bound is unchanged by the new rank", () => {
    const details = asRole("consumer", ["init", "--help"]).error["details"] as {
      valid_commands: string[];
    };
    assert.deepEqual(details.valid_commands.includes("lint"), false);
    assert.deepEqual(details.valid_commands.includes("search"), true);
  });
});

describe("docs/cli.md §new — the alias for a skeleton write", () => {
  // The code starter is a bundle over the code kit: installed and granted in
  // the scratch vault, judged under the vault's own trust store.
  let dir = "";
  before(() => {
    dir = join(SCRATCH, "code");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
    const init = run(dir, ["init", "--constitution", "code"], undefined, kitEnv(dir));
    assert.equal(init.ok, true, JSON.stringify(init.error));
    installKit(dir);
    grantKit(dir);
  });
  after(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it("new subsystem renders a skeleton from the type's sections and the gate accepts it", () => {
    const r = run(
      dir,
      [
        "new",
        "subsystem",
        "Warm reset",
        "--dest",
        "wiki/warm-reset.md",
        "--set",
        "pin=0123456789abcdef0123456789abcdef01234567",
        "--set",
        "origin=.",
        "--set",
        'covers=["src/reset/"]',
        "--item",
        "Relations: mapped_in [[layout]]",
      ],
      undefined,
      kitEnv(dir),
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const text = readFileSync(join(dir, "wiki/warm-reset.md"), "utf8");
    assert.match(text, /^## /mu);
    const lint = run(dir, ["lint", "--page", "wiki/warm-reset.md"], undefined, kitEnv(dir));
    assert.equal(lint.status, 0, JSON.stringify(lint.data));
  });
});

describe("docs/architecture.md §The invariants — the engine never disagrees with itself", () => {
  it("no rendered History line makes a transition arm fire", () => {
    const dir = vault("internal");
    try {
      for (const [category, item] of [
        ["identity", "- [identity] full name: 陈静 (stated 2026-09-03)"],
        ["role", "- [role] principal designer (stated 2026-09-03)"],
      ] as const) {
        const handle = handleOf(dir, category);
        const r = run(
          dir,
          [
            "write",
            "wiki/Chen Jing.md",
            "--section",
            "Facts",
            "--replace-core",
            handle,
            "--date",
            "2026-09-03",
          ],
          `${item}\n`,
        );
        assert.notEqual(r.status, 1, `writer-transition fired: ${JSON.stringify(r.error)}`);
        assert.equal(r.ok, true, JSON.stringify(r.error));
      }
      const lint = run(dir, ["lint", "--page", "wiki/Chen Jing.md", "--all"]);
      const findings = (lint.data["findings"] ?? []) as { ruleId: string; severity: string }[];
      assert.deepEqual(
        findings.filter((f) => f.ruleId === "claims-transition"),
        [],
      );
    } finally {
      rmSync(SCRATCH, { recursive: true, force: true });
    }
  });
});

describe("docs/cli.md §move — re-based on the Writer", () => {
  const SCRATCH2 = mkdtempSync(join(tmpdir(), "ww-move-test-"));
  function moveVault(name: string): string {
    const dir = join(SCRATCH2, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
    layMemoryLaw(dir);
    writeFileSync(join(dir, "wiki", "Ana.md"), PERSON.replaceAll("Chen Jing", "Ana"));
    writeFileSync(
      join(dir, "wiki", "Bo.md"),
      PERSON.replaceAll("Chen Jing", "Bo").replace("- knows [[Charter]]", "- knows [[Ana]]"),
    );
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "seed"], { cwd: dir });
    return dir;
  }
  after(() => rmSync(SCRATCH2, { recursive: true, force: true }));

  it("a rename appends the old basename to aliases, so the law cannot fire after it", () => {
    const dir = moveVault("rename");
    const r = run(dir, [
      "move",
      "wiki/Ana.md",
      "wiki/Anna.md",
      "--reason",
      "browse-misleading",
      "--rename",
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.data["aliased"], ["Ana"]);
    assert.match(page(dir, "wiki/Anna.md"), /^aliases: \["Ana"\]$/mu);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    const gate = run(dir, ["gate"]);
    const findings = (gate.data["findings"] ?? []) as { ruleId: string }[];
    assert.deepEqual(
      findings.filter((f) => f.ruleId === "renamed-without-alias"),
      [],
      "the ritual is satisfied by construction",
    );
  });

  it("inbound links are reported by default and rewritten on request", () => {
    const reported = moveVault("links-reported");
    const r0 = run(reported, [
      "move",
      "wiki/Ana.md",
      "wiki/Anna.md",
      "--reason",
      "browse-misleading",
      "--rename",
    ]);
    assert.equal(r0.ok, true, JSON.stringify(r0.error));
    assert.deepEqual(r0.data["rewritten_links"], []);
    assert.match(page(reported, "wiki/Bo.md"), /\[\[Ana\]\]/u);

    const rewritten = moveVault("links-rewritten");
    const r = run(rewritten, [
      "move",
      "wiki/Ana.md",
      "wiki/Anna.md",
      "--reason",
      "browse-misleading",
      "--rename",
      "--rewrite-links",
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.deepEqual(r.data["rewritten_links"], ["wiki/Bo.md"]);
    assert.match(page(rewritten, "wiki/Bo.md"), /\[\[Anna\|Ana\]\]/u);
  });

  it("retire splices the two keys and the banner, keeping the page's own bytes", () => {
    const dir = moveVault("retire");
    const before = page(dir, "wiki/Bo.md");
    const r = run(dir, ["retire", "wiki/Bo.md", "--superseded-by", "Ana"]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const after = page(dir, "wiki/Bo.md");
    const added = after.split("\n").filter((l) => !before.split("\n").includes(l));
    assert.deepEqual(added, [
      "status: retired",
      "superseded_by: Ana",
      "> Retired. Superseded by [[Ana]].",
    ]);
  });
});

describe("docs/cli.md §write — near stays advisory", () => {
  it("the identity refusal carries near beside the blocking tiers, never inside them", () => {
    const dir = vault("near");
    try {
      const draft = PERSON.replace("Chen Jing — a designer.", "A different designer.");
      const r = run(dir, ["write", "wiki/Chen Jing (designer).md", "--date", "2026-09-03"], draft);
      assert.equal(r.status, 10);
      const details = r.error["details"] as {
        candidates: { tier: string }[];
        near: { path: string }[];
      };
      assert.equal(Array.isArray(details.near), true, "the advisory list is present");
      for (const candidate of details.candidates) {
        assert.notEqual(candidate.tier, "near", "near never blocks");
      }
    } finally {
      rmSync(SCRATCH, { recursive: true, force: true });
    }
  });
});

describe("a draft whose frontmatter does not parse is refused with one finding", () => {
  let dir = "";
  before(() => {
    dir = vault("malformed");
  });
  after(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  // `person` stamps `created` and `updated`, so this also proves the stamp
  // step defers to the judge instead of refusing as `stamp-refused` (exit 4).
  const DRAFT = PERSON.replace("type: person", "type: person\ntitle: Chen Jing — designer: yes");

  it("write from stdin: exit 5, malformed-frontmatter with line and column, nothing else", () => {
    const r = run(dir, ["write", "wiki/Chen Jing.md", "--date", "2026-09-03"], DRAFT);
    assert.equal(r.status, 5, JSON.stringify(r.error));
    assert.equal(r.error["code"], "draft-invalid");
    const findings = r.data["findings"] as Array<Record<string, unknown>>;
    assert.deepEqual(
      findings.map((f) => f["ruleId"]),
      ["malformed-frontmatter"],
      JSON.stringify(findings),
    );
    const only = findings[0] ?? {};
    assert.equal(only["line"], 3);
    assert.deepEqual(only["details"], { column: 8 });
  });

  it("lint --stdin and the working tree say the same one thing", () => {
    const stdin = run(dir, ["lint", "--stdin", "--path", "wiki/Chen Jing.md"], DRAFT);
    assert.equal(stdin.status, 5);
    assert.deepEqual(
      (stdin.data["findings"] as Array<{ ruleId: string }>).map((f) => f.ruleId),
      ["malformed-frontmatter"],
    );
    writeFileSync(join(dir, "wiki", "Broken.md"), DRAFT.replaceAll("Chen Jing", "Broken"));
    const tree = run(dir, ["lint", "--page", "wiki/Broken.md"]);
    assert.equal(tree.status, 5);
    assert.deepEqual(
      (tree.data["findings"] as Array<{ ruleId: string }>).map((f) => f.ruleId),
      ["malformed-frontmatter"],
    );
  });
});

describe("docs/cli.md §write --from — a set of drafts lands together or not at all", () => {
  let dir = "";
  const DRAFTS = "temp/drafts";
  function person(name: string, knows: string): string {
    return PERSON.replace("Chen Jing — a designer.", `${name} — a person.`)
      .replaceAll("Chen Jing", name)
      .replace("- knows [[Charter]]", `- knows [[${knows}]]`);
  }
  function lay(pages: Record<string, string>): void {
    rmSync(join(dir, DRAFTS), { recursive: true, force: true });
    for (const [rel, text] of Object.entries(pages)) {
      mkdirSync(join(dir, DRAFTS, "wiki"), { recursive: true });
      writeFileSync(join(dir, DRAFTS, rel), text);
    }
  }
  before(() => {
    dir = vault("batch");
    // A program wiki's shape: the Relations section is ratcheted to error, so
    // a relation to a page that does not exist yet blocks the write.
    const file = join(dir, "config", "constitution.json");
    const law = JSON.parse(readFileSync(file, "utf8")) as {
      fragments: { "entity-body": { sections: { list: Array<Record<string, unknown>> } } };
    };
    const relations = law.fragments["entity-body"].sections.list.find(
      (s) => s["heading"] === "Relations",
    );
    assert.notEqual(relations, undefined);
    if (relations !== undefined) relations["severity"] = "error";
    writeFileSync(file, `${JSON.stringify(law, null, 2)}\n`);
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "ratchet relations"], { cwd: dir });
  });
  after(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it("two new pages that link each other are refused one at a time and land in one call", () => {
    const ana = person("Ana Ruiz", "Bo Lin");
    const bo = person("Bo Lin", "Ana Ruiz");
    const alone = run(dir, ["write", "wiki/Ana Ruiz.md", "--date", "2026-09-03"], ana);
    assert.equal(alone.status, 5, JSON.stringify(alone.error));
    assert.equal(
      (alone.data["findings"] as Array<{ ruleId: string }>).some(
        (f) => f.ruleId === "relation-target-unresolved",
      ),
      true,
    );
    lay({ "wiki/Ana Ruiz.md": ana, "wiki/Bo Lin.md": bo });
    const together = run(dir, ["write", "--from", DRAFTS, "--date", "2026-09-03"]);
    assert.equal(together.ok, true, JSON.stringify(together.error));
    assert.equal(together.data["from"], DRAFTS);
    assert.equal(together.data["date"], "2026-09-03");
    const pages = together.data["pages"] as Array<Record<string, unknown>>;
    assert.deepEqual(
      pages.map((p) => [p["path"], p["created"], typeof p["blob"]]),
      [
        ["wiki/Ana Ruiz.md", true, "string"],
        ["wiki/Bo Lin.md", true, "string"],
      ],
    );
    for (const rel of ["wiki/Ana Ruiz.md", "wiki/Bo Lin.md"]) {
      const written = page(dir, rel);
      assert.equal(written.includes("created: 2026-09-03"), true, `${rel} is stamped`);
      assert.equal(run(dir, ["lint", "--page", rel]).status, 0, `${rel} lints clean`);
    }
  });

  it("one bad draft refuses the whole set, and nothing lands", () => {
    lay({
      "wiki/Cy Park.md": person("Cy Park", "Di Sato"),
      "wiki/Di Sato.md": person("Di Sato", "Cy Park").replace("type: person", "type: nope"),
    });
    const r = run(dir, ["write", "--from", DRAFTS, "--date", "2026-09-03"]);
    assert.equal(r.status, 5, JSON.stringify(r.error));
    assert.equal(r.error["code"], "draft-invalid");
    assert.match(String(r.error["message"]), /1 of 2 draft\(s\) fail/);
    assert.deepEqual(r.data["failing"], ["wiki/Di Sato.md"]);
    assert.equal(
      (r.data["findings"] as Array<{ ruleId: string; path: string }>).some(
        (f) => f.ruleId === "unknown-type" && f.path === "wiki/Di Sato.md",
      ),
      true,
    );
    // The refusal carries the rows the accepted run prints, each draft
    // with its own findings and the bytes that were judged.
    const rows = r.data["pages"] as Array<{
      path: string;
      created: boolean;
      findings: { ruleId: string }[];
      preview: string;
    }>;
    assert.deepEqual(
      rows.map((p) => [
        p.path,
        p.created,
        p.findings.map((f) => f.ruleId).includes("unknown-type"),
      ]),
      [
        ["wiki/Cy Park.md", true, false],
        ["wiki/Di Sato.md", true, true],
      ],
    );
    assert.match(rows[1]?.preview ?? "", /^type: nope$/mu, "the judged bytes, per draft");
    assert.equal(existsSync(join(dir, "wiki/Cy Park.md")), false, "the good draft did not land");
    assert.equal(existsSync(join(dir, "wiki/Di Sato.md")), false);
  });

  it("--dry-run plans every path, previews every page and writes nothing", () => {
    lay({
      "wiki/Ed Kim.md": person("Ed Kim", "Fay Wu"),
      "wiki/Fay Wu.md": person("Fay Wu", "Ed Kim"),
      // The existing page joins the cluster by ADDING a relation: dropping
      // `knows [[Bo Lin]]` would be `relation-removed` (docs/concepts.md),
      // an error, and the whole set would be refused for a reason this test is
      // not about.
      "wiki/Ana Ruiz.md": person("Ana Ruiz", "Bo Lin").replace(
        "- knows [[Bo Lin]]",
        "- knows [[Bo Lin]]\n- knows [[Fay Wu]]",
      ),
    });
    const r = run(dir, ["write", "--from", DRAFTS, "--date", "2026-09-04", "--dry-run"]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data["wrote"], false);
    assert.deepEqual(
      (r.data["ops"] as Array<{ kind: string; path: string }>).map((op) => [op.kind, op.path]),
      [
        ["write", "wiki/Ana Ruiz.md"],
        ["create", "wiki/Ed Kim.md"],
        ["create", "wiki/Fay Wu.md"],
      ],
    );
    const pages = r.data["pages"] as Array<Record<string, unknown>>;
    assert.equal(pages.length, 3);
    assert.equal(
      pages.every((p) => typeof p["preview"] === "string"),
      true,
    );
    const update = pages.find((p) => p["path"] === "wiki/Ana Ruiz.md") ?? {};
    assert.equal(update["created"], false);
    assert.equal(typeof (update["digest"] as { before: unknown }).before, "string");
    assert.equal(existsSync(join(dir, "wiki/Ed Kim.md")), false);
  });

  it("an existing page in the set is an update: updated is re-stamped, the draft's created kept", () => {
    // A whole-page rewrite carries the page's own frontmatter forward, as any
    // rewrite from the page's bytes does; the engine re-stamps `updated` only.
    lay({
      "wiki/Ana Ruiz.md": person("Ana Ruiz", "Bo Lin")
        .replace("a person", "a pilot")
        .replace("tags: []", "tags: []\ncreated: 2026-09-03"),
    });
    const r = run(dir, ["write", "--from", DRAFTS, "--date", "2026-09-05"]);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const written = page(dir, "wiki/Ana Ruiz.md");
    assert.equal(written.includes("created: 2026-09-03"), true);
    assert.equal(written.includes("updated: 2026-09-05"), true);
    assert.equal(written.includes("a pilot"), true);
  });

  it("the usage refusals: both forms at once, a section flag, a draft outside the roots", () => {
    lay({ "wiki/Gil Ode.md": person("Gil Ode", "Ana Ruiz") });
    const both = run(dir, ["write", "wiki/Gil Ode.md", "--from", DRAFTS]);
    assert.equal(both.status, 2);
    assert.equal(both.error["code"], "one-op");
    const section = run(dir, ["write", "--from", DRAFTS, "--section", "Facts", "--append"]);
    assert.equal(section.status, 2);
    assert.equal(section.error["code"], "one-op");
    mkdirSync(join(dir, DRAFTS, "notes"), { recursive: true });
    writeFileSync(join(dir, DRAFTS, "notes", "loose.md"), "---\ntype: person\n---\n");
    const outside = run(dir, ["write", "--from", DRAFTS]);
    assert.equal(outside.status, 2, JSON.stringify(outside.error));
    assert.equal(outside.error["code"], "invalid-path");
    assert.match(String(outside.error["message"]), /notes\/loose\.md/);
    assert.equal(existsSync(join(dir, "wiki/Gil Ode.md")), false);
    const missing = run(dir, ["write", "--from", "temp/nowhere"]);
    // Resolved against --root as the process sees it, and the refusal says
    // where it looked. The root is `.` from the spawn's cwd, which the process
    // reads as a real path — under /private on macOS, where the temp directory
    // is a symlink — so the expectation is built from the real path too.
    assert.equal(
      (missing.error["details"] as { resolved: string }).resolved,
      resolve(realpathSync(dir), "temp/nowhere"),
    );
    assert.match(String(missing.error["message"]), /resolved against --root/u);
    assert.equal(missing.status, 3);
    assert.equal(run(dir, ["write"]).error["code"], "missing-argument");
  });
});
