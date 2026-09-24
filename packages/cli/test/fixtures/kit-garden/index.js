// docs/extending.md §Declaring a module (a module declared by a bundle-relative path).
//
// TEST INFRASTRUCTURE. A neutral gardening kit that a bundle carries in its own
// tree, at `kit/garden`, and declares by that path instead of installing under
// `node_modules`. It registers one of each thing a copied kit is expected to
// carry: a type, a fragment, a template, a check and the lane the check routes
// to. Its semantics are deliberately small: a planting names the bed it went
// into, and a bundle declares which beds it has.
//
// Plain JavaScript with no imports, which is what the purity scan admits.

const fail = (message, path = []) => ({ success: false, error: { issues: [{ path, message }] } });

/** The `known-bed` check's configuration: the bed names a bundle declares. */
const BedsConfig = {
  safeParse: (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return fail("a config is an object");
    }
    for (const key of Object.keys(value)) {
      if (key !== "beds") return fail(`"${key}" is not a key of this check's config`, [key]);
    }
    const beds = value.beds;
    if (!Array.isArray(beds) || beds.length === 0) {
      return fail("beds is a non-empty list of bed names", ["beds"]);
    }
    if (!beds.every((bed) => typeof bed === "string" && bed.length > 0)) {
      return fail("every bed is a non-empty string", ["beds"]);
    }
    return { success: true, data: { beds: [...beds] } };
  },
};

export default {
  id: "garden",

  lanes: ["garden/review"],

  fragments: {
    "garden/planted": {
      description: "Where a planting went in, and when.",
      fields: {
        bed: { kind: "string", required: true },
        sown: { kind: "date", required: true },
      },
    },
  },

  types: {
    "garden/planting": {
      abstract: true,
      extends: "procedure",
      description: "One planting: what went into which bed, when, and how it is cared for.",
      fragments: ["garden/planted"],
      template: "garden/planting.md",
      sections: { list: [{ heading: "Care", min: 1, max: 1 }] },
    },
  },

  templates: {
    "garden/planting.md":
      "---\ntype: x\ntitle: \ndescription: \ntags: []\nbed: \nsown: \n---\n\n# {{ title }}\n\n## Care\n\n",
  },

  checks: {
    "garden/known-bed": {
      config: BedsConfig,
      surfaces: ["type"],
      row: "declared",
      lane: "garden/review",
      run: (ctx) => {
        const bed = ctx.page.frontmatter["bed"];
        if (typeof bed === "string" && ctx.config.beds.includes(bed)) return;
        ctx.emit(
          undefined,
          `"${String(bed)}" is not a bed this garden declares`,
          { bed: String(bed) },
          `known-bed|${String(bed)}`,
          `plant in a declared bed: ${ctx.config.beds.join(", ")}`,
        );
      },
    },
  },
};
