// v2 contracts §2 (a bundle is detected by config/engine.json), §7 (the
// bundle block: label, root, head, dirty, law, content), §9 (the envelope).
//
// What every verb of the v2 table shares: which table answers a root, the law
// a state carries loaded or refused, the engine range refused, and the bundle
// block the envelope names, computed from the state the verb read — the
// working tree's for `check`, the index's for `gate` (§7: the gate's envelope
// law is the index's).
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  contentDigest,
  ENGINE_PATH,
  type JudgeState,
  lawDigest,
  loadTypeLaw,
  satisfiesEngineRange,
  type TypeLaw,
} from "@wikiwright/core";
import { type BundleIdentity, type CommandResult, ENGINE_VERSION, fail } from "./envelope.ts";
import { gitCheckoutState } from "./git.ts";
import { StateChangedDuringRead } from "./lawstate.ts";

/**
 * Whether the root holds a bundle of the v2 law: a `config/engine.json` that
 * reads as JSON with `schema_version: 4`. Such a bundle is answered by the
 * command table of §9; any other root — a bundle on the old constitution, or
 * no bundle at all — by the old table (`LEGACY_COMMANDS`), until step 5 of the
 * delivery migrates the corpora and step 6 deletes the old verbs.
 */
export function isTypeLawBundle(root: string): boolean {
  let text: string;
  try {
    text = readFileSync(join(root, ENGINE_PATH), "utf8");
  } catch {
    return false;
  }
  try {
    const json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
    return (
      json !== null &&
      typeof json === "object" &&
      (json as Record<string, unknown>)["schema_version"] === 4
    );
  } catch {
    return false;
  }
}

export type LawLoad = { ok: true; law: TypeLaw } | { ok: false; result: CommandResult };

/** The law a state carries, loaded; a law that does not load is refused with its issues, and nothing is judged. */
export function lawOf(command: string, state: JudgeState): LawLoad {
  const loaded = loadTypeLaw(state.law);
  if (loaded.ok) return { ok: true, law: loaded.law };
  return {
    ok: false,
    result: fail(
      command,
      "constitution",
      "constitution-invalid",
      `the law does not load: ${loaded.issues.length} issue(s), the first ${loaded.issues[0]?.code ?? "unnamed"} at ${loaded.issues[0]?.where ?? "the bundle"}`,
      {
        data: { issues: loaded.issues },
        hint: "each issue names the law file (`where`) and the pointer inside it; nothing was judged",
      },
    ),
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
  return contentDigest([...state.pages].map(([path, bytes]) => ({ path, bytes })));
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
): Promise<BundleIdentity> {
  const real = realpathSync(root);
  const checkout = await gitCheckoutState(real);
  return {
    label: law.engine.label,
    root: real,
    head: checkout?.head ?? null,
    dirty: checkout?.dirty ?? null,
    law: lawDigest(law, ENGINE_VERSION),
    content: stateContentDigest(state),
  };
}

/** The envelope with the bundle block it names. */
export function withIdentity(result: CommandResult, bundle: BundleIdentity): CommandResult {
  return {
    ...result,
    envelope: { ...result.envelope, metadata: { ...result.envelope.metadata, bundle } },
  };
}

/**
 * A state that could not be read as one state (§11): the working tree changed
 * while it was read, twice. Refused, and nothing judged; any other error is
 * the engine's.
 */
export function stateRefusal(command: string, error: unknown): CommandResult | undefined {
  if (error instanceof StateChangedDuringRead) {
    return fail(command, "conflict", "state-changed-during-read", error.message, {
      hint: "read again when no editor or process is writing to the bundle",
    });
  }
  return undefined;
}
