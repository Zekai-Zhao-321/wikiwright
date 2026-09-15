// docs/concepts.md §Findings and routing, docs/concepts.md
// docs/constitution.md frontmatter closure
// consumes flattened EffectiveType only · deterministic order.

import type { FindingFix } from "../fixers/index.ts";
import {
  checkGrammar,
  type Dispositions,
  type GrammarCheckOptions,
  type GrammarKind,
  type ParseOptions,
  parseSections,
  type SectionAST,
  type SectionBinding,
  type VocabularyUse,
} from "../grammar/index.ts";
import { sha256Hex } from "../hash/index.ts";
import { codeUnitCompare, normalizeIdentity } from "../identity/index.ts";
import {
  armApplies,
  armDefault,
  type CheckContext,
  DECLARED_ARM_DEFAULT,
  declaredParams,
  type ModuleRegistry,
  observedValues,
  resolveParsers,
  type TransitionContext,
  type TransitionItem,
  type VocabularyView,
} from "../modules/index.ts";
import { normalizeInput, type ParsedDoc, parseDoc } from "../parse/index.ts";
import type { QueueLane } from "../passes/index.ts";
import {
  type EffectiveSectionEntry,
  type EffectiveType,
  type EffectiveVocabulary,
  entryProperty,
  type FlattenedRegistry,
  tagByName,
  tagsOf,
} from "../registry/index.ts";
import { checkValue, shapeAuto, shapeKind, shapeRequired, shapeRequires } from "../shapes/index.ts";

/** docs/constitution.md §Sections: the matcher's default alphabet when a type declares no depth. */
const DEFAULT_SECTION_DEPTH = 2;

export interface Finding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  path: string;
  line?: number;
  message: string;
  /**
   * docs/concepts.md §Findings and routing: the PASS_TABLE row that emitted this finding, when
   * the `ruleId` is a bundle-authored rule id rather than the pass's own name.
   * Routing reads `pass ?? ruleId`, so a rule called `person-facts-shape` still
   * routes by the `required-headings` row that judged it.
   */
  pass?: string;
  /** Exactly one of `fix` / `queue` on every error or warning finding. */
  fix?: FindingFix;
  queue?: QueueLane;
  /** docs/concepts.md §The gate: set only where a base exists and the finding has a line. */
  new_since_base?: boolean;
  remediation?: string;
  contributedBy?: string;
  /** Whose law (audience, not carrier): engine/type/contract rules are all constitution law. */
  layer: "okf-core" | "constitution" | "editorial";
  /** Where in the page, from the enclosing matched heading (docs/concepts.md §Findings and routing). */
  breadcrumb?: string;
  /** Nearest registry prose: the contributing entry's avoid_when/description. */
  hint?: string;
  /** Machine pointer into the registry entry that carried the rule. */
  registryPath?: string;
  /** Queue-routed findings: the per-page `exceptions:` key (docs/concepts.md §Findings and routing). */
  evidenceDigest?: string;
  /** Machine detail: the item handle and other scalars (docs/concepts.md §Section grammar). */
  details?: Readonly<Record<string, string | number | boolean>>;
}

export interface LintContext {
  path: string;
  doc: ParsedDoc;
  registry: FlattenedRegistry;
}

/** Carrier-3 selector (docs/concepts.md §Findings and routing): additive, non-structural, tag-scoped. */
/** The slice of a name index link resolution needs. */
export interface LinkResolver {
  resolve(name: string): { path: string; viaAlias: boolean } | undefined;
  /** The declared type of the page a name resolves to. */
  typeOf?(name: string): string | undefined;
}

/**
 * docs/concepts.md §The gate: how one target resolves against one name index. The
 * emit site and the gate's base-index re-check call THIS function, so "would the
 * base have produced it" cannot drift from "does the current state produce it".
 */
export function linkVerdict(names: LinkResolver, target: string): "ok" | "unresolved" | "alias" {
  const entry = names.resolve(target);
  if (entry === undefined) return "unresolved";
  return entry.viaAlias ? "alias" : "ok";
}

export interface LintOptions {
  /** Base revision text for diff-aware checkers (append-only). Wired by the shell. */
  baseText?: string;
  /** Content roots whose folder segments must be tags. */
  contentRoots?: readonly string[];
  /** Vault-wide name index enabling wikilink resolution checks. */
  names?: LinkResolver;
  /** Engine-required fields satisfied by declared derivation. */
  fieldSources?: { title?: "basename"; description?: "lede" };
  /** Per-segment tag aliases — the escape when a directory name is a type name. */
  folderTagAliases?: Record<string, string>;
  /**
   * Folder-tag alignment policy. Core defaults to "validate" for
   * direct API callers; the CLI threads the bundle's declared mode, whose
   * undeclared default is "off" — policy is bundle law, not engine law.
   */
  folderTags?: "off" | "validate" | "materialize-add-only";
  /** Registered-extension policy; absent means the open default. */
  extensions?: { mode: "open" | "registered"; namespaces?: string[]; fields?: string[] };
  /**
   * docs/constitution.md §config/engine.json: `config/engine.json`'s `source_roots`, the
   * declared evidence roots the bare-path provenance form resolves against.
   * Absent ⇒ the form is off; the engine never infers a root from a name.
   */
  sourceRoots?: readonly string[];
  /**
   * docs/concepts.md §Section grammar: the transition arm's derived table, collected by
   * the caller. A sink rather than a return value because the arm must parse
   * the page exactly once and `lintPage` returns findings.
   */
  collect?: { dispositions: Dispositions };
}

/**
 * segment↔tag comparison folds separators (space/underscore → hyphen)
 * on top of normalizeIdentity. Scoped to folder alignment — page identity
 * is untouched.
 */
export function segmentIdentity(segment: string): string {
  return normalizeIdentity(segment.replaceAll(/[\s_]+/gu, "-"));
}

/** Checkers that need a base revision; without one they are counted, not run. */
/** Directory segments between a content root and the file (docs/constitution.md §config/engine.json). */
export function folderSegmentsFor(path: string, roots: readonly string[]): string[] {
  const parts = path.split("/");
  const root = parts[0];
  if (root === undefined || !roots.includes(root)) return [];
  return parts.slice(1, -1);
}

