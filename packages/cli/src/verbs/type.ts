// v2 contracts §9.7: `type show <name> [--brief]` — the effective contract of
// one type, with attribution: the documents each part of it comes from — and
// `type list`. `--brief` adds the skeleton of §3.3 and the writing
// instruction, one line per section, with the vocabularies it reads, each
// entry declared and each value the vault uses with its live count: the old
// `vocabulary show`, absorbed.
//
// Ported from the old verb (legacy/type.ts): the two subcommands, the
// refusal of an unknown type with the valid names, the writing instruction's
// line per section (heading, grammar, bounds, the item's spelling, the
// parameters sorted by key, the vocabulary with its size), and the live
// counts that keep the tracked brief from going stale on a content commit.
// Changed: the contract is the type document's — the effective shape as
// compiled JSON Schema, each top-level property with the documents that
// declare it, the sections with the types and fragments that declare each
// heading, the rules with their declaring document and config after
// `configure` — and the skeleton is derived (§3.3), not a template.
import {
  codeUnitCompare,
  jsonNumbers,
  type LawType,
  RESERVED_KEYS,
  readPages,
  type StateRead,
  skeletonOf,
  type TypeLaw,
} from "@wikiwright/core";
import { type CommandResult, fail, ok } from "../envelope.ts";
import { fsState } from "../lawstate.ts";
import type { CommandArgs, CommandSpec } from "../spec.ts";
import { lawOf, stateRefusal, typeLawIdentity, withIdentity } from "../typelaw.ts";

/** Each grammar's one spelling (§4). */
const SPELLING: Readonly<Record<string, string>> = {
  claims: "- [category] core (provenance)",
  relations: "- label [[Target]]",
  entries: "- YYYY-MM-DD — text",
};

/** The top-level properties of the effective shape, each with the documents that declare it. */
function properties(type: LawType): { key: string; declared_by: string[] }[] {
  return type.properties.map((key) => {
    const parts = type.parts
      .filter((part) => {
        const props = part.schema["properties"];
        return props !== null && typeof props === "object" && Object.hasOwn(props, key);
      })
      .map((part) => part.origin);
    return { key, declared_by: RESERVED_KEYS.includes(key) ? ["reserved", ...parts] : parts };
  });
}

/** The vocabularies a type's sections and the reserved `tags` read, qualified. */
function vocabulariesRead(law: TypeLaw, type: LawType): string[] {
  const names = new Set<string>();
  for (const section of type.sections?.list ?? [])
    if (section.vocabulary !== undefined) names.add(section.vocabulary);
  if (law.vocabularies.has("tags")) names.add("tags");
  return [...names].sort(codeUnitCompare);
}

/**
 * The values the vault's pages use, per vocabulary: a claim's category and a
 * relation's label under a section that reads the vocabulary, a page's tags
 * for `tags`.
 */
function census(read: StateRead): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const count = (vocabulary: string, value: string): void => {
    const counts = out.get(vocabulary) ?? new Map<string, number>();
    counts.set(value, (counts.get(value) ?? 0) + 1);
    out.set(vocabulary, counts);
  };
  for (const page of read.pages) {
    if (!page.read.ok) continue;
    const parsed = page.read.page;
    const tags = parsed.frontmatter["tags"];
    if (Array.isArray(tags))
      for (const tag of tags) if (typeof tag === "string") count("tags", tag);
    for (const occurrence of parsed.occurrences) {
      const section = parsed.type?.sections?.list.find(
        (s) => JSON.stringify(s.path) === JSON.stringify(occurrence.policy),
      );
      if (section?.vocabulary === undefined) continue;
      for (const item of occurrence.items) {
        if (item.kind === "claim") count(section.vocabulary, item.category);
        else if (item.kind === "relation") count(section.vocabulary, item.label);
      }
    }
  }
  return out;
}

