// The smallest bundle on the v2 law (contracts §2, §3): a schema-version-4
// `config/engine.json` over `wiki/` and one `note` type with no fields and no
// sections. The tests that hold the shell to a property of its own — the git
// transport, the envelope, the exit taxonomy — write it under os.tmpdir(), so
// what they judge is the property and not a law. Test data, not a starter.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** `config/engine.json` of a note bundle, with `extra` keys laid over it. */
export function noteEngine(extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify(
    {
      schema: "wikiwright/engine",
      schema_version: 4,
      label: "notes",
      content_roots: ["wiki"],
      ...extra,
    },
    null,
    2,
  )}\n`;
}

export const NOTE_TYPE = "type: note\nrole: concept\ndescription: A note.\n";

/** A note page: its title as the H1, and `body` after it. */
export function notePage(title: string, body = ""): string {
  return `---\ntype: note\ntitle: ${title}\n---\n\n# ${title}\n${body}`;
}

/** Write a file under `root`, its directories made. */
export function writeAt(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Write the note bundle's law at `root`, and one note per title under `wiki/`. */
export function writeNoteBundle(
  root: string,
  titles: readonly string[] = [],
  engine: Record<string, unknown> = {},
): void {
  writeAt(root, "config/engine.json", noteEngine(engine));
  writeAt(root, "constitution/types/note.yaml", NOTE_TYPE);
  for (const title of titles) writeAt(root, `wiki/${title}.md`, notePage(title));
}
