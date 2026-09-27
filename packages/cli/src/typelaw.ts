// v2 contracts §2 (a bundle is detected by config/engine.json), §7 (the
// bundle block: label, root, head, dirty, law, content), §9 (the envelope).
//
// What every verb shares: the law a state carries loaded or refused, the engine range refused, and the bundle
// block the envelope names, computed from the state the verb read — the
// working tree's for `check`, the index's for `gate` (§7: the gate's envelope
// law is the index's).
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  contentDigest,
  ENGINE_PATH,
  type JudgeState,
  lawDigest,
  loadEngineV4,
  loadTypeLaw,
  satisfiesEngineRange,
  type TypeLaw,
} from "@wikiwright/core";
import { type BundleIdentity, type CommandResult, ENGINE_VERSION, fail } from "./envelope.ts";
import { gitCheckoutState } from "./git.ts";
import { RootNotFound, StateChangedDuringRead } from "./lawstate.ts";

export type LawLoad = { ok: true; law: TypeLaw } | { ok: false; result: CommandResult };

/** The bundle and repository-relative library roots named by this snapshot. */
function outputProtection(
  root: string,
  state: JudgeState,
  libraries?: readonly string[],
): { paths: string[]; complete: boolean } {
  const bundle = realpathSync(root);
  let top = bundle;
  if (state.law.bundle !== "") for (const _ of state.law.bundle.split("/")) top = dirname(top);
  const loaded =
    libraries === undefined
      ? (() => {
          const path = state.law.bundle === "" ? ENGINE_PATH : `${state.law.bundle}/${ENGINE_PATH}`;
          return loadEngineV4(state.law.files.get(path)?.bytes);
        })()
      : undefined;
  const declared =
    libraries ??
    (loaded?.ok === true ? loaded.engine.libraries.map((library) => library.path) : []);
  return {
    paths: [bundle, ...declared.map((path) => resolve(top, path))],
    complete: libraries !== undefined || loaded?.ok === true,
  };
}

/** Where a state read its law from, for the refusal that names what it did not find. */
const READ_FROM: Record<JudgeState["kind"], string> = {
  "working-tree": "the directory",
  overlay: "the directory",
  index: "the index",
  revision: "the revision",
};

/**
 * The law a state carries, loaded; a law that does not load is refused with
 * its issues, and nothing is judged. A state with no `config/engine.json` at
 * all holds no bundle: absent is not malformed, so that is `bundle-not-found`
 * (exit 3), as the old verbs answered a root with no constitution.
 */
export function lawOf(command: string, state: JudgeState, root: string): LawLoad {
  const engine = state.law.bundle === "" ? ENGINE_PATH : `${state.law.bundle}/${ENGINE_PATH}`;
  const protection = outputProtection(root, state);
  if (!state.law.files.has(engine)) {
    return {
      ok: false,
      result: {
        ...fail(
          command,
          "not_found",
          "bundle-not-found",
          `${READ_FROM[state.kind]} holds no ${ENGINE_PATH}, so there is no bundle to read`,
          {
            details: { path: ENGINE_PATH },
            hint: "a bundle is a directory holding config/engine.json at schema_version 4; name one with --root",
          },
        ),
        outputProtected: protection.paths,
        outputProtectionComplete: protection.complete,
      },
    };
  }
  const loaded = loadTypeLaw(state.law);
  if (loaded.ok) return { ok: true, law: loaded.law };
  return {
    ok: false,
    result: {
      ...fail(
        command,
        "constitution",
        "constitution-invalid",
        `the law does not load: ${loaded.issues.length} issue(s), the first ${loaded.issues[0]?.code ?? "unnamed"} at ${loaded.issues[0]?.where ?? "the bundle"}`,
        {
          data: { issues: loaded.issues },
          hint: "each issue names the law file (`where`) and the pointer inside it; nothing was judged",
        },
      ),
      outputProtected: protection.paths,
      outputProtectionComplete: protection.complete,
    },
  };
}

