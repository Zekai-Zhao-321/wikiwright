// docs/cli.md §lint (--stdin: a draft that does not exist on disk lints through
// the identical core pass; --explain: the exceptions stanza emitter and the
// waiver stanza for every queue-routed finding; --since replays commit pairs;
// --limit, --rule, --all; --path on every judging verb) · docs/architecture.md
// · docs/concepts.md §Findings and routing ·
// docs/architecture.md §How a verdict is produced (a path is NFC at every
// constructor; lint sees the full effective configuration; identity sees
// resolved titles).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { documentOf } from "../../core/test/helpers/constitution.ts";
import { MEMORY_LAW } from "./fixtures/memory-law.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));
const LAW = join(MEMORY_LAW, "config");

interface Finding {
  ruleId: string;
  severity: string;
  path: string;
  line?: number;
  queue?: string;
  fix?: { argv: string[]; applicability: string };
  new_since_base?: boolean;
  details?: Record<string, unknown>;
}

interface Envelope {
  ok: boolean;
  error?: { code: string; exit_code: number };
  data?: Record<string, unknown>;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function run(cwd: string, args: string[], input?: string): { status: number; envelope: Envelope } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], {
    cwd,
    encoding: "utf8",
    input: input ?? "",
  });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Envelope };
}

const findings = (e: Envelope): Finding[] => (e.data?.["findings"] ?? []) as Finding[];
const summary = (e: Envelope): Record<string, number> =>
  (e.data?.["summary"] ?? {}) as Record<string, number>;

/** minimal-vault, with the deliberately broken page pruned. */
function minimalVault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-lint-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  return tmp;
}

function person(title: string, facts: string[], relations: string[], extra = ""): string {
  return `---
type: person
title: ${title}
description: A synthetic person.
tags: [folk]${extra}
---
${title} is a person.

## Facts

${facts.join("\n")}

## Relations

${relations.join("\n")}
`;
}

const LEGACY = person(
  "Alpha",
  [
    "- [bogus-one] Alpha likes tea (stated 2026-01-01)",
    "- [bogus-two] Alpha lives east (stated 2026-01-01)",
    "- [bogus-three] Alpha works late (stated 2026-01-01)",
  ],
  ["- knows [[Beta]]"],
);
const BETA = person(
  "Beta",
  ["- [identity] Beta is a person (stated 2026-01-01)"],
  ["- knows [[Alpha]]"],
);

/** A vault whose `Facts` section declares `severity: "error"` — the ratchet, pulled. */
function ratchetedVault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-lint-"));
  mkdirSync(join(tmp, "config"), { recursive: true });
  mkdirSync(join(tmp, "wiki/Folk"), { recursive: true });
  cpSync(join(LAW, "constitution.json"), join(tmp, "config/constitution.json"));
  const law = JSON.parse(readFileSync(join(tmp, "config/constitution.json"), "utf8")) as {
    fragments: Record<string, { sections?: { list: { heading: string; severity?: string }[] } }>;
  };
  for (const entry of law.fragments["entity-body"]?.sections?.list ?? []) {
    if (entry.heading === "Facts") entry.severity = "error";
  }
  writeFileSync(join(tmp, "config/constitution.json"), JSON.stringify(law, null, 2));
  writeFileSync(join(tmp, "config/engine.json"), JSON.stringify({ content_roots: ["wiki"] }));
  writeFileSync(join(tmp, "wiki/Folk/Alpha.md"), LEGACY);
  writeFileSync(join(tmp, "wiki/Folk/Beta.md"), BETA);
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "initial");
  return tmp;
}

const ANA = person(
  "Ana",
  ["- [identity] Ana is a person (stated 2026-01-01)"],
  ["- knows [[Bob]]"],
);
const BOB = person(
  "Bob",
  ["- [identity] Bob is a person (stated 2026-01-01)"],
  ["- knows [[Ana]]"],
);

