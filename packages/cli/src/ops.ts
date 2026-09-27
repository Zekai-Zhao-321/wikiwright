// v2 contracts §9.3: `write --from <dir>`'s `ops.json` — the expected bases
// and the four operations a batch applies before its drafts, in that order:
// `move`, `retire`, `retract`, `supersede`.
//
//   { "bases":     { "<path>": "<bytes digest>" },
//     "move":      [{ "from", "to", "reason" }],
//     "retire":    [{ "path", "successor" }],
//     "retract":   [{ "path", "handle", "date" }],
//     "supersede": [{ "path", "handle", "by", "date" }] }
//
// Every key is optional; an unknown key, a value of the wrong kind, a handle
// that is not `#` and eight hex digits or a date not on the calendar is
// `ops-invalid`, with the JSON pointer. `successor` may be absent or null (a
// retirement with no successor); `date` may be absent, and is then the
// shell's clock (`WIKIWRIGHT_TODAY`). A handle is the claim's computed `#`
// and eight hex digits (the navigator's ruling 5), and `by` names the claim
// that replaced it in the spelling the clause writes: `by #xxxxxxxx`.
//
// Pure text: the verb reads the pages and applies the operations through
// these helpers. Ported from the old verbs' line edits (legacy/write.ts
// `closeLine`, `supersedeClause`, `dayBefore`; legacy/move.ts's rename
// ritual): the closing clause is appended to the claim's own line, the
// author's bytes kept; a supersession names the day before it as the end of
// the claim's validity. Changed: a supersession's clause carries the
// replacing claim's handle, and no validity start (a claim records none).
import { isDate, normalizeIdentity } from "@wikiwright/core";

export interface MoveOp {
  from: string;
  to: string;
  reason: string;
}
export interface RetireOp {
  path: string;
  successor: string | null;
}
export interface RetractOp {
  path: string;
  handle: string;
  date: string | null;
}
export interface SupersedeOp {
  path: string;
  handle: string;
  by: string;
  date: string | null;
}

export interface OpsFile {
  bases: Record<string, string>;
  move: MoveOp[];
  retire: RetireOp[];
  retract: RetractOp[];
  supersede: SupersedeOp[];
}

export const OPS_FILE = "ops.json";

export type OpsRead = { ok: true; ops: OpsFile } | { ok: false; pointer: string; reason: string };

const HANDLE = /^#[0-9a-f]{8}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

class Invalid extends Error {
  readonly pointer: string;
  constructor(pointer: string, reason: string) {
    super(reason);
    this.pointer = pointer;
  }
}

function record(value: unknown, pointer: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Invalid(pointer, "is not an object");
  return value as Record<string, unknown>;
}

function keysOf(value: Record<string, unknown>, pointer: string, allowed: readonly string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Invalid(`${pointer}/${key}`, "is not a key of ops.json here");
}

function text(value: unknown, pointer: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Invalid(pointer, "is not a non-empty string");
  return value;
}

function handle(value: unknown, pointer: string): string {
  const h = text(value, pointer);
  if (!HANDLE.test(h))
    throw new Invalid(pointer, 'is not a claim handle, "#" and eight hex digits');
  return h;
}

function date(value: unknown, pointer: string): string | null {
  if (value === undefined || value === null) return null;
  const d = text(value, pointer);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(d) || !isDate(d))
    throw new Invalid(pointer, "is not a YYYY-MM-DD date on the calendar");
  return d;
}

function list<T>(
  value: unknown,
  pointer: string,
  keys: readonly string[],
  read: (item: Record<string, unknown>, at: string) => T,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Invalid(pointer, "is not a list");
  return value.map((item, i) => {
    const at = `${pointer}/${i}`;
    const rec = record(item, at);
    keysOf(rec, at, keys);
    return read(rec, at);
  });
}

