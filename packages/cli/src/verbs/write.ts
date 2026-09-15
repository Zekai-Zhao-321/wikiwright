// docs/cli.md §write (Markdown in, the judge with the disk as base, a splice
// of the lines the invocation names, a proof, one write) · docs/concepts.md §The judge and its states
// docs/concepts.md §Section grammar · docs/constitution.md §Shapes (created on create, updated on write — the only
// frontmatter the engine authors) · docs/architecture.md

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  basenameOf,
  buildNameIndex,
  buildNearIndex,
  type ClaimItem,
  type ClaimsParams,
  claimClass,
  codeUnitCompare,
  type EffectiveType,
  type Finding,
  grammarBindings,
  judge,
  type Law,
  nameFormsOf,
  nearCandidates,
  normalizeIdentity,
  type PageInput,
  type ParsedDoc,
  parseDoc,
  parseOptionsOf,
  parseSections,
  type SectionBinding,
  type SectionNode,
  shapeAuto,
  transitionArms,
  transitionSeam,
  type UnevaluatedRow,
  type VaultState,
  type WriteOp,
  type WritePlan,
} from "@wikiwright/core";
import { today } from "../clock.ts";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { lawFor, lintOptionsFor, rootsOf, type VaultOk } from "../law.ts";
import { collectPages } from "../pages.ts";
import { contentPathRefusal } from "../paths.ts";
import {
  type CommandArgs,
  type CommandSpec,
  isDryRun,
  listFlag,
  type Plan,
  type PlanOp,
  planOf,
} from "../spec.ts";
import { fsState, overlayState } from "../state.ts";
import { loadVault, readPage, walkPages } from "../vaultio.ts";
import { commitWrite, commitWrites, proveWrite, sha256, splicePlan, writeOps } from "../writer.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/u;

/** The day before `iso`, in the proleptic Gregorian calendar (docs/concepts.md §The judge and its states). */
export function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map((p) => Number.parseInt(p, 10));
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// the auto stamps — the ONLY frontmatter the engine authors (docs/constitution.md §Shapes)

