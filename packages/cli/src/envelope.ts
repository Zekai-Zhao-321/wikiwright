// docs/cli.md §The envelope (one envelope on stdout, uniform shapes, prose
// never load-bearing) · the closed exit taxonomy, JSON-only v1
// docs/concepts.md §Findings and routing (the verdict envelope and the cap flags every judging verb
// prints — docs/architecture.md §Directories keeps the envelope helpers here rather than beside a verb).
import type { ExportSelect, JudgeOptions, Verdict } from "@wikiwright/core";
import type { CommandArgs } from "./spec.ts";

export const EXIT = {
  ok: 0,
  internal: 1,
  usage: 2,
  // A defect in the LAW is exit 2 like a usage error, and a distinct
  // type — usage names flags the caller got wrong, `constitution` names
  // registry issues the bundle must fix. Page findings keep 5.
  constitution: 2,
  not_found: 3,
  conflict: 4,
  findings: 5,
} as const;

export type ErrorType = Exclude<keyof typeof EXIT, "ok">;

export const ENGINE_VERSION = "0.1.0";

/**
 * docs/cli.md §The envelope: which bundle a vault verb read, beside its answer.
 * Declared here rather than beside `bundleIdentity` so the envelope, which
 * every verb imports, reaches no module that reads a vault.
 */
export interface BundleIdentity {
  /** The basename of the root's real path: a label for a reader, never an identity. */
  label: string;
  /** The root's real path. */
  root: string;
  /** The commit HEAD names in the enclosing repository, or null when git names none. */
  head: string | null;
  /** Whether `git status` lists any change under the root, or null when no repository answers. */
  dirty: boolean | null;
  /** sha256 over the constitution, engine.json and each installed module's digest, loaded or not. */
  law: string;
  /** sha256 over every page under the content roots, path and bytes. */
  content: string;
  /** Over a copy, the export it is, read off its marker (docs/constitution.md §exports). */
  export?: BundleExport;
}

/**
 * docs/cli.md §The envelope: the identity a copy's marker gives it — the
 * export's name, where the bundle it was cut from is installed from, what it
 * selected, and how many pages it holds and links it cut. `intact: false`
 * says the copy's law or content no longer digests to what its marker
 * recorded: it was changed after export. Informational, never a refusal.
 */
export interface BundleExport {
  name: string;
  source: { repository: string | null };
  select: ExportSelect;
  pages: number;
  cut: { links: number; citations: number; attachments: number };
  intact?: false;
}

export interface Metadata {
  command: string;
  engine: string;
  bundle?: BundleIdentity;
}

export interface OkEnvelope {
  ok: true;
  data: unknown;
  metadata: Metadata;
}

export interface ErrEnvelope {
  ok: false;
  data?: unknown;
  error: {
    code: string;
    exit_code: number;
    type: ErrorType;
    message: string;
    hint?: string;
    details?: Record<string, unknown>;
  };
  metadata: Metadata;
}

export type Envelope = OkEnvelope | ErrEnvelope;

export interface CommandResult {
  envelope: Envelope;
  exit: number;
  /** docs/cli.md §The envelope: UX on stderr, through one slot main.ts writes. */
  stderr?: string;
}

export function ok(command: string, data: unknown): CommandResult {
  return {
    envelope: { ok: true, data, metadata: { command, engine: ENGINE_VERSION } },
    exit: EXIT.ok,
  };
}

export function fail(
  command: string,
  type: ErrorType,
  code: string,
  message: string,
  extra?: { hint?: string; details?: Record<string, unknown>; data?: unknown },
): CommandResult {
  const error: ErrEnvelope["error"] = { code, exit_code: EXIT[type], type, message };
  if (extra?.hint !== undefined) error.hint = extra.hint;
  if (extra?.details !== undefined) error.details = extra.details;
  const envelope: ErrEnvelope = {
    ok: false,
    error,
    metadata: { command, engine: ENGINE_VERSION },
  };
  if (extra?.data !== undefined) envelope.data = extra.data;
  return { envelope, exit: EXIT[type] };
}

/** v2 contracts §9: the most bytes one envelope may put on stdout. */
export const ENVELOPE_MAX_BYTES = 1_048_576;

/**
 * v2 contracts §9: an envelope over the bound, refused. The refusal keeps the
 * metadata (the verb, the bundle it read) and drops the data: a caller that
 * wants the whole answer asks again with `--out`.
 */
export function envelopeTooLarge(result: CommandResult, bytes: number): CommandResult {
  const refusal = fail(
    result.envelope.metadata.command,
    "usage",
    "envelope-too-large",
    `the envelope is ${bytes} bytes, and stdout carries at most ${ENVELOPE_MAX_BYTES}`,
    {
      details: { bytes, limit: ENVELOPE_MAX_BYTES, exit_code: result.exit },
      hint: "run the same command with --out <file>: the file receives the whole envelope, and stdout a pointer to it",
    },
  );
  return {
    ...refusal,
    envelope: { ...refusal.envelope, metadata: result.envelope.metadata },
  };
}

/**
 * v2 contracts §9: what stdout carries when `--out` took the envelope — two
 * lines that are one JSON object: whether the envelope is ok, its exit code
 * and size, and where it is. A reader that parses stdout as JSON reads the
 * pointer; one that reads lines reads the file's name on the second.
 */
export function outPointer(result: CommandResult, out: string, bytes: number): string {
  const head = JSON.stringify({
    ok: result.envelope.ok,
    command: result.envelope.metadata.command,
    exit_code: result.exit,
    bytes,
  });
  return `${head.slice(0, -1)},\n${JSON.stringify({ out }).slice(1)}\n`;
}

/** The envelope every judging verb prints (docs/concepts.md §Findings and routing). */
export function verdictEnvelope(verdict: Verdict): Record<string, unknown> {
  return {
    findings: verdict.findings,
    summary: verdict.summary,
    coverage: verdict.coverage,
    // The blind spot named — which pass, how many, why — beside the
    // scalar `summary.unevaluated` every reader sums.
    unevaluated: verdict.unevaluated,
    caps: verdict.caps,
    dispositions: verdict.dispositions,
  };
}

/** docs/concepts.md §Findings and routing: `--limit`, `--rule`, `--path`, `--all`, read once. */
export function capOptions(
  args: CommandArgs,
): Pick<JudgeOptions, "limit" | "all" | "rule" | "path"> {
  const out: Pick<JudgeOptions, "limit" | "all" | "rule" | "path"> = {};
  const limit = args.flags["limit"];
  if (typeof limit === "string") {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isFinite(parsed) && parsed >= 0) out.limit = parsed;
  }
  if (args.flags["all"] === true) out.all = true;
  const rule = args.flags["rule"];
  if (typeof rule === "string" && rule.length > 0) out.rule = rule;
  // `path` was declared in the return type and never assigned, so
  // `lint --path X` was accepted and filtered nothing — worse than an absent
  // flag. NFC because the caller's bytes are not the vault's.
  const path = args.flags["path"];
  if (typeof path === "string" && path.length > 0) out.path = path.normalize("NFC");
  return out;
}
