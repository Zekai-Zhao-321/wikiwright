// The compiled binary a test runs: built through the `binary` script's own
// tool (`tools/build-binary.ts`) at a path the test chooses under
// os.tmpdir(), never the ignored `dist/wikiwright` a developer may have left,
// so every run probes the binary of the code under test.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../../packages/cli/test/fixtures/runtime.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const TOOL = join(REPO, "tools", "build-binary.ts");

/** Build the binary at `outfile`, or throw with the compiler's report. */
export function buildBinary(outfile: string): void {
  const built = runCli([TOOL, "--outfile", outfile], { cwd: REPO, encoding: "utf8" });
  if (built.status !== 0 || !existsSync(outfile)) {
    throw new Error(`the binary did not build: ${built.stdout}${built.stderr}`);
  }
}
