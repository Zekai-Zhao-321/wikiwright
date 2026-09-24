// docs/cli.md §bundles (every bundle skill the skill directories hold, as
// `--bundle` would find it) · docs/concepts.md §A copy.
//
// A consumer verb that reads markers and writes nothing: one directory listing
// per skill directory, one marker and one SKILL.md frontmatter per directory
// that holds a marker. It loads no law, executes no kit and hashes no page:
// the digests a row carries are the marker's.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parseDoc } from "@wikiwright/core";
import { type Candidate, identityOf, scanAll } from "../discovery.ts";
import { ok } from "../envelope.ts";
import { SKILL_PATH } from "../exports.ts";
import type { CommandSpec } from "../spec.ts";

/** The frontmatter keys the engine's SKILL.md renderer writes; any other key is an installer's. */
const GENERATED_KEYS: ReadonlySet<string> = new Set(["name", "description", "license", "metadata"]);

/**
 * docs/cli.md §bundles: what an installer wrote into a copy's SKILL.md
 * frontmatter, whatever it calls it — every key outside the generated set,
 * each value as a string. None when there is no SKILL.md or it holds none.
 */
function provenanceOf(root: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(join(root, SKILL_PATH), "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  const value = parseDoc(text).frontmatter.value;
  for (const [key, entry] of Object.entries(value)) {
    if (GENERATED_KEYS.has(key)) continue;
    out[key] = typeof entry === "string" ? entry : JSON.stringify(entry);
  }
  return out;
}

function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * For every candidate the root `--bundle <its name>` would choose instead, or
 * null: null for the one it chooses, and for every candidate of a name two
 * different bundles answer, which `--bundle` refuses as ambiguous.
 */
function shadowing(candidates: readonly Candidate[]): Map<Candidate, string | null> {
  const out = new Map<Candidate, string | null>();
  const byName = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    byName.set(candidate.name, [...(byName.get(candidate.name) ?? []), candidate]);
  }
  for (const group of byName.values()) {
    const [first] = group;
    const ambiguous = group.some(
      (c) => c.realpath !== first?.realpath && identityOf(c) !== identityOf(first as Candidate),
    );
    for (const candidate of group) {
      out.set(candidate, ambiguous || candidate === first ? null : (first?.root ?? null));
    }
  }
  return out;
}

export const bundlesCommand: CommandSpec = {
  name: "bundles",
  role: "consumer",
  summary:
    "List every bundle skill installed in the skill directories, as --bundle finds them, with its identity and what its installer recorded.",
  positionals: [{ name: "subcommand", required: true }],
  subcommands: ["list"],
  flags: [],
  examples: ["wikiwright bundles list"],
  writes: false,
  needsVaultModules: false,
  run: () => {
    const { candidates, skipped } = scanAll();
    const shadowedBy = shadowing(candidates);
    const rows = [
      ...candidates.map((c) => ({
        name: c.name,
        bundle: c.marker.bundle,
        tier: c.tier,
        root: c.root,
        realpath: c.realpath,
        linked: c.linked,
        source: {
          repository: c.marker.source.repository,
          law: c.marker.source.law,
          content: c.marker.source.content,
        },
        select: c.marker.select,
        pages: c.marker.pages,
        contribution: c.marker.contribution,
        provenance: provenanceOf(c.root),
        shadowed_by: shadowedBy.get(c) ?? null,
      })),
      ...skipped.map((s) => ({
        name: s.name,
        tier: s.tier,
        root: s.root,
        realpath: realOf(s.root),
        linked: s.linked,
        code: "export-marker-invalid",
        reason: s.reason,
      })),
    ];
    return ok("bundles", { bundles: rows });
  },
};