/** §9.7 the writing instruction: one line per section. */
function instruction(law: TypeLaw, type: LawType): string[] {
  return (type.sections?.list ?? []).map((section) => {
    const grammar = section.grammar ?? "prose";
    const bounds = `min ${section.min}${section.max === null ? "" : ` max ${section.max}`}`;
    const parts = [`${section.path.join(" > ")}  ${grammar}  scope ${section.scope}  ${bounds}`];
    const spelling = section.grammar === undefined ? undefined : SPELLING[section.grammar];
    if (spelling !== undefined) parts.push(spelling);
    const params = Object.entries(section.params)
      .sort(([a], [b]) => codeUnitCompare(a, b))
      .map(([key, value]) => `${key}=${JSON.stringify(jsonNumbers(value))}`);
    if (params.length > 0) parts.push(params.join(" "));
    if (section.vocabulary !== undefined) {
      const vocabulary = law.vocabularies.get(section.vocabulary);
      parts.push(
        `${section.vocabulary}: ${vocabulary?.entries.size ?? 0} declared (${vocabulary?.mode ?? "unknown"})`,
      );
    }
    return parts.join("  |  ");
  });
}

function contract(law: TypeLaw, type: LawType): Record<string, unknown> {
  return {
    name: type.name,
    namespace: type.namespace === "" ? null : type.namespace,
    where: type.where,
    role: type.role,
    description: type.description,
    use_when: type.use_when ?? null,
    use_when_declared_by: type.use_when_declared_by ?? null,
    avoid_when: type.avoid_when ?? null,
    avoid_when_declared_by: type.avoid_when_declared_by ?? null,
    abstract: type.abstract,
    instances: type.instances,
    extends: type.extends ?? null,
    ancestry: type.ancestry,
    fragments: type.fragments.map((name) => ({
      name,
      description: law.fragments.get(name)?.description ?? null,
      where: law.fragments.get(name)?.where ?? null,
    })),
    fields: {
      properties: properties(type),
      shape: jsonNumbers(law.shapes.get(type.name) ?? {}),
    },
    sections:
      type.sections === null
        ? null
        : {
            depth: type.sections.depth,
            ordered: type.sections.ordered,
            additional: type.sections.additional,
            list: type.sections.list.map((s) => ({
              heading: s.heading,
              path: s.path,
              scope: s.scope,
              min: s.min,
              max: s.max,
              grammar: s.grammar ?? null,
              vocabulary: s.vocabulary ?? null,
              params: jsonNumbers(s.params),
              declared_by: s.declaredBy,
            })),
          },
    rules: type.rules.map((rule) => ({
      id: rule.id,
      section: rule.section ?? null,
      expr: rule.expr,
      config: jsonNumbers(rule.config),
      severity: rule.severity,
      message: rule.message,
      declared_by: rule.declaredBy,
      where: rule.where,
    })),
    meta: type.meta,
    examples: type.examples,
  };
}

/** Complete values and live counts, retained by normal `type show`. */
function vocabularyDetails(law: TypeLaw, type: LawType, read: StateRead) {
  const counts = census(read);
  return vocabulariesRead(law, type).map((vocabularyName) => {
    const vocabulary = law.vocabularies.get(vocabularyName);
    const used = counts.get(vocabularyName) ?? new Map<string, number>();
    return {
      name: vocabularyName,
      mode: vocabulary?.mode ?? null,
      entries: [...(vocabulary?.entries ?? new Map())]
        .sort(([a], [b]) => codeUnitCompare(a, b))
        .map(([entry, e]) => ({
          name: entry,
          description: (e as { description?: string }).description ?? null,
          count: used.get(entry) ?? 0,
        })),
      retired: [...(vocabulary?.retired ?? new Map())]
        .sort(([a], [b]) => codeUnitCompare(a, b))
        .map(([entry, r]) => ({
          name: entry,
          successor: (r as { successor?: string }).successor ?? null,
          count: used.get(entry) ?? 0,
        })),
      undeclared: [...used]
        .filter(
          ([value]) =>
            vocabulary?.entries.has(value) !== true && vocabulary?.retired.has(value) !== true,
        )
        .sort(([a, x], [b, y]) => y - x || codeUnitCompare(a, b))
        .map(([value, count]) => ({ name: value, count })),
    };
  });
}