interface FindingDraft {
  ruleId: string;
  /** docs/concepts.md §Findings and routing: the PASS_TABLE row, when the id is a bundle rule id. */
  pass?: string;
  severity: Finding["severity"];
  line?: number;
  message: string;
  remediation?: string;
  contributedBy?: string;
  layer?: Finding["layer"];
  hint?: string;
  registryPath?: string;
  evidenceDigest?: string;
  details?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * docs/concepts.md §Findings and routing: the key a per-page waiver names — sha256 over ruleId ‖ path ‖
 * the normalized evidence. The evidence is the item's identity as its arm states
 * it (a handle and a category, a label and a target), never a line number, so
 * the same item on a different line keeps its waiver. One function, filled here
 * for the arms that state their evidence and by the judge for everything else.
 */
export function evidenceDigestFor(ruleId: string, path: string, evidence: string): string {
  return `sha256:${sha256Hex(`${ruleId}\u0000${path}\u0000${normalizeIdentity(evidence)}`)}`;
}

/**
 * Lint one page against its flattened effective type and the engine rules.
 * Pure: all inputs arrive as data.
 */
export function lintPage(context: LintContext, options?: LintOptions): Finding[] {
  const { path, doc, registry } = context;
  const drafts: FindingDraft[] = [];
  const fm = doc.frontmatter;
  const keyLine = (key: string): number | undefined => fm.keys.find((k) => k.key === key)?.line;

  for (const issue of fm.issues) {
    drafts.push({
      ruleId: issue.code,
      severity: "error",
      line: issue.line,
      message: issue.message,
      remediation:
        issue.code === "duplicate-key"
          ? "keep one of the two keys"
          : "quote the value — a scalar containing `: ` or starting with a YAML indicator must be quoted — or fix the block so it parses",
      contributedBy: "engine",
      ...(issue.column === undefined ? {} : { details: { column: issue.column } }),
    });
  }
  // docs/concepts.md §Findings and routing: a parse law refuses BEFORE the shape arms run. A block
  // the parser could not read has no mapping to judge — the arms that ran over
  // its empty or half-read value reported every required field missing, four
  // lines above the cause, and the one real finding came last. The parse
  // findings are the verdict. A duplicate key is different: the block parsed,
  // one value won, and the page can be judged as it reads.
  if (fm.issues.some((issue) => issue.code !== "duplicate-key")) {
    return findingsOf(drafts, path, doc, DEFAULT_SECTION_DEPTH);
  }

  // --- type resolution (one declared nominal type) ---
  const typeValue = fm.value["type"];
  let effective: EffectiveType | undefined;
  if (typeof typeValue === "string") effective = registry.types.get(typeValue);
  if (effective === undefined) {
    drafts.push({
      ruleId: "unknown-type",
      severity: "error",
      line: keyLine("type") ?? 1,
      message:
        typeof typeValue === "string"
          ? `unknown type "${typeValue}"`
          : "page declares no type; every page carries exactly one registered type",
      remediation:
        "declare a registered type (`wikiwright type list`), or register a new one in config/constitution.json through review",
      contributedBy: "engine",
    });
  }

  // --- frontmatter closure against the effective field set ---
  if (effective !== undefined) {
    // `required` is read from the shape, here, where the question is
    // asked — the IR carries no second copy of the answer.
    const known = new Set<string>(effective.fields.keys());
    const derived = new Set<string>();
    if (options?.fieldSources?.title === "basename") derived.add("title");
    if (options?.fieldSources?.description === "lede") derived.add("description");
    for (const [field, declared] of effective.fields) {
      if (!shapeRequired(declared.shape) || shapeAuto(declared.shape) !== undefined) continue;
      if (derived.has(field)) continue; // satisfied by declared derivation
      if (!(field in fm.value)) {
        drafts.push({
          ruleId: "missing-required-field",
          severity: "error",
          line: 1,
          message: `missing required field "${field}"`,
          contributedBy: declared.contributedBy,
          // docs/concepts.md §Findings and routing: `frontmatter-set` may set this field only where the
          // shape admits exactly ONE legal value; the value travels as data.
          details: soleValueDetails(field, declared.shape),
        });
      }
    }
    // Typed metadata — a present field with a declared shape must
    // satisfy it. page-ref kinds resolve through the vault name index.
    for (const [field, declared] of effective.fields) {
      if (!(field in fm.value)) {
        // `requires` on a shape absorbs the `conditional-required`
        // checker — the field is required exactly when the fields it names are
        // present. Reported without a line, because the defect is an absence.
        const triggers = shapeRequires(declared.shape);
        if (triggers.length > 0 && triggers.every((t) => t in fm.value)) {
          drafts.push({
            ruleId: "field-shape",
            severity: "error",
            message: `"${triggers.join('", "')}" ${triggers.length > 1 ? "are" : "is"} present, so "${field}" is required`,
            remediation: `the field's declared shape is law — see \`type show\``,
            contributedBy: declared.contributedBy,
          });
        }
        continue;
      }
      const shapeContext = options?.names !== undefined ? { names: options.names } : undefined;
      // docs/constitution.md §Shapes: a `pin` is a shape like any other, but its value law is a
      // SOURCE matter — the remediation is "pin the origin's revision", not
      // "see the shape" — so it emits under its own row, queued to
      // source-review, and never under the fixer-routed `field-shape`.
      const pin = shapeKind(declared.shape) === "pin";
      for (const problem of checkValue(fm.value[field], declared.shape, shapeContext, field)) {
        drafts.push({
          ruleId: pin ? "malformed-pin" : "field-shape",
          severity: "error",
          line: keyLine(field) ?? 1,
          message: problem,
          remediation: pin
            ? "pin the exact origin revision: the full 40- or 64-hex commit id, lowercase"
            : `the field's declared shape is law — see \`type show\``,
          contributedBy: declared.contributedBy,
          ...(pin ? {} : { details: soleValueDetails(field, declared.shape) }),
        });
      }
      if (pin) {
        // A pin names a revision OF an origin: the sibling the shape names must
        // be present beside it, or the pin measures nothing.
        const origin = String((declared.shape as Record<string, unknown>)["origin"]);
        const named = fm.value[origin];
        if (typeof named !== "string" || named.trim().length === 0) {
          drafts.push({
            ruleId: "malformed-pin",
            severity: "error",
            line: keyLine(field) ?? 1,
            message: `${field}: the origin field "${origin}" is absent; a pin names a revision of an origin`,
            remediation: `write ${origin}: <the git URL, or "." for this repository> beside the pin`,
            contributedBy: declared.contributedBy,
          });
        }
      }
    }
    for (const k of fm.keys) {
      if (k.key.startsWith("x-")) {
        // In registered mode the escape is a declared surface, not an
        // unbounded shadow schema.
        const policy = options?.extensions;
        if (policy?.mode === "registered") {
          const allowed =
            (policy.namespaces ?? []).some((ns) => k.key.startsWith(ns)) ||
            (policy.fields ?? []).includes(k.key);
          if (!allowed) {
            drafts.push({
              ruleId: "unregistered-extension",
              severity: "error",
              line: k.line,
              message: `extension field "${k.key}" is not registered`,
              remediation:
                "declare its namespace or the field itself in engine.json extensions, or remove it",
              contributedBy: "engine",
            });
          }
        }
        continue;
      }
      if (known.has(k.key)) continue;
      drafts.push({
        ruleId: "unknown-frontmatter-key",
        severity: "error",
        line: k.line,
        message: `unknown frontmatter key "${k.key}" (x- prefixed keys are exempt)`,
        remediation: "remove the key, or declare it on the type in config/constitution.json",
        contributedBy: "engine",
        // docs/concepts.md §Findings and routing: the fixer deletes the key this names, never one it
        // re-derives from the message.
        details: { key: k.key },
      });
    }
  }

  // --- tags and folder alignment ---
  const tagsValue = fm.value["tags"];
  let pageTags: string[] | undefined;
  if (Array.isArray(tagsValue)) {
    pageTags = tagsValue.filter((t): t is string => typeof t === "string");
  } else if ("tags" in fm.value) {
    drafts.push({
      ruleId: "invalid-tags-field",
      severity: "error",
      line: keyLine("tags") ?? 1,
      message: "tags must be a flat list of registered tags",
      remediation: "write tags as a YAML sequence: tags: [a, b]",
      contributedBy: "engine",
    });
    pageTags = [];
  }
  const tags = tagsOf(registry);
  const aliasOwners = new Map<string, string>();
  for (const entry of tags.entries.values()) {
    for (const alias of entry.aliases) aliasOwners.set(normalizeIdentity(alias), entry.name);
  }
  if (pageTags !== undefined) {
    for (const tag of pageTags) {
      const canonical = aliasOwners.get(normalizeIdentity(tag));
      if (canonical !== undefined && tagByName(registry, tag) === undefined) {
        // Aliases are lookup inputs — authoring one names its
        // canonical tag instead of reading as an unknown string.
        drafts.push({
          ruleId: "tag-alias-target",
          severity: "error",
          line: keyLine("tags") ?? 1,
          message: `tag "${tag}" is an alias`,
          remediation: `write the canonical tag "${canonical}"`,
          contributedBy: "engine",
          details: { tag, canonical },
        });
        continue;
      }
      const info = tagByName(registry, tag);
      if (info === undefined) {
        drafts.push({
          ruleId: "unknown-tag",
          severity: "error",
          line: keyLine("tags") ?? 1,
          message: `unknown tag "${tag}"`,
          contributedBy: "engine",
        });
      } else if (info.status === "retired") {
        drafts.push({
          ruleId: "tag-retired",
          severity: "error",
          line: keyLine("tags") ?? 1,
          message: `tag "${tag}" is retired${info.replaced_by !== undefined ? ` (replaced by: ${info.replaced_by.join(", ")})` : ""}`,
          contributedBy: "engine",
          // One replacement is mechanical; two is a choice, and the fixer says so.
          details:
            info.replaced_by?.length === 1
              ? { tag, canonical: info.replaced_by[0] ?? "" }
              : { tag },
        });
      }
    }
    // docs/constitution.md §Vocabularies: the `tags` vocabulary's optional `form`, and the
    // one editorial power v3 kept — `requires_link` on the entry itself.
    const form = tags.form;
    if (form !== undefined) {
      const pattern = new RegExp(form, "u");
      for (const tag of pageTags) {
        if (tagByName(registry, tag) === undefined) continue;
        if (pattern.test(tag)) continue;
        drafts.push({
          ruleId: "tag-form",
          severity: "error",
          line: keyLine("tags") ?? 1,
          message: `tag "${tag}" does not match the vocabulary's form ${form}`,
          remediation: "rename the tag through review; the form is the vocabulary's own law",
          contributedBy: "engine",
        });
      }
    }
    for (const tag of pageTags) {
      const entry = tagByName(registry, tag);
      const target = entry === undefined ? undefined : entryProperty(entry, "requires_link");
      if (typeof target !== "string") continue;
      const wanted = normalizeIdentity(target);
      const wantedPath = options?.names?.resolve(target)?.path;
      const satisfied = doc.wikilinks.some((w) => {
        if (normalizeIdentity(w.target) === wanted) return true;
        if (wantedPath === undefined) return false;
        return options?.names?.resolve(w.target)?.path === wantedPath;
      });
      if (!satisfied) {
        drafts.push({
          ruleId: "tag-requires-link",
          severity: "error",
          line: keyLine("tags") ?? 1,
          message: `pages tagged "${tag}" link [[${target}]]`,
          remediation: `write [[${target}]] where the page refers to it`,
          contributedBy: `vocabulary:tags/${tag}`,
        });
      }
    }
  }
  const folderTagMode = options?.folderTags ?? "validate";
  const segments =
    folderTagMode === "off" ? [] : folderSegmentsFor(path, options?.contentRoots ?? []);
  // folder-segment↔tag comparison runs through segmentIdentity
  // (normalizeIdentity + separator folding); a per-segment alias in engine.json
  // resolves the segment to its governing tag before matching.
  const aliases = options?.folderTagAliases ?? {};
  const resolveSegment = (segment: string): string => aliases[segment] ?? segment;
  const tagIdentities = new Set([...tags.entries.values()].map((t) => segmentIdentity(t.name)));
  for (const rawSegment of segments) {
    const segment = resolveSegment(rawSegment);
    if (!tagIdentities.has(segmentIdentity(segment))) {
      drafts.push({
        ruleId: "folder-segment-registered",
        severity: "error",
        line: 1,
        message: `folder segment "${segment}" is not a registered tag`,
        remediation: "register the tag or rename the folder",
        contributedBy: "engine",
      });
    }
  }
  if (segments.length > 0 && pageTags !== undefined) {
    // The missing tag is named by its REGISTERED spelling where one matches the
    // segment, because `details.missing` is what the `folder-tags` fixer
    // materializes: a folder `Folk` over a registered `folk` used to land
    // `tags: ["Folk"]`, and the page then failed `unknown-tag`.
    const registeredFor = (segment: string): string =>
      [...tags.entries.values()].find((t) => segmentIdentity(t.name) === segmentIdentity(segment))
        ?.name ?? segment;
    const missing = segments
      .map(resolveSegment)
      .filter((s) => !pageTags.some((t) => segmentIdentity(t) === segmentIdentity(s)))
      .map(registeredFor);
    if (missing.length > 0) {
      drafts.push({
        ruleId: "folder-tags-present",
        severity: "error",
        line: keyLine("tags") ?? 1,
        message: `tags missing current folder segments: ${missing.join(", ")}`,
        details: { missing: missing.join(" ") },
        remediation:
          folderTagMode === "materialize-add-only"
            ? "run `wikiwright fix --rule folder-tags-present --path <page> --expect any` — the add-only materializer"
            : "add the missing tags deliberately, or move the page if its location is wrong",
        contributedBy: "engine",
      });
    }
  }

  // --- wikilink resolution against the vault name index ---
  const names = options?.names;
  if (names !== undefined) {
    for (const link of doc.wikilinks) {
      const entry = names.resolve(link.target);
      const verdict = linkVerdict(names, link.target);
      if (verdict === "unresolved") {
        drafts.push({
          ruleId: "wikilink-unresolved",
          severity: "warning",
          line: link.line,
          message: `wikilink [[${link.target}]] does not resolve to any page`,
          contributedBy: "engine",
          // The gate re-resolves this target against the BASE name
          // index, so it travels as data, not parsed back out of the message.
          details: { target: link.target },
        });
      } else if (verdict === "alias" && entry !== undefined) {
        const canonical = (entry.path.split("/").at(-1) ?? entry.path).replace(/\.md$/, "");
        drafts.push({
          ruleId: "wikilink-alias-target",
          severity: "error",
          line: link.line,
          message: `wikilink targets alias "${link.target}"; the canonical name is "${canonical}"`,
          remediation: `write [[${canonical}|${link.alias ?? link.target}]] — the engine declines to out-resolve the rendering surface`,
          contributedBy: "engine",
          details: { target: link.target, canonical, display: link.alias ?? link.target },
        });
      }
    }
  }

  // --- abstract types are uninstantiable (docs/constitution.md §Types) -------------------
  if (effective?.abstract === true) {
    drafts.push({
      ruleId: "abstract-type",
      severity: "error",
      line: keyLine("type") ?? 1,
      message: `type "${effective.name}" is abstract; it exists to be extended, never to be authored`,
      remediation: "declare one of its concrete descendants (`wikiwright type list`)",
      contributedBy: effective.name,
    });
  }

  // --- tombstone: a retired type's pages carry the migration hint and
  // are otherwise excluded from contract validation ---
  const retired = effective !== undefined && effective.status === "retired";
  if (effective !== undefined && retired) {
    drafts.push({
      ruleId: "tombstone",
      severity: "error",
      line: keyLine("type") ?? 1,
      message: `type "${effective.name}" is retired`,
      remediation:
        effective.replaced_by !== undefined && effective.replaced_by.length > 0
          ? `migrate to ${effective.replaced_by.join(", ")}`
          : "generalize to the parent type or migrate per the constitution",
      contributedBy: "engine",
      // docs/concepts.md §Findings and routing: `retype` executes only where ONE replacement is
      // declared — a choice between two is a judgment, and it queues.
      details:
        effective.replaced_by?.length === 1
          ? { type: effective.name, canonical: effective.replaced_by[0] ?? "" }
          : { type: effective.name },
    });
  }

  // The one section depth this run uses: the grammar arms, the transition arm
  // and the breadcrumb all read it.
  const sectionsDepth = effective?.sections?.depth ?? DEFAULT_SECTION_DEPTH;

  // --- sections matcher and budgets: engine passes driven by
  // the effective type's own declarations ---
  if (effective !== undefined && !retired) {
    drafts.push(...checkSections(effective, doc, registry));
    drafts.push(...checkSectionBudgets(effective, doc));
    drafts.push(...checkSectionGrammars(effective, registry, path, doc, pageTags ?? [], options));
    drafts.push(
      ...checkSectionTransitions(effective, registry, path, doc, pageTags ?? [], options),
    );
    drafts.push(...runRegisteredChecks(effective, registry, path, doc, pageTags ?? [], options));
  }

  return findingsOf(drafts, path, doc, sectionsDepth);
}

/**
 * Drafts to findings: the page's path on each, the breadcrumb — the enclosing
 * matched heading at the sections depth (docs/concepts.md §Findings and routing) — and the deterministic order.
 */
function findingsOf(
  drafts: readonly FindingDraft[],
  path: string,
  doc: ParsedDoc,
  breadcrumbDepth: number,
): Finding[] {
  const breadcrumbFor = (line: number | undefined): string | undefined => {
    if (line === undefined) return undefined;
    let crumb: string | undefined;
    for (const h of doc.headings) {
      if (h.depth !== breadcrumbDepth) continue;
      if (h.line > line) break;
      crumb = h.text;
    }
    return crumb;
  };

  const findings: Finding[] = drafts.map((d) => {
    const f: Finding = {
      ruleId: d.ruleId,
      severity: d.severity,
      path,
      message: d.message,
      layer: d.layer ?? "constitution",
    };
    if (d.pass !== undefined) f.pass = d.pass;
    if (d.line !== undefined) f.line = d.line;
    if (d.remediation !== undefined) f.remediation = d.remediation;
    if (d.contributedBy !== undefined) f.contributedBy = d.contributedBy;
    if (d.hint !== undefined) f.hint = d.hint;
    if (d.registryPath !== undefined) f.registryPath = d.registryPath;
    if (d.evidenceDigest !== undefined) f.evidenceDigest = d.evidenceDigest;
    if (d.details !== undefined) f.details = d.details;
    const crumb = breadcrumbFor(d.line);
    if (crumb !== undefined) f.breadcrumb = crumb;
    return f;
  });
  findings.sort((a, b) => {
    const la = a.line ?? 0;
    const lb = b.line ?? 0;
    if (la !== lb) return la - lb;
    const byRule = codeUnitCompare(a.ruleId, b.ruleId);
    if (byRule !== 0) return byRule;
    return codeUnitCompare(a.message, b.message);
  });
  return findings;
}

/** The sections matcher (docs/constitution.md §Sections): ordered, greedy, no backtracking. */
function checkSections(
  effective: EffectiveType,
  doc: ParsedDoc,
  registry: FlattenedRegistry,
): FindingDraft[] {
  const s = effective.sections;
  if (s === undefined) return [];
  const raw: FindingDraft[] = [];
  /**
   * docs/concepts.md §Findings and routing: two of the three ergonomics `enrichRuleDraft` gave a
   * rule-driven finding — the declaring entry's `registryPath` and the
   * contributing type's own prose as a hint. A `required-headings` finding
   * carried both; the `sections` arm that absorbed it carried neither.
   *
   * NOT the third. The `evidenceDigest` is filled by the judge for a finding
   * that states no evidence of its own, from the line's text. Only drafts that
   * carry a declaring `entry` are enriched, so `section-depth` — which absorbed
   * nothing — keeps the envelope it had.
   */
  const drafts = {
    push(draft: FindingDraft & { entry?: EffectiveSectionEntry }): void {
      const { entry, ...rest } = draft;
      const out: FindingDraft = { ...rest };
      if (entry === undefined) {
        raw.push(out);
        return;
      }
      if (entry.registryPath !== undefined) out.registryPath = entry.registryPath;
      const contributor = registry.types.get(draft.contributedBy ?? "");
      const hint = contributor?.avoid_when ?? contributor?.description;
      if (hint !== undefined) out.hint = hint;
      raw.push(out);
    },
  };
  const declared = s.list.map((e) => ({ ...e, identity: normalizeIdentity(e.heading) }));
  const indexOf = new Map<string, number>();
  declared.forEach((e, i) => {
    // A declared name is the heading OR any of its aliases — one
    // identity space, normalizeIdentity like every other declared name.
    for (const name of [e.heading, ...(e.aliases ?? [])]) {
      const identity = normalizeIdentity(name);
      if (!indexOf.has(identity)) indexOf.set(identity, i);
    }
  });
  const counts: number[] = declared.map(() => 0);
  let maxSeen = -1;
  let orderReported = false;
  // docs/constitution.md §Sections: the page's first depth-1 heading is its
  // title, not a section, wherever the type's sections live deeper — so a page
  // titled like one of its own sections (`# Layout` over `## Layout`) is not a
  // heading at the wrong depth. It takes no part in this pass, the forbidden
  // rule included; any later depth-1 heading does.
  const titleLine = s.depth >= 2 ? doc.headings.find((h) => h.depth === 1)?.line : undefined;
  for (const h of doc.headings) {
    if (h.line === titleLine) continue;
    const idx = indexOf.get(normalizeIdentity(h.text));
    const declaredEntry = idx === undefined ? undefined : declared[idx];
    // Max: 0 forbids the heading at ANY depth. Forbidden-ness is a
    // property of the declared identity, so the depth rule below does not
    // preempt it — `section-depth` would tell the author to re-level a heading
    // this type does not allow at any level, and the forbidden rule, whose
    // final loop is guarded by max > 0, would never speak.
    if (idx !== undefined && declaredEntry?.max === 0) {
      counts[idx] = (counts[idx] ?? 0) + 1;
      drafts.push({
        ruleId: "sections",
        severity: "error",
        line: h.line,
        message: `section "${declaredEntry.heading}" is not allowed on this type (max 0)`,
        remediation: `remove the section, or drop the max: 0 declaration on ${declaredEntry.contributedBy}`,
        contributedBy: declaredEntry.contributedBy,
        entry: declaredEntry,
      });
      continue;
    }
    // The depth alphabet: only headings at the declared depth
    // participate; deeper headings belong to their enclosing section and are
    // exempt — UNLESS this type declares the heading, in which case header
    // identity binds first and the depth is the defect.
    if (h.depth !== s.depth) {
      if (idx === undefined) continue;
      const entry = declared[idx];
      if (entry === undefined) continue;
      counts[idx] = (counts[idx] ?? 0) + 1;
      drafts.push({
        ruleId: "section-depth",
        severity: "error",
        line: h.line,
        message: `section "${entry.heading}" is declared at depth ${s.depth} but appears at depth ${h.depth}`,
        remediation: `write it as "${"#".repeat(s.depth)} ${h.text}"`,
        contributedBy: entry.contributedBy,
        // docs/concepts.md §Findings and routing: the fixer reads VALUES, never the message.
        details: { heading: h.text, declared_depth: s.depth, found_depth: h.depth },
      });
      continue;
    }
    if (idx === undefined) {
      if (!s.additional) {
        drafts.push({
          ruleId: "sections",
          severity: "error",
          line: h.line,
          message: `undeclared section "${h.text}" (sections.additional is false)`,
          contributedBy: effective.name,
        });
      }
      continue;
    }
    counts[idx] = (counts[idx] ?? 0) + 1;
    if (s.ordered) {
      if (idx < maxSeen && !orderReported) {
        drafts.push({
          ruleId: "sections",
          severity: "error",
          line: h.line,
          message: `section "${h.text}" appears out of declared order`,
          remediation: `sections match in declared order: ${declared.map((e) => e.heading).join(" → ")}`,
          contributedBy: effective.name,
        });
        orderReported = true;
      }
      if (idx > maxSeen) maxSeen = idx;
    }
  }
  declared.forEach((e, i) => {
    const count = counts[i] ?? 0;
    if (count < e.min) {
      drafts.push({
        ruleId: "sections",
        severity: "error",
        message: `missing required section "${e.heading}"${e.min > 1 ? ` (${count} of ${e.min})` : ""}`,
        remediation: `add a "## ${e.heading}" section (declared by ${e.contributedBy})`,
        contributedBy: e.contributedBy,
        details: { missing_heading: e.heading, depth: s.depth, needed: e.min - count },
        entry: e,
      });
    }
    if (e.max !== undefined && e.max > 0 && count > e.max) {
      drafts.push({
        ruleId: "sections",
        severity: "error",
        message: `section "${e.heading}" appears ${count} times; at most ${e.max} allowed`,
        contributedBy: e.contributedBy,
        entry: e,
      });
    }
  });
  return raw;
}

/**
 * docs/constitution.md §Sections: a section's `max_chars`, counted
 * over NFC code points — deterministic, warning severity. The one budget a
 * bundle declares, and this pass is its one reader.
 */
function checkSectionBudgets(effective: EffectiveType, doc: ParsedDoc): FindingDraft[] {
  const entries = (effective.sections?.list ?? []).filter((e) => e.max_chars !== undefined);
  if (entries.length === 0) return [];
  const depth = effective.sections?.depth ?? DEFAULT_SECTION_DEPTH;
  const chars = (text: string): number => [...text.normalize("NFC")].length;
  const lines = doc.source.split("\n");
  const marks = doc.headings.filter((h) => h.depth === depth);
  const drafts: FindingDraft[] = [];
  marks.forEach((mark, i) => {
    // A declared name is the heading OR any of its aliases — one identity
    // space, `normalizeIdentity` like every other declared name.
    const identity = normalizeIdentity(mark.text);
    const entry = entries.find((e) =>
      [e.heading, ...(e.aliases ?? [])].some((n) => normalizeIdentity(n) === identity),
    );
    const max = entry?.max_chars;
    if (entry === undefined || max === undefined) return;
    const end = i + 1 < marks.length ? (marks[i + 1]?.line ?? lines.length) - 1 : lines.length;
    const spanChars = chars(lines.slice(mark.line, end).join("\n"));
    if (spanChars <= max) return;
    drafts.push({
      ruleId: "max-chars",
      severity: "warning",
      line: mark.line,
      message: `section "${mark.text}" is ${spanChars} chars over NFC; the budget is ${max}`,
      contributedBy: entry.contributedBy,
    });
  });
  return drafts;
}

/**
 * docs/constitution.md §Sections: the effective section list, as parser bindings.
 *
 * Exported because it is the ONE compiler from an effective type to
 * `SectionBinding[]`, and every reader of a page's grammar must see the same
 * one.
 */
/**
 * docs/concepts.md §Findings and routing: the ONE legal value of a shape, where there is one.
 * An `enum` with a single member is the whole of that population today — a
 * boolean has two, a string has infinitely many — and `frontmatter-set` may
 * only write a value the shape leaves no room to get wrong.
 */
function soleValueDetails(field: string, shape: unknown): Record<string, string> {
  const record = shape as Record<string, unknown> | null;
  const values = record === null ? undefined : record["values"];
  if (record?.["kind"] === "enum" && Array.isArray(values) && values.length === 1) {
    const only = values[0];
    if (typeof only === "string") return { field, sole_value: only };
  }
  return { field };
}

export function grammarBindings(
  effective: EffectiveType,
  modules: ModuleRegistry,
): SectionBinding[] {
  const sections = effective.sections;
  if (sections === undefined) return [];
  return sections.list.map((entry) => {
    // docs/extending.md §A grammar: the entry's own record, plus the
    // kernel's `vocabulary` key under the name every grammar reads it by. The
    // kernel reads none of them, so a kit's parameter travels the same way the
    // shipped ones do and this function never learns a new name.
    const params = declaredParams(entry);
    const grammar = (entry.grammar ?? "prose") as GrammarKind;
    const binding: SectionBinding = {
      heading: entry.heading,
      depth: sections.depth,
      grammar,
      params,
      // docs/extending.md §A grammar: the dispatch chain is resolved HERE, where the
      // registry is, so the parser never holds one and never names a grammar.
      parsers: resolveParsers(grammar, params, modules),
    };
    if (entry.aliases !== undefined) binding.aliases = entry.aliases;
    if (entry.severity !== undefined) binding.severity = entry.severity;
    binding.contributedBy = entry.contributedBy;
    if (entry.registryPath !== undefined) binding.registryPath = entry.registryPath;
    return binding;
  });
}

/**
 * ONE construction site for the parser's bundle-level options. Every
 * `parseSections` call in this module reads it, because the bare-path form
 * changes a claim's CORE — two call sites disagreeing would give one page two
 * identities and quietly break the transition arm's survival test.
 */
export function parseOptionsOf(options: LintOptions | undefined): ParseOptions | undefined {
  if (options?.sourceRoots === undefined) return undefined;
  return { sourceRoots: options.sourceRoots };
}

/** docs/constitution.md §Vocabularies: one entry, as the vault uses it. */
export interface VocabularyObservation {
  /** The authored value, grouped by the vocabulary's own identity relation. */
  label: string;
  count: number;
  /** The declared `type` of every page the value was observed on, sorted. */
  onTypes: string[];
}

/**
 * docs/constitution.md §Vocabularies: what the vault actually writes, counted.
 *
 * The census reads the pages through the SAME parse the arms are judged from —
 * `grammarBindings` + `parseSections` under `parseOptionsOf`, the one
 * construction site — because a count produced by a second reader
 * is a count of a different vault. `tags` is the one vocabulary read outside a
 * section, so it is read where it lives: the page's frontmatter.
 *
 * Every item of the matching kind is counted, whether or not the section that
 * carries it binds the vocabulary: a label written where nothing checks it is
 * still a label this vault carries, and hiding it is how a census stops
 * measuring drift.
 */
export function observeVocabulary(
  vocabulary: string,
  pages: readonly { path: string; doc: ParsedDoc }[],
  registry: FlattenedRegistry,
  options?: LintOptions,
): VocabularyObservation[] {
  const seen = new Map<string, { label: string; count: number; onTypes: Set<string> }>();
  const record = (authored: string, type: string): void => {
    const identity = normalizeIdentity(authored);
    const row = seen.get(identity);
    if (row === undefined) {
      seen.set(identity, { label: authored, count: 1, onTypes: new Set([type]) });
      return;
    }
    row.count += 1;
    row.onTypes.add(type);
    // Two spellings of one identity are ONE entry to every consumer of the
    // vocabulary, so they are one row here; the reported spelling is fixed by
    // code-unit order rather than by which page the walk reached first.
    if (codeUnitCompare(authored, row.label) < 0) row.label = authored;
  };
  for (const page of pages) {
    const declared = page.doc.frontmatter.value["type"];
    if (typeof declared !== "string" || declared.length === 0) continue;
    if (vocabulary === "tags") {
      const tags = page.doc.frontmatter.value["tags"];
      if (!Array.isArray(tags)) continue;
      for (const tag of tags) if (typeof tag === "string") record(tag, declared);
      continue;
    }
    const effective = registry.types.get(declared);
    if (effective === undefined) continue;
    const bindings = grammarBindings(effective, registry.modules);
    if (!bindings.some((b) => b.grammar !== "prose")) continue;
    for (const section of parseSections(page.doc, bindings, parseOptionsOf(options)).sections) {
      for (const item of section.items) {
        // docs/constitution.md §Vocabularies: the item says which values of THIS
        // vocabulary it authored, through the grammar that owns its kind. This
        // loop used to branch on three vocabulary names and then read
        // `item.label`, `item.category` and `item.provenance.source` — one
        // module's field names in a kernel census, and a kit's vocabulary
        // uncountable by construction.
        for (const authored of observedValues(vocabulary, item as never, registry.modules)) {
          record(authored, declared);
        }
      }
    }
  }
  return [...seen.values()]
    .map((row) => ({
      label: row.label,
      count: row.count,
      onTypes: [...row.onTypes].sort(codeUnitCompare),
    }))
    .sort((a, b) => b.count - a.count || codeUnitCompare(a.label, b.label));
}

/**
 * docs/extending.md §A check: the registered checks this page's type answers to.
 * The kernel resolves the check from the registry, builds the narrow context it
 * declared, and owns the severity — a check emits its own id and nothing else,
 * exactly as an arm does. A bundle SELECTS a check and configures it; it never
 * names a checker file the engine has to trust (`docs/extending.md §A check`).
 */
function runRegisteredChecks(
  effective: EffectiveType,
  registry: FlattenedRegistry,
  path: string,
  doc: ParsedDoc,
  pageTags: readonly string[],
  options: LintOptions | undefined,
): FindingDraft[] {
  if (effective.checks.length === 0) return [];
  const drafts: FindingDraft[] = [];
  const body = bodyLines(doc.source, doc.frontmatter.endLine).join("\n");
  const page = {
    path,
    frontmatter: doc.frontmatter.value,
    body,
    chain: effective.chain,
    tags: pageTags,
  };
  const names = options?.names;
  let ast: SectionAST | undefined;
  for (const attachment of effective.checks) {
    const spec = registry.modules.checks.get(attachment.use);
    if (spec === undefined) continue;
    // Applied to checks as to arms: without a base a `needsBase` check does not
    // run at all, and the coverage block reads `not_applicable`, reason
    // `no-base` — never a silent pass over half its input.
    if (spec.needsBase === true && options?.baseText === undefined) continue;
    const emitted: FindingDraft[] = [];
    const emit = (
      line: number | undefined,
      message: string,
      details: Record<string, string | number | boolean>,
      evidence: string,
      remediation?: string,
    ): void => {
      const severity =
        spec.row === "declared"
          ? (attachment.severity ?? DECLARED_ARM_DEFAULT)
          : armDefault(spec.row);
      const draft: FindingDraft = {
        ruleId: attachment.use,
        severity,
        message,
        details,
        evidenceDigest: evidenceDigestFor(attachment.use, path, evidence),
        contributedBy: attachment.contributedBy,
      };
      if (line !== undefined) draft.line = line;
      if (remediation !== undefined) draft.remediation = remediation;
      if (attachment.registryPath !== undefined) draft.registryPath = attachment.registryPath;
      emitted.push(draft);
    };
    const context: CheckContext = {
      config: attachment.config,
      page,
      emit,
      resolves: (name) => (names === undefined ? undefined : names.resolve(name) !== undefined),
      chainOf: (name) => {
        const declared = names?.typeOf?.(name);
        return declared === undefined ? undefined : registry.types.get(declared)?.chain;
      },
    };
    let scoped: CheckContext = context;
    if (attachment.surface === "field" && attachment.target !== undefined) {
      const field: { name: string; value: unknown; line?: number } = {
        name: attachment.target,
        value: doc.frontmatter.value[attachment.target],
      };
      const line = doc.frontmatter.keys.find((k) => k.key === attachment.target)?.line;
      if (line !== undefined) field.line = line;
      scoped = { ...context, field };
    } else if (attachment.surface === "section" && attachment.target !== undefined) {
      ast ??= parseSections(
        doc,
        grammarBindings(effective, registry.modules),
        parseOptionsOf(options),
      );
      const identity = normalizeIdentity(attachment.target);
      const node = ast.sections.find((s) => s.identity === identity);
      if (node === undefined) continue;
      scoped = {
        ...context,
        section: {
          heading: node.heading,
          line: node.line,
          params: node.binding.params,
          items: node.items as never,
        },
      };
    }
    if (options?.baseText !== undefined) scoped = { ...scoped, baseText: options.baseText };
    // docs/extending.md §The determinism fixture: a check that throws is one attributed error on
    // one page, never an unattributed crash. Its own emits are DROPPED — a
    // predicate that did not finish has no verdict, and half a verdict read as a
    // whole one is the silence this whole record exists to remove.
    try {
      spec.run(scoped);
      drafts.push(...emitted);
    } catch (error) {
      const owner = registry.modules.owners.get(`check:${attachment.use}`);
      const module = owner?.module ?? "?";
      drafts.push({
        ruleId: "module-failure",
        severity: "error",
        message: `module "${module}"${owner?.version === undefined ? "" : `@${owner.version}`} threw while running check "${attachment.use}": ${error instanceof Error ? error.message : String(error)}`,
        details: {
          module,
          check: attachment.use,
          ...(owner?.version === undefined ? {} : { version: owner.version }),
        },
        remediation:
          "report the failure to the module's author; the check has no verdict on this page",
        evidenceDigest: evidenceDigestFor("module-failure", path, `${module}|${attachment.use}`),
        contributedBy: attachment.contributedBy,
      });
    }
  }
  return drafts;
}

/** docs/concepts.md §Section grammar: the state arms, driven by the type's own declarations. */
function checkSectionGrammars(
  effective: EffectiveType,
  registry: FlattenedRegistry,
  path: string,
  doc: ParsedDoc,
  pageTags: readonly string[],
  options: LintOptions | undefined,
): FindingDraft[] {
  const bindings = grammarBindings(effective, registry.modules);
  if (!bindings.some((b) => b.grammar !== "prose")) return [];
  const ast = parseSections(doc, bindings, parseOptionsOf(options));
  // docs/concepts.md §Findings and routing: the arms' rows come from the modules that
  // declared them, so the judge carries the registry to the emit site.
  const checkOptions: GrammarCheckOptions = { modules: registry.modules };
  // The page a negative selector is judged against. Unconditional now:
  // the arm reads the entry's own `owned_by` through the vocabulary view, so
  // there is no map whose emptiness could stand in for "no selector exists".
  checkOptions.page = { chain: effective.chain, tags: pageTags };
  checkOptions.vocabularies = vocabularyViews(registry);
  checkOptions.concreteTypesUnder = (names) =>
    [...registry.types.values()]
      .filter(
        (t) =>
          t.abstract !== true && t.status === "active" && t.chain.some((c) => names.includes(c)),
      )
      .map((t) => t.name)
      .sort(codeUnitCompare);
  const names = options?.names;
  if (names !== undefined) {
    checkOptions.resolveTarget = (n) => names.resolve(n) !== undefined;
    checkOptions.resolveTargetChain = (n) => {
      const declared = names.typeOf?.(n);
      return declared === undefined ? undefined : registry.types.get(declared)?.chain;
    };
  }
  return checkGrammar(ast, checkOptions).map((f) => {
    const draft: FindingDraft = {
      ruleId: f.ruleId,
      severity: f.severity,
      line: f.line,
      message: f.message,
      details: f.details,
      // Every grammar row is judgment-class by 07's own table — so without an
      // evidence key the queue the ratchet waits on can never reach 0 (docs/concepts.md §Findings and routing).
      evidenceDigest: evidenceDigestFor(f.ruleId, path, f.evidence),
    };
    if (f.remediation !== undefined) draft.remediation = f.remediation;
    if (f.contributedBy !== undefined) draft.contributedBy = f.contributedBy;
    if (f.registryPath !== undefined) draft.registryPath = f.registryPath;
    return draft;
  });
}

/**
 * docs/constitution.md §Vocabularies: one view per REGISTERED vocabulary name, as an
 * arm sees it. Entries are keyed by every name an author may write — canonical
 * AND alias — because an aliased label is a KNOWN label, and folding aliases
 * away is what made the alias law unenforceable before. The arm gets the
 * MODULE's own entry (the properties its own schema validated); the alias and
 * retirement laws travel in `uses`, which is the kernel's because it judges them.
 */
function vocabularyViews(registry: FlattenedRegistry): Map<string, VocabularyView> {
  const usesOf = (vocabulary: EffectiveVocabulary): Map<string, VocabularyUse> => {
    const uses = new Map<string, VocabularyUse>();
    for (const entry of vocabulary.entries.values()) {
      const shared = {
        canonical: entry.name,
        retired: entry.status === "retired",
        ...(entry.replaced_by === undefined ? {} : { replaced_by: entry.replaced_by }),
      };
      uses.set(normalizeIdentity(entry.name), { ...shared, alias: false });
      for (const alias of entry.aliases) {
        uses.set(normalizeIdentity(alias), { ...shared, alias: true });
      }
    }
    return uses;
  };
  const views = new Map<string, VocabularyView>();
  for (const [name, vocabulary] of registry.vocabularies) {
    const entries = new Map<string, Readonly<Record<string, unknown>>>();
    for (const [identity, entry] of vocabulary.entries) {
      entries.set(identity, entry.properties);
      for (const alias of entry.aliases) entries.set(normalizeIdentity(alias), entry.properties);
    }
    views.set(name, { mode: vocabulary.mode, entries, uses: usesOf(vocabulary) });
  }
  return views;
}

/**
 * docs/concepts.md §Findings and routing: the transition arms, driven by the SECTION's
 * declaration. The kernel parses both revisions under the one parser, hands
 * each grammar's `runTransition` arms the items of the section and of any other
 * declared section by heading, and carries findings and counts back; what a
 * removal, a landing or a mutation MEANS is the grammar's (docs/extending.md §An arm).
 * The page-wide `body-append-only` law is the type's, and stays the kernel's.
 *
 * Diff-gated by construction: with no base there is no transition, and the caller
 * counts the pass `not_applicable` rather than reporting a clean zero.
 */
function checkSectionTransitions(
  effective: EffectiveType,
  registry: FlattenedRegistry,
  path: string,
  doc: ParsedDoc,
  pageTags: readonly string[],
  options: LintOptions | undefined,
): FindingDraft[] {
  const baseText = options?.baseText;
  if (baseText === undefined) return [];
  const bindings = grammarBindings(effective, registry.modules);
  if (bindings.length === 0 && effective.body?.lifecycle !== "append-only") return [];
  const drafts: FindingDraft[] = [];

  // docs/constitution.md §Types: the page-wide arm. v2's `append-only` checker in strict
  // mode, moved rather than reinterpreted — the base body's lines, trailing
  // empty lines trimmed, are a PREFIX of the draft's, and the first differing
  // line is the finding's. A file-final newline yields one trailing empty
  // element; it is an artifact of splitting, not content.
  // The index carries an unchanged page's own bytes as its base. Reuse its
  // projection, but still run every declared transition arm and disposition.
  const baseDoc = normalizeInput(baseText).text === doc.source ? doc : parseDoc(baseText);
  if (effective.body?.lifecycle === "append-only") {
    const baseBody = bodyLines(baseDoc.source, baseDoc.frontmatter.endLine);
    while (baseBody.length > 0 && baseBody.at(-1) === "") baseBody.pop();
    const currentBody = bodyLines(doc.source, doc.frontmatter.endLine);
    for (let i = 0; i < baseBody.length; i += 1) {
      if (currentBody[i] === baseBody[i]) continue;
      drafts.push({
        ruleId: "body-append-only",
        severity: effective.body.severity,
        line: doc.frontmatter.endLine + i + 1,
        message: `this page is append-only; body line ${i + 1} was changed or removed`,
        remediation: "restore the line and record the correction as a NEW dated entry",
        contributedBy: effective.body.contributedBy,
        evidenceDigest: evidenceDigestFor("body-append-only", path, baseBody[i] ?? ""),
      });
      break;
    }
  }

  if (bindings.length === 0) return drafts;
  // The ONE construction site. The bare-path form changes a
  // claim's CORE, so an arm parsing without the bundle's options gives the page
  // a second identity and reports a claim nobody edited as removed.
  const parseOptions = parseOptionsOf(options);
  const current = parseSections(doc, bindings, parseOptions);
  const base = parseSections(baseDoc, bindings, parseOptions);
  const views = vocabularyViews(registry);
  const declared = new Set(bindings.map((b) => normalizeIdentity(b.heading)));
  const itemsOf = (ast: SectionAST, heading: string): TransitionItem[] => {
    const identity = normalizeIdentity(heading);
    return ast.sections
      .filter((s) => s.identity === identity)
      .flatMap((s) => s.items) as unknown as TransitionItem[];
  };
  const count = (disposition: string, n = 1): void => {
    const sink = options?.collect?.dispositions;
    if (sink !== undefined) sink[disposition] = (sink[disposition] ?? 0) + n;
  };

  for (const binding of bindings) {
    const spec = registry.modules.grammars.get(binding.grammar);
    if (spec === undefined) continue;
    const arms = spec.arms.filter(
      (arm) => arm.runTransition !== undefined && armApplies(arm, binding.params),
    );
    if (arms.length === 0) continue;
    const identity = normalizeIdentity(binding.heading);
    const section = {
      heading: binding.heading,
      line:
        current.sections.find((s) => s.identity === identity)?.line ?? doc.frontmatter.endLine + 1,
    };
    for (const arm of arms) {
      const severity =
        arm.row === "declared"
          ? (binding.severity ?? arm.severityDefault ?? DECLARED_ARM_DEFAULT)
          : armDefault(arm.row);
      const ctx: TransitionContext = {
        params: binding.params,
        section,
        page: { chain: effective.chain, tags: pageTags },
        base: itemsOf(base, binding.heading),
        current: itemsOf(current, binding.heading),
        sectionItems: (heading) =>
          declared.has(normalizeIdentity(heading))
            ? { base: itemsOf(base, heading), current: itemsOf(current, heading) }
            : undefined,
        vocabulary: (name) => views.get(name),
        emit: (id, line, message, details, evidence, remediation) => {
          if (id !== arm.id) {
            throw new Error(
              `arm "${arm.id}" emitted "${id}", which is not its own id — an arm may emit only the id it declared`,
            );
          }
          const draft: FindingDraft = {
            ruleId: id,
            severity,
            message,
            details,
            contributedBy: binding.contributedBy ?? effective.name,
            evidenceDigest: evidenceDigestFor(id, path, evidence),
          };
          if (line !== undefined) draft.line = line;
          if (remediation !== undefined) draft.remediation = remediation;
          if (binding.registryPath !== undefined) draft.registryPath = binding.registryPath;
          drafts.push(draft);
        },
        count,
      };
      // docs/extending.md §The determinism fixture: a module that throws is one attributed error
      // on one page, never an unattributed crash.
      try {
        arm.runTransition?.(ctx);
      } catch (error) {
        const owner = registry.modules.owners.get(`arm:${arm.id}`);
        const module = owner?.module ?? "?";
        drafts.push({
          ruleId: "module-failure",
          severity: "error",
          line: section.line,
          message: `module "${module}"${owner?.version === undefined ? "" : `@${owner.version}`} threw while running arm "${arm.id}": ${error instanceof Error ? error.message : String(error)}`,
          details: {
            module,
            arm: arm.id,
            section: binding.heading,
            ...(owner?.version === undefined ? {} : { version: owner.version }),
          },
          remediation:
            "report the failure to the module's author; the pass it was running has no verdict on this page",
          evidenceDigest: evidenceDigestFor("module-failure", path, `${module}|${arm.id}`),
          contributedBy: binding.contributedBy ?? effective.name,
        });
      }
    }
  }
  return drafts;
}

/**
 * docs/constitution.md §Types: `instances` is a vault-level cardinality with its own
 * severity — "exactly one charter", stated where the type is declared. Counted
 * over the pages the caller walked, so `lint --page` never guesses a vault total.
 */
export function checkVaultInstances(
  pages: readonly { path: string; doc: ParsedDoc }[],
  registry: FlattenedRegistry,
): Finding[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const declared = page.doc.frontmatter.value["type"];
    if (typeof declared !== "string") continue;
    counts.set(declared, (counts.get(declared) ?? 0) + 1);
  }
  const findings: Finding[] = [];
  for (const [name, effective] of [...registry.types].sort((a, b) => codeUnitCompare(a[0], b[0]))) {
    const instances = effective.instances;
    if (instances === undefined) continue;
    const count = counts.get(name) ?? 0;
    const under = instances.min !== undefined && count < instances.min;
    const over = instances.max !== undefined && count > instances.max;
    if (!under && !over) continue;
    findings.push({
      ruleId: "instances",
      severity: instances.severity,
      path: "config/constitution.json",
      message: under
        ? `the vault holds ${count} page(s) of type "${name}"; at least ${String(instances.min)} required`
        : `the vault holds ${count} page(s) of type "${name}"; at most ${String(instances.max)} allowed`,
      remediation: under
        ? `author the page, or relax instances.min on "${name}" through review`
        : `retire the extra page(s), or relax instances.max on "${name}" through review`,
      contributedBy: instances.contributedBy,
      layer: "constitution",
    });
  }
  return findings;
}

/**
 * docs/concepts.md: base-OKF conformance as its own pass — markdown plus
 * frontmatter, and a non-empty producer-defined `type` on every concept
 * document. A narrower LAW than the constitution's, judged apart from it so the
 * two layers never rescue or contaminate each other; the verb that prints it is
 * a runner and nothing more.
 */
export function checkOkfCore(pages: readonly { path: string; doc: ParsedDoc }[]): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    for (const issue of page.doc.frontmatter.issues) {
      findings.push({
        ruleId: issue.code,
        severity: "error",
        path: page.path,
        line: issue.line,
        message: issue.message,
        contributedBy: "engine",
        layer: "okf-core",
      });
    }
    const typeValue = page.doc.frontmatter.value["type"];
    if (typeof typeValue !== "string" || typeValue.trim().length === 0) {
      findings.push({
        ruleId: "okf-missing-type",
        severity: "error",
        path: page.path,
        message: "OKF requires a non-empty type on every concept document",
        remediation: "add a type: value — any producer-defined string satisfies base OKF",
        contributedBy: "engine",
        layer: "okf-core",
      });
    }
  }
  return findings;
}

function bodyLines(text: string, frontmatterEndLine: number): string[] {
  return text.split("\n").slice(frontmatterEndLine);
}
