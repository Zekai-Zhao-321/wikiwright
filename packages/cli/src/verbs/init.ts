// docs/cli.md §brief via docs/architecture.md (scaffold a vault from a starter constitution) · docs/cli.md §init
// (a fresh init is a green vault; ONE refusal listing every
// conflict, a plan a dry run can read, and `--force` for exactly the listed
// files) · docs/cli.md §hook · docs/architecture.md §Directories.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildNameIndex,
  codeUnitCompare,
  generateArtifacts,
  isContentPath,
  loadEngineConfig,
  normalizeInput,
  type PageInput,
  parseDoc,
} from "@wikiwright/core";
import { regenerate } from "../artifacts.ts";
import { BRIEF_PATH, briefOf } from "../brief.ts";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { inspectHook, installHook } from "../hooks.ts";
import { generateOptionsFor, rootsOf, type VaultOk } from "../law.ts";
import { declaredModulesIn, type ModuleDeclaration } from "../moduleload.ts";
import { shippedDir } from "../shipped.ts";
import {
  inspectSkills,
  SKILLS_ROOT,
  STAMP_BASENAME,
  shippedSkillNames,
  stampAll,
  stampText,
} from "../skills.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";
import { fsReader, loadVault, loadVaultVia, readPage, walkPages } from "../vaultio.ts";

/** The starter directory's files, repo-relative, in code-unit order. */
function starterFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort(codeUnitCompare);
}

/**
 * What one file init would land is, against the directory as it stands.
 * `identical`: the bytes are already there — not a conflict, not a write.
 * `stale`: the engine wrote the bytes on disk and owns them (a skill file whose
 * stamp matches, a stamp, an artifact, the brief) — rewritten, never refused.
 * `conflict`: bytes the engine cannot account for — refused unless `--force`.
 */
type FileState = "absent" | "identical" | "stale" | "conflict";

interface InitFile {
  /** Vault-relative, POSIX. */
  path: string;
  /** Where the bytes come from: a file to copy, or the rendered text. */
  source: { copy: string } | { text: string };
  state: FileState;
  summary: string;
}

/**
 * A starter that declares modules lands before the modules can load: they
 * live in `node_modules` the copy does not create, and a grant is a
 * machine-local act the user performs after reading them. So the law is not
 * read at init, no artifact and no brief is rendered, and the envelope names
 * the steps that make the first `check` green. The hook is read off the
 * starter's own engine.json, the one file the decision needs.
 */
interface DeclaredModules {
  declared: ModuleDeclaration[];
  commitPrefixes: boolean;
}

interface InitPlan {
  name: string;
  starterDir: string;
  /** Every file init lands, in code-unit order, with its state. */
  files: InitFile[];
  /** The vault as it will load after the copy — one law, read before any write; absent while the starter's modules cannot load. */
  vault?: VaultOk;
  modules?: DeclaredModules;
  hooks: string[];
}

type Inspection = { ok: true; plan: InitPlan } | { ok: false; result: CommandResult };

function stateOf(path: string, root: string, bytes: Buffer, owned: boolean): FileState {
  const abs = join(root, path);
  if (!existsSync(abs)) return "absent";
  if (readFileSync(abs).equals(bytes)) return "identical";
  return owned ? "stale" : "conflict";
}

/**
 * The starter's files and the shipped skills, each with its state. The skill
 * rows read the same inspection `skills update` reads (a file whose stamp
 * says the engine wrote it is the engine's to rewrite), so `init` and `skills
 * update` cannot disagree about which bytes are the user's.
 */
