import { afterAll, describe, expect, it } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanBundles, cli, commitAll, gardenBundle, git } from "./fixtures/garden-cli.ts";
import { engineJson } from "./fixtures/garden-law.ts";

const made: string[] = [];
afterAll(() => {
  cleanBundles();
  for (const path of made) rmSync(path, { recursive: true, force: true });
});

function repository(): { top: string; bundle: string; imported: string } {
  const source = gardenBundle();
  const top = mkdtempSync(join(tmpdir(), "ww-output-law-"));
  made.push(top);
  const bundle = join(top, "bundle");
  cpSync(source, bundle, { recursive: true });
  cpSync(join(source, "libraries/kit-garden"), join(top, "libraries/kit-garden"), {
    recursive: true,
  });
  cpSync(join(source, "libraries/kit-garden"), join(top, "libraries/kit-alt"), { recursive: true });
  writeFileSync(join(top, "libraries/kit-alt/library.yaml"), "id: garden\n");
  commitAll(top);
  return { top, bundle, imported: join(top, "libraries/kit-alt/types/planting.yaml") };
}

describe("--out ownership from the selected law", () => {
  it("protects staged imports even when the working-tree engine names another library", () => {
    const { top, bundle, imported } = repository();
    const original = readFileSync(imported, "utf8");
    const diskEngine = readFileSync(join(bundle, "config/engine.json"), "utf8");
    writeFileSync(
      join(bundle, "config/engine.json"),
      engineJson({ libraries: [{ path: "libraries/kit-alt" }] }),
    );
    git(top, "add", "bundle/config/engine.json");
    writeFileSync(join(bundle, "config/engine.json"), diskEngine);
    const staged = cli(["gate", "--out", imported], bundle);
    expect(staged.status).toBe(2);
    expect(staged.envelope.error?.code).toBe("out-inside-law");
    expect(readFileSync(imported, "utf8")).toBe(original);

    writeFileSync(imported, "not: a type document\n");
    git(top, "add", "libraries/kit-alt/types/planting.yaml");
    const refusedLaw = cli(["gate", "--out", imported], bundle);
    expect(refusedLaw.status).toBe(2);
    expect(refusedLaw.envelope.error?.code).toBe("out-inside-law");
    expect(readFileSync(imported, "utf8")).toBe("not: a type document\n");
    const help = cli(["gate", "--help", "--out", imported], bundle);
    expect(help.status).toBe(2);
    expect(help.envelope.error?.code).toBe("out-inside-repository");
  });

  it("uses a repository fallback when the working-tree engine cannot name its imports", () => {
    const { bundle, imported } = repository();
    const before = readFileSync(imported, "utf8");
    writeFileSync(join(bundle, "config/engine.json"), "{ broken json\n");
    const result = cli(["check", "--out", imported], bundle);
    expect(result.status).toBe(2);
    expect(result.envelope.error?.code).toBe("out-inside-repository");
    expect(readFileSync(imported, "utf8")).toBe(before);
  });
});
