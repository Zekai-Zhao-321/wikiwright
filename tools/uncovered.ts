// docs/extending.md §The code kit: which top-level directories under a source
// root no anchored page reaches — the code the wiki has not read. A bundle
// script over the pages' `covers`, not a verb: the engine measures a pin
// against its origin (`wikiwright freshness`) and never asks what a bundle
// has left undescribed, because "undescribed" is a question about the
// repository beside the vault, which a verb over the vault does not see.
//
// Run: `bun tools/uncovered.ts` (the engine's own devwiki over the default root,
// every package's `src`),
// or `bun tools/uncovered.ts --vault <dir> --root <dir>` (`--root` repeatable;
// one `*` segment is expanded against the directory it sits in). Prints one
// line per unreached directory and a count per root; exits 0 either way — a
// report, never a gate.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codeUnitCompare, parseDoc } from "../packages/core/src/index.ts";

const REPO = fileURLToPath(new URL("../", import.meta.url));

interface Options {
  vault: string;
  roots: string[];
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { vault: "devwiki", roots: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag === "--vault" || flag === "--root") && value === undefined) {
      throw new Error(`${flag} takes a directory`);
    }
    if (flag === "--vault" && value !== undefined) {
      options.vault = value;
      i += 1;
    } else if (flag === "--root" && value !== undefined) {
      options.roots.push(value);
      i += 1;
    } else {
      throw new Error(`unknown argument "${String(flag)}": use --vault <dir> and --root <dir>`);
    }
  }
  if (options.roots.length === 0) options.roots.push("packages/*/src");
  return options;
}

/** A root pattern against the repository: the directories its one `*` segment matches, in code-unit order. */
function expandRoot(pattern: string): string[] {
  const segments = pattern.split("/");
  const star = segments.indexOf("*");
  if (star === -1) return existsSync(join(REPO, pattern)) ? [pattern] : [];
  const base = segments.slice(0, star).join("/");
  const rest = segments.slice(star + 1).join("/");
  const baseAbs = join(REPO, base);
  if (!existsSync(baseAbs)) return [];
  return readdirSync(baseAbs, { withFileTypes: true, encoding: "utf8" })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [base, entry.name, rest].filter((s) => s.length > 0).join("/"))
    .filter((dir) => existsSync(join(REPO, dir)))
    .sort(codeUnitCompare);
}

/** Every `covers` path the vault's pages carry, repository-relative, without a trailing slash. */
function coversOf(vault: string): string[] {
  const engine = JSON.parse(readFileSync(join(vault, "config", "engine.json"), "utf8")) as {
    content_roots?: string[];
  };
  const covers = new Set<string>();
  for (const contentRoot of engine.content_roots ?? []) {
    const dir = join(vault, contentRoot);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (!entry.endsWith(".md")) continue;
      const doc = parseDoc(readFileSync(join(dir, entry), "utf8"));
      const listed = doc.frontmatter.value["covers"];
      if (!Array.isArray(listed)) continue;
      for (const path of listed) {
        if (typeof path === "string" && path.length > 0) covers.add(path.replace(/\/+$/u, ""));
      }
    }
  }
  return [...covers].sort(codeUnitCompare);
}

/** A directory is reached when a covers path is the directory, an ancestor of it, or inside it. */
function reached(dir: string, covers: readonly string[]): boolean {
  return covers.some(
    (path) => path === dir || dir.startsWith(`${path}/`) || path.startsWith(`${dir}/`),
  );
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const vault = resolve(REPO, options.vault);
  const covers = coversOf(vault);
  const lines: string[] = [];
  for (const pattern of options.roots) {
    for (const root of expandRoot(pattern)) {
      const abs = join(REPO, root);
      if (!statSync(abs).isDirectory()) continue;
      const directories = readdirSync(abs, { withFileTypes: true, encoding: "utf8" })
        .filter((entry) => entry.isDirectory())
        .map((entry) => relative(REPO, join(abs, entry.name)).replaceAll("\\", "/"))
        .sort(codeUnitCompare);
      const unreached = directories.filter((dir) => !reached(dir, covers));
      lines.push(
        `${root}: ${unreached.length} of ${directories.length} top-level directories reached by no page's covers`,
        ...unreached.map((dir) => `  ${dir}`),
      );
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
