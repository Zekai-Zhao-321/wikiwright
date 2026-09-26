// v2 contracts §8: rule tests and examples.
//
// A rule's test set lives under `rule-tests/<rule id>/` in the bundle or in a
// library: `negative.md`, which must draw exactly one error-or-warning
// finding, the named rule at the named location; `repaired.md` and every
// `positive/<name>.md`, which must draw none; `before/negative.md` and
// `before/repaired.md`, the base each is judged against when present; and
// `expect.json`, `{"rule": "<id>", "location": "page" | {"section":
// "<heading>", "occurrence": n}}`, n counting from 0 as a finding's
// occurrence does. Every test page is overlaid on the vault from outside the
// content roots — its path is its law file's framed path, its links resolve
// against the vault — and it is excluded from instances and identity; it may
// be a page of an abstract type. A test page with no `before/` twin is new to
// its base, so a transition rule evaluates with `before.present` false.
//
// A rule with no negative, no repaired or no positive page is
// `rule-untested`: a warning, or an error for a rule the gate's law diff adds
// or changes. A test that does not hold is `rule-test-fails`, with what it
// found. Every page under an `examples/` directory, and every path a type's
// `examples` names (relative to the root of the bundle or library that
// declares the type), must pass as a page of its type: `example-fails`.
import { codeUnitCompare } from "../identity/index.ts";
import type { TypeLaw } from "../law/load.ts";
import { utf8Text, withoutBom } from "../law/text.ts";
import { PAGE_LOCATION, type Unrouted } from "./page.ts";
import type { FindingLocation } from "./table.ts";

/**
 * Judge one page overlaid from outside the content roots; `base` is its
 * `before/` twin. Returns what it found and the type its frontmatter names.
 */
export type JudgeOverlaid = (
  path: string,
  bytes: Uint8Array,
  base: Uint8Array | null,
) => { findings: Unrouted[]; type: string | null };

interface LawFileRef {
  /** `<owner>:<path>`, as the law digest frames it. */
  framed: string;
  bytes: Uint8Array;
}

/** Every law file by its framed path. */
function framedFiles(law: TypeLaw): Map<string, LawFileRef> {
  const out = new Map<string, LawFileRef>();
  for (const file of law.files.values()) {
    const framed = `${file.owner}:${file.path}`;
    out.set(framed, { framed, bytes: file.bytes });
  }
  return out;
}

interface TestSet {
  owner: string;
  id: string;
  /** By path inside `rule-tests/<id>/`. */
  files: Map<string, LawFileRef>;
}

function testSets(law: TypeLaw): TestSet[] {
  const sets = new Map<string, TestSet>();
  for (const file of law.files.values()) {
    const [top, id, ...rest] = file.path.split("/");
    if (top !== "rule-tests" || id === undefined || rest.length === 0) continue;
    const key = `${file.owner}\u0000${id}`;
    const set = sets.get(key) ?? { owner: file.owner, id, files: new Map() };
    set.files.set(rest.join("/"), { framed: `${file.owner}:${file.path}`, bytes: file.bytes });
    sets.set(key, set);
  }
  return [...sets.values()].sort(
    (a, b) => codeUnitCompare(a.owner, b.owner) || codeUnitCompare(a.id, b.id),
  );
}

type Expected = { rule: string; location: "page" | { section: string; occurrence: number } };

