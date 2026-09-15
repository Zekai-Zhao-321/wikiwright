// docs/concepts.md (base-OKF conformance as its own layered verdict —
// "OKF-clean even where our own bar fails" is a computable sentence; layers never
// rescue each other) · docs/cli.md
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
  const tmp = mkdtempSync(join(tmpdir(), "ww-okf-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  rmSync(join(tmp, "wiki/test-execution/broken-case.md"));
  return tmp;
}

function data(envelope: Record<string, unknown>): Record<string, unknown> {
  return (envelope["data"] as Record<string, unknown> | undefined) ?? {};
}

describe("okf check: the base-OKF layer, independent of the constitution", () => {
  it("a page with an unregistered type fails lint but passes okf check — layers never rescue or contaminate", () => {
    const tmp = vault();
    try {
      writeFileSync(
        join(tmp, "wiki", "foreign.md"),
        "---\ntype: some-unregistered-type\ntitle: Foreign page\ndescription: d.\ntags: []\n---\n\n# Foreign page\n",
      );
      const lint = run(tmp, ["lint"]);
      assert.equal(lint.status, 5, "the constitution's bar fails");

      const okf = run(tmp, ["okf", "check"]);
      assert.equal(okf.status, 0, "base OKF is satisfied: type is a producer-defined string");
      assert.equal(data(okf.envelope)["verdict"], "pass");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a page without a type fails okf check with an okf-core finding", () => {
    const tmp = vault();
    try {
      writeFileSync(
        join(tmp, "wiki", "untyped.md"),
        "---\ntitle: Untyped\ndescription: d.\ntags: []\n---\n\n# Untyped\n",
      );
      const okf = run(tmp, ["okf", "check"]);
      assert.equal(okf.status, 5);
      assert.equal(data(okf.envelope)["verdict"], "fail");
      const findings = (data(okf.envelope)["findings"] as Array<Record<string, unknown>>) ?? [];
      const f = findings.find((x) => x["ruleId"] === "okf-missing-type");
      assert.equal(f?.["layer"], "okf-core");
      assert.equal(f?.["path"], "wiki/untyped.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("okf check reports only okf-core findings — constitution findings never appear", () => {
    const tmp = vault();
    try {
      writeFileSync(
        join(tmp, "wiki", "foreign.md"),
        "---\ntype: some-unregistered-type\ntitle: Foreign page\ndescription: d.\ntags: []\n---\n\n# Foreign page\n",
      );
      const okf = run(tmp, ["okf", "check"]);
      const findings = (data(okf.envelope)["findings"] as Array<Record<string, unknown>>) ?? [];
      assert.equal(
        findings.every((f) => f["layer"] === "okf-core"),
        true,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("unknown okf subcommands are usage errors", () => {
    const tmp = vault();
    try {
      const r = run(tmp, ["okf", "export"]);
      assert.equal(r.status, 2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
