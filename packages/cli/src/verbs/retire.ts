// docs/cli.md (status + banner + optional successor pointer)
// docs/architecture.md §How a verdict is produced (the frontmatter half goes through the ONE Writer, so the two
// keys it sets are spliced under the same law every other write obeys)
// docs/architecture.md §Directories.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  basenameOf,
  buildNameIndex,
  parseDoc,
  type WriteOp,
  type WritePlan,
} from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { rootsOf } from "../law.ts";
import { collectPages } from "../pages.ts";
import { type CommandArgs, type CommandSpec, isDryRun, type Plan, planOf } from "../spec.ts";
import { loadVault, readPage, walkPages } from "../vaultio.ts";
import { commitWrite, splicePlan, writeOps } from "../writer.ts";

/**
 * docs/cli.md §The dry-run law: retirement is one frontmatter edit on one page, so the
 * plan is one op — and none at all when there is no page to retire, which is
 * the honest answer to "what would this do" for a path that does not exist.
 */
function planForRetire(args: CommandArgs): Plan {
  const [pagePath] = args.positionals;
  if (pagePath === undefined || !existsSync(join(args.root, pagePath))) return planOf([]);
  const successor = args.flags["superseded-by"];
  const successorNote =
    typeof successor === "string" && successor.length > 0 ? `, superseded_by: ${successor}` : "";
  return planOf(
    writeOps(
      pagePath,
      "write",
      `set status: retired${successorNote}, and insert the retirement banner`,
    ),
  );
}

export const retireCommand: CommandSpec = {
  name: "retire",
  role: "maintainer",
  summary: "Standard end-of-life: status retired + banner + optional successor pointer.",
  positionals: [{ name: "page", required: true }],
  flags: [
    { name: "superseded-by", type: "string", summary: "canonical name of the successor page" },
  ],
  examples: ["wikiwright retire wiki/old-model.md --superseded-by new-model"],
  writes: true,
  needsVaultModules: true,
  plan: planForRetire,
  run: (args) => {
    const vault = loadVault("retire", args.root);
    if (!vault.ok) return vault.result;
    const [pagePath] = args.positionals;
    if (pagePath === undefined) {
      return fail("retire", "usage", "missing-argument", "retire requires <page>");
    }
    if (!existsSync(join(args.root, pagePath))) {
      return fail("retire", "not_found", "page-not-found", `no page at "${pagePath}"`);
    }
    // The RAW bytes, not `doc.source`: the parse seam normalizes CRLF and the
    // BOM away for judging, and the Writer's whole promise is that the page's
    // own envelope survives (docs/concepts.md §The judge and its states).
    const raw = readPage(args.root, pagePath);
    const doc = parseDoc(raw);
    if (!doc.frontmatter.present) {
      // Splicing keys into a file with no ---/--- block would corrupt it
      // retirement is a frontmatter edit by definition.
      return fail(
        "retire",
        "conflict",
        "no-frontmatter",
        `"${pagePath}" has no frontmatter block`,
        { hint: "add frontmatter (at minimum a type:) before retiring the page" },
      );
    }
    if (doc.frontmatter.value["status"] === "retired") {
      return fail("retire", "conflict", "already-retired", `"${pagePath}" is already retired`);
    }
    const successor = args.flags["superseded-by"];
    let successorName: string | undefined;
    if (typeof successor === "string") {
      const pages = collectPages(args.root, walkPages(args.root, rootsOf(vault)));
      const entry = buildNameIndex(pages).resolve(successor);
      if (entry === undefined) {
        return fail("retire", "not_found", "unknown-successor", `no page named "${successor}"`);
      }
      successorName = basenameOf(entry.path);
    }

    // docs/architecture.md §How a verdict is produced: the two frontmatter keys and the banner are three ops on
    // the ONE Writer, so a retirement differs from the page only inside the
    // lines it names — and a frontmatter block the parser could not read is a
    // refusal rather than a page with a status wedged into it.
    const ops: WriteOp[] = [{ kind: "frontmatter-set", field: "status", value: "retired" }];
    if (successorName !== undefined) {
      ops.push({ kind: "frontmatter-set", field: "superseded_by", value: successorName });
    }
    const banner =
      successorName !== undefined ? `> Retired. Superseded by [[${successorName}]].` : "> Retired.";
    // After the frontmatter block, which is where the parser says it ends.
    ops.push({ kind: "insert", after: doc.frontmatter.endLine, lines: ["", banner] });
    const plan: WritePlan = { path: pagePath, ops };
    const spliced = splicePlan(raw, plan);
    if (!spliced.ok) {
      return fail("retire", "conflict", "splice-refused", spliced.reason);
    }
    // After the missing page, the missing frontmatter, the already-retired
    // page, the unknown successor and a splice the Writer refuses, and before
    // the write.
    if (isDryRun(args)) return ok("retire", planForRetire(args));
    commitWrite(args.root, pagePath, spliced.spliced.text);
    const data: Record<string, unknown> = { path: pagePath, status: "retired" };
    if (successorName !== undefined) data["superseded_by"] = successorName;
    return ok("retire", data);
  },
};
