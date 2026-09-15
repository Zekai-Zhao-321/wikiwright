// docs/cli.md §The envelope (one envelope on stdout, uniform shapes, prose
// never load-bearing) · the closed exit taxonomy, JSON-only v1
// docs/concepts.md §Findings and routing (the verdict envelope and the cap flags every judging verb
// prints — docs/architecture.md §Directories keeps the envelope helpers here rather than beside a verb).
import type { JudgeOptions, Verdict } from "@wikiwright/core";
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
  confirm_required: 10,
} as const;

export type ErrorType = Exclude<keyof typeof EXIT, "ok">;

export const ENGINE_VERSION = "0.1.0";

export interface Metadata {
  command: string;
  engine: string;
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
