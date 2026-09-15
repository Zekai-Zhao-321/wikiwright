// docs/extending.md §Declaring a module, docs/extending.md §The determinism fixture, docs/extending.md §Adopting a new version
// docs/cli.md §The envelope · docs/cli.md §The dry-run law (this verb writes nothing).
//
// What the bundle declares, what actually resolved, and what adopting a
// different version would do to the verdict. The third question is the one
// `docs/extending.md §Adopting a new version` asks for: "a version change reports a finding delta
// against the corpus before adoption".
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  codeUnitCompare,
  type Finding,
  judge,
  loadModules,
  STANDARD_LIBRARY,
} from "@wikiwright/core";
import { fail, ok } from "../envelope.ts";
import { lawFor, rootsOf } from "../law.ts";
import { runModuleFixture } from "../modulefixture.ts";
import {
  declaredModulesOf,
  forgetPreloadedModules,
  loadDeclaredModules,
  plantPreloadedModules,
  preloadModules,
} from "../moduleload.ts";
import type { CommandArgs, CommandSpec } from "../spec.ts";
import { fsState } from "../state.ts";
import { loadVault } from "../vaultio.ts";

/** One finding, as a delta line: the identity a reader compares across versions. */
function shapeOf(finding: Finding): string {
  return `${finding.ruleId}|${finding.path}|${finding.line ?? 0}|${finding.severity}`;
}

/**
 * How the bundle's own package.json names a declared module — a `file:`
 * path, a version range, a tarball — beside the version the install resolved
 * to. Read off the bundle's manifest, never the lockfile: the trust digest is
 * the pin, and this is the spelling a reader edits.
 */
function packageSpecOf(root: string, name: string): string | null {
  const manifest = join(root, "package.json");
  if (!existsSync(manifest)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return parsed.dependencies?.[name] ?? parsed.devDependencies?.[name] ?? null;
  } catch {
    return null;
  }
}

/** Every finding this vault produces under whatever modules are preloaded for it. */
function findingsOf(root: string): { ok: true; shapes: string[] } | { ok: false; why: string } {
  const vault = loadVault("modules", root);
  if (!vault.ok) {
    return { ok: false, why: JSON.stringify(vault.result.envelope) };
  }
  const verdict = judge(fsState(root, rootsOf(vault)), lawFor(vault), {
    all: true,
    limit: 100_000,
  });
  return { ok: true, shapes: verdict.findings.map(shapeOf).sort(codeUnitCompare) };
}

