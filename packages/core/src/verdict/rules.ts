// v2 contracts §5 (the page interface a rule is bound to, `before`
// availability) · §6 (evaluation: a page rule once per page, a section rule
// once per matching occurrence; true passes, false is a finding, anything
// else is rule-error; a transition rule under a state with no base is
// unevaluated).
//
// The rules a page's type carries after inheritance and `configure`, each
// evaluated over the interface built once per page: `page`, `section` for a
// section rule's occurrence, the rule's `config`, the law's `facts` with this
// page's links, and `before` — the base's page and sections, and the same
// occurrence of the section when the base has it.
import {
  buildBefore,
  buildPageInterface,
  celOccurrence,
  type lawFacts,
  type PageRead,
  type ParsedPage,
  pageLinks,
} from "../interface/index.ts";
import type { LawType } from "../law/compose.ts";
import type { TypeLaw } from "../law/load.ts";
import type { ResolveTarget } from "../records/index.ts";
import { indexed } from "./grammar.ts";
import { PAGE_LOCATION, type Unrouted } from "./page.ts";
import type { FindingLocation } from "./table.ts";

/** What every page's rules share: the law's facts, and how a name resolves. */
export interface RuleContext {
  law: TypeLaw;
  facts: ReturnType<typeof lawFacts>;
  resolve: ResolveTarget;
}

export interface RuleOutcome {
  findings: Unrouted[];
  /** Rules that evaluated on this page. */
  judged: Set<string>;
  /** Transition rules this page could not evaluate, and why. */
  unjudged: Map<string, "no-base" | "base-unreadable">;
}

/**
 * Every rule of the page's type over the page. `base` is as the state holds
 * it: `undefined` with no base, `null` for a page the base does not hold.
 */
export function ruleFindings(
  ctx: RuleContext,
  page: ParsedPage,
  type: LawType,
  base: PageRead | null | undefined,
): RuleOutcome {
  const out: RuleOutcome = { findings: [], judged: new Set(), unjudged: new Map() };
  if (type.rules.length === 0) return out;
  const pageValue = buildPageInterface(page, type);
  const facts = {
    vocabularies: ctx.facts.vocabularies,
    links: pageLinks(page, ctx.resolve),
    ancestry: ctx.facts.ancestry,
  };
  const readable = base === null || base?.ok === true;
  const basePage = base !== null && base?.ok === true ? base.page : undefined;
  const beforeValue = buildBefore(
    basePage === undefined ? undefined : { parsed: basePage, type: basePage.type ?? type },
  );
  const reason = base === undefined ? "no-base" : readable ? undefined : "base-unreadable";
  const occurrences = indexed(page);
  const baseOccurrences = basePage === undefined ? [] : indexed(basePage);
  for (const rule of type.rules) {
    const compiled = ctx.law.rules.get(rule.id);
    if (compiled === undefined) continue;
    const sites: {
      location: FindingLocation;
      section?: Record<string, unknown>;
      before: Record<string, unknown>;
    }[] =
      rule.section === undefined
        ? [{ location: PAGE_LOCATION, before: beforeValue }]
        : occurrences
            .filter(
              (a) =>
                JSON.stringify(a.occurrence.policy) ===
                JSON.stringify(typeof rule.section === "string" ? [rule.section] : rule.section),
            )
            .map((a) => {
              const was = baseOccurrences.find(
                (b) =>
                  JSON.stringify(b.occurrence.address) === JSON.stringify(a.occurrence.address) &&
                  JSON.stringify(b.occurrence.policy) === JSON.stringify(a.occurrence.policy),
              );
              return {
                location: {
                  kind: "section" as const,
                  heading: a.occurrence.heading,
                  occurrence: a.index,
                  line: a.occurrence.location.line,
                },
                section: celOccurrence(a.occurrence),
                before:
                  was === undefined
                    ? beforeValue
                    : { ...beforeValue, section: celOccurrence(was.occurrence) },
              };
            });
    for (const site of sites) {
      if (compiled.transition && reason !== undefined) {
        out.unjudged.set(rule.id, reason);
        out.findings.push({
          rule: "unevaluated",
          severity: "info",
          path: page.path,
          location: site.location,
          message:
            reason === "no-base"
              ? `rule ${rule.id} reads before, and this state has no base`
              : `rule ${rule.id} reads before, and the base does not read as a page`,
          details: { rule: rule.id, reason },
        });
        continue;
      }
      out.judged.add(rule.id);
      const verdict = compiled.evaluate({
        base: reason === undefined,
        page: pageValue,
        ...(site.section === undefined ? {} : { section: site.section }),
        config: rule.config,
        facts,
        before: site.before,
      });
      if (verdict.verdict === "fail") {
        out.findings.push({
          rule: rule.id,
          severity: rule.severity,
          path: page.path,
          location: site.location,
          message: rule.message,
          details: { declared_by: rule.declaredBy },
        });
      } else if (verdict.verdict === "error") {
        out.findings.push({
          rule: "rule-error",
          severity: "error",
          path: page.path,
          location: site.location,
          message: `rule ${rule.id} did not evaluate to a bool: ${verdict.message}`,
          details: { rule: rule.id, kind: verdict.kind, error: verdict.message },
        });
      }
    }
  }
  return out;
}