function copiedFiles(root: string, name: string, starterDir: string): InitFile[] {
  const files: InitFile[] = [];
  for (const rel of starterFiles(starterDir)) {
    const source = join(starterDir, rel);
    files.push({
      path: rel,
      source: { copy: source },
      state: stateOf(rel, root, readFileSync(source), false),
      summary: `from the "${name}" starter constitution`,
    });
  }
  const shipped = shippedDir("skills");
  if (!existsSync(shipped)) return files;
  for (const report of inspectSkills(root)) {
    for (const row of report.files) {
      const state: FileState =
        row.state === "missing"
          ? "absent"
          : row.state === "current" || (row.state === "unstamped" && row.installed === row.shipped)
            ? "identical"
            : row.state === "stale"
              ? "stale"
              : "conflict";
      files.push({
        path: `${SKILLS_ROOT}/${report.skill}/${row.path}`,
        source: { copy: join(shipped, report.skill, row.path) },
        state,
        summary: "a shipped skill file",
      });
    }
    const stampPath = `${SKILLS_ROOT}/${report.skill}/${STAMP_BASENAME}`;
    const text = stampText(report.skill);
    files.push({
      path: stampPath,
      source: { text },
      state: stateOf(stampPath, root, Buffer.from(text, "utf8"), true),
      summary: "the install stamp: this engine, this commit, and every file's sha256",
    });
  }
  return files;
}

/**
 * The pages the post-copy vault holds: whatever the directory already carries
 * under the starter's roots, with the starter's own pages over it. The derived
 * artifacts and the brief are rendered from THIS set, which is what the
 * post-copy `regenerate` walks — so the plan can say whether each would change.
 */
function postCopyPages(root: string, vault: VaultOk, files: readonly InitFile[]): PageInput[] {
  const roots = rootsOf(vault);
  const texts = new Map<string, string>();
  for (const rel of walkPages(root, roots)) texts.set(rel, readPage(root, rel));
  for (const file of files) {
    if (!("copy" in file.source) || !isContentPath(file.path, roots)) continue;
    texts.set(file.path, readFileSync(file.source.copy, "utf8"));
  }
  return [...texts]
    .sort(([a], [b]) => codeUnitCompare(a, b))
    .map(([path, text]) => ({ path, doc: parseDoc(text) }));
}

function inspectInit(args: CommandArgs): Inspection {
  const name = typeof args.flags["constitution"] === "string" ? args.flags["constitution"] : "base";
  const constitutionsDir = shippedDir("constitutions");
  const validNames = readdirSync(constitutionsDir).sort(codeUnitCompare);
  // Membership in the actual directory listing, not existsSync on a joined
  // path — "" and ".." would otherwise resolve to real directories and copy
  // the wrong tree over the vault.
  if (!validNames.includes(name)) {
    return {
      ok: false,
      result: fail("init", "usage", "unknown-constitution", `no starter constitution "${name}"`, {
        details: { valid_values: validNames },
      }),
    };
  }
  const starterDir = join(constitutionsDir, name);
  const files = copiedFiles(args.root, name, starterDir);
  const planned = new Map(files.map((f) => [f.path, f] as const));
  const disk = fsReader(args.root);

  // A starter that declares modules: the files land, the hook lands, and the
  // law waits for the install and the grant (docs/cli.md §init).
  const engineFile = planned.get("config/engine.json");
  if (engineFile !== undefined && "copy" in engineFile.source) {
    let engineJson: unknown;
    try {
      engineJson = JSON.parse(normalizeInput(readFileSync(engineFile.source.copy, "utf8")).text);
    } catch {
      engineJson = undefined;
    }
    const declared = declaredModulesIn(engineJson);
    if (declared.length > 0) {
      const engine = loadEngineConfig(engineJson);
      const commitPrefixes = engine.ok && engine.config.commit_prefixes !== undefined;
      files.sort((a, b) => codeUnitCompare(a.path, b.path));
      const inspection = inspectHook(args.root, { commitPrefixes });
      const hooks = inspection.kind === "installed" ? inspection.names : [];
      return {
        ok: true,
        plan: { name, starterDir, files, modules: { declared, commitPrefixes }, hooks },
      };
    }
  }

  // The law the directory will carry AFTER the copy, loaded before any byte
  // lands: the starter's files over whatever is there. A directory the copy
  // would leave unloadable is refused here, where nothing has been written yet.
  const vault = loadVaultVia(
    "init",
    {
      exists: (rel) => planned.has(rel) || disk.exists(rel),
      read: (rel) => {
        const file = planned.get(rel);
        if (file === undefined) return disk.read(rel);
        return "copy" in file.source ? readFileSync(file.source.copy, "utf8") : file.source.text;
      },
    },
    { root: args.root },
  );
  if (!vault.ok) return vault;

  const pages = postCopyPages(args.root, vault, files);
  for (const artifact of generateArtifacts(
    vault.registry,
    pages,
    buildNameIndex(pages),
    generateOptionsFor(vault),
  )) {
    files.push({
      path: artifact.path,
      source: { text: artifact.content },
      state: stateOf(artifact.path, args.root, Buffer.from(artifact.content, "utf8"), true),
      summary: "the derived artifact, regenerated",
    });
  }
  // docs/cli.md §brief: the install lands the brief too.
  const brief = briefOf(vault, pages, "writer", args.commands);
  files.push({
    path: BRIEF_PATH,
    source: { text: brief },
    state: stateOf(BRIEF_PATH, args.root, Buffer.from(brief, "utf8"), true),
    summary: "the writer's generated brief, from the verb registry and the constitution",
  });
  files.sort((a, b) => codeUnitCompare(a.path, b.path));

  // The hooks come from the installer's own pre-write half, so a
  // directory outside a git work tree — where `installHook` answers `no-git`
  // and writes nothing — plans no hook rather than one it cannot land.
  const inspection = inspectHook(args.root, {
    commitPrefixes: vault.engine.commit_prefixes !== undefined,
  });
  const hooks = inspection.kind === "installed" ? inspection.names : [];
  return { ok: true, plan: { name, starterDir, files, vault, hooks } };
}

