// v2 contracts §9.3: `write --from <dir> [--dry-run]` — `<dir>/ops.json`
// (optional), then the drafts. The expected bases are checked against the
// disk's bytes (`base-mismatch`); the operations apply in order — move,
// retire, retract, supersede — then every draft page in `<dir>`, mirroring
// the vault's paths, is laid in place; `created` and `updated` are stamped
// (the navigator's ruling 7); the whole batch is judged together under the
// overlay with the disk as its base; on no error finding on a page the batch
// touches, and none elsewhere that judging the disk alone does not give, the
// pages land through the batch writer (writer.ts `landBatch`), a move's old
// path removed last.
//
// Replaces the old `write` (legacy/write.ts) and absorbs `move` and `retire`
// (operations here) and `new` (the skeleton is `type show --brief`'s, and the
// agent writes the file). Kept from the old verb and re-justified: the
// Writer's splice (`applyWrite`) for the frontmatter keys an operation or a
// stamp sets, since a write differs from its input only inside the lines an
// op names; the clock seam (`today`), read once. Not carried: the stdin form,
// `--section --append`, `--retract`, `--replace-core` and `--correct` (the
// first two are a draft; the others are operations or a draft), the
// new-page identity gate's stem tier, `--not-any-of` and the `near` list
// (an identity collision with an existing page is the judge's
// `identity-collision`), and the retirement banner.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  applyWrite,
  basenameOf,
  bytesDigest,
  type ClaimRecord,
  codeUnitCompare,
  collectTypeLaw,
  findingKey,
  isContentPath,
  type JudgeState,
  normalizeIdentity,
  parsePage,
  readPages,
  type TypeLaw,
  type VerdictFinding,
  verdictOfCollected,
  type WriteOp,
} from "@wikiwright/core";
import { today } from "../clock.ts";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { fsState, type Move, overlayFromState, workingTreeDigest } from "../lawstate.ts";
import {
  closeLine,
  OPS_FILE,
  type OpsFile,
  parseOps,
  renameLinks,
  retractClause,
  supersedeClause,
} from "../ops.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";
import { engineMismatch, lawOf, stateRefusal, typeLawIdentity, withIdentity } from "../typelaw.ts";
import { landBatch, preflightBatch } from "../writer.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Step<T> = { ok: true; value: T } | { ok: false; result: CommandResult };

function refuse<T>(result: CommandResult): Step<T> {
  return { ok: false, result };
}

/** The drafts under `dir`: every `.md` beneath it, at the vault path it mirrors. */
function draftsUnder(dir: string): { path: string; bytes: Uint8Array }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((rel) => rel.endsWith(".md") && statSync(join(dir, rel)).isFile())
    .sort(codeUnitCompare)
    .map((rel) => ({
      path: rel.normalize("NFC"),
      bytes: new Uint8Array(readFileSync(join(dir, rel))),
    }));
}

/** What one operation did, as the envelope reports it. */
interface Applied {
  op: "move" | "retire" | "retract" | "supersede";
  path: string;
  details: Record<string, unknown>;
}

/** The batch being built: the pages as the operations and drafts leave them. */
class Batch {
  readonly pages: Map<string, Uint8Array>;
  readonly touched = new Set<string>();
  readonly moves: Move[] = [];
  readonly applied: Applied[] = [];
  readonly disk: JudgeState;
  readonly law: TypeLaw;
  constructor(disk: JudgeState, law: TypeLaw) {
    this.disk = disk;
    this.law = law;
    this.pages = new Map(disk.pages);
  }

  text(path: string): string {
    return decoder.decode(this.pages.get(path) ?? new Uint8Array());
  }

  set(path: string, text: string): void {
    this.pages.set(path, encoder.encode(text));
    this.touched.add(path);
  }

  frontmatter(path: string): Record<string, unknown> {
    const read = parsePage(path, this.pages.get(path) ?? new Uint8Array(), this.law);
    return read.ok ? read.page.frontmatter : {};
  }

