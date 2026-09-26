import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanBundles, cli, gardenBundle } from "./fixtures/garden-cli.ts";

const made: string[] = [];
afterAll(() => {
  cleanBundles();
  for (const path of made) rmSync(path, { recursive: true, force: true });
});

describe("check --summary", () => {
  it("keeps the verdict and saves the selected uncapped report from the same run", () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < 56; i += 1) {
      extra[`wiki/Unknown-${String(i).padStart(2, "0")}.md`] =
        `---\ntype: missing-type\ntitle: Unknown-${i}\n---\n\n# Unknown-${i}\n`;
    }
    const dir = gardenBundle(extra);
    const destination = mkdtempSync(join(tmpdir(), "ww-summary-report-"));
    made.push(destination);
    const out = join(destination, "report.json");
    const plain = cli(["check", "--rule", "type-unknown"], dir);
    expect(plain.status).toBe(5);
    expect(plain.envelope.data?.["findings"]).toHaveLength(50);
    const compact = cli(["check", "--rule", "type-unknown", "--summary", "--out", out], dir);
    expect(compact.status).toBe(plain.status);
    expect(compact.envelope.ok).toBe(false);
    expect(compact.envelope.error?.code).toBe(plain.envelope.error?.code);
    expect(compact.envelope.data?.["findings"]).toBeUndefined();
    expect(compact.envelope.data?.["summary"]).toEqual(plain.envelope.data?.["summary"]);
    expect(compact.envelope.data?.["scope"]).toBeDefined();
    expect(compact.envelope.data?.["unevaluated"]).toBeDefined();
    expect(compact.envelope.data?.["pins"]).toMatchObject({ counts: expect.any(Object) });
    expect(compact.envelope.data?.["pins"]).toMatchObject({
      citations: { checked: 0, outside_scope: 0 },
    });
    const report = JSON.parse(readFileSync(out, "utf8")) as typeof compact.envelope;
    expect(report.data?.["findings"]).toHaveLength(56);
    expect((report.data?.["caps"] as { hit: boolean } | undefined)?.hit).toBe(false);
    expect(report.data?.["summary"]).toEqual(compact.envelope.data?.["summary"]);
    expect(compact.envelope.data?.["report"]).toMatchObject({ out: realpathSync(out) });
    expect(cli(["check", "--summary", "--limit", "2"], dir).envelope.error?.code).toBe(
      "summary-limit-conflict",
    );
  }, 15_000);

  it("preserves the detailed dry-run plan", () => {
    const dir = gardenBundle();
    const result = cli(["check", "--write", "--dry-run", "--summary"], dir);
    expect(result.status).toBe(0);
    expect(result.envelope.data?.["ops"]).toBeDefined();
    expect(result.envelope.data?.["summary"]).toBeUndefined();
  });

  it("reports generated writes in a compact executed check", () => {
    const dir = gardenBundle();
    const result = cli(["check", "--write", "--summary"], dir);
    expect(result.status).toBe(0);
    expect(result.envelope.data?.["findings"]).toBeUndefined();
    expect(result.envelope.data?.["fixed_count"]).toBe(0);
    expect(
      (result.envelope.data?.["generated"] as { written: string[] } | undefined)?.written,
    ).toContain("generated/BRIEF.md");
  });
});
