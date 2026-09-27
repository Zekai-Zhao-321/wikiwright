// v2 contracts §2 (the bundle and its libraries) · §7 (the law digest's lines)
// · §10 (readers gain `list(prefix)`).
//
// The loader is a function of one snapshot: every file under the directories
// the loader reads, by repository-relative path, with its bytes. The shell
// builds it from the working tree or from the index (packages/cli/src/
// lawfiles.ts) in two reads — engine.json first, because it names the
// libraries, then the directories — and the kernel never touches a filesystem
// or git. Same bytes, same snapshot, same law, whichever adapter read them.
import type { EngineV4 } from "./engine.ts";
import type { LawIssue } from "./issues.ts";
import { isName } from "./names.ts";
import { joinUnder, relativeUnder, resolveInRepository } from "./paths.ts";
import { utf8Text, withoutBom } from "./text.ts";
import { isMapping, jsonNumbers, readYaml } from "./yaml.ts";

export interface LawFile {
  bytes: Uint8Array;
  /**
   * A symbolic link in the tree or the index, or a submodule: never read as
   * law (`law-foreign-file`). A law directory or a library root that is one,
   * or lies under one, is recorded as one such file in its own place.
   */
  link?: boolean;
  /** The link is a submodule (index mode 160000; a directory holding `.git` in the tree). */
  submodule?: boolean;
}

export interface LawSnapshot {
  /** The bundle root, relative to the repository's top level; `""` at the top. */
  bundle: string;
  /** Every file under the law directories the shell listed, by repository-relative NFC path. */
  files: ReadonlyMap<string, LawFile>;
  /**
   * The library directories (repository-relative, resolved) that exist in the
   * adapter's tree, a library root recorded as a link included.
   */
  directories: ReadonlySet<string>;
}

/** The bundle's own directories the loader reads, relative to the bundle root. */
export const BUNDLE_LAW_DIRECTORIES: readonly string[] = ["constitution", "rule-tests", "examples"];
/** A library's directories the loader reads, relative to the library root. */
export const LIBRARY_LAW_DIRECTORIES: readonly string[] = [
  "types",
  "fragments",
  "vocabularies",
  "rule-tests",
  "examples",
];
/** The document kinds, each a directory of `<name>.yaml` files. */
export const DOCUMENT_DIRECTORIES: readonly ("types" | "fragments" | "vocabularies")[] = [
  "types",
  "fragments",
  "vocabularies",
];
export const LIBRARY_FILE = "library.yaml";

export interface ResolvedLibrary {
  /** The path as engine.json declares it. */
  declared: string;
  /** The library root, repository-relative. */
  root: string;
  id: string;
}

/**
 * The library directories an engine.json names, resolved against the top
 * level, for the shell's second read. A path that leaves the repository is
 * left out here and refused by `resolveLibraries`.
 */
export function libraryDirectories(engine: EngineV4): string[] {
  const out: string[] = [];
  for (const library of engine.libraries) {
    const root = resolveInRepository(library.path);
    if (root !== undefined && root !== "") out.push(root);
  }
  return out;
}

/** The id `library.yaml` declares, `null` when the file declares none, an issue when it is not one. */
function declaredId(
  snapshot: LawSnapshot,
  root: string,
  where: string,
): { id: string | null } | { issue: LawIssue } {
  const file = snapshot.files.get(joinUnder(root, LIBRARY_FILE));
  if (file === undefined) return { id: null };
  const invalid = (message: string): { issue: LawIssue } => ({
    issue: { code: "library-invalid", where, message },
  });
  if (file.link === true) return invalid(`${LIBRARY_FILE} is a symbolic link`);
  const text = utf8Text(file.bytes);
  if (text === undefined) return invalid(`${LIBRARY_FILE} is not UTF-8`);
  const read = readYaml(withoutBom(text));
  if (!read.ok) return invalid(`${LIBRARY_FILE} is not YAML: ${read.message}`);
  const value = read.value;
  if (!isMapping(value) || Object.keys(value).some((key) => key !== "id")) {
    return invalid(`${LIBRARY_FILE} is a mapping with one key, "id"`);
  }
  const id = value["id"];
  if (id === undefined) return { id: null };
  if (typeof id !== "string" || !isName(id)) {
    return invalid(
      `${JSON.stringify(jsonNumbers(id))} is not a library id: lower-case letters and digits in hyphen-separated runs`,
    );
  }
  return { id };
}

/**
 * §2: each `libraries[].path` against the git top level, contained, present,
 * with its id — the directory's basename with a leading `kit-` stripped, or
 * the `id` its `library.yaml` declares. Two libraries with one id are one
 * qualified name declared twice (`constitution-collision`).
 */