  /** The page a name resolves to among the batch's pages: by basename, then by alias. */
  resolve(name: string): string | undefined {
    const wanted = normalizeIdentity(name.trim());
    const paths = [...this.pages.keys()].sort(codeUnitCompare);
    const byName = paths.find((p) => normalizeIdentity(basenameOf(p)) === wanted);
    if (byName !== undefined) return byName;
    return paths.find((p) => {
      const aliases = this.frontmatter(p)["aliases"];
      return (
        Array.isArray(aliases) &&
        aliases.some((a) => typeof a === "string" && normalizeIdentity(a) === wanted)
      );
    });
  }

  /** The base of a page: the disk's bytes at its path, or at the path it moved from. */
  base(path: string): Uint8Array | undefined {
    const from = this.moves.find((m) => m.to === path)?.from;
    return this.disk.pages.get(from ?? path);
  }
}

function splice(
  batch: Batch,
  path: string,
  ops: Parameters<typeof applyWrite>[1],
  op: string,
): Step<void> {
  const spliced = applyWrite(batch.text(path), ops);
  if (!spliced.ok) {
    return refuse(
      fail("write", "conflict", "splice-refused", `${op} on ${path}: ${spliced.reason}`, {
        details: { op, path, reason: spliced.reason },
      }),
    );
  }
  batch.set(path, spliced.text);
  return { ok: true, value: undefined };
}

function missingPage(op: string, index: number, path: string): CommandResult {
  return fail(
    "write",
    "not_found",
    "page-not-found",
    `${op}[${index}] names no page at "${path}"`,
    {
      details: { op, index, path },
    },
  );
}

/** §9.3 `move`: the page leaves `from` for `to`; the rename keeps the old name and every link follows. */
function applyMoves(batch: Batch, ops: OpsFile): Step<void> {
  const roots = batch.law.engine.content_roots;
  for (const [index, move] of ops.move.entries()) {
    if (!batch.pages.has(move.from)) return refuse(missingPage("move", index, move.from));
    if (!isContentPath(move.to, roots)) {
      return refuse(
        fail(
          "write",
          "usage",
          "invalid-path",
          `move[${index}]: "${move.to}" is not a page under the content roots`,
          {
            details: { op: "move", index, path: move.to, content_roots: roots },
          },
        ),
      );
    }
    if (move.to !== move.from && normalizeIdentity(move.to) === normalizeIdentity(move.from)) {
      // On a case-insensitive filesystem the two spellings are one file: the
      // landing would write the page and then remove it as the path it left.
      return refuse(
        fail(
          "write",
          "conflict",
          "move-case-only",
          `move[${index}]: "${move.to}" differs from "${move.from}" only in case or normalization`,
          {
            details: { op: "move", index, from: move.from, to: move.to },
            hint: "a page's name is compared case-folded, so the rename changes no link; rename the file with git mv",
          },
        ),
      );
    }
    const taken = [...batch.pages.keys()].find(
      (path) => normalizeIdentity(path) === normalizeIdentity(move.to),
    );
    if (taken !== undefined) {
      return refuse(
        fail(
          "write",
          "conflict",
          "destination-exists",
          `move[${index}]: a page already exists at "${taken}"`,
          {
            details: { op: "move", index, path: move.to, existing: taken },
          },
        ),
      );
    }
    const bytes = batch.pages.get(move.from) as Uint8Array;
    batch.pages.delete(move.from);
    batch.touched.delete(move.from);
    batch.pages.set(move.to, bytes);
    batch.touched.add(move.to);
    const earlier = batch.moves.find((m) => m.to === move.from);
    if (earlier !== undefined) earlier.to = move.to;
    else batch.moves.push({ from: move.from, to: move.to });
    const oldName = basenameOf(move.from);
    const newName = basenameOf(move.to);
    const rewritten: string[] = [];
    let aliased = false;
    if (normalizeIdentity(oldName) !== normalizeIdentity(newName)) {
      // The rename ritual: the old name survives as an alias, so a reference
      // the batch does not rewrite — a frontmatter page reference, another
      // bundle's link — still resolves, and the gate's rename review holds.
      const aliases = batch.frontmatter(move.to)["aliases"];
      const existing = Array.isArray(aliases) ? aliases : [];
      if (
        !existing.some(
          (a) => typeof a === "string" && normalizeIdentity(a) === normalizeIdentity(oldName),
        )
      ) {
        const done = splice(
          batch,
          move.to,
          [{ kind: "frontmatter-list", field: "aliases", existing, add: [oldName] }],
          "move",
        );
        if (!done.ok) return done;
        aliased = true;
      }
      for (const path of [...batch.pages.keys()].sort(codeUnitCompare)) {
        const renamed = renameLinks(batch.text(path), oldName, newName);
        if (renamed.count === 0) continue;
        batch.set(path, renamed.text);
        rewritten.push(path);
      }
    }
    batch.applied.push({
      op: "move",
      path: move.to,
      details: { from: move.from, reason: move.reason, aliased, rewritten_links: rewritten },
    });
  }
  return { ok: true, value: undefined };
}

