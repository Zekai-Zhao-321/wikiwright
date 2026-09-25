// v2 contracts §4: each record kind has an engine JSON Schema — `item-claim`,
// `item-relation`, `item-entry` — and every parsed record is validated
// against it. The schemas are data, exported, so `type show` and a reader can
// see the exact shape a rule's `section.items` hold.
import type { ValidateFunction } from "ajv/dist/2020.js";
import { strictAjv } from "../schema/ajv.ts";

const DAY = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";

const LOCATION = {
  type: "object",
  properties: {
    line: { type: "integer", minimum: 1 },
    span: {
      type: "array",
      prefixItems: [
        { type: "integer", minimum: 0 },
        { type: "integer", minimum: 0 },
      ],
      items: false,
      minItems: 2,
    },
  },
  required: ["line", "span"],
  additionalProperties: false,
} as const;

const STRINGS = { type: "array", items: { type: "string" } } as const;
const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const RECORD_SCHEMAS: Readonly<Record<string, Record<string, unknown>>> = {
  "item-claim": {
    type: "object",
    properties: {
      kind: { const: "claim" },
      handle: { type: "string", pattern: "^#[0-9a-f]{8}$" },
      category: { type: "string", minLength: 1 },
      core: { type: "string", minLength: 1 },
      provenance: {
        type: "object",
        properties: {
          kind: { enum: ["page", "url", "path", "none"] },
          value: NULLABLE_STRING,
        },
        required: ["kind", "value"],
        additionalProperties: false,
      },
      retracted: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            properties: { date: { type: "string", format: "date" } },
            required: ["date"],
            additionalProperties: false,
          },
        ],
      },
      superseded: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            properties: {
              date: { type: "string", format: "date" },
              by: NULLABLE_STRING,
              valid_from: { anyOf: [{ type: "string", pattern: DAY }, { type: "null" }] },
              valid_to: { type: "string", format: "date" },
            },
            required: ["date", "by", "valid_from", "valid_to"],
            additionalProperties: false,
          },
        ],
      },
      rationale: STRINGS,
      raw: { type: "string" },
      location: LOCATION,
    },
    required: [
      "kind",
      "handle",
      "category",
      "core",
      "provenance",
      "retracted",
      "superseded",
      "rationale",
      "raw",
      "location",
    ],
    additionalProperties: false,
  },
  "item-relation": {
    type: "object",
    properties: {
      kind: { const: "relation" },
      label: { type: "string", minLength: 1 },
      target: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          heading: NULLABLE_STRING,
          alias: NULLABLE_STRING,
          path: NULLABLE_STRING,
          resolved: { type: "boolean" },
          type: NULLABLE_STRING,
        },
        required: ["name", "heading", "alias", "path", "resolved", "type"],
        additionalProperties: false,
      },
      rationale: STRINGS,
      raw: { type: "string" },
      location: LOCATION,
    },
    required: ["kind", "label", "target", "rationale", "raw", "location"],
    additionalProperties: false,
  },
  "item-entry": {
    type: "object",
    properties: {
      kind: { const: "entry" },
      date: { type: "string", pattern: "^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$" },
      precision: { enum: ["day", "month", "year"] },
      text: { type: "string", minLength: 1 },
      rationale: STRINGS,
      raw: { type: "string" },
      location: LOCATION,
    },
    required: ["kind", "date", "precision", "text", "rationale", "raw", "location"],
    additionalProperties: false,
  },
};

let compiled: Map<string, ValidateFunction> | undefined;

/** The compiled record schemas, one per kind. */
export function recordValidators(): Map<string, ValidateFunction> {
  if (compiled === undefined) {
    const ajv = strictAjv();
    compiled = new Map(
      Object.entries(RECORD_SCHEMAS).map(([id, schema]) => [id, ajv.compile(schema)]),
    );
  }
  return compiled;
}