export function resolveLibraries(
  engine: EngineV4,
  snapshot: LawSnapshot,
): { libraries: ResolvedLibrary[]; issues: LawIssue[] } {
  const issues: LawIssue[] = [];
  const libraries: ResolvedLibrary[] = [];
  const byId = new Map<string, ResolvedLibrary>();
  engine.libraries.forEach((declaration, index) => {
    const where = `bundle:config/engine.json`;
    const root = resolveInRepository(declaration.path);
    if (root === undefined || root === "") {
      issues.push({
        code: "library-outside-repository",
        where,
        message: `libraries[${index}].path "${declaration.path}" ${
          root === ""
            ? "names the repository itself"
            : "resolves outside the repository that holds the bundle"
        }; a library is a directory inside it, named from its top level`,
        details: { pointer: `/libraries/${index}/path`, path: declaration.path },
      });
      return;
    }
    if (!snapshot.directories.has(root)) {
      issues.push({
        code: "library-missing",
        where,
        message: `libraries[${index}].path "${declaration.path}" names no directory in this tree (resolved from the repository's top level: "${root}")`,
        details: { pointer: `/libraries/${index}/path`, path: declaration.path },
      });
      return;
    }
    const base = root.slice(root.lastIndexOf("/") + 1);
    const declared = declaredId(snapshot, root, `${declaration.path}:${LIBRARY_FILE}`);
    if ("issue" in declared) {
      issues.push(declared.issue);
      return;
    }
    const id = declared.id ?? base.replace(/^kit-/u, "");
    if (!isName(id)) {
      issues.push({
        code: "library-invalid",
        where,
        message: `the library at "${declaration.path}" takes the id "${id}" from its directory name, which is not a library id; declare one in ${LIBRARY_FILE}`,
      });
      return;
    }
    const prior = byId.get(id);
    if (prior !== undefined) {
      issues.push({
        code: "constitution-collision",
        where,
        message: `libraries "${prior.declared}" and "${declaration.path}" both take the id "${id}", so every name either declares would be declared twice`,
        details: { library: id },
      });
      return;
    }
    const library = { declared: declaration.path, root, id };
    byId.set(id, library);
    libraries.push(library);
  });
  return { libraries, issues };
}

/** Where a snapshot file sits in the law: whose it is, and its path inside that owner. */
export interface LawPlace {
  /** `bundle` or a library id. */
  owner: string;
  /** The path relative to the bundle root or the library root. */
  path: string;
}

/**
 * Every file the loader reads, placed, and every other file under a law
 * directory refused by name (§2 `law-foreign-file`). What the loader reads:
 * `<name>.yaml` directly under `types/`, `fragments/`, `vocabularies/`
 * (the bundle's under `constitution/`), a library's `library.yaml`, and under
 * `rule-tests/` and `examples/` every `.md` and every file named
 * `expect.json`. A symbolic link is never read.
 */
export function placeLawFiles(
  snapshot: LawSnapshot,
  libraries: readonly ResolvedLibrary[],
): { placed: Map<string, LawPlace>; issues: LawIssue[] } {
  const placed = new Map<string, LawPlace>();
  const issues: LawIssue[] = [];
  const owners: { owner: string; root: string; documents: string; tests: string[] }[] = [
    {
      owner: "bundle",
      root: snapshot.bundle,
      documents: "constitution",
      tests: ["rule-tests", "examples"],
    },
    ...libraries.map((l) => ({
      owner: l.id,
      root: l.root,
      documents: "",
      tests: ["rule-tests", "examples"],
    })),
  ];
  for (const [path, file] of snapshot.files) {
    if (path === joinUnder(snapshot.bundle, "config/engine.json")) {
      placed.set(path, { owner: "bundle", path: "config/engine.json" });
      continue;
    }
    // A library inside the bundle's tree is its own owner: the longest root
    // wins. A library root recorded as a link is its library's own file.
    const owner = owners
      .filter((o) => path === o.root || relativeUnder(o.root, path) !== undefined)
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (owner === undefined) continue;
    const rel = path === owner.root ? "" : (relativeUnder(owner.root, path) ?? path);
    const where = `${owner.owner}:${rel === "" ? "." : rel}`;
    const foreign = (why: string): void => {
      issues.push({ code: "law-foreign-file", where, message: why });
    };
    if (file.link === true) {
      // A link or a submodule anywhere the loader reads: a law file, a law
      // directory, a library root, or a directory on the way to one.
      foreign(
        file.submodule === true
          ? "a git submodule: the loader reads the repository's own files only"
          : "a symbolic link: the loader reads regular files only",
      );
      continue;
    }
    if (owner.owner !== "bundle" && rel === LIBRARY_FILE) {
      placed.set(path, { owner: owner.owner, path: rel });
      continue;
    }
    const segments = rel.split("/");
    const inDocuments = owner.documents === "" ? segments : segments.slice(1);
    if (
      owner.documents !== "" &&
      segments[0] !== owner.documents &&
      !owner.tests.includes(segments[0] ?? "")
    ) {
      continue;
    }
    const top = inDocuments[0] ?? "";
    const isDocumentDir = (DOCUMENT_DIRECTORIES as readonly string[]).includes(top);
    const isTestDir = owner.tests.includes(segments[0] ?? "");
    if (!isDocumentDir && !isTestDir) {
      // Under `constitution/` every file is law or foreign; beside a library's
      // law directories (a README, a licence) a file is not the loader's.
      if (owner.documents !== "") {
        foreign(
          `"${rel}" is not under types/, fragments/ or vocabularies/, which is all constitution/ holds`,
        );
      }
      continue;
    }
    if (isTestDir) {
      const name = segments[segments.length - 1] ?? "";
      if (name.endsWith(".md") || name === "expect.json") {
        placed.set(path, { owner: owner.owner, path: rel });
      } else {
        foreign(`"${rel}": rule-tests/ and examples/ hold .md pages and expect.json files only`);
      }
      continue;
    }
    const nameSegments = inDocuments.slice(1);
    if (nameSegments.length !== 1 || !(nameSegments[0] ?? "").endsWith(".yaml")) {
      foreign(
        `"${rel}": ${top}/ holds <name>.yaml files, one per ${top.replace(/s$/u, "").replace(/ie$/u, "y")}, and nothing else`,
      );
      continue;
    }
    placed.set(path, { owner: owner.owner, path: rel });
  }
  return { placed, issues };
}