function readExpect(bytes: Uint8Array): Expected | string {
  const text = utf8Text(bytes);
  if (text === undefined) return "not UTF-8";
  let value: unknown;
  try {
    value = JSON.parse(withoutBom(text));
  } catch (error) {
    return `not JSON: ${(error as Error).message}`;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return "an object with rule and location";
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter((k) => k !== "rule" && k !== "location");
  if (extra.length > 0) return `unknown keys: ${extra.join(", ")}`;
  const { rule, location } = record;
  if (typeof rule !== "string") return "rule is the rule's id";
  if (location === "page") return { rule, location };
  if (location !== null && typeof location === "object" && !Array.isArray(location)) {
    const { section, occurrence } = location as Record<string, unknown>;
    const keys = Object.keys(location);
    if (
      typeof section === "string" &&
      typeof occurrence === "number" &&
      Number.isInteger(occurrence) &&
      occurrence >= 0 &&
      keys.every((k) => k === "section" || k === "occurrence")
    ) {
      return { rule, location: { section, occurrence } };
    }
  }
  return 'location is "page" or {"section": "<heading>", "occurrence": n}';
}

function atExpected(location: FindingLocation, expected: Expected["location"]): boolean {
  if (expected === "page") return location.kind === "page";
  return (
    location.kind === "section" &&
    location.heading === expected.section &&
    location.occurrence === expected.occurrence
  );
}

const blocking = (found: readonly Unrouted[]): Unrouted[] =>
  found.filter((f) => f.severity === "error" || f.severity === "warning");

const brief = (found: readonly Unrouted[]) =>
  found.map((f) => ({
    rule: f.rule,
    severity: f.severity,
    location: f.location,
    message: f.message,
  }));

export interface LawTestOptions {
  /** Rule ids the gate's law diff adds or changes: untested, each is an error. */
  rulesChanged?: ReadonlySet<string>;
}

/** Where each rule is declared, framed: the first type that carries it. */
function declarations(law: TypeLaw): Map<string, string> {
  const out = new Map<string, string>();
  for (const type of law.types.values())
    for (const rule of type.rules) if (!out.has(rule.id)) out.set(rule.id, rule.where);
  return out;
}

/** §8: every rule test and every example, judged; what does not hold, found. */
export function lawTestFindings(
  law: TypeLaw,
  judge: JudgeOverlaid,
  options: LawTestOptions = {},
): Unrouted[] {
  const out: Unrouted[] = [];
  const fail = (
    path: string,
    kind: string,
    message: string,
    details: Record<string, unknown> = {},
  ): void => {
    out.push({
      rule: "rule-test-fails",
      severity: "error",
      path,
      location: PAGE_LOCATION,
      message,
      details: { kind, ...details },
    });
  };
  const complete = new Set<string>();
  for (const set of testSets(law)) {
    const dir = `${set.owner}:rule-tests/${set.id}`;
    if (!law.rules.has(set.id)) {
      fail(dir, "rule-unknown", `rule-tests/${set.id} tests no rule this law declares`, {
        rule: set.id,
      });
      continue;
    }
    const expectFile = set.files.get("expect.json");
    const expected = expectFile === undefined ? "absent" : readExpect(expectFile.bytes);
    const negative = set.files.get("negative.md");
    const repaired = set.files.get("repaired.md");
    const positives = [...set.files.entries()]
      .filter(([p]) => p.startsWith("positive/") && p.endsWith(".md"))
      .sort(([a], [b]) => codeUnitCompare(a, b));
    for (const [path, file] of set.files) {
      const known =
        path === "expect.json" ||
        path === "negative.md" ||
        path === "repaired.md" ||
        path === "before/negative.md" ||
        path === "before/repaired.md" ||
        (path.startsWith("positive/") && !path.slice("positive/".length).includes("/"));
      if (!known) {
        fail(file.framed, "file-unknown", `${file.framed} is no part of a rule test`, {
          rule: set.id,
        });
      }
    }
    if (negative !== undefined && repaired !== undefined && positives.length > 0) {
      complete.add(set.id);
    }
    const base = (name: string): Uint8Array | null =>
      set.files.get(`before/${name}`)?.bytes ?? null;
    if (negative !== undefined) {
      if (typeof expected === "string") {
        fail(
          expectFile?.framed ?? `${dir}/expect.json`,
          "expect-invalid",
          `the negative page needs expect.json beside it, naming the rule and the location: ${expected}`,
          { rule: set.id },
        );
      } else if (expected.rule !== set.id) {
        fail(
          expectFile?.framed ?? `${dir}/expect.json`,
          "expect-invalid",
          `expect.json names rule "${expected.rule}" under rule-tests/${set.id}`,
          { rule: set.id },
        );
      } else {
        const found = blocking(
          judge(negative.framed, negative.bytes, base("negative.md")).findings,
        );
        const hit = found[0];
        if (
          found.length !== 1 ||
          hit === undefined ||
          hit.rule !== expected.rule ||
          !atExpected(hit.location, expected.location)
        ) {
          fail(
            negative.framed,
            "negative",
            `the negative page must draw exactly one finding, ${expected.rule} at ${JSON.stringify(expected.location)}; it drew ${found.length}`,
            { rule: set.id, expected, found: brief(found) },
          );
        }
      }
    }
    const clean: [string, LawFileRef | undefined, string][] = [
      ["repaired", repaired, "repaired.md"],
      ...positives.map(([p, f]) => ["positive", f, p] as [string, LawFileRef, string]),
    ];
    for (const [kind, file, name] of clean) {
      if (file === undefined) continue;
      const found = blocking(judge(file.framed, file.bytes, base(name)).findings);
      if (found.length === 0) continue;
      fail(file.framed, kind, `the ${kind} page must draw no finding; it drew ${found.length}`, {
        rule: set.id,
        found: brief(found),
      });
    }
  }
  const declared = declarations(law);
  const tested = new Set(testSets(law).map((s) => s.id));
  for (const id of [...law.rules.keys()].sort(codeUnitCompare)) {
    if (complete.has(id)) continue;
    const sets = testSets(law).filter((s) => s.id === id);
    const has = (name: string) => sets.some((s) => s.files.has(name));
    const missing = [
      ...(has("negative.md") ? [] : ["negative"]),
      ...(has("repaired.md") ? [] : ["repaired"]),
      ...(sets.some((s) => [...s.files.keys()].some((p) => p.startsWith("positive/")))
        ? []
        : ["positive"]),
    ];
    const changed = options.rulesChanged?.has(id) === true;
    out.push({
      rule: "rule-untested",
      severity: changed ? "error" : "warning",
      path: declared.get(id) ?? "bundle:constitution",
      location: PAGE_LOCATION,
      message: `rule ${id} has no ${missing.join(", no ")} page${tested.has(id) ? "" : ": it has no test set"}${changed ? ", and this change adds or changes it" : ""}`,
      details: { rule: id, missing, changed },
    });
  }
  return [...out, ...exampleFindings(law, judge)];
}

/** §8 `example-fails`: every example page, and every path a type's `examples` names. */
function exampleFindings(law: TypeLaw, judge: JudgeOverlaid): Unrouted[] {
  const out: Unrouted[] = [];
  const files = framedFiles(law);
  const examples = [...files.values()]
    .filter((f) => {
      const path = f.framed.slice(f.framed.indexOf(":") + 1);
      return path.startsWith("examples/") && path.endsWith(".md");
    })
    .sort((a, b) => codeUnitCompare(a.framed, b.framed));
  const typeOf = new Map<string, string | null>();
  for (const example of examples) {
    const judged = judge(example.framed, example.bytes, null);
    typeOf.set(example.framed, judged.type);
    const found = blocking(judged.findings);
    if (found.length === 0) continue;
    out.push({
      rule: "example-fails",
      severity: "error",
      path: example.framed,
      location: PAGE_LOCATION,
      message: `the example does not pass as a page of its type: ${found.length} finding(s)`,
      details: { kind: "findings", found: brief(found) },
    });
  }
  for (const type of [...law.types.values()].sort((a, b) => codeUnitCompare(a.name, b.name))) {
    const owner = type.where.slice(0, type.where.indexOf(":"));
    for (const path of type.examples) {
      const file = files.get(`${owner}:${path}`);
      if (file === undefined || !path.startsWith("examples/")) {
        out.push({
          rule: "example-fails",
          severity: "error",
          path: type.where,
          location: PAGE_LOCATION,
          message: `${type.name} names the example "${path}", which is no page under ${owner === "bundle" ? "the bundle's" : `library ${owner}'s`} examples/`,
          details: { kind: "missing", type: type.name, example: path },
        });
        continue;
      }
      const declared = typeOf.get(file.framed) ?? undefined;
      if (declared !== type.name) {
        out.push({
          rule: "example-fails",
          severity: "error",
          path: file.framed,
          location: PAGE_LOCATION,
          message: `${type.name} names this example, and it is a page of ${declared === undefined ? "no type" : `type ${declared}`}`,
          details: { kind: "type-mismatch", type: type.name, declared: declared ?? null },
        });
      }
    }
  }
  return out;
}
