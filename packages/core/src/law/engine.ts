// v2 contracts §2: `config/engine.json`, schema version 4. A strict JSON
// Schema compiled by the engine's Ajv (schema/ajv.ts), then the two checks a
// schema cannot state: an engine range this engine parses, and roots held to
// the path law. Beside the old loader (registry/engine.ts), which still reads
// every corpus in the repository; nothing here is wired into a verb yet.
import { pathRefusal } from "../paths/index.ts";
import { errorLine, strictAjv } from "../schema/ajv.ts";
import { parseEngineRange } from "../version/index.ts";
import type { LawIssue } from "./issues.ts";
import { LABEL_MAX, NAME_PATTERN } from "./names.ts";
import { utf8Text, withoutBom } from "./text.ts";

export type FolderTagModeV4 = "off" | "validate" | "materialize-add-only";

/** A loaded engine.json v4 with every default applied. */
export interface EngineV4 {
  schema: "wikiwright/engine";
  schema_version: 4;
  label: string;
  engine?: string;
  content_roots: string[];
  source_roots: string[];
  libraries: { path: string }[];
  commit_prefixes: string[];
  field_sources: { title?: "basename" };
  folder_tags: { mode: FolderTagModeV4 };
  folder_tag_aliases: Record<string, string>;
  extensions: { mode: "open" | "registered" };
}

const ROOTS = { type: "array", minItems: 1, items: { type: "string", minLength: 1 } } as const;

/** The schema, exported as data: the key table of §2, and nothing else. */
export const ENGINE_V4_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schema", "schema_version", "label", "content_roots"],
  properties: {
    schema: { const: "wikiwright/engine" },
    schema_version: { const: 4 },
    label: { type: "string", pattern: NAME_PATTERN, maxLength: LABEL_MAX },
    engine: { type: "string", minLength: 1 },
    content_roots: ROOTS,
    source_roots: { type: "array", items: { type: "string", minLength: 1 } },
    libraries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: { path: { type: "string", minLength: 1 } },
      },
    },
    commit_prefixes: { type: "array", items: { type: "string", minLength: 1 } },
    field_sources: {
      type: "object",
      additionalProperties: false,
      properties: { title: { const: "basename" } },
    },
    folder_tags: {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: { mode: { enum: ["off", "validate", "materialize-add-only"] } },
    },
    folder_tag_aliases: {
      type: "object",
      additionalProperties: { type: "string", minLength: 1 },
    },
    extensions: {
      type: "object",
      additionalProperties: false,
      required: ["mode"],
      properties: { mode: { enum: ["open", "registered"] } },
    },
  },
} as const;

/**
 * Every v4 key and the exported function that reads it: a function of
 * @wikiwright/core by its name, or a function of the shell as
 * `cli/<module>:<function>` (packages/cli/src). `null` is a key the loader
 * validates and carries with no reader yet: a verb not yet rewritten over
 * the v2 law (contracts §12 step 4). docs/roadmap.md names each.
 */
export const ENGINE_V4_CONSUMERS: Readonly<Record<string, string | null>> = {
  schema: "loadEngineV4",
  schema_version: "loadEngineV4",
  label: "cli/typelaw.ts:typeLawIdentity",
  engine: "cli/typelaw.ts:engineMismatch",
  content_roots: "contentRootsOf",
  source_roots: "parsePage",
  libraries: "resolveLibraries",
  commit_prefixes: "cli/verbs/gate.ts:commitMessageStage",
  field_sources: "compileShapes",
  folder_tags: "folderFindings",
  folder_tag_aliases: "folderFindings",
  extensions: "compileShapes",
};

let compiled: ReturnType<ReturnType<typeof strictAjv>["compile"]> | undefined;

function validator() {
  compiled ??= strictAjv().compile(ENGINE_V4_SCHEMA);
  return compiled;
}

export const ENGINE_PATH = "config/engine.json";
const WHERE = `bundle:${ENGINE_PATH}`;

export type EngineV4Result = { ok: true; engine: EngineV4 } | { ok: false; issues: LawIssue[] };

/** Load `config/engine.json` v4 from its bytes. */
export function loadEngineV4(bytes: Uint8Array | undefined): EngineV4Result {
  const fail = (message: string, details?: Record<string, unknown>): EngineV4Result => ({
    ok: false,
    issues: [
      {
        code: "engine-invalid",
        where: WHERE,
        message,
        ...(details === undefined ? {} : { details }),
      },
    ],
  });
  if (bytes === undefined)
    return fail("a bundle is detected by config/engine.json, and it is absent");
  const text = utf8Text(bytes);
  if (text === undefined) return fail("config/engine.json is not UTF-8");
  let json: unknown;
  try {
    json = JSON.parse(withoutBom(text));
  } catch (error) {
    return fail(`config/engine.json is not JSON: ${(error as Error).message}`);
  }
  const validate = validator();
  if (!validate(json)) {
    return {
      ok: false,
      issues: (validate.errors ?? []).map((error) => ({
        code: "engine-invalid",
        where: WHERE,
        message: errorLine(error),
        details: { keyword: error.keyword, pointer: error.instancePath },
      })),
    };
  }
  const raw = json as {
    label: string;
    engine?: string;
    content_roots: string[];
    source_roots?: string[];
    libraries?: { path: string }[];
    commit_prefixes?: string[];
    field_sources?: { title?: "basename" };
    folder_tags?: { mode: FolderTagModeV4 };
    folder_tag_aliases?: Record<string, string>;
    extensions?: { mode: "open" | "registered" };
  };
  const issues: LawIssue[] = [];
  if (raw.engine !== undefined && parseEngineRange(raw.engine) === undefined) {
    issues.push({
      code: "engine-invalid",
      where: WHERE,
      message: `/engine: "${raw.engine}" is not a range this engine parses: space-separated comparators, "^", "~", or an exact version`,
      details: { keyword: "engine", pointer: "/engine" },
    });
  }
  for (const key of ["content_roots", "source_roots"] as const) {
    (raw[key] ?? []).forEach((root, index) => {
      const refusal = pathRefusal(root);
      if (refusal === undefined) return;
      issues.push({
        code: "engine-invalid",
        where: WHERE,
        message: `/${key}/${index}: "${root}" is not a directory inside the bundle (${refusal})`,
        details: { keyword: "path", pointer: `/${key}/${index}` },
      });
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  const engine: EngineV4 = {
    schema: "wikiwright/engine",
    schema_version: 4,
    label: raw.label,
    content_roots: [...raw.content_roots],
    source_roots: [...(raw.source_roots ?? [])],
    libraries: (raw.libraries ?? []).map((l) => ({ path: l.path })),
    commit_prefixes: [...(raw.commit_prefixes ?? [])],
    field_sources: raw.field_sources?.title === undefined ? {} : { title: "basename" },
    folder_tags: { mode: raw.folder_tags?.mode ?? "off" },
    folder_tag_aliases: { ...(raw.folder_tag_aliases ?? {}) },
    extensions: { mode: raw.extensions?.mode ?? "registered" },
  };
  if (raw.engine !== undefined) engine.engine = raw.engine;
  return { ok: true, engine };
}
