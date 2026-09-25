// docs/cli.md §export · docs/constitution.md §exports (an `output: external`
// export is declared here and written into another repository's tree) ·
// docs/cli.md §The dry-run law (the plan names every file written and removed,
// by absolute path, since the destination is not the vault).
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parsedPages, routeFindings } from "@wikiwright/core";
import { exportOps, writeExports } from "../artifacts.ts";
import { bundleLabel } from "../bundle.ts";
import { type CommandResult, fail, ok } from "../envelope.ts";
import {
  type ExportPlan,
  exportPlans,
  fsExportSource,
  PLUGIN_MANIFESTS,
  planExport,
  pluginManifests,
  type RepositoryExports,
  SKILLS_DIR,
} from "../exports.ts";
import { lawFor, rootsOf } from "../law.ts";
import { MARKER_PATH } from "../marker.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";
import { fsState } from "../state.ts";
import { loadVault } from "../vaultio.ts";

/** What an invocation would write, once every refusal before the first write has passed. */
interface Prepared {
  /** The destination root, absolute: the other repository's. */
  destination: string;
  plan: ExportPlan;
  /** The export and the manifests, in the shape the renderer writes. */
  rendered: RepositoryExports;
  ops: PlanOp[];
  findings: ReturnType<typeof routeFindings>;
}

/** Whether `path` or anything under it is a symbolic link; the walk never follows one. */
function linkUnder(path: string): string | undefined {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return undefined;
  }
  if (stat.isSymbolicLink()) return path;
  if (!stat.isDirectory()) return undefined;
  for (const entry of readdirSync(path, { encoding: "utf8" }).sort()) {
    const found = linkUnder(join(path, entry));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The real path of `path`, or of its nearest existing ancestor with the rest appended. */
function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = resolve(path, "..");
    return parent === path ? path : join(realOf(parent), path.slice(parent.length + 1));
  }
}

/**
 * docs/cli.md §export: every refusal the real run would reach before its first
 * write, in the order it reaches them, and otherwise the plan — shared by the
 * run and the dry run, so the two cannot disagree.
 */
