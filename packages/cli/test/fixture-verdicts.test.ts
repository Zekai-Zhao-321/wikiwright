// docs/architecture.md §The invariants (every shipped fixture's EXACT finding set
// is asserted — two fixtures carry deliberate defects, and a deliberate defect
// nothing checks is indistinguishable from rot; the handbooks carry none, so a
// finding of any severity there is rot) · docs/constitution.md §Sections (the
// planted `### Timeline` is `section-depth`'s first measurement: 1 firing
// across 40 pages).

import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { corpusCopy, REPO, removeCopies } from "./fixtures/corpora.ts";
import { cli, type Envelope, git } from "./fixtures/garden-cli.ts";

// v2 contracts §12 step 5: the corpora migrated onto the v2 law, judged by
// the v2 `check` where they stand and by the v2 `gate` over a copy whose
// every file is staged. A corpus's verdict is the exact set of its
// deliberate defects; `unevaluated` (info, no route) is the transition
// rules a working tree cannot evaluate.

afterAll(removeCopies);

/** A shallow checkout's history may not reach a pin, which is then not measured. */
const SHALLOW = git(REPO, "rev-parse", "--is-shallow-repository").trim() === "true";

type Row = [rule: string, severity: string, path: string];

function rows(envelope: Envelope, severities: readonly string[]): Row[] {
  return (envelope.data?.findings ?? [])
    .filter((f) => severities.includes(f.severity))
    .map((f): Row => [f.rule, f.severity, f.path])
    .sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
}

interface Expected {
  pages: number;
  /** Every error and warning finding, sorted, but those of `live`. */
  findings: Row[];
  /** Every rule `unevaluated` names, and how many pages it names it on. */
  unevaluated: Record<string, number>;
  /**
   * Warnings measured live against the repository the corpus sits in (a
   * stale pin and the pages that link one): they change with every commit
   * that touches a covered path, so their rules are held, not their count.
   * `pin-unknown` and `citation-unresolved` are not among them: each
   * depends only on a page's bytes and its pin's commit, so each is held
   * at the count `findings` gives it.
   */
  live?: string[];
  /**
   * How many pins the corpus carries, every one measured unless the
   * checkout is a shallow clone whose history does not reach it.
   */
  pins?: number;
}

const V2_VERDICTS: Record<string, Expected> = {
  // The engine's own bundle carries no defect. Its pins are measured against
  // this repository, so a covered path changed since a pin is `pin-stale`
  // on the page and `stale-source-cited` on every page that links it, until
  // the documentation step re-reads and re-pins them. Every pin is on
  // HEAD's history and every citation stands at its pin.
  devwiki: {
    pages: 36,
    findings: [],
    unevaluated: { "body-append-only": 8, "entry-edited": 27, "relation-removed": 27 },
    live: ["pin-stale", "stale-source-cited"],
    pins: 27,
  },
  // A handbook carries no defect: a finding of any severity is rot. Its
  // `source-host-allowed` rule holds the page that names a source.
  "fixtures/handbooks/orchard": { pages: 3, findings: [], unevaluated: {} },
  // Its `history-dated` rule holds the History of the page that has one;
  // History is append-only, which a working tree cannot evaluate.
  "fixtures/handbooks/allotment": { pages: 3, findings: [], unevaluated: { "entry-edited": 2 } },
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
      const live = new Set(expected.live ?? []);
      const judged = rows(r.envelope, ["error", "warning"]);
      expect(judged.filter(([rule]) => !live.has(rule))).toEqual(expected.findings);
      expect(judged.filter(([rule, severity]) => live.has(rule) && severity !== "warning")).toEqual(
        [],
      );
      const unevaluated = r.envelope.data?.["unevaluated"] as Record<string, { count: number }>;
      expect(
        Object.fromEntries(Object.entries(unevaluated).map(([rule, u]) => [rule, u.count])),
      ).toEqual(expected.unevaluated);
      if (expected.pins !== undefined) {
        const pins = r.envelope.data?.["pins"] as
          | { entries: unknown[]; counts: Record<string, number> }
          | undefined;
        expect(pins?.entries.length).toBe(expected.pins);
        if (!SHALLOW) expect(pins?.counts["unmeasured"]).toBe(0);
      }
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