function autoOps(
  effective: EffectiveType | undefined,
  draft: string,
  date: string,
  creating: boolean,
): WriteOp[] {
  if (effective === undefined) return [];
  const frontmatter = parseDoc(draft).frontmatter;
  // A block the parser could not read gets no stamp — the splice would
  // refuse it as `stamp-refused`, one exit code away from the one finding the
  // judge is about to report. The judge reports it; the stamps wait for a
  // draft the parser reads.
  if (frontmatter.issues.some((issue) => issue.code !== "duplicate-key")) return [];
  const value = frontmatter.value;
  const ops: WriteOp[] = [];
  for (const [field, declared] of [...effective.fields].sort((a, b) =>
    codeUnitCompare(a[0], b[0]),
  )) {
    const auto = shapeAuto(declared.shape);
    if (auto === undefined) continue;
    // `on-create` is written once, at birth: a later write that re-stamped it
    // would rewrite the page's own age. `on-write` is written every time.
    if (auto === "on-create" && (!creating || typeof value[field] === "string")) continue;
    ops.push({ kind: "frontmatter-set", field, value: date });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// the new-page identity gate (docs/cli.md §write)

export interface IdentityHit {
  tier: "exact" | "alias" | "derived-title" | "stem";
  path: string;
  name: string;
}

/**
 * docs/cli.md §write: the tiers that BLOCK a create — exact, alias, derived title, stem.
 * `near` stays advisory and rides in the envelope: a ranked guess may inform a
 * writer and may not gate one.
 */
export function identityHits(existing: readonly PageInput[], draft: PageInput): IdentityHit[] {
  const wanted = new Set(nameFormsOf(draft).map((n) => normalizeIdentity(n)));
  const hits: IdentityHit[] = [];
  for (const page of existing) {
    if (page.path === draft.path) continue;
    const fm = page.doc.frontmatter.value;
    const aliases = Array.isArray(fm["aliases"])
      ? fm["aliases"].filter((a): a is string => typeof a === "string")
      : [];
    const title = typeof fm["title"] === "string" ? fm["title"] : undefined;
    const basename = basenameOf(page.path);
    const tiers: { tier: IdentityHit["tier"]; names: string[] }[] = [
      { tier: "exact", names: [basename] },
      { tier: "alias", names: aliases },
      { tier: "derived-title", names: title === undefined ? [] : [title] },
      {
        tier: "stem",
        names: nameFormsOf(page).filter(
          (n) => n !== basename && !aliases.includes(n) && n !== title,
        ),
      },
    ];
    for (const { tier, names } of tiers) {
      const found = names.find((n) => wanted.has(normalizeIdentity(n)));
      if (found !== undefined) {
        hits.push({ tier, path: page.path, name: found });
        break;
      }
    }
  }
  return hits.sort((a, b) => codeUnitCompare(a.path, b.path));
}

// ---------------------------------------------------------------------------
// section resolution and claim rendering

interface Sections {
  open: SectionNode;
  history: SectionNode | undefined;
  historyHeading: string | undefined;
}

type SectionsResult =
  | { ok: true; sections: Sections }
  | {
      ok: false;
      /** `unknown-section`: the type declares no such heading. `section-absent`: declared, not on the page. */
      code: "unknown-section" | "section-absent" | "untyped-page";
      message: string;
      /** Every heading the type declares — the legal domain, in `details`. */
      declared: string[];
    };

/** The binding a heading names, by identity, through the declared heading and its aliases. */
function bindingFor(
  bindings: readonly SectionBinding[],
  heading: string,
): SectionBinding | undefined {
  const wanted = normalizeIdentity(heading);
  return bindings.find((b) =>
    [b.heading, ...(b.aliases ?? [])].some((name) => normalizeIdentity(name) === wanted),
  );
}

function sectionAst(vault: VaultOk, doc: ParsedDoc, bindings: readonly SectionBinding[]) {
  return parseSections(doc, bindings, parseOptionsOf(lintOptionsFor(vault, buildNameIndex([]))));
}

/**
 * The section a form edits, resolved through the TYPE's declared sections and
 * then the page: a heading the type does not declare is `unknown-section`; one
 * it declares and the page does not carry is `section-absent`, which an append
 * answers by adding the heading (`appendUnderSection`) and a claims form cannot.
 */
function sectionsOf(vault: VaultOk, path: string, text: string, heading: string): SectionsResult {
  const doc = parseDoc(text);
  const typeName = doc.frontmatter.value["type"];
  const effective = typeof typeName === "string" ? vault.registry.types.get(typeName) : undefined;
  if (effective === undefined) {
    return {
      ok: false,
      code: "untyped-page",
      message: `"${path}" declares no registered type, so it has no grammar`,
      declared: [],
    };
  }
  const bindings = grammarBindings(effective, vault.registry.modules);
  const declared = bindings.map((b) => b.heading);
  const binding = bindingFor(bindings, heading);
  if (binding === undefined) {
    return {
      ok: false,
      code: "unknown-section",
      message: `"${heading}" is not a declared section of type "${effective.name}" (declared: ${declared.join(", ")})`,
      declared,
    };
  }
  const ast = sectionAst(vault, doc, bindings);
  const open = ast.sections.find((s) => s.declared === binding.heading);
  if (open === undefined) {
    return {
      ok: false,
      code: "section-absent",
      message: `"${binding.heading}" is declared by type "${effective.name}" but is not on ${path}`,
      declared,
    };
  }
  const historyHeading = (open.binding.params as ClaimsParams).history;
  const history =
    historyHeading === undefined
      ? undefined
      : ast.sections.find(
          (s) => normalizeIdentity(s.declared) === normalizeIdentity(historyHeading),
        );
  return { ok: true, sections: { open, history, historyHeading } };
}

/** The page's lines as the Writer splits them: BOM off, a trailing newline as a final empty element. */
function pageLines(text: string): string[] {
  return (text.startsWith("\uFEFF") ? text.slice(1) : text).split(/\r?\n/u);
}

export type AppendUnderSection =
  | { ok: true; ops: WriteOp[]; binding: SectionBinding; created: boolean }
  | { ok: false; code: "unknown-section"; message: string; declared: string[] };

/**
 * The ops that put `lines` under a DECLARED section of `effective`: at the
 * section's tail when the page carries it, and — when the type declares it and
 * the page does not — the heading first, placed in declared order before the
 * first later section the page does carry, else at the end. One helper, so
 * `write --section --append` and `new --item` land an item the same way; the
 * grammar judges the lines afterwards, in the judge, and this reads no grammar.
 */
export function appendUnderSection(
  vault: VaultOk,
  effective: EffectiveType,
  text: string,
  heading: string,
  lines: readonly string[],
): AppendUnderSection {
  const bindings = grammarBindings(effective, vault.registry.modules);
  const declared = bindings.map((b) => b.heading);
  const binding = bindingFor(bindings, heading);
  if (binding === undefined) {
    return {
      ok: false,
      code: "unknown-section",
      message: `"${heading}" is not a declared section of type "${effective.name}" (declared: ${declared.join(", ")})`,
      declared,
    };
  }
  const ast = sectionAst(vault, parseDoc(text), bindings);
  const present = ast.sections.find((s) => s.declared === binding.heading);
  if (present !== undefined) {
    return {
      ok: true,
      binding,
      created: false,
      ops: [
        {
          kind: "append-section",
          heading: present.declared,
          depth: present.depth,
          lines: [...lines],
        },
      ],
    };
  }
  // Where the heading goes: after the nearest section the page carries that
  // precedes it in declared order (a History lands after its Relations even
  // on a page whose sections run in another order), else before the first
  // later one the page carries, else at the end.
  const order = new Map(declared.map((h, i) => [h, i] as const));
  const mine = order.get(binding.heading) ?? declared.length;
  const byLine = [...ast.sections].sort((a, b) => a.line - b.line);
  const prev = byLine
    .filter((s) => (order.get(s.declared) ?? -1) < mine)
    .sort((a, b) => (order.get(b.declared) ?? -1) - (order.get(a.declared) ?? -1))[0];
  const following =
    prev === undefined
      ? byLine.find((s) => (order.get(s.declared) ?? -1) > mine)
      : byLine.find((s) => s.line > prev.line);
  const pageText = pageLines(text);
  const endsWithEol = pageText[pageText.length - 1] === "";
  const at =
    following === undefined
      ? endsWithEol
        ? pageText.length - 1
        : pageText.length
      : following.line - 1;
  const blankBefore = at > 0 && (pageText[at - 1] ?? "").trim() !== "" ? [""] : [];
  const headingLine = `${"#".repeat(binding.depth)} ${binding.heading}`;
  const block = [
    ...blankBefore,
    headingLine,
    "",
    ...lines,
    ...(following === undefined ? [] : [""]),
  ];
  return {
    ok: true,
    binding,
    created: true,
    ops: [{ kind: "insert", after: at, lines: block }],
  };
}

function claimsOf(section: SectionNode): ClaimItem[] {
  return section.items.filter((i): i is ClaimItem => i.kind === "claim");
}

function findClaim(
  section: SectionNode,
  handle: string | undefined,
  line: number | undefined,
): ClaimItem | undefined {
  const claims = claimsOf(section);
  if (line !== undefined) return claims.find((c) => c.line === line);
  if (handle === undefined) return undefined;
  const wanted = handle.startsWith("#") ? handle : `#${handle}`;
  return claims.find((c) => c.handle === wanted);
}

/**
 * docs/concepts.md §The judge and its states: the History line is the retired claim's OWN line plus the
 * closing clause. Re-rendering the core from the parse would put the engine's
 * dialect on a human's bytes; copying the line keeps every marker, every
 * separator and every parenthetical the author wrote, and makes the round-trip
 * proof exact.
 */
function closeLine(original: string, clause: string): string {
  return `${original.replace(/\s+$/u, "")} (${clause})`;
}

function supersedeClause(claim: ClaimItem, date: string): string {
  const from = claim.provenance?.date;
  const to = dayBefore(date);
  return from === undefined
    ? `valid →${to}, superseded ${date}`
    : `valid ${from}→${to}, superseded ${date}`;
}

// ---------------------------------------------------------------------------
// the verb

function stdinText(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * docs/cli.md §write: the drafts under `--from <dir>` — every `.md` beneath it,
 * each a draft at the same vault-relative path. Read once here, by the plan
 * and the run alike, so the plan names exactly the files the run would land.
 */
function draftsUnder(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((rel) => rel.endsWith(".md") && statSync(join(dir, rel)).isFile())
    .map((rel) => rel.normalize("NFC"))
    .sort(codeUnitCompare)
    .map((rel) => ({ path: rel, text: readFileSync(join(dir, rel), "utf8") }));
}

/** The plan op for one page: a create where the path is empty, a write where it is not. */
function pageOp(root: string, path: string): PlanOp[] {
  const exists = existsSync(join(root, path));
  return writeOps(
    path,
    exists ? "write" : "create",
    exists ? "replace the page with the draft" : "create the page from the draft",
  );
}

function planForWrite(args: CommandArgs): Plan {
  const from = args.flags["from"];
  if (typeof from === "string" && from.length > 0) {
    const dir = resolve(args.root, from);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return planOf([]);
    return planOf(draftsUnder(dir).flatMap((draft) => pageOp(args.root, draft.path)));
  }
  const [path] = args.positionals;
  if (path === undefined || path.length === 0) return planOf([]);
  const rel = path.normalize("NFC");
  const exists = existsSync(join(args.root, rel));
  return planOf(
    writeOps(
      rel,
      exists ? "write" : "create",
      exists ? "splice the lines this invocation names" : "create the page from the draft",
    ),
  );
}

interface Draft {
  path: string;
  content: string;
}

/** One draft as the judge saw it, with what the envelope reports per page. */
interface JudgedDraft {
  path: string;
  created: boolean;
  before: string;
  content: string;
  findings: Finding[];
  dispositions: Record<string, number>;
  claims: ReturnType<typeof claimHandles>;
  digest: { before: string | null; after: string };
}

type Judged =
  | { ok: true; pages: JudgedDraft[]; unevaluated: Record<string, UnevaluatedRow> }
  | { ok: false; result: CommandResult };

/**
 * docs/cli.md §write: the drafts, judged in ONE virtual state — the vault with every
 * draft in place of its page — and refused together or admitted together. The
 * whole-page form is a batch of one; `--from` is a batch of many (two
 * new pages that link each other cannot be written one at a time under an
 * error-severity relation section, so the judge sees both or neither). The
 * auto stamps are spliced into each draft first, so the engine's own two
 * fields are the only frontmatter it authors (docs/constitution.md §Shapes).
 */
function judgeDrafts(input: {
  args: CommandArgs;
  vault: VaultOk;
  drafts: readonly Draft[];
  date: string;
  notAnyOf: readonly string[];
  command: string;
}): Judged {
  const { args, vault, date, command } = input;
  const roots = rootsOf(vault);
  const law = lawFor(vault);
  const stamped: { path: string; created: boolean; before: string; text: string }[] = [];
  for (const draft of input.drafts) {
    const exists = existsSync(join(args.root, draft.path));
    const typeName = parseDoc(draft.content).frontmatter.value["type"];
    const effective = typeof typeName === "string" ? vault.registry.types.get(typeName) : undefined;
    const ops = autoOps(effective, draft.content, date, !exists);
    const spliced = splicePlan(draft.content, { path: draft.path, ops });
    if (!spliced.ok) {
      return {
        ok: false,
        result: fail(command, "conflict", "stamp-refused", `${draft.path}: ${spliced.reason}`, {
          hint: "the engine stamps created/updated and authors no other frontmatter",
        }),
      };
    }
    stamped.push({
      path: draft.path,
      created: !exists,
      before: exists ? readPage(args.root, draft.path) : "",
      text: spliced.spliced.text,
    });
  }
  const state = overlayState(fsState(args.root, roots), args.root, stamped);

  // docs/cli.md §write: the new-page identity gate, against the pages the vault HOLDS —
  // a draft answering to another draft's name is the judge's own
  // `identity-collision` below, since both are in the state it reads.
  const creating = stamped.filter((page) => page.created);
  if (creating.length > 0) {
    const existing = collectPages(args.root, walkPages(args.root, roots));
    const ruledOut = new Set(input.notAnyOf.map((n) => normalizeIdentity(n)));
    const blocking: (IdentityHit & { draft: string })[] = [];
    for (const page of creating) {
      for (const hit of identityHits(existing, { path: page.path, doc: parseDoc(page.text) })) {
        if (ruledOut.has(normalizeIdentity(hit.name))) continue;
        if (ruledOut.has(normalizeIdentity(basenameOf(hit.path)))) continue;
        blocking.push({ draft: page.path, ...hit });
      }
    }
    if (blocking.length > 0) {
      // docs/cli.md §write: `near` is ADVISORY and rides beside the blocking tiers — a
      // ranked guess may inform a writer and may not gate one, so it is in the
      // envelope and never in `blocking`.
      const nearIndex = buildNearIndex(existing);
      const near = creating.flatMap((page) =>
        nearCandidates(nearIndex, basenameOf(page.path), 5).map((c) => ({
          draft: page.path,
          path: c.path,
          name: c.name,
          why: c.why,
        })),
      );
      return {
        ok: false,
        result: fail(
          command,
          "confirm_required",
          "identity-candidates",
          `${blocking.length} existing page(s) answer to a name a draft claims`,
          {
            details: {
              candidates: blocking,
              near,
              legal: blocking.map((h) => ["--not-any-of", basenameOf(h.path)]),
            },
            hint: "name every candidate you ruled out with --not-any-of, or write to the existing page",
          },
        ),
      };
    }
  }

  const paths = new Set(stamped.map((page) => page.path));
  const verdict = judgeFor(state, law, paths);
  const removed = removedIllegally(verdict.findings, vault, paths);
  if (removed.length > 0) {
    return {
      ok: false,
      result: fail(
        command,
        "conflict",
        "removed-illegally",
        `${removed.length} governed item(s) left a page, or changed where the grammar forbids it`,
        {
          data: { findings: removed },
          // The path back is the arm's own: each transition arm says where a
          // removed item lands (a History line for a relation, a closing
          // clause for a claim), so the hint is those remediations and never a
          // fixed sentence about one grammar's verbs.
          hint: [
            "a whole-page write may not drop or rewrite a governed item; restore it, or land it where its arm says",
            ...[
              ...new Set(
                removed.map((f) => f.remediation).filter((r): r is string => r !== undefined),
              ),
            ],
          ].join(" · "),
        },
      ),
    };
  }
  const errors = verdict.findings.filter((f) => f.severity === "error");
  // One row per draft, on both outcomes: what the accepted run prints, so a
  // refusal reads like a dry run that failed — the findings grouped by
  // the page they are on, and the bytes that were judged.
  const rows = stamped.map((page) => ({
    path: page.path,
    created: page.created,
    findings: verdict.findings.filter((f) => f.path === page.path),
    dispositions: verdict.dispositions[page.path] ?? {},
    claims: claimHandles(vault, page.text),
    digest: { before: page.created ? null : sha256(page.before), after: sha256(page.text) },
  }));
  if (errors.length > 0) {
    const failing = [...new Set(errors.map((f) => f.path))].sort(codeUnitCompare);
    return {
      ok: false,
      result: fail(
        command,
        "findings",
        "draft-invalid",
        stamped.length === 1
          ? `draft fails ${errors.length} check(s)`
          : `${failing.length} of ${stamped.length} draft(s) fail ${errors.length} check(s); none landed`,
        {
          data: {
            findings: verdict.findings,
            pages: rows.map((row, i) => ({ ...row, preview: stamped[i]?.text ?? "" })),
            // docs/cli.md §new: the one draft that was judged, as the accepted
            // dry run prints it — a refusal a reader cannot see is a refusal a
            // reader cannot answer.
            ...(stamped.length === 1 ? { preview: stamped[0]?.text ?? "" } : { failing }),
          },
        },
      ),
    };
  }
  return {
    ok: true,
    // docs/concepts.md §Findings and routing: the KEYED block — which pass could not be
    // judged and why; `summary.unevaluated` is the scalar readers sum.
    unevaluated: verdict.unevaluated,
    pages: stamped.map((page, i) => ({
      ...(rows[i] as (typeof rows)[number]),
      before: page.before,
      content: page.text,
    })),
  };
}

/** The whole-page form, shared with `new` (docs/cli.md §new is the alias). */
export async function performWholePageWrite(input: {
  args: CommandArgs;
  vault: VaultOk;
  path: string;
  content: string;
  date: string;
  notAnyOf: readonly string[];
  command: string;
  /** The caller's own plan, so `new --dry-run` answers as `new`, not as `write`. */
  plan?: Plan;
  extra?: Record<string, unknown>;
}): Promise<CommandResult> {
  const { args, path, date, command } = input;
  const judged = judgeDrafts({
    args,
    vault: input.vault,
    drafts: [{ path, content: input.content }],
    date,
    notAnyOf: input.notAnyOf,
    command,
  });
  if (!judged.ok) return judged.result;
  const [page] = judged.pages;
  if (page === undefined) return fail(command, "internal", "no-draft", "the draft was not judged");
  const payload: Record<string, unknown> = {
    path,
    date,
    findings: page.findings,
    dispositions: page.dispositions,
    claims: page.claims,
    unevaluated: judged.unevaluated,
    resolve_checked: [...input.notAnyOf],
    digest: page.digest,
    ...(input.extra ?? {}),
  };
  if (isDryRun(args)) {
    const plan = input.plan ?? planForWrite(args);
    return ok(command, { ...planOf(plan.ops), ...payload, preview: page.content });
  }
  const sha = commitWrite(args.root, path, page.content);
  return ok(command, { ...payload, blob: sha });
}

/**
 * docs/cli.md §write --from: every draft under the directory, judged in one
 * state and landed through the Writer together — or not at all. The envelope
 * reports per page; the plan names every path (docs/cli.md §The dry-run law).
 */
function performBatchWrite(input: {
  args: CommandArgs;
  vault: VaultOk;
  from: string;
  drafts: readonly Draft[];
  date: string;
  notAnyOf: readonly string[];
}): CommandResult {
  const { args, date } = input;
  const judged = judgeDrafts({ ...input, command: "write" });
  if (!judged.ok) return judged.result;
  const pages = judged.pages.map((page) => ({
    path: page.path,
    created: page.created,
    findings: page.findings,
    dispositions: page.dispositions,
    claims: page.claims,
    digest: page.digest,
  }));
  const payload: Record<string, unknown> = {
    from: input.from,
    date,
    unevaluated: judged.unevaluated,
    resolve_checked: [...input.notAnyOf],
  };
  if (isDryRun(args)) {
    return ok("write", {
      ...planOf(planForWrite(args).ops),
      ...payload,
      pages: pages.map((page, i) => ({ ...page, preview: judged.pages[i]?.content ?? "" })),
    });
  }
  const blobs = commitWrites(
    args.root,
    judged.pages.map((page) => ({ path: page.path, text: page.content })),
  );
  return ok("write", {
    ...payload,
    pages: pages.map((page, i) => ({ ...page, blob: blobs[i] ?? null })),
  });
}

/**
 * The verdict the envelope reports. `proveWrite` answers "may this land" and
 * this answers "what does the page say now"; one function returning both would
 * make the proof's contract depend on its caller's reporting needs.
 */
function judgeFor(state: VaultState, law: Law, paths: ReadonlySet<string>) {
  const verdict = judge(state, law, { all: true, only: paths });
  // `only` scopes the page loop; the VAULT passes still see the whole state, so
  // a pre-existing collision on some other page would otherwise refuse a write
  // that has nothing to do with it.
  return { ...verdict, findings: verdict.findings.filter((f) => paths.has(f.path)) };
}

/**
 * docs/extending.md §An arm: the findings of the arms that judge a page against
 * its base — a governed item that left the page or changed where its grammar
 * forbids it. The arms are read off the loaded modules' declarations, so this
 * verb names none of them: the rule id is the predicate, and no reading of
 * the message is needed.
 */
function removedIllegally(
  findings: readonly Finding[],
  vault: VaultOk,
  paths: ReadonlySet<string>,
): Finding[] {
  // Only at `error`: the composed row and the section's knob already decided
  // whether this arm gates, and a warning is a report, never a refusal.
  const transitional = transitionArms(vault.modules);
  return findings.filter(
    (f) => paths.has(f.path) && f.severity === "error" && transitional.has(f.ruleId),
  );
}

function claimHandles(
  vault: VaultOk,
  text: string,
): { line: number; id: string; category: string; core: string; section: string }[] {
  const doc = parseDoc(text);
  const typeName = doc.frontmatter.value["type"];
  const effective = typeof typeName === "string" ? vault.registry.types.get(typeName) : undefined;
  if (effective === undefined) return [];
  const ast = parseSections(
    doc,
    grammarBindings(effective, vault.registry.modules),
    parseOptionsOf(lintOptionsFor(vault, buildNameIndex([]))),
  );
  const out: { line: number; id: string; category: string; core: string; section: string }[] = [];
  for (const section of ast.sections) {
    for (const claim of claimsOf(section)) {
      out.push({
        line: claim.line,
        id: claim.handle,
        category: claim.category,
        core: claim.core,
        section: section.declared,
      });
    }
  }
  return out;
}

export const writeCommand: CommandSpec = {
  name: "write",
  role: "writer",
  summary:
    "Write a page from stdin, a directory of drafts together (--from), or splice one item into a section (--section --append, any grammar); the claims forms retire, replace and correct a claim.",
  positionals: [{ name: "path", required: false }],
  flags: [
    {
      name: "from",
      type: "string",
      summary:
        "a directory of drafts: every .md under it is a draft at the same vault-relative path, judged in one state and landed together or not at all",
    },
    { name: "section", type: "string", summary: "the declared heading this op edits" },
    {
      name: "append",
      type: "boolean",
      summary:
        "splice the stdin lines at the section's tail: one item under a grammar, verbatim under prose",
    },
    { name: "date", type: "string", summary: "the write's date (default: today)" },
    {
      name: "replace-core",
      type: "string",
      summary: "claims: retire this claim handle and replace it with the stdin claim",
    },
    {
      name: "retract",
      type: "string",
      summary: "claims: retire this claim handle with no replacement",
    },
    {
      name: "correct",
      type: "string",
      summary: "claims: the claim handle whose core carries a typo",
    },
    { name: "core", type: "string", summary: "claims: with --correct, the corrected core" },
    {
      name: "line",
      type: "string",
      summary: "claims: name the claim by line instead of by handle",
    },
    {
      name: "coexist",
      type: "string",
      summary: "claims: with --append, why a second open claim of the same category is deliberate",
    },
    { name: "base", type: "string", summary: "compare-and-swap against this page digest" },
    {
      name: "not-any-of",
      type: "string",
      multiple: true,
      summary: "an identity candidate this write ruled out (repeatable)",
    },
  ],
  examples: [
    "wikiwright write wiki/parser.md --dry-run",
    "wikiwright write --from temp/drafts",
    "wikiwright write wiki/parser.md --section Relations --append",
    "wikiwright write wiki/parser.md --section Invariants --append --date 2026-09-03",
  ],
  writes: true,
  needsVaultModules: true,
  plan: planForWrite,
  run: async (args) => {
    const [raw] = args.positionals;
    const from = args.flags["from"];
    const batch = typeof from === "string" && from.length > 0;
    if (batch && raw !== undefined) {
      return fail("write", "usage", "one-op", "write takes <path> or --from <dir>, not both");
    }
    if (!batch && (raw === undefined || raw.length === 0)) {
      return fail("write", "usage", "missing-argument", "write requires <path> or --from <dir>");
    }
    const vault = loadVault("write", args.root);
    if (!vault.ok) return vault.result;
    const roots = rootsOf(vault);
    const dateFlag = args.flags["date"];
    if (dateFlag !== undefined && (typeof dateFlag !== "string" || !ISO.test(dateFlag))) {
      return fail("write", "usage", "invalid-value", "--date takes YYYY-MM-DD");
    }
    const date = typeof dateFlag === "string" ? dateFlag : today();
    if (batch) {
      for (const flag of ["section", "base"]) {
        if (args.flags[flag] !== undefined) {
          return fail(
            "write",
            "usage",
            "one-op",
            `--${flag} edits one page; --from lands a set of whole pages`,
          );
        }
      }
      // Every path a verb takes is vault-relative: `--from` resolves against
      // `--root` like the rest, and a refusal names the directory it looked
      // in rather than repeating the argument.
      const dir = resolve(args.root, from);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        return fail(
          "write",
          "not_found",
          "directory-not-found",
          `no directory at "${dir}" (--from "${from}" is resolved against --root)`,
          { details: { from, resolved: dir } },
        );
      }
      const drafts = draftsUnder(dir);
      if (drafts.length === 0) {
        return fail("write", "usage", "empty-draft", `no .md file under "${dir}"`, {
          details: { from, resolved: dir },
        });
      }
      for (const draft of drafts) {
        const refused = contentPathRefusal(args.root, draft.path, roots);
        if (refused !== undefined) {
          return fail("write", "usage", "invalid-path", `${from}/${draft.path} ${refused}`, {
            hint: "a draft's path under --from is its vault-relative path, so the directory mirrors the vault's roots",
          });
        }
      }
      return performBatchWrite({
        args,
        vault,
        from,
        drafts: drafts.map((d) => ({ path: d.path, content: d.text })),
        date,
        notAnyOf: listFlag(args, "not-any-of"),
      });
    }
    const path = (raw ?? "").normalize("NFC");
    const pathRefused = contentPathRefusal(args.root, path, roots);
    if (pathRefused !== undefined) {
      return fail("write", "usage", "invalid-path", `<path> ${pathRefused}`);
    }
    const exists = existsSync(join(args.root, path));
    const before = exists ? readPage(args.root, path) : "";

    const baseDigest = args.flags["base"];
    if (typeof baseDigest === "string") {
      const actual = exists ? sha256(before) : "";
      if (actual !== baseDigest) {
        return fail(
          "write",
          "conflict",
          "stale-base",
          "the page on disk is not the one this write was computed against",
          { data: { expected: baseDigest, actual: exists ? actual : null } },
        );
      }
    }

    const section = args.flags["section"];
    if (typeof section !== "string" || section.length === 0) {
      return performWholePageWrite({
        args,
        vault,
        path,
        content: stdinText(),
        date,
        notAnyOf: listFlag(args, "not-any-of"),
        command: "write",
      });
    }
    if (!exists) {
      return fail("write", "not_found", "page-not-found", `no page at "${path}"`, {
        hint: "a section form edits an existing page; write the whole page first",
      });
    }
    return sectionForm({ args, vault, path, date, before, section });
  },
};

// ---------------------------------------------------------------------------
// the section forms

async function sectionForm(input: {
  args: CommandArgs;
  vault: VaultOk;
  path: string;
  date: string;
  before: string;
  section: string;
}): Promise<CommandResult> {
  const { args, vault, path, date, before, section } = input;
  const resolved = sectionsOf(vault, path, before, section);
  const append = args.flags["append"] === true;
  if (!resolved.ok && (resolved.code !== "section-absent" || !append)) {
    return fail("write", "usage", resolved.code, resolved.message, {
      details: { valid_values: resolved.declared },
      ...(resolved.code === "section-absent"
        ? {
            hint: "a claims form acts on a claim the page carries; --append adds the heading with the item",
          }
        : {}),
    });
  }
  const open = resolved.ok ? resolved.sections.open : undefined;
  const history = resolved.ok ? resolved.sections.history : undefined;
  const historyHeading = resolved.ok ? resolved.sections.historyHeading : undefined;
  const lineFlag = args.flags["line"];
  const line = typeof lineFlag === "string" ? Number.parseInt(lineFlag, 10) : undefined;

  const replaceCore = args.flags["replace-core"];
  const retract = args.flags["retract"];
  const correct = args.flags["correct"];
  const chosen = [
    append,
    typeof replaceCore === "string",
    typeof retract === "string",
    typeof correct === "string",
  ].filter(Boolean).length;
  if (chosen !== 1) {
    return fail(
      "write",
      "usage",
      "one-op",
      "a section write names exactly one of --append, --replace-core, --retract, --correct",
    );
  }

  const beforeLines = before.replace(/^﻿/u, "").split(/\r?\n/u);
  const ops: WriteOp[] = [];
  const rendered: string[] = [];
  let confirm: CommandResult | undefined;

  if (append) {
    const item = stdinText().replace(/\r?\n$/u, "");
    if (item.trim() === "") {
      return fail("write", "usage", "empty-draft", "--append reads the item from stdin");
    }
    const lines = item.split(/\r?\n/u);
    const coexist = args.flags["coexist"];
    const typeName = parseDoc(before).frontmatter.value["type"];
    const effective = typeof typeName === "string" ? vault.registry.types.get(typeName) : undefined;
    if (effective === undefined) {
      return fail("write", "usage", "untyped-page", `"${path}" declares no registered type`);
    }
    const landing = appendUnderSection(vault, effective, before, section, lines);
    if (!landing.ok) {
      return fail("write", "usage", landing.code, landing.message, {
        details: { valid_values: landing.declared },
      });
    }
    // The open same-category check runs on the item AS PARSED, so the category
    // comes from the grammar and never from a regex the verb keeps privately.
    // A prose section has no item grammar: the lines land verbatim at
    // its tail, and the judge reads the page as it will then stand. A heading
    // the page lacks is added first, so the probe reads the item where it lands.
    const probe: ItemProbe =
      landing.binding.grammar === "prose"
        ? { kind: "other" }
        : parseItemLines(vault, path, before, landing);
    if (probe.kind === "unparsed") {
      return fail("write", "conflict", "grammar-unparsed", probe.message, {
        hint: "the item must parse under the section's grammar; `type show <type> --brief` prints it",
      });
    }
    if (probe.kind === "claim") {
      const cls = claimClass(vault.registry, probe.claim);
      const open_ = (open === undefined ? [] : claimsOf(open)).filter(
        (c) => c.categoryId === probe.claim.categoryId && c.closing === undefined,
      );
      if (cls === "supersede" && open_.length > 0 && typeof coexist !== "string") {
        confirm = fail(
          "write",
          "confirm_required",
          "open-claim-of-category",
          `[${probe.claim.category}] is a supersede category and ${open_.length} open claim(s) already stand`,
          {
            details: {
              claims: open_.map((c) => ({ id: c.handle, core: c.core, line: c.line })),
              legal: [
                [
                  "write",
                  path,
                  "--section",
                  section,
                  "--replace-core",
                  open_[0]?.handle ?? "",
                  "--date",
                  date,
                ],
                [
                  "write",
                  path,
                  "--section",
                  section,
                  "--append",
                  "--coexist",
                  "<why both are current>",
                ],
              ],
            },
            hint: "supersede the open claim, or say why both are current",
          },
        );
      }
      if (typeof coexist === "string" && coexist.length > 0) {
        // Deliberate variance is recorded ON THE PAGE, as rationale: identity-
        // free, never a finding, and it travels with the item it explains.
        lines.push(`  - coexists with ${open_.map((c) => c.handle).join(", ")}: ${coexist}`);
      }
    }
    if (confirm !== undefined) return confirm;
    // Re-derived over the final lines: a `--coexist` rationale was appended to
    // them after the probe, and the ops must carry it.
    const final = appendUnderSection(vault, effective, before, section, lines);
    ops.push(...(final.ok ? final.ops : landing.ops));
    rendered.push(...lines);
  } else if (open === undefined) {
    // Unreachable: every form but --append returned above on an absent section.
    return fail("write", "internal", "section-unresolved", `"${section}" resolved to no section`);
  } else if (typeof replaceCore === "string") {
    const claim = findClaim(open, replaceCore, line);
    if (claim === undefined) return noSuchClaim(path, section, replaceCore, line);
    const cls = claimClass(vault.registry, claim);
    if (cls === "accumulate") {
      return fail(
        "write",
        "conflict",
        "class-forbids-supersede",
        `[${claim.category}] is an accumulate category: a later contrary observation never overwrites an earlier one`,
        {
          data: {
            claims: [
              { id: claim.handle, category: claim.category, core: claim.core, line: claim.line },
            ],
            legal: [
              ["write", path, "--section", section, "--append"],
              ["write", path, "--section", section, "--retract", claim.handle, "--date", date],
            ],
          },
          hint: "variance across time is the signal",
        },
      );
    }
    const from = claim.provenance?.date;
    if (from !== undefined && date <= from) {
      return fail(
        "write",
        "conflict",
        "date-not-after",
        `--date ${date} is not after the retired claim's own date ${from}; the interval would render backwards`,
      );
    }
    const item = stdinText().replace(/\r?\n$/u, "");
    if (item.trim() === "") {
      return fail("write", "usage", "empty-draft", "--replace-core reads the new claim from stdin");
    }
    if (history === undefined || historyHeading === undefined) {
      return fail(
        "write",
        "usage",
        "no-history-section",
        `"${section}" declares no history section, so a supersession has nowhere to land`,
      );
    }
    const closing = closeLine(beforeLines[claim.line - 1] ?? "", supersedeClause(claim, date));
    ops.push({ kind: "replace", from: claim.line, to: claim.line, lines: item.split(/\r?\n/u) });
    ops.push({
      kind: "append-section",
      heading: history.declared,
      depth: history.depth,
      lines: [closing],
    });
    rendered.push(...item.split(/\r?\n/u), closing);
  } else if (typeof retract === "string") {
    const claim = findClaim(open, retract, line);
    if (claim === undefined) return noSuchClaim(path, section, retract, line);
    if (history === undefined) {
      return fail(
        "write",
        "usage",
        "no-history-section",
        `"${section}" declares no history section, so a retraction has nowhere to land`,
      );
    }
    const closing = closeLine(beforeLines[claim.line - 1] ?? "", `retracted ${date}`);
    ops.push({ kind: "replace", from: claim.line, to: claim.line, lines: [] });
    ops.push({
      kind: "append-section",
      heading: history.declared,
      depth: history.depth,
      lines: [closing],
    });
    rendered.push(closing);
  } else if (typeof correct === "string") {
    const claim = findClaim(open, correct, line);
    if (claim === undefined) return noSuchClaim(path, section, correct, line);
    const core = args.flags["core"];
    if (typeof core !== "string" || core.length === 0) {
      return fail("write", "usage", "missing-argument", "--correct needs --core <new core>");
    }
    const original = beforeLines[claim.line - 1] ?? "";
    const at = original.indexOf(claim.core);
    if (at < 0) {
      return fail("write", "internal", "core-not-found", "the parsed core is not in its own line");
    }
    const corrected = original.slice(0, at) + core + original.slice(at + claim.core.length);
    const probe = parseItemLines(vault, path, before, {
      ok: true,
      binding: open.binding,
      created: false,
      ops: [
        { kind: "append-section", heading: open.declared, depth: open.depth, lines: [corrected] },
      ],
    });
    if (probe.kind !== "claim") {
      return fail("write", "conflict", "grammar-unparsed", "the corrected line does not parse");
    }
    // docs/extending.md §An arm: the predicate comes from the grammar
    // this section declared, resolved through the loaded modules. Importing
    // `claims`' own would make the flag mean "a claims correction" under a kit's
    // grammar — the same silent-wrong-law failure the registry exists to close.
    // A grammar that registers no predicate corrects nothing: an unrecognized
    // edit is a change of substance, and `--replace-core` is the verb for that.
    const { isCorrection } = transitionSeam(open.binding.grammar, vault.modules);
    if (!isCorrection(claim as never, probe.claim as never)) {
      return fail(
        "write",
        "conflict",
        "not-a-correction",
        "the new core is outside the correction tolerance — a digit, a polarity or too much text moved",
        {
          data: {
            from: claim.core,
            to: probe.claim.core,
            legal: [["write", path, "--section", section, "--replace-core", claim.handle]],
          },
          hint: "a change of value is a supersession: use --replace-core",
        },
      );
    }
    ops.push({ kind: "replace", from: claim.line, to: claim.line, lines: [corrected] });
    rendered.push(corrected);
  }

  const plan: WritePlan = { path, ops };
  const spliced = splicePlan(before, plan);
  if (!spliced.ok) {
    return fail("write", "conflict", "splice-refused", spliced.reason);
  }
  const doc = parseDoc(spliced.spliced.text);
  const typeName = doc.frontmatter.value["type"];
  const effective = typeof typeName === "string" ? vault.registry.types.get(typeName) : undefined;
  const stamps = autoOps(effective, spliced.spliced.text, date, false);
  const withStamps = splicePlan(spliced.spliced.text, { path, ops: stamps });
  if (!withStamps.ok) {
    return fail("write", "conflict", "stamp-refused", withStamps.reason);
  }
  const after = withStamps.spliced.text;

  const law = lawFor(vault);
  const state = overlayState(fsState(args.root, rootsOf(vault)), args.root, [
    { path, text: after },
  ]);
  const proof = proveWrite({ state, law, path, after });
  if (!proof.ok) {
    return fail("write", "findings", proof.code, proof.message, { data: proof.details });
  }
  const verdict = judgeFor(state, law, new Set([path]));
  // docs/cli.md §write: a transition arm firing on bytes the ENGINE wrote is an internal
  // error, never a finding — the History line was rendered from the very claim
  // the arm says vanished, so the renderer and the parser disagree.
  const engineAuthored = removedIllegally(verdict.findings, vault, new Set([path]));
  if (engineAuthored.length > 0 && ops.some((o) => o.kind === "append-section")) {
    return fail(
      "write",
      "internal",
      "writer-transition",
      "the engine's own History line did not satisfy the transition arm",
      { data: { findings: engineAuthored } },
    );
  }
  const errors = verdict.findings.filter((f) => f.severity === "error");
  if (errors.length > 0) {
    return fail("write", "findings", "draft-invalid", `the write fails ${errors.length} check(s)`, {
      data: { findings: verdict.findings },
    });
  }

  const payload: Record<string, unknown> = {
    path,
    date,
    section,
    findings: verdict.findings,
    dispositions: verdict.dispositions[path] ?? {},
    claims: claimHandles(vault, after),
    rendered,
    spliced: {
      inserted: spliced.spliced.ranges.map((r) => r.from),
      replaced: spliced.spliced.consumed.filter((r) => r.to >= r.from).map((r) => r.from),
    },
    digest: { before: sha256(before), after: sha256(after) },
  };
  if (isDryRun(args)) {
    return ok("write", { ...planOf(planForWrite(args).ops), ...payload, preview: after });
  }
  const sha = commitWrite(args.root, path, after);
  return ok("write", { ...payload, blob: sha });
}

function noSuchClaim(
  path: string,
  section: string,
  handle: string,
  line: number | undefined,
): CommandResult {
  return fail(
    "write",
    "not_found",
    "no-such-claim",
    line === undefined
      ? `no claim with handle "${handle}" in "${section}" of ${path}`
      : `no claim on line ${line} of "${section}" in ${path}`,
    { hint: "handles come from the envelope — `write --dry-run` or `lint --page` print them" },
  );
}

type ItemProbe =
  | { kind: "claim"; claim: ClaimItem }
  | { kind: "other" }
  | { kind: "unparsed"; message: string };

/**
 * The incoming item, read by the SAME parser the arms read (docs/concepts.md §Section grammar). The
 * lines are spliced into a copy of the page and the copy is parsed, so the item
 * is judged in the context that will hold it rather than in isolation.
 */
function parseItemLines(
  vault: VaultOk,
  path: string,
  before: string,
  landing: Extract<AppendUnderSection, { ok: true }>,
): ItemProbe {
  const heading = landing.binding.heading;
  const spliced = splicePlan(before, { path, ops: landing.ops });
  if (!spliced.ok) return { kind: "unparsed", message: spliced.reason };
  const resolved = sectionsOf(vault, path, spliced.spliced.text, heading);
  if (!resolved.ok) return { kind: "unparsed", message: resolved.message };
  // The item is the one INSIDE the spliced range — never the section's last
  // item, which under a draft that is not an item at all is the last item the
  // page already had, and would be probed in the draft's place. A range that
  // carries a freshly inserted heading holds the item too.
  const range = spliced.spliced.ranges[0];
  const item = resolved.sections.open.items.find(
    (i) => range !== undefined && i.line >= range.from && i.line <= range.to,
  );
  if (item === undefined) {
    return {
      kind: "unparsed",
      message: `"${heading}" is a ${resolved.sections.open.grammar} section and the draft is not an item under it: an item is one top-level \`- \` line, with any rationale indented beneath it`,
    };
  }
  if (item.kind === "unparsed") {
    return {
      kind: "unparsed",
      message: `the item does not parse under the "${heading}" grammar: ${item.text}`,
    };
  }
  // docs/extending.md §What a module registers: the kernel hands back its own item shape; the CLAIM shape is
  // `claims`' own, re-exported by the package for exactly this read.
  return item.kind === "claim"
    ? { kind: "claim", claim: item as unknown as ClaimItem }
    : { kind: "other" };
}
