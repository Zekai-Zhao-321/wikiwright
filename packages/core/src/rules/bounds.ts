// v2 contracts §6: the declared bounds of every range a comprehension may
// walk, enforced on the data. The static cost bound (profile.ts) multiplies
// these; it is a bound only because the page reader and the loader refuse
// data that exceeds them.
import type { LawType, LawVocabulary } from "../law/compose.ts";
import type { LawIssue } from "../law/issues.ts";
import { RANGE_BOUNDS } from "./profile.ts";

export { RANGE_BOUNDS };

/**
 * The first list or map below the top of `value` holding more than `bound`
 * members, as a JSON pointer, with its size. The top-level map itself (a
 * page's frontmatter, a rule's config) is not a range a rule can walk; every
 * list and every map inside it is, under one bound.
 */
export function overBound(
  value: unknown,
  bound: number,
  pointer = "",
): { pointer: string; size: number } | undefined {
  const members: [string, unknown][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : value !== null && typeof value === "object"
      ? Object.entries(value)
      : [];
  for (const [key, member] of members) {
    const at = `${pointer}/${key}`;
    const size = Array.isArray(member)
      ? member.length
      : member !== null && typeof member === "object"
        ? Object.keys(member).length
        : 0;
    if (size > bound) return { pointer: at, size };
    const inner = overBound(member, bound, at);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/**
 * §6 at load: the ranges the law itself supplies. Every vocabulary is a
 * `facts.vocabularies` list (entries, contributions counted), the type set is
 * `facts.ancestry` (a map a rule may walk, and the bound of every ancestry
 * chain in it), the vocabulary set is `facts.vocabularies` itself, and a
 * `default` the shape declares enters `page.fields` as a frontmatter value
 * would. A rule's config lists are held where they are written, by the
 * document reader.
 */
export function lawBoundIssues(
  types: ReadonlyMap<string, LawType>,
  vocabularies: ReadonlyMap<string, LawVocabulary>,
): LawIssue[] {
  const issues: LawIssue[] = [];
  const whole = (what: string, size: number): void => {
    if (size <= RANGE_BOUNDS.facts) return;
    issues.push({
      code: "law-too-large",
      where: "bundle:constitution",
      message: `the law declares ${size} ${what}; facts holds at most ${RANGE_BOUNDS.facts}`,
      details: { limit: "facts", bound: RANGE_BOUNDS.facts, size },
    });
  };
  whole("types (libraries included)", types.size);
  whole("vocabularies (libraries included)", vocabularies.size);
  for (const vocabulary of vocabularies.values()) {
    if (vocabulary.entries.size <= RANGE_BOUNDS.facts) continue;
    issues.push({
      code: "vocabulary-invalid",
      where: vocabulary.where,
      message: `/entries: ${vocabulary.name} holds ${vocabulary.entries.size} entries, contributions counted; a vocabulary holds at most ${RANGE_BOUNDS.facts}`,
      details: {
        pointer: "/entries",
        limit: "facts",
        bound: RANGE_BOUNDS.facts,
        size: vocabulary.entries.size,
      },
    });
  }
  const seen = new Set<string>();
  for (const type of types.values()) {
    for (const part of type.parts) {
      if (seen.has(part.origin)) continue;
      seen.add(part.origin);
      const properties = part.raw["properties"];
      if (properties === null || typeof properties !== "object") continue;
      for (const [name, declared] of Object.entries(properties)) {
        if (declared === null || typeof declared !== "object") continue;
        if (!Object.hasOwn(declared, "default")) continue;
        const over = overBound(
          { [name]: (declared as Record<string, unknown>)["default"] },
          RANGE_BOUNDS.list,
        );
        if (over === undefined) continue;
        const pointer = `/fields/properties/${name}/default${over.pointer.slice(name.length + 1)}`;
        issues.push({
          code: `${part.origin.startsWith("fragment:") ? "fragment" : "type"}-invalid`,
          where: part.where,
          message: `${pointer}: the default holds ${over.size} members; a frontmatter list or map holds at most ${RANGE_BOUNDS.list}`,
          details: { pointer, limit: "list", bound: RANGE_BOUNDS.list, size: over.size },
        });
      }
    }
  }
  return issues;
}