export const modulesCommand: CommandSpec = {
  name: "modules",
  role: "maintainer",
  summary: "List the modules this bundle declares, or plan the delta of adopting another version.",
  positionals: [{ name: "subcommand", required: true }],
  subcommands: ["list", "plan"],
  flags: [
    {
      name: "package",
      type: "string",
      summary: "with `plan`: the declared module whose version would change",
    },
    {
      name: "candidate",
      type: "string",
      summary: "with `plan`: a bundle root that already has the candidate version installed",
    },
  ],
  examples: [
    "wikiwright modules list",
    "wikiwright modules plan --package @acme/kit --candidate ../bundle-with-the-new-version",
  ],
  writes: false,
  needsVaultModules: true,
  run: async (args: CommandArgs) => {
    const [action] = args.positionals;
    const declarations = declaredModulesOf(args.root);

    if (action === "list") {
      // docs/extending.md §Declaring a module: what the bundle declares, what resolved, what its
      // grant is pinned to, and whether its fixture passes. A module that did not load is
      // reported WITH its refusal rather than omitted, because an absent row is
      // exactly what a reader would read as "fine".
      const outcome = await loadDeclaredModules(args.root, declarations);
      const proved = new Map<string, unknown>();
      for (const module of outcome.loaded) {
        const result = runModuleFixture(module);
        proved.set(module.package, result.ok ? result.result : { failed: result.issue.message });
      }
      // The whole of what a module contributed — the declarations a kit
      // is mostly made of (types, fragments, templates, skill fragments,
      // entries into another module's vocabulary) beside the code it
      // registered (grammars, checks, lanes) — and how the bundle names the
      // package: the spelling in its package.json, the resolved version, the
      // digest the grant pins, and the grant's standing on this machine.
      return ok("modules", {
        declared: declarations.length,
        loaded: outcome.loaded
          .map((m) => ({
            package: m.package,
            id: m.manifest.id,
            version: m.version,
            resolved: {
              spec: packageSpecOf(args.root, m.package),
              declared: declarations.find((d) => d.package === m.package)?.version ?? null,
              path: `node_modules/${m.package}`,
            },
            digest: m.digest,
            grant: "granted",
            grant_scope: m.authorizedBy ?? null,
            contributes: {
              types: Object.keys(m.manifest.types ?? {}).sort(codeUnitCompare),
              fragments: Object.keys(m.manifest.fragments ?? {}).sort(codeUnitCompare),
              templates: Object.keys(m.manifest.templates ?? {}).sort(codeUnitCompare),
              skills: (m.manifest.skills ?? []).map((fragment) => fragment.heading),
              entries: Object.entries(m.manifest.entries ?? {})
                .flatMap(([vocabulary, shipped]) =>
                  Object.keys(shipped).map((entry) => `${vocabulary}/${entry}`),
                )
                .sort(codeUnitCompare),
              vocabularies: Object.keys(m.manifest.vocabularies ?? {}).sort(codeUnitCompare),
              grammars: Object.keys(m.manifest.grammars ?? {}).sort(codeUnitCompare),
              checks: Object.keys(m.manifest.checks ?? {}).sort(codeUnitCompare),
              lanes: [...(m.manifest.lanes ?? [])].sort(codeUnitCompare),
            },
            fixture: proved.get(m.package) ?? null,
          }))
          .sort((a, b) => codeUnitCompare(a.package, b.package)),
        refused: outcome.issues.map((issue) => ({
          ...issue,
          resolved: {
            spec: packageSpecOf(args.root, issue.package),
            path: `node_modules/${issue.package}`,
          },
          grant:
            issue.code === "module-untrusted"
              ? "missing"
              : issue.code === "module-modified"
                ? "modified"
                : issue.code === "module-scope-unresolved"
                  ? "scope-unresolved"
                  : "not-reached",
        })),
      });
    }

    const name = args.flags["package"];
    const candidate = args.flags["candidate"];
    if (typeof name !== "string" || typeof candidate !== "string") {
      return fail(
        "modules",
        "usage",
        "missing-argument",
        "`modules plan` needs --package and --candidate",
        {
          hint: "--candidate is a bundle root that already has the version you would adopt installed; nothing here reaches the network",
        },
      );
    }
    if (!declarations.some((d) => d.package === name)) {
      return fail(
        "modules",
        "usage",
        "unknown-module",
        `config/engine.json does not declare "${name}"`,
        { details: { declared: declarations.map((d) => d.package) } },
      );
    }
    const candidateRoot = resolve(candidate);
    if (!existsSync(candidateRoot)) {
      return fail("modules", "not_found", "candidate-not-found", `no directory at "${candidate}"`);
    }

    // Current: this bundle, under the modules it has installed today.
    forgetPreloadedModules(args.root);
    await preloadModules(args.root, declarations);
    const before = findingsOf(args.root);
    if (!before.ok) {
      forgetPreloadedModules(args.root);
      return fail("modules", "constitution", "current-unjudgeable", before.why);
    }

    // Candidate: the SAME bundle, under the candidate root's resolution of the
    // one package. Resolution is the only variable — the pages, the constitution
    // and every other module are this bundle's, so the delta is the version's.
    const candidateLoad = await loadDeclaredModules(candidateRoot, [{ package: name }]);
    const candidateModule = candidateLoad.loaded[0];
    if (candidateLoad.issues.length > 0 || candidateModule === undefined) {
      forgetPreloadedModules(args.root);
      return fail(
        "modules",
        "constitution",
        "candidate-unresolved",
        `"${name}" did not load from "${candidate}"`,
        { data: { issues: candidateLoad.issues } },
      );
    }
    const fixture = runModuleFixture(candidateModule);
    if (!fixture.ok) {
      forgetPreloadedModules(args.root);
      return fail(
        "modules",
        "constitution",
        fixture.issue.code,
        `the candidate of "${name}" fails its own determinism fixture`,
        { data: { issue: fixture.issue } },
      );
    }
    const others = await loadDeclaredModules(
      args.root,
      declarations.filter((d) => d.package !== name),
    );
    const composed = loadModules([
      ...STANDARD_LIBRARY,
      ...others.loaded.map((m) => m.manifest),
      candidateModule.manifest,
    ]);
    if (!composed.ok) {
      forgetPreloadedModules(args.root);
      return fail(
        "modules",
        "constitution",
        "module-conflict",
        `the candidate of "${name}" collides with the bundle's other modules`,
        { data: { conflicts: composed.conflicts } },
      );
    }

    // The already-resolved candidate set is planted for THIS root, which is what
    // makes the second judgment a judgment of this bundle rather than of the
    // candidate's. It is the one write to the preload cache that did not come
    // from resolving that root, and it is undone below either way.
    plantPreloadedModules(args.root, {
      loaded: [...others.loaded, candidateModule],
      issues: [],
    });
    const after = findingsOf(args.root);
    forgetPreloadedModules(args.root);
    if (!after.ok) {
      return fail("modules", "constitution", "candidate-unjudgeable", after.why);
    }

    const beforeSet = new Set(before.shapes);
    const afterSet = new Set(after.shapes);
    const added = after.shapes.filter((s) => !beforeSet.has(s));
    const removed = before.shapes.filter((s) => !afterSet.has(s));
    return ok("modules", {
      package: name,
      declared: declarations.find((d) => d.package === name)?.version ?? null,
      candidate: { version: candidateModule.version, digest: candidateModule.digest },
      // docs/cli.md §The dry-run law: a plan states the WHOLE delta, never the first item
      // of it — a reader who has to ask for the rest cannot adopt safely.
      delta: { added, removed, unchanged: before.shapes.length - removed.length },
      adopt:
        added.length === 0 && removed.length === 0
          ? "the candidate changes no finding on this corpus"
          : `install the candidate in this bundle and update config/engine.json; ${added.length} finding(s) appear and ${removed.length} disappear`,
    });
  },
};
