// docs/cli.md §search (--near, the banded result fields, the coverage block)
// docs/concepts.md §Generated artifacts (bigram-capable
// CJK search, day one)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/minimal-vault", import.meta.url));

function run(cwd: string, args: string[]): { status: number; envelope: Record<string, unknown> } {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", "."], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, envelope: JSON.parse(r.stdout) as Record<string, unknown> };
}

function vault(): string {
  const tmp = mkdtempSync(join(tmpdir(), "ww-retrieval-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  writeFileSync(
    join(tmp, "wiki/张伟.md"),
    '---\ntype: concept\ntitle: 张伟\ndescription: A colleague who owns the reset rigs.\naliases: ["Zhang Wei"]\ntags: []\n---\n\n# 张伟\n\n## 职责\n\nOwns [[warm-reset]].\n',
  );
  return tmp;
}

interface SearchData {
  results: Array<{
    path: string;
    score: number;
    band: string;
    ladder_score: number;
    match_reasons: string[];
  }>;
  near?: Array<{ path: string; name: string; score: number; why: string[] }>;
  coverage: {
    tiers_executed: string[];
    corpus_size: number;
    tokenization: string;
    fusion: { method: string; k: number; lists: string[] };
    caps: { limit: number; found: number; hit: boolean; near_limit?: number; near_hit?: boolean };
  };
}

describe("search answers multi-token queries in both scripts", () => {
  it("finds a page whose query tokens are not contiguous in the text", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["search", "warm reset recovery"]);
      assert.equal(r.status, 0);
      const data = r.envelope["data"] as SearchData;
      assert.equal(
        data.results.some((x) => x.path.endsWith("warm-reset.md")),
        true,
        "the old substring matcher returned nothing here",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds a CJK page from a query whose characters are separated in the text", () => {
    const tmp = vault();
    try {
      const data = run(tmp, ["search", "热重启恢复"]).envelope["data"] as SearchData;
      assert.equal(
        data.results.some((x) => x.path.endsWith("热重启.md")),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("carries the banded result fields and the fusion coverage block", () => {
    const tmp = vault();
    try {
      const data = run(tmp, ["search", "张伟"]).envelope["data"] as SearchData;
      assert.equal(data.results[0]?.path, "wiki/张伟.md");
      assert.equal(data.results[0]?.band, "identity");
      assert.equal(data.results[0]?.match_reasons.includes("name:exact"), true);
      assert.equal(data.coverage.tokenization, "latin-word + cjk-unigram+bigram, NFC casefold");
      assert.equal(data.coverage.tiers_executed.includes("lexical:bm25"), true);
      assert.deepEqual(data.coverage.fusion, {
        method: "rrf",
        k: 60,
        lists: ["ladder", "lexical:bm25"],
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("search --near — the advisory candidate list (docs/cli.md §search)", () => {
  it("returns candidates with why strings and adds name:near to the coverage block", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["search", "Wei Zhang", "--near"]);
      assert.equal(r.status, 0);
      const data = r.envelope["data"] as SearchData;
      assert.equal(data.coverage.tiers_executed.includes("name:near"), true);
      const hit = (data.near ?? []).find((c) => c.path === "wiki/张伟.md");
      assert.notEqual(hit, undefined, "the reversed-order form reaches its page as a candidate");
      assert.equal(hit?.why.includes("token-set:equal"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("omits the near block, and the tier, without the flag", () => {
    const tmp = vault();
    try {
      const data = run(tmp, ["search", "Wei Zhang"]).envelope["data"] as SearchData;
      assert.equal(data.near, undefined);
      assert.equal(data.coverage.tiers_executed.includes("name:near"), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("caps sizes the answer it capped (docs/concepts.md §Generated artifacts)", () => {
  it("carries found — the pre-cap count — beside limit and hit", () => {
    const tmp = vault();
    try {
      const full = run(tmp, ["search", "reset"]).envelope["data"] as SearchData;
      assert.ok(full.results.length > 1, "the fixture must match more than one page");
      assert.equal(
        full.coverage.caps.found,
        full.results.length,
        "uncapped: found is what printed",
      );
      assert.equal(full.coverage.caps.hit, false);
      const capped = run(tmp, ["search", "reset", "--limit", "1"]).envelope["data"] as SearchData;
      assert.equal(capped.results.length, 1);
      assert.equal(capped.coverage.caps.limit, 1);
      assert.equal(capped.coverage.caps.found, full.results.length, "the corpus, not the flag");
      assert.equal(capped.coverage.caps.hit, true, "found > limit");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("a query-less search never claims a tier it did not run (docs/concepts.md §Generated artifacts)", () => {
  it("reports tiers_executed [filter] for a filters-only invocation", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["search", "--tag", "reset"]);
      assert.equal(r.status, 0);
      const data = r.envelope["data"] as SearchData;
      assert.deepEqual(data.coverage.tiers_executed, ["filter"]);
      assert.deepEqual(data.coverage.fusion, { method: "rrf", k: 60, lists: ["ladder"] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("omits name:near from a query-less --near invocation, as the near block is", () => {
    const tmp = vault();
    try {
      const data = run(tmp, ["search", "--tag", "reset", "--near"]).envelope["data"] as SearchData;
      assert.equal(data.coverage.tiers_executed.includes("name:near"), false);
      assert.equal(data.near, undefined);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("an empty query string is not a query (docs/cli.md §search)", () => {
  it("fails missing-argument exactly as a bare search does", () => {
    const tmp = vault();
    try {
      const bare = run(tmp, ["search"]);
      const empty = run(tmp, ["search", ""]);
      assert.notEqual(empty.status, 0);
      assert.equal(empty.status, bare.status);
      const error = empty.envelope["error"] as { code?: string } | undefined;
      assert.equal(error?.code, "missing-argument");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("is the filter-only invocation when a filter is given, not a nine-tier search", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["search", "", "--tag", "reset"]);
      assert.equal(r.status, 0);
      const data = r.envelope["data"] as SearchData;
      assert.deepEqual(data.coverage.tiers_executed, ["filter"]);
      for (const result of data.results) {
        // Membership, then the one fused list's rank — and no tier (docs/cli.md §search).
        assert.equal(result.match_reasons.length, 2);
        assert.equal(result.match_reasons[0], "filter:match");
        assert.match(result.match_reasons[1] ?? "", /^rrf:ladder#\d+$/);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("--near carries its own cap through the envelope (docs/concepts.md §Generated artifacts)", () => {
  it("reports near_limit and near_hit only under --near", () => {
    const tmp = vault();
    try {
      const withNear = run(tmp, ["search", "ZhangWei", "--near", "--limit", "1"]);
      assert.equal(withNear.status, 0);
      const near = (withNear.envelope["data"] as SearchData).coverage.caps;
      assert.equal(near.near_limit, 20);
      assert.equal(near.near_hit, false);
      const plain = (run(tmp, ["search", "ZhangWei"]).envelope["data"] as SearchData).coverage.caps;
      assert.equal("near_limit" in plain, false);
      assert.equal("near_hit" in plain, false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps the candidate list past --limit — the guard is not a display", () => {
    const tmp = vault();
    try {
      const one = run(tmp, ["search", "ZhangWei", "--near", "--limit", "1"]);
      const data = one.envelope["data"] as SearchData;
      assert.equal(data.results.length <= 1, true);
      assert.ok(
        (data.near?.length ?? 0) >= 1,
        "the alias page stays a candidate however small --limit is",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
