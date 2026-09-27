// v2 contracts §3.3: the derived skeleton `type show --brief` prints — the
// effective shape's frontmatter keys in linearisation order with an empty
// value of their kind, `type:` filled, then the title heading and one heading
// per declared section with a blank line under each. There is no template
// key and no `new` verb: the agent writes the file from this.
import { reservedShape } from "../schema/reserved.ts";
import type { LawType } from "./compose.ts";

/** The first `type` a declaration of `key` states, or the kind its engine `$ref` names. */
function kindOf(type: LawType, key: string): string | undefined {
  const schemas = [reservedShape({}), ...type.parts.map((p) => p.schema)];
  for (const schema of schemas) {
    const properties = schema["properties"];
    if (properties === null || typeof properties !== "object") continue;
    const declared = (properties as Record<string, unknown>)[key];
    if (declared === null || typeof declared !== "object") continue;
    const record = declared as Record<string, unknown>;
    const kind = record["type"];
    if (typeof kind === "string") return kind;
    if (Array.isArray(kind) && typeof kind[0] === "string") return kind[0];
    const ref = record["$ref"];
    if (ref === "#/$defs/page-ref") return "string";
    if (ref === "#/$defs/page-ref-list") return "array";
    if (ref === "#/$defs/pin") return "object";
  }
  return undefined;
}

export function skeletonOf(type: LawType): string {
  const lines = ["---"];
  for (const key of type.properties) {
    if (key === "type") {
      lines.push(`type: ${type.name}`);
      continue;
    }
    const kind = kindOf(type, key);
    lines.push(`${key}: ${kind === "string" ? '""' : kind === "array" ? "[]" : "null"}`);
  }
  lines.push("---", "", "# <title>", "");
  interface HeadingNode {
    heading: string;
    children: Map<string, HeadingNode>;
  }
  const roots = new Map<string, HeadingNode>();
  for (const section of type.sections?.list ?? []) {
    let siblings = roots;
    for (const heading of section.path) {
      let node = siblings.get(heading);
      if (node === undefined) {
        node = { heading, children: new Map() };
        siblings.set(heading, node);
      }
      siblings = node.children;
    }
  }
  const emit = (nodes: Map<string, HeadingNode>, depth: number): void => {
    for (const node of nodes.values()) {
      lines.push(`${"#".repeat(depth)} ${node.heading}`, "");
      emit(node.children, depth + 1);
    }
  };
  emit(roots, type.sections?.depth ?? 2);
  return `${lines.join("\n")}\n`;
}
