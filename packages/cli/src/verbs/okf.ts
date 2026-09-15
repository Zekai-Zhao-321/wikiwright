// docs/concepts.md · docs/cli.md §okf (base-OKF conformance as its own verdict — the
// constitution's stricter bar never contaminates it). The pass is the kernel's
// (`checkOkfCore`); this verb collects the pages, runs it, routes and prints.

import { checkOkfCore, routeFindings } from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { lawFor, rootsOf } from "../law.ts";
import { collectPages, sortFindings, summarize } from "../pages.ts";
import type { CommandSpec } from "../spec.ts";
import { loadVault, walkPages } from "../vaultio.ts";

export const okfCommand: CommandSpec = {
  name: "okf",
  role: "consumer",
  summary: "Base-OKF conformance as its own verdict, independent of the constitution.",
  positionals: [{ name: "subcommand", required: true }],
  subcommands: ["check"],
  flags: [],
  examples: ["wikiwright okf check"],
  writes: false,
  needsVaultModules: true,
  run: (args) => {
    const vault = loadVault("okf", args.root);
    if (!vault.ok) return vault.result;
    const pages = collectPages(args.root, walkPages(args.root, rootsOf(vault)));
    const findings = sortFindings(checkOkfCore(pages));
    // docs/concepts.md §Findings and routing: base OKF is a narrower LAW, not a narrower
    // envelope — `okf-missing-type` reaches an agent with a lane like every
    // other finding.
    const routed = routeFindings(findings, lawFor(vault), pages);
    const summary = summarize(routed, pages.length);
    const verdict = summary.errors > 0 ? "fail" : "pass";
    const data = { findings: routed, summary, verdict, layer: "okf-core" };
    if (summary.errors > 0) {
      return fail("okf", "findings", "findings", `${summary.errors} okf-core error finding(s)`, {
        data,
      });
    }
    return ok("okf", data);
  },
};