function prepare(args: CommandArgs): Prepared | CommandResult {
  const name = args.positionals[0] ?? "";
  const to = args.flags["to"];
  if (typeof to !== "string" || to.length === 0) {
    return fail("export", "usage", "missing-argument", "`export` needs --to <dir>", {
      details: { flag: "to" },
      hint: "--to names the root of the repository the export is written into, as `<dir>/skills/<name>/`",
    });
  }
  const vault = loadVault("export", args.root);
  if (!vault.ok) return vault.result;
  const label = bundleLabel(args.root);
  const declared = exportPlans(vault, label);
  const declaration = declared.find((d) => d.name === name);
  if (declaration === undefined) {
    return fail(
      "export",
      "usage",
      "export-not-declared",
      `config/engine.json declares no export "${name}"`,
      {
        details: { valid_values: declared.map((d) => d.name) },
      },
    );
  }
  if (declaration.output !== "external") {
    return fail(
      "export",
      "usage",
      "export-output-skills",
      `"${name}" is an \`output: skills\` export, rendered into this bundle's own skills/ by \`check --write\``,
      {
        hint: 'declare `"output": "external"` and a repository to write it elsewhere with `export`',
      },
    );
  }
  const destination = isAbsolute(to) ? resolve(to) : resolve(args.root, to);
  let isDirectory = false;
  try {
    isDirectory = statSync(destination).isDirectory();
  } catch {
    // Not there: refused below.
  }
  if (!isDirectory) {
    return fail(
      "export",
      "not_found",
      "directory-not-found",
      `no directory at "${to}" (--to is resolved against --root)`,
      { details: { to, resolved: destination } },
    );
  }
  const bundle = realpathSync(args.root);
  const real = realOf(destination);
  const insideContent = rootsOf(vault).some((root) => {
    const abs = realOf(join(bundle, root));
    return real === abs || real.startsWith(abs + sep);
  });
  if (real === bundle || insideContent) {
    return fail(
      "export",
      "usage",
      "export-destination-inside-bundle",
      real === bundle
        ? `"${to}" is this bundle's own root`
        : `"${to}" lies in one of this bundle's content roots`,
      {
        details: { destination },
        hint: "--to names the root of another repository, outside this bundle's content roots",
      },
    );
  }
  const dir = join(destination, SKILLS_DIR, name);
  const isLinkAt = (path: string): boolean => {
    try {
      return lstatSync(path).isSymbolicLink();
    } catch {
      // Nothing there yet: nothing to be a link.
      return false;
    }
  };
  // Every directory the export writes into, from <dir> down: skills/ and the
  // manifests' own directory, then anything under skills/<name>.
  const owned = [
    join(destination, SKILLS_DIR),
    ...(pluginManifests(vault).length > 0 ? [join(destination, dirname(PLUGIN_MANIFESTS[1]))] : []),
  ];
  let linked = owned.find(isLinkAt);
  linked ??= linkUnder(dir);
  if (linked !== undefined) {
    return fail(
      "export",
      "conflict",
      "export-destination-linked",
      `"${linked}" is a symbolic link, and an export writes bytes where it owns them, never through a link`,
      { details: { destination: dir, link: linked } },
    );
  }
  const is = (path: string, kind: "file" | "directory"): boolean => {
    try {
      const stat = statSync(path);
      return kind === "file" ? stat.isFile() : stat.isDirectory();
    } catch {
      return false;
    }
  };
  if (is(dir, "directory") && !is(join(dir, MARKER_PATH), "file")) {
    return fail(
      "export",
      "conflict",
      "export-destination-occupied",
      `"${dir}" exists and holds no export's marker, so it is not the engine's to write`,
      {
        details: { destination: dir },
        hint: "move the directory aside, or export under another name",
      },
    );
  }
  const pages = parsedPages(fsState(args.root, rootsOf(vault)));
  const plan = planExport({
    vault,
    source: fsExportSource(args.root, pages),
    declaration,
    label,
    commands: args.commands,
    siblings: declared,
  });
  const findings = routeFindings(plan.findings, lawFor(vault));
  if (plan.files === undefined) {
    return fail(
      "export",
      "findings",
      "findings",
      `"${name}" cannot be exported: ${findings.length} finding(s)`,
      {
        data: { findings },
        hint: "each finding names what refuses the export and how to change the declaration",
      },
    );
  }
  const rendered: RepositoryExports = {
    plans: [plan],
    destinations: [declaration.destination],
    manifests: pluginManifests(vault),
    findings: [],
  };
  // docs/cli.md §The dry-run law: a path under the bundle's root is named
  // relative to it, as every verb names a vault path; a path anywhere else is
  // named absolute, as `bundles` names the registry.
  const under = real.startsWith(bundle + sep)
    ? relative(bundle, real).split(sep).join("/")
    : undefined;
  const ops = exportOps(destination, rendered).map((op) => ({
    ...op,
    path: under === undefined ? join(destination, op.path) : `${under}/${op.path}`,
  }));
  return { destination, plan, rendered, ops, findings };
}

function planForExport(args: CommandArgs): Plan {
  const prepared = prepare(args);
  return "envelope" in prepared ? planOf([]) : planOf(prepared.ops);
}

export const exportCommand: CommandSpec = {
  name: "export",
  role: "maintainer",
  summary: "Write one declared external export into another repository, as skills/<name>/.",
  positionals: [{ name: "name", required: true }],
  flags: [
    {
      name: "to",
      type: "string",
      summary: "the root of the repository the export is written into (required)",
    },
  ],
  examples: ["wikiwright export roses --to ../roses-skill"],
  writes: true,
  needsVaultModules: true,
  plan: planForExport,
  run: (args) => {
    const prepared = prepare(args);
    if ("envelope" in prepared) return prepared;
    const marker = prepared.plan.marker;
    const identity = {
      destination: prepared.destination,
      export: {
        name: marker.name,
        bundle: marker.bundle,
        source: { repository: marker.source.repository },
        select: marker.select,
        pages: marker.pages,
        cut: marker.cut,
      },
    };
    if (isDryRun(args)) return ok("export", { ...planOf(prepared.ops), ...identity });
    const changed = writeExports(prepared.destination, prepared.rendered);
    const removed = prepared.ops.filter((op) => op.kind === "delete").length;
    return ok("export", {
      ...identity,
      written: changed.length - removed,
      removed,
      files: prepared.plan.files?.length ?? 0,
      findings: prepared.findings,
    });
  },
};