/** `ops.json` read and held to its shape. */
export function parseOps(source: string): OpsRead {
  let json: unknown;
  try {
    json = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  } catch (error) {
    return { ok: false, pointer: "", reason: `is not JSON: ${(error as Error).message}` };
  }
  try {
    const top = record(json, "");
    keysOf(top, "", ["bases", "move", "retire", "retract", "supersede"]);
    const bases: Record<string, string> = {};
    if (top["bases"] !== undefined) {
      for (const [path, digest] of Object.entries(record(top["bases"], "/bases"))) {
        const at = `/bases/${path.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        if (typeof digest !== "string" || !DIGEST.test(digest))
          throw new Invalid(at, "is not a bytes digest, 64 hex digits");
        bases[path.normalize("NFC")] = digest;
      }
    }
    return {
      ok: true,
      ops: {
        bases,
        move: list(top["move"], "/move", ["from", "to", "reason"], (r, at) => ({
          from: text(r["from"], `${at}/from`).normalize("NFC"),
          to: text(r["to"], `${at}/to`).normalize("NFC"),
          reason: text(r["reason"], `${at}/reason`),
        })),
        retire: list(top["retire"], "/retire", ["path", "successor"], (r, at) => ({
          path: text(r["path"], `${at}/path`).normalize("NFC"),
          successor:
            r["successor"] === undefined || r["successor"] === null
              ? null
              : text(r["successor"], `${at}/successor`),
        })),
        retract: list(top["retract"], "/retract", ["path", "handle", "date"], (r, at) => ({
          path: text(r["path"], `${at}/path`).normalize("NFC"),
          handle: handle(r["handle"], `${at}/handle`),
          date: date(r["date"], `${at}/date`),
        })),
        supersede: list(
          top["supersede"],
          "/supersede",
          ["path", "handle", "by", "date"],
          (r, at) => ({
            path: text(r["path"], `${at}/path`).normalize("NFC"),
            handle: handle(r["handle"], `${at}/handle`),
            by: handle(r["by"], `${at}/by`),
            date: date(r["date"], `${at}/date`),
          }),
        ),
      },
    };
  } catch (error) {
    if (error instanceof Invalid)
      return { ok: false, pointer: error.pointer, reason: error.message };
    throw error;
  }
}

/** The day before `iso`, in the proleptic Gregorian calendar. */
export function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map((p) => Number.parseInt(p, 10));
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The clause a retraction appends. */
export function retractClause(on: string): string {
  return `retracted ${on}`;
}

/** The clause a supersession appends: valid until the day before, replaced by `by`. */
export function supersedeClause(on: string, by: string): string {
  return `valid →${dayBefore(on)}, superseded ${on} by ${by}`;
}

/** The page's text with ` (<clause>)` appended to line `line` (1-based), its ending kept. */
export function closeLine(source: string, line: number, clause: string): string {
  const lines = source.split("\n");
  const at = lines[line - 1];
  if (at === undefined) return source;
  const cr = at.endsWith("\r");
  const body = cr ? at.slice(0, -1) : at;
  lines[line - 1] = `${body.trimEnd()} (${clause})${cr ? "\r" : ""}`;
  return lines.join("\n");
}

const WIKILINK = /\[\[([^[\]|#]+)(#[^[\]|]*)?(\|[^[\]]*)?\]\]/gu;

/**
 * Every wikilink naming `from` — a body link, a claim's provenance, a
 * relation's target — renamed to `to`, its heading and alias kept. The number
 * of links rewritten comes back beside the text.
 */
export function renameLinks(
  source: string,
  from: string,
  to: string,
): { text: string; count: number } {
  const wanted = normalizeIdentity(from.trim());
  let count = 0;
  const out = source.replace(WIKILINK, (link, target: string, heading?: string, alias?: string) => {
    if (normalizeIdentity(target.trim()) !== wanted) return link;
    count += 1;
    return `[[${to}${heading ?? ""}${alias ?? ""}]]`;
  });
  return { text: out, count };
}