/** §9.3 `retire`: `status: retired`, and `superseded_by` the successor's name. */
function applyRetirements(batch: Batch, ops: OpsFile): Step<void> {
  for (const [index, retire] of ops.retire.entries()) {
    if (!batch.pages.has(retire.path)) return refuse(missingPage("retire", index, retire.path));
    if (batch.frontmatter(retire.path)["status"] === "retired") {
      return refuse(
        fail(
          "write",
          "conflict",
          "already-retired",
          `retire[${index}]: "${retire.path}" is already retired`,
          {
            details: { op: "retire", index, path: retire.path },
          },
        ),
      );
    }
    const edits: WriteOp[] = [{ kind: "frontmatter-set", field: "status", value: "retired" }];
    let successor: string | null = null;
    if (retire.successor !== null) {
      const found = batch.resolve(retire.successor);
      if (found === undefined) {
        return refuse(
          fail(
            "write",
            "not_found",
            "unknown-successor",
            `retire[${index}]: no page is named "${retire.successor}"`,
            {
              details: { op: "retire", index, successor: retire.successor },
            },
          ),
        );
      }
      successor = basenameOf(found);
      edits.push({ kind: "frontmatter-set", field: "superseded_by", value: successor });
    }
    const done = splice(batch, retire.path, edits, "retire");
    if (!done.ok) return done;
    batch.applied.push({ op: "retire", path: retire.path, details: { successor } });
  }
  return { ok: true, value: undefined };
}

function claimsOf(batch: Batch, path: string): ClaimRecord[] {
  const read = parsePage(path, batch.pages.get(path) ?? new Uint8Array(), batch.law);
  if (!read.ok) return [];
  return read.page.occurrences.flatMap((o) =>
    o.items.filter((i): i is ClaimRecord => i.kind === "claim"),
  );
}

/** The open claim `handle` names on the page, or the refusal. */
function openClaim(
  batch: Batch,
  op: "retract" | "supersede",
  index: number,
  path: string,
  handle: string,
): Step<ClaimRecord> {
  if (!batch.pages.has(path)) return refuse(missingPage(op, index, path));
  const claims = claimsOf(batch, path);
  const claim = claims.find((c) => c.handle === handle);
  if (claim === undefined) {
    return refuse(
      fail(
        "write",
        "not_found",
        "claim-not-found",
        `${op}[${index}]: ${path} holds no claim ${handle}`,
        {
          details: { op, index, path, handle, valid_values: claims.map((c) => c.handle) },
        },
      ),
    );
  }
  if (claim.retracted !== null || claim.superseded !== null) {
    return refuse(
      fail(
        "write",
        "conflict",
        "claim-not-open",
        `${op}[${index}]: the claim ${handle} on ${path} is already closed`,
        {
          details: { op, index, path, handle },
        },
      ),
    );
  }
  return { ok: true, value: claim };
}

