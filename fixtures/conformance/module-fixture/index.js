// spec: 28 §what-a-module-registers, §parse, §arm-predicates, §attachment ·
// 12 §module-registration.
//
// TEST INFRASTRUCTURE. This is not a domain model, not a recommended shape, and
// not a product kit. It is the smallest module that touches every extension
// surface at once, so the conformance suite can prove that an EXTERNAL package —
// resolved from a bundle's own node_modules, pinned by that bundle's lockfile,
// granted on this machine and scanned before it runs — reaches every one of
// them through the public API and nothing else.
//
// Its semantics are deliberately trivial: an item is `<key>: <value>`, a value
// is "small" or "large", and a page has an id. Nothing here should be read as
// advice about how to model anything.
//
// Written in plain JavaScript with no imports at all, which is the shape an
// installed package has: the engine hands it `defineModule`-shaped data, and a
// manifest is a literal. A kit written in TypeScript compiles to exactly this.

// 28 §the-schema-contract: the engine calls `safeParse` and nothing else, so a
// module written in plain JavaScript declares its own validators rather than
// depending on the engine's zod build. Two zod copies in one process are two
// `instanceof` families, and the failure is invisible — which is why the
// contract is structural.
const fail = (message, path = []) => ({ success: false, error: { issues: [{ path, message }] } });
const pass = (data) => ({ success: true, data });

/** An entry of the size vocabulary: one numeric `limit`, and nothing else. */
const SizeEntry = {
  shape: { limit: null },
  safeParse: (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return fail("a size entry is an object");
    }
    for (const key of Object.keys(value)) {
      if (key !== "limit") return fail(`"${key}" is not a property of a size entry`, [key]);
    }
    if (typeof value.limit !== "number" || !Number.isInteger(value.limit)) {
      return fail("limit is a whole number", ["limit"]);
    }
    return pass({ limit: value.limit });
  },
};

/** The `has-id` check's configuration: one non-empty `prefix`. */
const HasIdConfig = {
  safeParse: (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return fail("a config is an object");
    }
    for (const key of Object.keys(value)) {
      if (key !== "prefix") return fail(`"${key}" is not a key of this check's config`, [key]);
    }
    if (typeof value.prefix !== "string" || value.prefix.length === 0) {
      return fail("prefix is a non-empty string", ["prefix"]);
    }
    return pass({ prefix: value.prefix });
  },
};

/** The `allow` parameter: a non-empty list of admitted values. */
const AllowParam = {
  safeParse: (value) => {
    if (!Array.isArray(value) || value.length === 0) {
      return fail("allow is a non-empty array of values");
    }
    if (!value.every((v) => typeof v === "string" && v.length > 0)) {
      return fail("every admitted value is a non-empty string");
    }
    return pass([...value]);
  },
};

/** The one vocabulary this module owns, and the one property its entries carry. */
const SIZES = "@wikiwright-fixture/probe/sizes";

/** `key: value` — the whole grammar. */
const ITEM = /^([a-z][a-z0-9_-]*)\s*:\s*(\S.*)$/u;

const asProbe = (item) => (item.kind === "probe:measure" ? item : undefined);

const detailsOf = (item) => ({ key: item.key, value: item.value });