function conflictsOf(plan: InitPlan): InitFile[] {
  return plan.files.filter((f) => f.state === "conflict");
}

/**
 * docs/cli.md §The dry-run law: the plan names FILES, and its path set is
 * the run's delta — an identical file is not in it, because rewriting the same
 * bytes moves nothing. A conflict is in it whatever the flags say: without
 * `--force` the run refuses over it, and the refusal carries this plan so the
 * whole conflict list is read in one envelope.
 */
function opsOf(plan: InitPlan): PlanOp[] {
  const ops: PlanOp[] = [];
  for (const file of plan.files) {
    if (file.state === "identical") continue;
    const copied = "copy" in file.source;
    if (file.state === "conflict") {
      ops.push({
        kind: "write",
        path: file.path,
        summary: `overwrite an existing file (${file.summary}); refused without --force`,
      });
    } else if (file.state === "stale") {
      ops.push({ kind: "write", path: file.path, summary: file.summary });
    } else {
      ops.push({ kind: copied ? "copy" : "create", path: file.path, summary: file.summary });
    }
  }
  for (const name of plan.hooks) {
    ops.push({
      kind: "write",
      path: `.git/hooks/${name}`,
      summary:
        name === "pre-commit"
          ? "the staged gate, because this directory is inside a git work tree"
          : "the commit-prefix policy this starter declares",
    });
  }
  return ops;
}

function planForInit(args: CommandArgs): Plan {
  const inspection = inspectInit(args);
  return planOf(inspection.ok ? opsOf(inspection.plan) : []);
}