/** §9.3 `retract` then `supersede`: the closing clause appended to the claim's own line. */
function applyClosures(batch: Batch, ops: OpsFile, date: string): Step<void> {
  for (const [index, retract] of ops.retract.entries()) {
    const claim = openClaim(batch, "retract", index, retract.path, retract.handle);
    if (!claim.ok) return claim;
    const on = retract.date ?? date;
    batch.set(
      retract.path,
      closeLine(batch.text(retract.path), claim.value.location.line, retractClause(on)),
    );
    batch.applied.push({
      op: "retract",
      path: retract.path,
      details: { handle: retract.handle, date: on },
    });
  }
  for (const [index, supersede] of ops.supersede.entries()) {
    const claim = openClaim(batch, "supersede", index, supersede.path, supersede.handle);
    if (!claim.ok) return claim;
    const by = claimsOf(batch, supersede.path).find(
      (c) => c.handle === supersede.by && c.handle !== supersede.handle,
    );
    if (by === undefined) {
      return refuse(
        fail(
          "write",
          "not_found",
          "claim-not-found",
          `supersede[${index}]: ${supersede.path} holds no other claim ${supersede.by} to supersede ${supersede.handle} by`,
          { details: { op: "supersede", index, path: supersede.path, handle: supersede.by } },
        ),
      );
    }
    const on = supersede.date ?? date;
    batch.set(
      supersede.path,
      closeLine(
        batch.text(supersede.path),
        claim.value.location.line,
        supersedeClause(on, supersede.by),
      ),
    );
    batch.applied.push({
      op: "supersede",
      path: supersede.path,
      details: { handle: supersede.handle, by: supersede.by, date: on },
    });
  }
  return { ok: true, value: undefined };
}

/**
 * Ruling 7: `created` on a page new to the vault, where the draft carries
 * none, and `updated` on every page the batch changes, where the effective
 * shape declares the key. A page whose frontmatter does not read is not
 * stamped; the judge reports it.
 */
function stamp(batch: Batch, path: string, date: string): Step<void> {
  const bytes = batch.pages.get(path) ?? new Uint8Array();
  const read = parsePage(path, bytes, batch.law);
  if (!read.ok || read.page.frontmatterCode !== undefined || read.page.type === undefined)
    return { ok: true, value: undefined };
  const declared = read.page.type.properties;
  const base = batch.base(path);
  const edits: WriteOp[] = [];
  if (
    base === undefined &&
    declared.includes("created") &&
    typeof read.page.frontmatter["created"] !== "string"
  )
    edits.push({ kind: "frontmatter-set", field: "created", value: date });
  if (declared.includes("updated"))
    edits.push({ kind: "frontmatter-set", field: "updated", value: date });
  if (edits.length === 0) return { ok: true, value: undefined };
  return splice(batch, path, edits, "stamp");
}

