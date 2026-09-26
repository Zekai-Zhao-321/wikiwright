// docs/architecture.md §The invariants (every shipped fixture's EXACT finding set
// is asserted — both fixtures carry deliberate defects, and a deliberate defect
// nothing checks is indistinguishable from rot) · docs/constitution.md §Sections (the planted
// `### Timeline` is `section-depth`'s first measurement: 1 firing across 40
// pages).

import { afterAll, describe, expect, it } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusCopy, REPO, removeCopies } from "./fixtures/corpora.ts";
import { cli, type Envelope, git } from "./fixtures/garden-cli.ts";
import { runCli } from "./fixtures/runtime.ts";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

interface Finding {
  ruleId: string;
  severity: string;
  path: string;
}

interface Verdict {
  status: number;
  findings: Finding[];
  summary: Record<string, unknown>;
}

function lint(fixture: string, verb: "lint" | "check" = "lint"): Verdict {
  const r = runCli([CLI, verb, "--all", "--root", `${FIXTURES}${fixture}`], {
    encoding: "utf8",
  });
  const envelope = JSON.parse(r.stdout) as {
    data?: { findings?: Finding[]; summary?: Record<string, unknown> };
  };
  return {
    status: r.status ?? -1,
    findings: envelope.data?.findings ?? [],
    summary: envelope.data?.summary ?? {},
  };
}

describe("the shipped fixtures lint to the verdict the spec records (docs/architecture.md §The invariants)", () => {
  // docs/cli.md §bundles: the two handbooks the connection tests read, each one
  // type with a required climate and the same page under the same title. They
  // carry no defect, so a finding of any severity is rot; `check` holds their
  // tracked generated/ too.
  for (const handbook of ["handbooks/allotment"]) {
    it(`${handbook}: three pages and no finding of any severity, under lint and check`, () => {
      for (const verb of ["lint", "check"] as const) {
        const v = lint(handbook, verb);
        assert.equal(v.summary["pages"], 3, verb);
        assert.deepEqual(v.findings, [], `${handbook} under ${verb}`);
        assert.equal(v.status, 0, verb);
      }
    });
  }
});

// v2 contracts §12 step 5: the corpora migrated onto the v2 law, judged by
// the v2 `check` where they stand and by the v2 `gate` over a copy whose
// every file is staged. A corpus's verdict is the exact set of its
// deliberate defects; `unevaluated` (info, no route) is the transition
// rules a working tree cannot evaluate.

afterAll(removeCopies);

type Row = [rule: string, severity: string, path: string];

function rows(envelope: Envelope, severities: readonly string[]): Row[] {
  return (envelope.data?.findings ?? [])
    .filter((f) => severities.includes(f.severity))
    .map((f): Row => [f.rule, f.severity, f.path])
    .sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
}

interface Expected {
  pages: number;
  /** Every error and warning finding, sorted. */
  findings: Row[];
  /** Every rule `unevaluated` names, and how many pages it names it on. */
  unevaluated: Record<string, number>;
}

const V2_VERDICTS: Record<string, Expected> = {
  // A handbook carries no defect: a finding of any severity is rot. Its
  // `source-host-allowed` rule holds the page that names a source.
  "fixtures/handbooks/orchard": { pages: 3, findings: [], unevaluated: {} },
  // The planted `### Timeline` under `## Notes` is still `section-depth`'s
  // one firing. The migration respelled 98 relations and 52 entries and
  // left nine items no rewrite keeps whole — six undated lines of one
  // day's Timeline, a History line with no date of its own, the relation
  // with no link and the fact with no category planted for the v1 census —
  // and one `status: draft`, which v1 admitted and the reserved `status`
  // (active or retired) does not.
  "fixtures/memory-synth": {
    pages: 41,
    findings: [
      ["item-unparsed", "error", "journal/daily/2031-08-14.md"],
      ["item-unparsed", "error", "journal/daily/2031-08-14.md"],
      ["item-unparsed", "error", "journal/daily/2031-08-14.md"],
      ["item-unparsed", "error", "journal/daily/2031-08-14.md"],
      ["item-unparsed", "error", "journal/daily/2031-08-14.md"],
      ["item-unparsed", "error", "journal/daily/2031-08-14.md"],
      ["item-unparsed", "error", "wiki/Craft/Isle Cadence.md"],
      ["item-unparsed", "error", "wiki/Folk/Guild/Maelis Ostrander.md"],
      ["item-unparsed", "error", "wiki/Folk/Kin/鄢霈珉.md"],
      ["page-shape-invalid", "error", "wiki/Craft/Kiln Jasper.md"],
      ["section-depth", "error", "wiki/Craft/Isle Cadence.md"],
    ],
    unevaluated: { "body-append-only": 6, "claims-transition": 35, "relation-removed": 35 },
  },
  // The one broken case keeps its three defects under the v2 names: an
  // undeclared key, a missing section, a tag the vocabulary does not hold.
  "fixtures/minimal-vault": {
    pages: 3,
    findings: [
      ["page-shape-invalid", "error", "wiki/test-execution/broken-case.md"],
      ["section-count", "error", "wiki/test-execution/broken-case.md"],
      ["vocabulary-unknown", "error", "wiki/test-execution/broken-case.md"],
    ],
    unevaluated: { "body-append-only": 3 },
  },
};

describe("the corpora on the v2 law judge to the verdict recorded here (contracts §12 step 5)", () => {
  for (const [corpus, expected] of Object.entries(V2_VERDICTS)) {
    it(`${corpus}: check --all where it stands`, () => {
      const r = cli(["check", "--all"], join(REPO, corpus));
      expect(r.envelope.data?.summary).toMatchObject({ pages: expected.pages });
      expect(rows(r.envelope, ["error", "warning"])).toEqual(expected.findings);
      const unevaluated = r.envelope.data?.["unevaluated"] as Record<string, { count: number }>;
      expect(
        Object.fromEntries(Object.entries(unevaluated).map(([rule, u]) => [rule, u.count])),
      ).toEqual(expected.unevaluated);
      const errors = expected.findings.filter(([, severity]) => severity === "error").length;
      expect(r.status).toBe(errors > 0 ? 5 : 0);
    });

    it(`${corpus}: gate over a copy with every file staged gives the same errors`, () => {
      const { root, top } = corpusCopy(corpus);
      git(top, "add", "-A");
      const r = cli(["gate"], root);
      expect(rows(r.envelope, ["error"])).toEqual(
        expected.findings.filter(([, severity]) => severity === "error"),
      );
      expect(r.status).toBe(expected.findings.some(([, s]) => s === "error") ? 5 : 0);
    });
  }
});
