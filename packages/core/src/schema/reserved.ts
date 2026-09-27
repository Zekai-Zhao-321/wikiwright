// v2 contracts §3.1: the reserved frontmatter keys, present on every effective
// shape, and the schema the engine writes for them. The first member of every
// effective shape's `allOf`; a type may add constraints to a reserved key in
// its own `fields`, never loosen these (allOf only narrows).
import { NAME_PATTERN } from "../law/names.ts";

/** In the order the skeleton prints them (§3.3). */
export const RESERVED_KEYS: readonly string[] = [
  "type",
  "title",
  "description",
  "tags",
  "aliases",
  "status",
  "supersedes",
  "superseded_by",
  "exceptions",
  "created",
  "updated",
];

/**
 * The reserved keys' schema. `title` is required unless `field_sources.title`
 * derives it from the file's basename (engine.json §2, its consumer here).
 */
export function reservedShape(fieldSources: { title?: "basename" }): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      type: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      description: { type: "string" },
      tags: { type: "array", items: { type: "string", pattern: NAME_PATTERN } },
      aliases: { type: "array", items: { type: "string", minLength: 1 } },
      status: { enum: ["active", "retired"] },
      supersedes: { $ref: "#/$defs/page-ref-list" },
      superseded_by: { $ref: "#/$defs/page-ref" },
      // Today's waivers, kept: each closes a queued finding on this page.
      exceptions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rule: { type: "string", pattern: NAME_PATTERN },
            reason: { type: "string", minLength: 1 },
          },
          required: ["rule", "reason"],
          additionalProperties: false,
        },
      },
      created: { type: "string", format: "date" },
      updated: { type: "string", format: "date" },
    },
    required: fieldSources.title === "basename" ? ["type"] : ["type", "title"],
  };
}