function same(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** One `write` read, applied, stamped and judged: the run and its dry run share it. */
interface Prepared {
  disk: JudgeState;
  law: TypeLaw;
  batch: Batch;
  /** Every page the batch lands, in path order. */
  changed: string[];
  overlay: JudgeState;
  findings: VerdictFinding[];
  from: string;
  date: string;
}

async function prepare(args: CommandArgs): Promise<Step<Prepared>> {
  const from = args.flags["from"];
  if (typeof from !== "string" || from.length === 0) {
    return refuse(
      fail(
        "write",
        "usage",
        "missing-argument",
        "write needs --from <dir>: the drafts and an optional ops.json",
        {
          details: { expected_flags: ["--from"] },
        },
      ),
    );
  }
  const dir = resolve(args.root, from);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return refuse(
      fail("write", "not_found", "drafts-not-found", `no directory at "${from}"`, {
        details: { from },
      }),
    );
  }
  let ops: OpsFile = { bases: {}, move: [], retire: [], retract: [], supersede: [] };
  if (existsSync(join(dir, OPS_FILE))) {
    const parsed = parseOps(readFileSync(join(dir, OPS_FILE), "utf8"));
    if (!parsed.ok) {
      return refuse(
        fail(
          "write",
          "usage",
          "ops-invalid",
          `ops.json${parsed.pointer === "" ? "" : ` at ${parsed.pointer}`} ${parsed.reason}`,
          {
            details: { pointer: parsed.pointer, reason: parsed.reason },
          },
        ),
      );
    }
    ops = parsed.ops;
  }
  const drafts = draftsUnder(dir);
  let disk: JudgeState;
  try {
    disk = await fsState(args.root);
  } catch (e) {
    const refused = stateRefusal("write", e);
    if (refused === undefined) throw e;
    return refuse(refused);
  }
  const loaded = lawOf("write", disk);
  if (!loaded.ok) return refuse(loaded.result);
  const law = loaded.law;
  const mismatch = engineMismatch("write", law);
  if (mismatch !== undefined) return refuse(mismatch);
  const roots = law.engine.content_roots;
  for (const draft of drafts) {
    if (!isContentPath(draft.path, roots)) {
      return refuse(
        fail(
          "write",
          "usage",
          "draft-outside-content",
          `the draft "${draft.path}" is not a page under the content roots`,
          {
            details: { path: draft.path, content_roots: roots },
          },
        ),
      );
    }
  }
  // §9.3: a page whose recorded base differs from the current bytes.
  for (const [path, expected] of Object.entries(ops.bases).sort(([a], [b]) =>
    codeUnitCompare(a, b),
  )) {
    const bytes = disk.pages.get(path);
    const actual = bytes === undefined ? null : bytesDigest(bytes);
    if (actual !== expected) {
      return refuse(
        fail(
          "write",
          "conflict",
          "base-mismatch",
          `the bytes of "${path}" are not the base ops.json records`,
          {
            details: { path, expected, actual },
            hint: "read the page again, re-apply your change to its current bytes, and record the new digest",
          },
        ),
      );
    }
  }
  const date = today();
  const batch = new Batch(disk, law);
  for (const step of [
    applyMoves(batch, ops),
    applyRetirements(batch, ops),
    applyClosures(batch, ops, date),
  ]) {
    if (!step.ok) return step;
  }
  const movedFrom = new Set(batch.moves.map((m) => m.from));
  const byOps = new Set(batch.touched);
  for (const draft of drafts) {
    if (movedFrom.has(draft.path) && !batch.pages.has(draft.path)) {
      return refuse(
        fail(
          "write",
          "conflict",
          "draft-on-moved-path",
          `the draft "${draft.path}" is at a path a move leaves`,
          {
            details: { path: draft.path },
          },
        ),
      );
    }
    if (byOps.has(draft.path)) {
      return refuse(
        fail(
          "write",
          "conflict",
          "draft-overlaps-op",
          `the draft "${draft.path}" names a page an operation changes`,
          {
            details: { path: draft.path },
            hint: "write the change into the draft, or leave the page to the operation: a batch changes a page one way",
          },
        ),
      );
    }
    batch.pages.set(draft.path, draft.bytes);
    batch.touched.add(draft.path);
  }
  for (const path of [...batch.touched].sort(codeUnitCompare)) {
    if (same(batch.pages.get(path), batch.base(path))) continue;
    const stamped = stamp(batch, path, date);
    if (!stamped.ok) return stamped;
  }
  const movedTo = new Set(batch.moves.map((m) => m.to));
  const changed = [...batch.touched]
    .filter((path) => movedTo.has(path) || !same(batch.pages.get(path), batch.base(path)))
    .sort(codeUnitCompare);
  let overlay: JudgeState;
  try {
    overlay = overlayFromState(
      disk,
      changed.map((path) => ({ path, bytes: batch.pages.get(path) as Uint8Array })),
      batch.moves,
    );
  } catch (e) {
    const refused = stateRefusal("write", e);
    if (refused !== undefined) return refuse(refused);
    return refuse(
      fail("write", "usage", "draft-refused", e instanceof Error ? e.message : String(e)),
    );
  }
  const read = readPages(overlay, law);
  const collected = collectTypeLaw(overlay, law, { read, lawTests: false });
  const touched = new Set(changed);
  const verdict = verdictOfCollected(collected, { all: true });
  // §9.3 installs on no error finding: every finding on a page the batch
  // touches, and every other finding the disk alone does not give — a page
  // the batch makes invalid, an identity collision reported on the page it
  // collides with, an instance count at its type's law file.
  const before = new Set(
    verdictOfCollected(collectTypeLaw(disk, law, { lawTests: false }), { all: true }).findings.map(
      findingKey,
    ),
  );
  const findings = verdict.findings.filter(
    (f) => touched.has(f.path) || !before.has(findingKey(f)),
  );
  return {
    ok: true,
    value: { disk, law, batch, changed, overlay, findings, from, date },
  };
}

function planOps(prepared: Prepared): PlanOp[] {
  const ops: PlanOp[] = [];
  for (const move of prepared.batch.moves) {
    ops.push({
      kind: "rename",
      path: move.to,
      from: move.from,
      summary: `move ${move.from} → ${move.to}`,
    });
  }
  const moved = new Set(prepared.batch.moves.map((m) => m.to));
  for (const path of prepared.changed) {
    if (moved.has(path)) continue;
    const exists = prepared.disk.pages.has(path);
    ops.push({
      kind: exists ? "write" : "create",
      path,
      summary: exists ? "replace the page" : "create the page",
    });
  }
  return ops.sort((a, b) => codeUnitCompare(a.path, b.path));
}