async function run(args: CommandArgs): Promise<CommandResult> {
  const [sub, name] = args.positionals;
  if (
    (sub === "list" && args.flags["brief"] === true) ||
    (sub === "show" && args.flags["concrete"] === true)
  ) {
    const flag = sub === "list" ? "--brief" : "--concrete";
    return fail("type", "usage", "flag-not-applicable", `${flag} does not apply to type ${sub}`, {
      details: { subcommand: sub, flag },
    });
  }
  let state: Awaited<ReturnType<typeof fsState>>;
  try {
    state = await fsState(args.root);
  } catch (e) {
    const refused = stateRefusal("type", e);
    if (refused === undefined) throw e;
    return refused;
  }
  const loaded = lawOf("type", state, args.root);
  if (!loaded.ok) return loaded.result;
  const law = loaded.law;
  const identity = await typeLawIdentity(args.root, state, law);
  const names = [...law.types.keys()].sort(codeUnitCompare);
  if (sub === "list") {
    return withIdentity(
      ok("type", {
        types: names
          .filter((n) => args.flags["concrete"] !== true || law.types.get(n)?.abstract !== true)
          .map((n) => {
            const t = law.types.get(n) as LawType;
            return {
              name: t.name,
              role: t.role,
              abstract: t.abstract,
              extends: t.extends ?? null,
              description: t.description,
              use_when: t.use_when ?? null,
              use_when_declared_by: t.use_when_declared_by ?? null,
              avoid_when: t.avoid_when ?? null,
              avoid_when_declared_by: t.avoid_when_declared_by ?? null,
            };
          }),
      }),
      identity,
    );
  }
  if (name === undefined) {
    return withIdentity(
      fail("type", "usage", "missing-argument", "type show requires a type name", {
        details: { valid_values: names },
      }),
      identity,
    );
  }
  const type = law.types.get(name);
  if (type === undefined) {
    return withIdentity(
      fail("type", "not_found", "unknown-type", `the law declares no type "${name}"`, {
        details: { valid_values: names },
        hint: "a library's type is named with its library's id, as `<id>/<name>`",
      }),
      identity,
    );
  }
  const vocabularies = vocabularyDetails(law, type, readPages(state, law));
  if (args.flags["brief"] === true) {
    return withIdentity(
      ok("type", {
        name: type.name,
        role: type.role,
        abstract: type.abstract,
        extends: type.extends ?? null,
        description: type.description,
        use_when: type.use_when ?? null,
        use_when_declared_by: type.use_when_declared_by ?? null,
        avoid_when: type.avoid_when ?? null,
        avoid_when_declared_by: type.avoid_when_declared_by ?? null,
        brief: {
          skeleton: skeletonOf(type),
          instruction: instruction(law, type),
          vocabularies: vocabularies.map((vocabulary) => ({
            name: vocabulary.name,
            mode: vocabulary.mode,
            entries: vocabulary.entries.length,
            retired: vocabulary.retired.length,
            undeclared: vocabulary.undeclared.length,
          })),
        },
        full_argv: ["wikiwright", "type", "show", type.name, "--root", identity.root],
      }),
      identity,
    );
  }
  const data = contract(law, type);
  data["vocabularies"] = vocabularies;
  return withIdentity(ok("type", data), identity);
}

export const typeCommand: CommandSpec = {
  name: "type",
  summary:
    "Show a type's full contract and vocabulary values, a short writing brief, or a list of types.",
  positionals: [
    { name: "subcommand", required: true },
    { name: "name", required: false },
  ],
  subcommands: ["list", "show"],
  flags: [
    {
      name: "brief",
      type: "boolean",
      summary: "with type show, return short guidance and a skeleton instead of the full contract",
    },
    { name: "concrete", type: "boolean", summary: "with type list, omit abstract types" },
  ],
  examples: [
    "wikiwright type show planting",
    "wikiwright type show planting --brief",
    "wikiwright type list",
    "wikiwright type list --concrete",
  ],
  writes: false,
  run,
};