export const initCommand: CommandSpec = {
  name: "init",
  role: "maintainer",
  summary:
    "Scaffold a vault from a starter constitution — only what is missing, unless --force; installs the hook when git exists.",
  positionals: [],
  flags: [
    { name: "constitution", type: "string", summary: 'starter constitution (default "base")' },
    {
      name: "force",
      type: "boolean",
      summary: "overwrite the existing files init lists as conflicts",
    },
  ],
  examples: [
    "wikiwright init",
    "wikiwright init --constitution base --dry-run",
    "wikiwright init --force",
  ],
  writes: true,
  needsVaultModules: true,
  plan: planForInit,
  run: (args) => {
    const inspection = inspectInit(args);
    if (!inspection.ok) return inspection.result;
    const { plan } = inspection;
    const conflicts = conflictsOf(plan);
    const force = args.flags["force"] === true;
    // Every conflict in ONE refusal, before any write, with the plan
    // beside it — never one file per run. Files already carrying the bytes
    // init would write are not in the list.
    if (conflicts.length > 0 && !force) {
      return fail(
        "init",
        "conflict",
        "file-exists",
        `init would overwrite ${conflicts.length} existing file(s): ${conflicts.map((f) => f.path).join(", ")}`,
        {
          hint: "move them aside and rerun, or pass --force to overwrite exactly these files; a file already identical to what init writes is not a conflict",
          details: { conflicts: conflicts.map((f) => f.path) },
          data: { ...planOf(opsOf(plan)), conflicts: conflicts.map((f) => f.path) },
        },
      );
    }
    // After every refusal `init` makes before it copies, and before the copy:
    // a dry run of the widest-blast-radius verb answers for the directory it is
    // actually pointed at.
    if (isDryRun(args)) return ok("init", planOf(opsOf(plan)));

    const written: string[] = [];
    const overwritten: string[] = [];
    const unchanged: string[] = [];
    for (const file of plan.files) {
      if (!("copy" in file.source)) continue;
      if (file.state === "identical") {
        unchanged.push(file.path);
        continue;
      }
      // The starter tree copy, file by file — the one declared exception to
      // the Writer: a starter is copied, never spliced.
      const abs = join(args.root, file.path);
      mkdirSync(dirname(abs), { recursive: true });
      cpSync(file.source.copy, abs);
      (file.state === "conflict" ? overwritten : written).push(file.path);
    }
    // The copy is stamped as it lands, so the engine can tell
    // from the first scaffold what it wrote and when the install fell behind.
    const stamps = existsSync(shippedDir("skills")) ? stampAll(args.root) : [];
    if (plan.modules !== undefined) {
      // The starter's modules are not installed and not granted: the artifacts
      // and the brief wait for the law they are rendered under, and the
      // envelope says what makes the first `check` green.
      const hookOutcome = installHook(args.root, { commitPrefixes: plan.modules.commitPrefixes });
      const packages = plan.modules.declared.map((m) => m.package);
      const data: Record<string, unknown> = {
        constitution: plan.name,
        hook: hookOutcome.kind === "installed",
        skills: shippedSkillNames().map((skill) => `${SKILLS_ROOT}/${skill}`),
        skills_stamped: stamps,
        generated: [],
        brief: null,
        written,
        overwritten,
        unchanged,
        modules: {
          declared: packages,
          loaded: false,
          note: "this starter declares modules the bundle has not installed; the artifacts and the brief are rendered once they load",
          install:
            "point package.json's dependency at where each module lives — a workspace link, or `file:<path>` to the package — and run the package manager's install",
          // The approval is a maintainer's decision, named rather than handed
          // out as a command: an agent runs a listed command literally.
          next: [
            ...packages.map(
              (name) =>
                `a maintainer reviews ${name} and approves it for this vault or its worktrees (see \`wikiwright trust --help\`)`,
            ),
            "wikiwright check --write",
          ],
        },
      };
      if (hookOutcome.kind === "foreign") {
        data["hook_note"] =
          "an existing pre-commit hook was left in place; wire the staged gate in manually";
      }
      return ok("init", data);
    }
    // A fresh init is a green vault — generate through build's
    // one path and report what landed, so the first `check` has nothing to say.
    const vault = loadVault("init", args.root);
    if (!vault.ok) return vault.result;
    // The starter's own declarations decide which hooks it gets — a starter
    // that declares commit_prefixes must not need `hook install` afterwards to
    // get the hook its constitution asks for (docs/cli.md §hook).
    const hookOutcome = installHook(args.root, {
      commitPrefixes: vault.engine.commit_prefixes !== undefined,
    });
    // The artifacts and the brief, through the one generator `check --write`
    // runs — so the first `check` has nothing to say.
    const generated = regenerate(args.root, vault, args.commands);
    const data: Record<string, unknown> = {
      constitution: plan.name,
      hook: hookOutcome.kind === "installed",
      skills: shippedSkillNames().map((skill) => `${SKILLS_ROOT}/${skill}`),
      skills_stamped: stamps,
      generated,
      brief: generated.includes(BRIEF_PATH) ? BRIEF_PATH : null,
      written,
      overwritten,
      unchanged,
    };
    if (hookOutcome.kind === "foreign") {
      data["hook_note"] =
        "an existing pre-commit hook was left in place; wire the staged gate in manually";
    }
    return ok("init", data);
  },
};
