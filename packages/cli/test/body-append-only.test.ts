// v2 contracts §5 (`before` under the index is HEAD) · §12 step 5: the
// transition rule `body-append-only`, which library `code` carries on
// `code/decision` and tools/migrate-spellings.ts wrote into the `append-only`
// fragment of fixtures/minimal-vault and fixtures/memory-synth. Each of the
// three documents is judged by the v2 `gate` over a copy of the corpus that
// holds it, in a repository under os.tmpdir(): an append passes whether the
// page is LF, CRLF or grew from an empty body; an edit above the end is
// refused. The tool's constant and the three documents hold one expression.
import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BODY_APPEND_ONLY } from "../../../tools/migrate-spellings.ts";
import { corpusCopy, REPO, removeCopies } from "./fixtures/corpora.ts";
import { cli, findingsOf, git } from "./fixtures/garden-cli.ts";

afterAll(removeCopies);

/** The corpus, the page of an append-only type in it, and the document carrying the rule. */
const OWNERS: [corpus: string, page: string, document: string][] = [
  ["devwiki", "meta/D-001.md", "libraries/kit-code/types/decision.yaml"],
  [
    "fixtures/minimal-vault",
    "wiki/test-execution/warm-reset.md",
    "fixtures/minimal-vault/constitution/fragments/append-only.yaml",
  ],
  [
    "fixtures/memory-synth",
    "journal/2031-W31.md",
    "fixtures/memory-synth/constitution/fragments/append-only.yaml",
  ],
];

/** A page's frontmatter block, closing line included, and its body. */
function split(text: string): [string, string] {
  const close = text.indexOf("\n---\n", 3);
  if (close < 0) throw new Error("no closing frontmatter line");
  return [text.slice(0, close + 5), text.slice(close + 5)];
}

/** The rule's expression as the document declares it, its YAML quoting read. */
function declared(document: string): string {
  const line = readFileSync(join(REPO, document), "utf8")
    .split("\n")
    .find((l) => l.trimStart().startsWith("expr:"));
  const quoted = line?.slice(line.indexOf("expr:") + 5).trim() ?? "";
  // A single-quoted YAML scalar with no quote inside is its text; a
  // double-quoted one escapes only `"` and `\`, as JSON does.
  return quoted.startsWith("'") ? quoted.slice(1, -1) : (JSON.parse(quoted) as string);
}

describe("body-append-only admits every append and refuses an edit", () => {
  it("is one expression in the tool and in the three documents it stands in", () => {
    for (const [, , document] of OWNERS)
      expect(declared(document)).toBe(String(BODY_APPEND_ONLY["expr"]));
  });

  for (const [corpus, page, document] of OWNERS) {
    it(`${document}, over ${corpus}'s ${page}`, () => {
      const { root, top } = corpusCopy(corpus);
      // The bytes as written: no line-ending conversion from the caller's git.
      writeFileSync(join(top, ".gitattributes"), "* -text\n");
      const file = join(root, page);
      const refused = (): string[] => {
        git(top, "add", "-A");
        return findingsOf(cli(["gate"], root).envelope, "body-append-only").map((f) => f.path);
      };
      const commit = (message: string): void => {
        git(top, "add", "-A");
        git(top, "commit", "-q", "--no-verify", "-m", message);
      };
      const [front, body] = split(readFileSync(file, "utf8"));
      commit("the corpus");

      writeFileSync(file, `${front}${body.trimEnd()}\n\nA line appended.\n`);
      expect(refused()).toEqual([]);
      commit("an LF append");

      const crlf = readFileSync(file, "utf8").replaceAll("\n", "\r\n");
      writeFileSync(file, crlf);
      commit("the page in CRLF");
      writeFileSync(file, `${crlf}A second line appended.\r\n`);
      expect(refused()).toEqual([]);
      commit("a CRLF append");

      writeFileSync(file, front);
      commit("the body emptied");
      writeFileSync(file, `${front}${body}`);
      expect(refused()).toEqual([]);
      commit("the body written into an empty one");

      const lines = body.split("\n");
      const first = lines.findIndex((l) => l.trim() !== "");
      lines[first] = `${lines[first]} (edited)`;
      writeFileSync(file, `${front}${lines.join("\n")}`);
      expect(refused()).toEqual([page]);
    });
  }
});