function pageRows(prepared: Prepared) {
  return prepared.changed.map((path) => {
    const base = prepared.batch.base(path);
    const move = prepared.batch.moves.find((m) => m.to === path);
    const after = prepared.batch.pages.get(path) as Uint8Array;
    return {
      path,
      created: base === undefined,
      ...(move === undefined ? {} : { moved_from: move.from }),
      findings: prepared.findings.filter((f) => f.path === path),
      digest: { before: base === undefined ? null : bytesDigest(base), after: bytesDigest(after) },
    };
  });
}

async function planForWrite(args: CommandArgs): Promise<Plan> {
  const prepared = await prepare(args);
  return planOf(prepared.ok ? planOps(prepared.value) : []);
}

async function run(args: CommandArgs): Promise<CommandResult> {
  const step = await prepare(args);
  if (!step.ok) return step.result;
  const prepared = step.value;
  const errors = prepared.findings.filter((f) => f.severity === "error");
  const data = {
    from: prepared.from,
    date: prepared.date,
    operations: prepared.batch.applied,
    pages: pageRows(prepared),
    findings: prepared.findings,
  };
  const plan = planOps(prepared);
  if (errors.length > 0) {
    const failing = [...new Set(errors.map((f) => f.path))].sort(codeUnitCompare);
    const refused = fail(
      "write",
      "findings",
      "draft-invalid",
      `${errors.length} error finding(s) on ${failing.length} page(s), the batch touching ${prepared.changed.length}; nothing landed`,
      {
        data: { ...planOf(plan.length === 0 ? [] : plan), ...data, failing },
        hint: "each finding names its fix or its queue lane; the batch lands whole or not at all",
      },
    );
    return withIdentity(refused, await typeLawIdentity(args.root, prepared.disk, prepared.law));
  }
  const removed = prepared.batch.moves
    .map((move) => move.from)
    .filter((path) => !prepared.batch.pages.has(path));
  preflightBatch(args.root, prepared.changed, removed);
  let current: JudgeState;
  try {
    current = await fsState(args.root);
  } catch (error) {
    const refused = stateRefusal("write", error);
    if (refused === undefined) throw error;
    return withIdentity(refused, await typeLawIdentity(args.root, prepared.disk, prepared.law));
  }
  const expectedState = workingTreeDigest(prepared.disk);
  const actualState = workingTreeDigest(current);
  if (expectedState !== actualState) {
    return withIdentity(
      fail(
        "write",
        "conflict",
        "state-changed-before-write",
        "the bundle's pages or law changed after the draft base was read; nothing landed",
        {
          details: { expected: expectedState, actual: actualState },
          hint: "read the bundle again, re-apply the draft to its current bytes and law, then retry",
        },
      ),
      await typeLawIdentity(args.root, prepared.disk, prepared.law),
    );
  }
  if (isDryRun(args)) {
    return withIdentity(
      ok("write", { ...planOf(plan), ...data }),
      await typeLawIdentity(args.root, prepared.disk, prepared.law),
    );
  }
  landBatch(
    args.root,
    prepared.changed.map((path) => ({ path, bytes: prepared.batch.pages.get(path) as Uint8Array })),
    removed,
  );
  return withIdentity(
    ok("write", { ops: plan, wrote: true, ...data }),
    await typeLawIdentity(args.root, prepared.overlay, prepared.law),
  );
}

export const writeCommand: CommandSpec = {
  name: "write",
  summary:
    "Land a directory of drafts and its ops.json (bases, move, retire, retract, supersede) as one batch, judged together with the disk as its base.",
  positionals: [],
  flags: [
    {
      name: "from",
      type: "string",
      summary: "the directory of drafts, mirroring the vault's paths, with an optional ops.json",
    },
  ],
  examples: ["wikiwright write --from drafts --dry-run", "wikiwright write --from drafts"],
  writes: true,
  plan: planForWrite,
  run,
};
