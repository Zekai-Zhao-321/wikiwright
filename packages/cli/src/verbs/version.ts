// docs/cli.md §version (the engine version and the commit
// this binary was BUILT from, beside the checkout it sits in) · docs/architecture.md §Directories.

import { checkoutIdentity, readBuildInfo, versionData } from "../buildinfo.ts";
import { ENGINE_VERSION, ok } from "../envelope.ts";
import type { CommandSpec } from "../spec.ts";

export const versionCommand: CommandSpec = {
  name: "version",
  role: "consumer",
  summary:
    "Report the engine version and the commit this binary was BUILT from (--version / -v alias it).",
  positionals: [],
  flags: [],
  examples: ["wikiwright version", "wikiwright --version"],
  // `commit` is the build's, from the stamped artifact; the
  // checkout the package sits in is a real but different question, kept beside
  // it under the name that says which one it is.
  writes: false,
  needsVaultModules: false,
  run: () => ok("version", versionData(readBuildInfo(), checkoutIdentity(), ENGINE_VERSION)),
};