export default {
  id: "@wikiwright-fixture/probe",

  // 07 §routing-law: the module's own lane. A kit that cannot name its own lane
  // pollutes a kernel one.
  lanes: ["@wikiwright-fixture/probe/review"],

  // 04 §vocabularies: the module owns the entry schema. `limit` is its property;
  // `description`, `aliases`, `status` and `replaced_by` are the kernel's. It
  // ships one entry of its own, which every consuming bundle gets beside its
  // own declarations.
  vocabularies: {
    [SIZES]: {
      entry: SizeEntry,
      entries: { tiny: { description: "The module's own smallest size.", limit: 1 } },
    },
  },

  // 28 §attachment: a check a bundle attaches and configures. Two surfaces, so
  // the conformance suite can prove the third is refused.
  checks: {
    "@wikiwright-fixture/probe/has-id": {
      config: HasIdConfig,
      surfaces: ["type", "field"],
      row: "declared",
      lane: "@wikiwright-fixture/probe/review",
      run: (ctx) => {
        const prefix = ctx.config.prefix;
        const value = ctx.field === undefined ? ctx.page.frontmatter["probe_id"] : ctx.field.value;
        if (typeof value === "string" && value.startsWith(prefix)) return;
        ctx.emit(
          ctx.field?.line,
          `the probe id does not begin with "${prefix}"`,
          { prefix },
          `has-id|${String(value)}`,
          `write a probe id beginning with "${prefix}"`,
        );
      },
    },
  },

  // 28 §what-a-module-registers: plain constitution data.
  fragments: {
    "@wikiwright-fixture/probe/identified": {
      description: "Everything this module identifies.",
      fields: { probe_id: { kind: "string", required: true } },
    },
  },
  types: {
    "@wikiwright-fixture/probe/subject": {
      extends: "concept",
      description: "A page this module measures. Test infrastructure, not a domain type.",
      fragments: ["@wikiwright-fixture/probe/identified"],
      template: "@wikiwright-fixture/probe/subject.md",
      sections: {
        list: [
          {
            heading: "Measures",
            grammar: "@wikiwright-fixture/probe/measures",
            vocabulary: SIZES,
            min: 0,
          },
        ],
      },
    },
  },
  templates: {
    "@wikiwright-fixture/probe/subject.md": "---\ntype: x\n---\n\n## Measures\n\n- size: small\n",
  },
  skills: [
    {
      heading: "Measures",
      body: "A `Measures` item is `<key>: <value>`. A value must be an entry of the module's `sizes` vocabulary.",
    },
  ],

  grammars: {
    "@wikiwright-fixture/probe/measures": {
      kinds: ["probe:measure"],
      form: "- key: value",
      // 04 §vocabularies: a measure's value is checked against the module's
      // own size vocabulary; a section binding this grammar to another is
      // refused at load.
      vocabulary: SIZES,
      // 28 §parse: one item at a time, and the module never sees the line.
      parse: (text) => {
        const matched = ITEM.exec(text);
        if (matched === null) return undefined;
        return { kind: "probe:measure", key: matched[1], value: matched[2].trim() };
      },
      params: {
        // A section may narrow the values it admits; `subset-only` is the law,
        // so a child may narrow and never widen.
        allow: {
          introduction: "any-depth",
          value: AllowParam,
          law: "subset-only",
        },
        // The vocabulary a section's items read arrives as `vocabulary` too —
        // the kernel's own key, under the name every grammar reads it by.
      },
      // 07 §splice-law: this grammar's canonical rendering of its own item.
      canonicalize: (item) => {
        const raw = item.raw;
        const matched = ITEM.exec(raw);
        if (matched === null) return undefined;
        const canonical = `- ${matched[1]}: ${matched[2].trim()}`;
        return canonical === `- ${raw}` ? undefined : canonical;
      },
      // 04 §vocabularies: what a census counts.
      observes: (vocabulary, item) => {
        const probe = asProbe(item);
        return vocabulary === SIZES && probe !== undefined ? [probe.value] : [];
      },
      // 28 §the-transition-seam: this grammar's items have an identity, and no
      // edit of one is a correction — the closed default, stated rather than
      // inherited, because a fixture that relies on a default proves nothing.
      identityOf: (item) => {
        const probe = asProbe(item);
        return probe === undefined ? undefined : `probe:${probe.key}`;
      },
      isCorrection: () => false,
      arms: [
        {
          id: "@wikiwright-fixture/probe/unknown-size",
          row: "declared",
          lane: "@wikiwright-fixture/probe/review",
          run: (item, ctx) => {
            const probe = asProbe(item);
            if (probe === undefined) return;
            const view = ctx.vocabulary(SIZES);
            if (view === undefined) return;
            ctx.vocabularyLaws(
              view.uses.get(probe.value.toLowerCase()),
              probe.value,
              probe.line,
              detailsOf(probe),
              `${probe.key}|${probe.value}`,
            );
            if (view.entries.get(probe.value.toLowerCase()) !== undefined) return;
            ctx.emit(
              "@wikiwright-fixture/probe/unknown-size",
              probe.line,
              `"${probe.value}" is not an entry of this module's size vocabulary`,
              detailsOf(probe),
              `${probe.key}|${probe.value}`,
              "write a registered size, or add the entry to the bundle's own vocabulary",
            );
          },
        },
        {
          // The section's own allow-list, turned on by the `allow` parameter —
          // which is what `on` declares, and what the coverage block counts.
          id: "@wikiwright-fixture/probe/not-allowed",
          on: { param: "allow" },
          row: "declared",
          lane: "@wikiwright-fixture/probe/review",
          run: (item, ctx) => {
            const probe = asProbe(item);
            const allow = ctx.params["allow"];
            if (probe === undefined || !Array.isArray(allow)) return;
            if (allow.includes(probe.value)) return;
            ctx.emit(
              "@wikiwright-fixture/probe/not-allowed",
              probe.line,
              `section "${ctx.section.heading}" admits only ${allow.join(", ")}`,
              detailsOf(probe),
              `allow|${probe.key}|${probe.value}`,
              "write one of the values the section admits, or widen `allow` through review",
            );
          },
        },
        {
          // A census row: counted, never ratcheted, and it needs no lane.
          id: "@wikiwright-fixture/probe/measured",
          row: "info",
          run: (item, ctx) => {
            const probe = asProbe(item);
            if (probe === undefined) return;
            ctx.emit(
              "@wikiwright-fixture/probe/measured",
              probe.line,
              "a measure was recorded",
              detailsOf(probe),
              `measured|${probe.key}`,
            );
          },
        },
      ],
    },
  },
};