/**
 * §2 `engine`: a running engine outside the bundle's declared range is
 * refused before anything is judged (`engine-mismatch`, exit 2).
 */
export function engineMismatch(
  command: string,
  law: TypeLaw,
  version: string = ENGINE_VERSION,
): CommandResult | undefined {
  const range = law.engine.engine;
  if (range === undefined || satisfiesEngineRange(version, range)) return undefined;
  return fail(
    command,
    "constitution",
    "engine-mismatch",
    `this bundle declares the engine range "${range}", and the running engine is ${version}`,
    {
      details: { required: range, running: version },
      hint: "run an engine inside the declared range, or change config/engine.json's `engine` through review",
    },
  );
}

/** §7 `content`: every page the state holds, path and bytes. */
export function stateContentDigest(state: JudgeState): string {
  const empty = new Uint8Array();
  return contentDigest([
    ...[...state.pages].map(([path, bytes]) => ({ path: `page:${path}`, bytes })),
    ...[...(state.sources?.files ?? [])].map((path) => ({
      path: `source-file:${path}`,
      bytes: empty,
    })),
    ...[...(state.sources?.directories ?? [])].map((path) => ({
      path: `source-directory:${path}`,
      bytes: empty,
    })),
    ...(state.sources?.skipped ?? []).map((entry) => ({
      path: `source-${entry.kind}:${entry.path}`,
      bytes: empty,
    })),
    ...(state.sources === undefined ? [{ path: "source-unmeasured", bytes: empty }] : []),
  ]);
}

/**
 * §7 `metadata.bundle`, from the state a verb read and the law it loaded:
 * `label` is engine.json's, `law` and `content` are the digests of what the
 * state holds, `head` and `dirty` what git says of the root's checkout.
 */
export async function typeLawIdentity(
  root: string,
  state: JudgeState,
  law: TypeLaw,
): Promise<
  BundleIdentity & { outputProtected: readonly string[]; outputProtectionComplete: boolean }
> {
  const real = realpathSync(root);
  const checkout = await gitCheckoutState(real);
  return {
    label: law.engine.label,
    root: real,
    head: checkout?.head ?? null,
    dirty: checkout?.dirty ?? null,
    law: lawDigest(law, ENGINE_VERSION),
    content: stateContentDigest(state),
    outputProtected: outputProtection(
      root,
      state,
      law.libraries.map((library) => library.root),
    ).paths,
    outputProtectionComplete: true,
  };
}

/** The envelope with the bundle block it names. */
export function withIdentity(
  result: CommandResult,
  identity: BundleIdentity & {
    outputProtected?: readonly string[];
    outputProtectionComplete?: boolean;
  },
): CommandResult {
  const { outputProtected: selected, outputProtectionComplete, ...bundle } = identity;
  const complete = result.outputProtectionComplete === false ? false : outputProtectionComplete;
  return {
    ...result,
    outputProtected: [...new Set([...(result.outputProtected ?? []), ...(selected ?? [])])],
    ...(complete === undefined ? {} : { outputProtectionComplete: complete }),
    envelope: { ...result.envelope, metadata: { ...result.envelope.metadata, bundle } },
  };
}

/**
 * A state that could not be read as one state (§11): the working tree changed
 * while it was read, twice; or the root names no directory, which is no
 * bundle (`bundle-not-found`, as a directory with no engine.json is).
 * Refused, and nothing judged; any other error is the engine's.
 */
export function stateRefusal(command: string, error: unknown): CommandResult | undefined {
  if (error instanceof RootNotFound) {
    return fail(command, "not_found", "bundle-not-found", error.message, {
      details: { path: ENGINE_PATH },
      hint: "a bundle is a directory holding config/engine.json at schema_version 4; name one with --root",
    });
  }
  if (error instanceof StateChangedDuringRead) {
    return fail(command, "conflict", "state-changed-during-read", error.message, {
      hint: "read again when no editor or process is writing to the bundle",
    });
  }
  return undefined;
}