/** The memory law, as a git vault — engine.json included verbatim. */
function lawVault(engine?: Record<string, unknown>): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-lint-"));
  mkdirSync(join(tmp, "config"), { recursive: true });
  mkdirSync(join(tmp, "wiki/Folk"), { recursive: true });
  cpSync(join(LAW, "constitution.json"), join(tmp, "config/constitution.json"));
  cpSync(join(LAW, "engine.json"), join(tmp, "config/engine.json"));
  if (engine !== undefined) {
    writeFileSync(join(tmp, "config/engine.json"), JSON.stringify(engine, null, 2));
  }
  writeFileSync(join(tmp, "wiki/Folk/Ana.md"), ANA);
  writeFileSync(join(tmp, "wiki/Folk/Bob.md"), BOB);
  git(tmp, "init", "-q");
  git(tmp, "config", "user.email", "test@example.com");
  git(tmp, "config", "user.name", "Test");
  git(tmp, "add", "-A");
  git(tmp, "commit", "-q", "-m", "initial");
  return tmp;
}

describe("lint --stdin (docs/cli.md §lint)", () => {
  it("lints a draft from stdin at its would-be path without touching disk", () => {
    const tmp = minimalVault();
    try {
      const bad =
        "---\ntype: nonexistent-type\ntitle: Draft\ndescription: d.\ntags: []\n---\n\n# Draft\n";
      const r = run(tmp, ["lint", "--stdin", "--path", "wiki/draft.md"], bad);
      assert.equal(r.status, 5);
      assert.equal(
        findings(r.envelope).some((f) => f["ruleId"] === "unknown-type"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes a clean draft, and requires --path", () => {
    const tmp = minimalVault();
    try {
      const good =
        "---\ntype: concept\ntitle: Fresh draft\ndescription: d.\ntags: []\n---\n\n# Fresh draft\n\nSee [[Warm reset under load]].\n";
      const ok = run(tmp, ["lint", "--stdin", "--path", "wiki/fresh-draft.md"], good);
      assert.equal(ok.status, 0);

      const missing = run(tmp, ["lint", "--stdin"], good);
      assert.equal(missing.status, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("lint --explain (docs/cli.md §lint: the exceptions stanza emitter)", () => {
  it("explains a page: chain, sections, and ready-to-paste stanzas for judgment findings", () => {
    const tmp = minimalVault();
    try {
      // The tag entry's `requires_link` is the one judgment-class finding the
      // fixture can carry: a queued finding is what a stanza is written for.
      const constitutionPath = join(tmp, "config", "constitution.json");
      const constitution = JSON.parse(readFileSync(constitutionPath, "utf8")) as {
        vocabularies: { tags: { entries: Record<string, Record<string, unknown>> } };
      };
      constitution.vocabularies.tags.entries["test-execution"] = {
        description: "Running tests on real hardware or rigs.",
        requires_link: "Missing Hub Page",
      };
      writeFileSync(constitutionPath, JSON.stringify(constitution, null, 2));
      const pagePath = "wiki/test-execution/warm-reset.md";
      const r = run(tmp, ["lint", "--explain", "--page", pagePath]);
      const explain = (r.envelope["data"] as Record<string, unknown>)["explain"] as Record<
        string,
        unknown
      >;
      assert.notEqual(explain, undefined);
      assert.equal(Array.isArray(explain["chain"]), true);
      // A v3 constitution declares no rules, and the editorial tier's
      // one surviving power is a tag entry's `requires_link`. The stanza emitter
      // is what this test is about, and it works off the finding.
      const stanzas = explain["exception_stanzas"] as Array<Record<string, unknown>>;
      const stanza = stanzas.find((s) => s["rule"] === "tag-requires-link");
      assert.notEqual(stanza, undefined, JSON.stringify(stanzas));
      assert.equal(typeof stanza?.["digest"], "string");
      assert.equal(typeof stanza?.["reason"], "string", "a fill-me-in reason slot");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--explain requires --page", () => {
    const tmp = minimalVault();
    try {
      const r = run(tmp, ["lint", "--explain"]);
      assert.equal(r.status, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("lint --stdin sees the full effective configuration", () => {
  it("a draft valid under field_sources derivation passes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-stdin-"));
    try {
      mkdirSync(join(tmp, "config"));
      mkdirSync(join(tmp, "wiki"));
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify(
          documentOf({ types: { note: { extends: "concept", description: "A note." } } }),
        ),
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({
          content_roots: ["wiki"],
          field_sources: { title: "basename", description: "lede" },
        }),
      );
      const draft = "---\ntype: note\ntags: []\n---\n\n# Draft\n\nThe lede line.\n";
      const r = run(tmp, ["lint", "--stdin", "--path", "wiki/draft.md"], draft);
      assert.equal(r.status, 0, JSON.stringify(r.envelope));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("identity sees resolved titles", () => {
  it("a derived title colliding with an explicit title is caught", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ww-ident-"));
    try {
      mkdirSync(join(tmp, "config"));
      mkdirSync(join(tmp, "wiki"));
      writeFileSync(
        join(tmp, "config", "constitution.json"),
        JSON.stringify(
          documentOf({ types: { note: { extends: "concept", description: "A note." } } }),
        ),
      );
      writeFileSync(
        join(tmp, "config", "engine.json"),
        JSON.stringify({
          content_roots: ["wiki"],
          field_sources: { title: "basename", description: "lede" },
        }),
      );
      writeFileSync(
        join(tmp, "wiki", "alpha.md"),
        "---\ntype: note\ntags: []\n---\n\n# alpha\n\nDerives its title.\n",
      );
      writeFileSync(
        join(tmp, "wiki", "beta.md"),
        "---\ntype: note\ntitle: alpha\ndescription: d.\ntags: []\n---\n\n# beta\n",
      );
      const r = run(tmp, ["lint"]);
      assert.equal(r.status, 5, JSON.stringify(r.envelope));
      assert.equal(
        findings(r.envelope).some((f) => f["ruleId"] === "identity-collision"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the envelope caps and filters (docs/concepts.md §Findings and routing)", () => {
  it("--limit trims the array while the summary stays whole", () => {
    const tmp = ratchetedVault();
    try {
      const capped = run(tmp, ["lint", "--limit", "1"]);
      assert.equal(findings(capped.envelope).length, 1);
      const caps = capped.envelope.data?.["caps"] as { hit: boolean };
      assert.equal(caps.hit, true);
      const all = run(tmp, ["lint", "--all"]);
      assert.equal(findings(all.envelope).length > 1, true);
      assert.deepEqual(
        capped.envelope.data?.["summary"],
        all.envelope.data?.["summary"],
        "the summary is computed over the uncapped set",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--rule filters before the cap", () => {
    const tmp = ratchetedVault();
    try {
      const r = run(tmp, ["lint", "--rule", "unknown-category", "--all"]);
      assert.equal(findings(r.envelope).length, 3);
      assert.equal(
        findings(r.envelope).every((f) => f.ruleId === "unknown-category"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("lint --explain prints the waiver stanza (docs/cli.md §lint --explain)", () => {
  it("every queue-routed finding gets an exceptions stanza", () => {
    const tmp = ratchetedVault();
    try {
      const r = run(tmp, ["lint", "--page", "wiki/Folk/Alpha.md", "--explain", "--all"]);
      const explain = r.envelope.data?.["explain"] as Record<string, unknown>;
      const stanzas = explain["exception_stanzas"] as { rule: string; digest: string }[];
      assert.equal(stanzas.length >= 3, true, JSON.stringify(stanzas));
      for (const s of stanzas) {
        assert.equal(typeof s.digest, "string");
        assert.equal(s.digest.length > 0, true);
      }
      // Every queue-routed finding is keyed; the ones the grammar already keyed
      // per item keep their key, and the ones that had none gain the sha256
      // form. Neither keys a line number.
      const queued = findings(r.envelope).filter(
        (f) => f.path === "wiki/Folk/Alpha.md" && f.queue !== undefined,
      );
      assert.equal(queued.length, stanzas.length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a pasted exceptions stanza silences the finding and is censused", () => {
    const tmp = ratchetedVault();
    try {
      const r = run(tmp, ["lint", "--page", "wiki/Folk/Alpha.md", "--explain", "--all"]);
      const explain = r.envelope.data?.["explain"] as Record<string, unknown>;
      const stanza = (explain["exception_stanzas"] as { rule: string; digest: string }[])[0];
      assert.notEqual(stanza, undefined);
      writeFileSync(
        join(tmp, "wiki/Folk/Alpha.md"),
        LEGACY.replace(
          "tags: [folk]",
          `tags: [folk]\nexceptions:\n  - rule: ${stanza?.rule}\n    digest: "${stanza?.digest}"\n    reason: deliberate for this page`,
        ),
      );
      const after = run(tmp, ["lint", "--all"]);
      const excepted = (summary(after.envelope) as unknown as { excepted: Record<string, number> })
        .excepted;
      assert.equal(
        excepted[stanza?.rule ?? ""],
        1,
        JSON.stringify(after.envelope.data?.["summary"]),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("lint --since replays commit pairs (docs/cli.md §lint --since, replay absorbed)", () => {
  it("walks the pairs under the constitution at each commit, and under today's", () => {
    const tmp = ratchetedVault();
    try {
      const root = git(tmp, "rev-parse", "HEAD").trim();
      // A REGISTERED category, so the transition arm has a class to judge.
      writeFileSync(
        join(tmp, "wiki/Folk/Beta.md"),
        BETA.replace("- [identity] Beta is a person (stated 2026-01-01)\n", ""),
      );
      git(tmp, "add", "-A");
      git(tmp, "commit", "-q", "-m", "remove a claim");

      const replay = run(tmp, ["lint", "--since", root]);
      assert.equal(replay.status, 0, JSON.stringify(replay.envelope));
      const commits = replay.envelope.data?.["commits"] as Record<string, unknown>[];
      assert.equal(commits.length, 2, "the walk includes the root commit's own pair");
      const totals = replay.envelope.data?.["totals"] as Record<string, number>;
      assert.equal((totals["blocked"] ?? 0) >= 1, true, "the removal blocks its own commit");
      // The replay answers with the standard `summary` block.
      const summary = replay.envelope.data?.["summary"] as {
        pages: number;
        errors: number;
        by_rule: Record<string, number>;
        unevaluated: number;
      };
      assert.equal((summary.by_rule["claims-transition"] ?? 0) >= 1, true);
      assert.equal(summary.errors, totals["errors"]);
      assert.equal(summary.pages > 0, true, "distinct pages judged across the pairs");
      assert.equal(replay.envelope.data?.["by_rule"], undefined, "one reader, one block");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("--path filters on every judging verb (docs/concepts.md §Findings and routing)", () => {
  it("lint --path scopes the findings without --stdin", () => {
    const tmp = lawVault();
    try {
      writeFileSync(
        join(tmp, "wiki/Folk/Ana.md"),
        ANA.replace("- knows [[Bob]]", "- knows [[Nobody Here]]"),
      );
      writeFileSync(
        join(tmp, "wiki/Folk/Bob.md"),
        BOB.replace("- knows [[Ana]]", "- knows [[Nobody Else]]"),
      );
      const all = run(tmp, ["lint", "--all"]);
      const paths = new Set(findings(all.envelope).map((f) => f.path));
      assert.equal(paths.size > 1, true, "the fixture fires on more than one page");

      const scoped = run(tmp, ["lint", "--all", "--path", "wiki/Folk/Ana.md"]);
      assert.equal(findings(scoped.envelope).length > 0, true, "and the flag is not a black hole");
      assert.deepEqual(
        [...new Set(findings(scoped.envelope).map((f) => f.path))],
        ["wiki/Folk/Ana.md"],
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("check --path and gate --path are accepted, not `invalid-arguments`", () => {
    const tmp = lawVault();
    try {
      writeFileSync(
        join(tmp, "wiki/Folk/Ana.md"),
        ANA.replace("- knows [[Bob]]", "- knows [[Nobody Here]]"),
      );
      git(tmp, "add", "-A");
      for (const verb of ["check", "gate"]) {
        const r = run(tmp, [verb, "--all", "--path", "wiki/Folk/Ana.md"]);
        assert.notEqual(
          r.envelope.error?.code,
          "invalid-arguments",
          `${verb} --path: ${JSON.stringify(r.envelope.error)}`,
        );
        for (const f of findings(r.envelope)) {
          assert.equal(f.path, "wiki/Folk/Ana.md", `${verb} --path did not scope`);
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("a path is NFC at every constructor (docs/architecture.md §How a verdict is produced)", () => {
  it("an NFD --path over the same page does not judge it twice", () => {
    const tmp = lawVault();
    try {
      const nfc = "wiki/Folk/Café.md".normalize("NFC");
      const nfd = nfc.normalize("NFD");
      assert.notEqual(nfc, nfd, "the fixture is actually two byte sequences");
      writeFileSync(
        join(tmp, nfc),
        person("Café", ["- [identity] Café is a person (stated 2026-01-01)"], ["- knows [[Ana]]"]),
      );
      const r = run(tmp, ["lint", "--all", "--page", nfd]);
      assert.equal(
        findings(r.envelope).some((f) => f.ruleId === "identity-collision"),
        false,
        "a page does not collide with itself",
      );
      assert.equal(summary(r.envelope)["pages"], 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
