# Migrating an LLM wiki from v1 to v2

This guide is for an agent migrating an existing bundle. It covers the changes,
their purpose, the migration sequence, and the evidence needed before adoption.
All examples are synthetic.

**Behavior baseline:** engine commit
`95773f65400bdf23a7d972ffb855da072b9aea11`. “V2” names the rewrite; the engine
version still reports `0.1.0`. Its engine config is schema version **4**, its rule
interface is **`page-interface/3`**, and its runtime is **Bun 1.3.11**. Record the
actual engine commit used for your migration; the version number alone is
insufficient. Recheck this guide against the selected commit if it differs.

## 1. What the rewrite is for

The goal is durable domain knowledge that people and agents can maintain and
reuse: concepts, procedures, evidence, relationships, and decisions that survive
the next conversation or change of agent. An engineering handbook, research
collection, and team onboarding LLM wiki can have different page types and rules.
This context lives in the bundle, independently of a host's conversation memory.

The improvement loop is explicit:

1. A person or agent investigates and writes knowledge.
2. The engine checks the proposed pages against their declared types and rules.
3. The maintainer identifies a recurring, decidable mistake and adds a tested rule.
4. Future writes encounter that rule; changed source evidence is exposed for review.

V1 combined a JSON registry with registered checks, executable modules and code
kits. V2 makes domain policy inspectable data: YAML documents, JSON Schema and
bounded CEL expressions. The kernel supplies a small common language and one
judge. The same selected state supplies both the pages and their law, including
at commit time. This makes policies easier to inspect, test and evolve without
letting a bundle execute code inside the engine.

**Backward compatibility is deliberately absent.** Migration is a redesign of
the bundle's contracts with preservation of its knowledge. Every old policy needs
a disposition: preserved by the kernel, expressed as a tested data rule, replaced
by a reviewed workflow, or recorded as a remaining gap. A green result is evidence
of conformance to the new law, never proof of factual truth or policy equivalence.

## 2. What changes

| V1 surface | V2 migration |
|---|---|
| `config/constitution.json` registry | Split into `constitution/types/`, `fragments/` and `vocabularies/` YAML documents. |
| Older `config/engine.json` | Write strict `schema: wikiwright/engine`, `schema_version: 4`; unknown keys are refused. |
| Field-kind declarations | JSON Schema 2020-12 under `fields`; reserved fields are composed by the kernel. |
| Registered `checks`, executable modules and package kits | Fixed kernel checks plus bounded CEL `rules`; reusable libraries contain data only. |
| `@wikiwright/kit-code` | Repository-contained `libraries/kit-code`; bundle types extend its abstract `code/*` types. |
| Templates and `new` | `type show <type> --brief` supplies a derived skeleton; the agent authors a draft. |
| `lint`, `okf`, `fix` | Inspect `check`; regenerate with `check --write`; supported repairs use `check --fix`. These are not complete behavioral aliases. |
| `lint --staged` | `gate`, judging staged pages and staged law against HEAD. |
| Old `write` flags, separate `move` / `retire` | `write --from <draft-directory>` and optional `ops.json`; use the documented operations format. |
| `schema` | `<verb> --help --json`; refresh integrations parsing commands or envelopes. |
| Nested section assumptions | Declare root depth and heading policies explicitly, including descendant scope and child overrides. |
| Separate pin commit, origin and covers fields | A pin property uses the engine `pin` definition: `{commit, origin, covers}`. |
| Remote freshness fetching | Local Git measurements in `check`, `read`, `search`; URL origins are unmeasured. |
| Installed skills, host plugin and hook comparison | Supply current guidance through the host; install and verify the bundle Git gates yourself. |
| Role guard / `WIKIWRIGHT_ROLE` | No engine enforcement; host permissions and review govern access. Type `role` still exists and means a page's role. |
| `export`, copied-bundle read-only identity, bundle discovery | No equivalent in this delivery. Share a repository under your own policy; target it explicitly with `--root`. |
| Node runtime | Bun-only build and CLI. Windows remains unverified. |

Some small-looking policy keys also disappeared: category classes and `owned_by`,
vocabulary aliases and `requires_link`, section heading aliases, `max_chars`,
template declarations, extension namespace mounts, and executable checks. Do not
drop their intent merely because their spelling is obsolete. For example, a size
limit can become a section rule over `section.raw`; another policy may require
manual review because the current rule interface cannot express it.

Use the [complete disposition table](v2-dispositions.md) for every old key and
finding, and the [changelog](../CHANGELOG.md) for removed commands and flags.
There is no blanket old-to-new substitution script that proves equivalent policy.

## 3. Decide where each requirement belongs

There are three layers of law. A “kit” is a reusable data library, not a fourth
runtime or a plugin API.

| Layer | Owns | Example |
|---|---|---|
| Kernel | Parsing, identity resolution, the page interface, JSON Schema/CEL execution, state capture, findings and write mechanics | Resolve a cited page to its path and nominal type. |
| Library | Reusable types, fragments, vocabularies and tested rules | Require selected observation categories to cite a test-record page. |
| Bundle | This knowledge base's concrete types, vocabulary, policy configuration, pages and sources | Define its procedure types, relation labels and accepted record types. |

Start with the simplest representation that carries the intended meaning. A
plain `[[Page]]` is enough for an ordinary link. A relation such as
`- verified-by [[Bench procedure]]` adds a label when that label matters. A typed
frontmatter reference can constrain its target through `target_type` or
`target_root`; relation rules can inspect resolved targets and `facts.ancestry`.
The engine does not need one hard-coded implementation per domain relationship.

There is also **no arbitrary graph traversal or access to another page's body in
CEL**. Matching target identity/type is different from proving a reciprocal edge,
a transitive dependency invariant, or that a claim was copied to a destination.
Do not promise those checks without a supported expression and a failing example.
If an invariant needs unavailable facts, record it as unexpressed and decide
whether a narrow generic engine capability is justified. Preserve the workflow
obligation while that decision is open.

When a migration encounters a problem, classify it by reproduction:

- **Bundle design/content:** the declared contract is wrong for these pages, a
  required fact is missing, a vocabulary is incomplete, or mixed content needs
  an intentional heading split.
- **Library design:** multiple bundles need the same rule/type contract, or an
  inherited policy was designed too narrowly for its intended consumers.
- **Kernel defect:** valid native v2 data parses incorrectly, necessary regions
  disappear from coverage, or state/identity/write behavior violates the contract.
- **Capability gap:** the current interface intentionally cannot express the
  requirement. A migration report must state its operational consequence.

Make a minimal native v2 reproduction before blaming the kernel. Preserve a real
kernel failure rather than weakening the library or rewriting meaningful content
solely to make the test pass.

## 4. Inventory and protect the starting state

Work in a dedicated migration checkout. First inspect the real repository root,
HEAD, status, index, existing worktrees, hooks and configured runtime. A worktree
shares Git metadata and normally hooks with the original checkout: it is not an
independent place to experiment with hook installation. Use a disposable clone
for commit-hook probes.

Preserve existing staged, unstaged, untracked and relevant ignored inputs. A new
worktree does not include the owner's pending edits. Keep recovery material and
reports outside declared content/law roots. Keep source material and
reports inside the approved environment; use synthetic reproductions for any
upstream engine feedback.

Record at least:

- Page count by content root and type; missing types and identity collisions.
- Old types, fragments, fields, vocabulary entries, module/check implementations,
  templates, scripts and their command/flag dependencies.
- Heading paths and record counts, including claims under H3/H4, history, prose
  bullets, closed claims and existing provenance spellings.
- Source roots, pin origins/covers/commits, source paths, and repository history
  availability. Distinguish immutable inputs from derived artifacts.
- Policies enforced automatically, policies enforced by instructions/review, and
  known preexisting failures. Save the old checker output if it can run.

Create a policy ledger with these columns:

```text
Old requirement | Why needed | V2 owner and representation | Verification | Gap
```

This ledger is the comparison target. The v2 error count alone cannot tell you
whether the migration preserved the old requirements.

## 5. Compose native v2 law

Use the [starter](starter/README.md) for the smallest layout and the
[constitution reference](constitution.md) for exact syntax. An engine document
for a bundle at the repository root could be:

```json
{
  "schema": "wikiwright/engine",
  "schema_version": 4,
  "label": "engineering-notes",
  "content_roots": ["wiki"],
  "source_roots": ["raw"],
  "extensions": {"mode": "registered"},
  "commit_prefixes": ["feat", "fix", "refactor", "test", "docs", "chore"]
}
```

Design concrete page types around their knowledge purpose. Each page names one
nominal type. Use fragments for repeated contract pieces and libraries for stable
shared policy. Under `extensions.mode: registered`, frontmatter properties must
belong to the effective shape. Declare useful metadata explicitly; switching to
`open` just to hide undeclared fields weakens the contract.

Libraries must physically live inside the bundle's enclosing Git repository.
`libraries[].path` is relative to that repository's top level, not the bundle
directory. Copy an external data library into the repository and record its
source revision; there is no package resolver, live upstream identity or
automatic update. Symlinks and submodules are not a substitute for contained law.

`kit-code` serves code documentation; it is not automatically the right model
for every engineering LLM wiki. If importing it, provide concrete types and the
bundle-local `rule-tests/relation-range/` test set with targets from this bundle.
See its [import requirements](../libraries/kit-code/README.md).

### Nested headings: H3/H4 are supported

Markdown `## Facts` is H2, `### Electrical` is H3, and `#### Repeat` is H4.
`sections.depth: 2` identifies the root section level. It does not by itself
govern every deeper heading. Default `scope: direct` covers only a heading's
direct body; choose `scope: descendants` when its policy should reach children.

For example, `constitution/types/test-report.yaml`:

```yaml
type: test-report
role: reference
description: A test result with cited observations and review notes.
fields:
  type: object
  properties:
    result: {type: string, enum: [pass, fail, inconclusive]}
  required: [result]
sections:
  depth: 2
  list:
    - {heading: Facts, min: 1, grammar: claims, provenance: required, scope: descendants}
    - {heading: Notes, under: [Facts], grammar: prose, scope: descendants}
    - {heading: History, grammar: entries, lifecycle: append-only}
```

With an existing source page named `Bench run`, this page uses that contract:

```markdown
---
type: test-report
title: Supply check
result: inconclusive
---

# Supply check

## Facts

### Electrical
- [observed] The recorded voltage was 3.2 V. ([[Bench run]])

#### Repeat
- [observed] The repeat run recorded the same value. ([[Bench run]])

### Notes
- Decide whether another run is necessary.

## History
- 2026-09-28 — Recorded the initial observations.
```

Both observations are governed claims; `Notes` is explicitly prose. Each physical
heading owns its direct items once. `section.items` does **not** collect the entire
subtree. Section rules and relation `require` counts run per governed heading.
An explicit child declaration owns its own section rules; attach a separate rule
to its complete path if required. A child type cannot weaken an inherited
descendants policy by adding a prose exception: put deliberate exceptions in the
same declaration layer as that policy.

Heading `min` and `max` count headings, not records. A CEL expression such as
`section.items.all(...)` also passes for an empty item list. Requiring an actual
observation needs a separately tested constraint; `min: 1` on `Facts` alone
requires only that heading.

Inspect the governed/prose/unbound coverage and `read` output. No error does not
mean every bullet was checked. A direct body containing several record kinds
needs a reviewed content split; one direct region cannot mix multiple grammars.

### Rewrite syntax without changing knowledge

Canonical records are claims (`- [category] core (provenance)`), relations
(`- label [[Target]]`) and dated entries (`- YYYY-MM-DD — text`). Grammar items
start at column one. Claims recognize a final page-link, HTTP(S) URL or declared
source-root path as provenance, before an optional lifecycle suffix.

Preserve uncertainty, attribution, dates, retractions, corrections and history
during conversion. Older markers such as `(inferred ...)` are not automatically
recognized as v2 provenance. Do not turn an inference into an observation or
invent evidence to satisfy `provenance: required`. Recheck link identities: v2
uses names, aliases and titles with Unicode normalization and case folding.

`tools/migrate-spellings.ts` is a historical corpus converter, not a general
migration product. It expects a v3 constitution and an engine document without
`schema_version`; it rewrites pages, reports dropped keys and unparsed items,
and removes the old constitution and templates. It refuses unknown modules; the
current tree cannot convert the removed code-kit package through that route.
If using it as a reference or isolated `--dry-run`, inspect its assumptions and
output first. Its output still needs contract design, tests and full validation.

## 6. Rebuild domain rules and their tests

Keep a rule in the bundle until reuse justifies a library. A rule must use the
documented interface and bounded CEL; it cannot execute TypeScript, open files,
call a model, fetch a URL or read another page's body.

For a claim citing a page, `i.provenance.page` exposes resolved identity and
nominal type. For a relation, `i.target` exposes resolved target identity/type.
Use those fields instead of reconstructing link names in ad hoc scripts. The
[source-policy example](../fixtures/source-policy) demonstrates a library rule
requiring selected categories to cite a particular source-page type. It does
not establish whether that source proves the claim.

Each CEL rule needs `rule-tests/<rule-id>/` containing:

- `negative.md`: exactly the intended finding at the expected location.
- `repaired.md`: the repaired twin, passing.
- `positive/*.md`: at least one valid case that must remain accepted.
- `expect.json`: the expected rule id and location.
- For transition rules, the relevant `before/negative.md` and
  `before/repaired.md` bases.

Resolved-reference tests use the importing bundle's content names; rule-test
pages themselves are not content identity targets. Build suitable synthetic
examples within the approved environment and ensure the tests exercise the
actual imported law.

`rule try` previews a candidate and exits successfully even if it would refuse
pages; inspect its counts. `rule try --base <revision>` evaluates the candidate
on that revision too, but supplies no transition base to either evaluation.
A rule reading `before` therefore remains unevaluated there. Exercise transitions
through test twins, `write` over disk and `gate` over HEAD. `write` does not run
the law test suite; a successful draft write does not replace `check` and `gate`.

## 7. Validate content, evidence and the commit snapshot

In the commands below, `wikiwright` means a launcher pinned to the selected
v2 build, not an assumed global installation. `BUNDLE_ROOT`, `REPORT_DIR` and
`DRAFT_DIR` are absolute paths set for this migration. Put reports and drafts
outside content/law roots; use a report directory outside the bundle.

```sh
wikiwright version
wikiwright type list --concrete --root "$BUNDLE_ROOT"
wikiwright type show test-report --brief --root "$BUNDLE_ROOT"
wikiwright check --root "$BUNDLE_ROOT" --summary --out "$REPORT_DIR/before-generation.json"
wikiwright check --root "$BUNDLE_ROOT" --write
wikiwright check --root "$BUNDLE_ROOT" --summary --out "$REPORT_DIR/check.json"
wikiwright read "Supply check" --root "$BUNDLE_ROOT"
wikiwright search "voltage" --items --root "$BUNDLE_ROOT"
wikiwright write --root "$BUNDLE_ROOT" --from "$DRAFT_DIR" --dry-run
```

Substitute actual type/page/search names and an authored draft batch. The initial
check may report missing or stale generated files. Resolve law-loading errors
before interpreting any page verdict. `check --write` generates artifacts; it
does not make rejected content conform. Inspect each exit status and the full
saved envelope, including warnings, coverage, unparsed records, unbound regions,
unevaluated checks and pin measurements.

Compare the inventory before and after: page identities, claim counts by heading,
source associations, closed claims and history. Explain intentional changes.
Replay representative valid writes and known bad writes in disposable copies.
Include a nested-heading claim, an invalid source reference, a source-only change
that breaks a dependent page, and the lifecycle rules this bundle actually uses.

### Evidence has several distinct checks

- A page citation can resolve to a page/type without proving the source's truth
  or validating a cited heading.
- A literal `source_roots` path is checked for existence and file/directory kind
  in the selected state; its bytes and meaning are not checked by that rule.
- A pin measures covered paths at a commit. `origin: "."` means the enclosing
  repository. Other local Git origins require explicit `local_origins` bindings;
  their paths must identify repository roots. Prefer a documented portable
  checkout layout when multiple hosts share a bundle.
- Preserve histories containing the pinned commits. Do not update pins to HEAD
  merely to clear findings: re-read the covered evidence and review the page.
  URL origins, unavailable history and unbound sources stay visibly unverified.
- External repositories are observed at captured HEADs by `check`, `read` and
  `search`. `gate` does not measure them or atomically commit their state with the
  bundle. Save that observation separately from the staged gate result.

### Generated files must describe the staged state

`check --write` generates from the **working tree**. `gate` checks the **index**.
Stage the intended pages, sources, law, library files, rule tests, examples and
their generated output together, reviewing the exact file list. Do not use a
blanket stage operation that sweeps in unrelated or confidential local inputs.

An untracked/ignored source path or unstaged page can change the working-tree
digest, even when the intended staged pages pass. There is no
`check --write --staged` option. For migration, use a clean checkout whose relevant
working files match the intended snapshot, regenerate there and stage that
result. Preserve unrelated owner files in their original checkout. If a partial
staging workflow is required, explicitly construct and verify the selected
snapshot; do not edit generated digests by hand or stage a mismatched queue.

After staging, inspect the staged diff. Save the proposed commit message as
`$REPORT_DIR/commit-message.txt`, using a prefix permitted by the bundle:

```text
refactor: migrate the knowledge base to the v2 type law

law-change: replace the legacy registry with reviewed types and tested data rules
```

Then run both gate stages:

```sh
wikiwright gate --root "$BUNDLE_ROOT" --all --out "$REPORT_DIR/gate.json"
wikiwright gate --root "$BUNDLE_ROOT" --commit-msg "$REPORT_DIR/commit-message.txt" --all
```

The initial migration can be gated while HEAD still contains the old v1 law:
the gate reports `head-law-unloadable` as a law change and treats all staged CEL
rules as changed. Supply all their tests and the commit-message reason. This
does not prove semantic equivalence to the old law; the policy ledger and
before/after review provide that evidence. No hook bypass is needed for bootstrap.

## 8. Adopt the runtime and prove hook delivery

A clean migration checkout is not adoption. The real bundle, its launcher, the
agent instructions, existing scripts and its installed hooks must all use v2.
Replace removed verbs/flags and obsolete role/plugin instructions. Supply the
current [consume, write and maintain guidance](skills/) through the actual host,
along with this bundle's generated brief; no v2 verb installs those skills.
The [skill setup guide](agent-skills.md) explains the division: shared skills
stay common, bundle-specific instructions supply routing and domain workflow,
and generated guidance follows the type law. Do not fork the three shared skills
for every bundle or hand-edit the brief to teach a new mechanical requirement.

The consuming bundle needs both `gate` stages. See the
[published hook definition](../.pre-commit-hooks.yaml) and [CLI guide](cli.md#gate).
Preserve existing repository hooks and checks through their established manager.
Do not install the engine repository's `scripts/hooks/pre-commit` in a bundle:
that hook runs the engine's development suite, not the bundle's staged gate.
Verify the hook environment resolves the intended Bun executable and v2 launcher,
including from an IDE or agent host if that is how commits will be made.

In a disposable clone with the intended hook installation, verify that an actual
`git commit` refuses an invalid staged page, that a law change without its reason
is refused at commit-message time, and that repaired counterparts succeed. Keep
the command, exit result and hook stderr. A direct successful `gate` invocation
does not prove Git ran the installed hook.

The writer validates a batch before its first page replacement, but multi-file
writes are not crash transactions. Keep recoverable state for adoption and review
a partially landed batch before continuing. After adoption, rerun the real-root
checks, confirm the owner's pending changes are preserved, and retire completed
temporary checkouts recoverably so obsolete copies cannot be mistaken for the
active bundle.

## 9. Completion report and agent handoff

Report these items before calling the migration complete:

| Evidence | Required report |
|---|---|
| Runtime and target | Engine source/build commit, Bun version, active bundle root, branch and HEAD. |
| Policy coverage | Completed old-to-new ledger; each removed behavior has an explicit disposition. |
| Content preservation | Before/after counts and identities, reviewed semantic changes, preserved original inputs. |
| Law and rule tests | Types/libraries selected, test results, exceptions and remaining unexpressed policies. |
| Current-state check | Errors, warnings, governed/prose/unbound coverage and unevaluated work, with reasons. |
| Evidence status | Pin counts and observed origin HEADs; missing/unmeasured sources and re-pin reviews. |
| Commit snapshot | Exact staged diff and gate result, generated artifacts matching that snapshot, law-change reason. |
| Operational adoption | Real-root launcher/scripts/instructions updated, actual installed-hook negative and repaired probes. |
| Residual work | Remaining findings with owners, capability gaps, platform limitations and recovery location. |

Zero `no-base` checks is not a completion target for `check`: transition checks
have no base there by design. Acceptance requires those obligations to have
separate transition evidence. Similarly, an empty error list does not erase
unmeasured sources or intentionally ungoverned prose. State the limits plainly.

For each migration problem, collect: intended user behavior, smallest
reproduction, expected/actual result, kernel/library/bundle/gap classification,
workaround, consequence and proposed improvement. Fix domain design in its proper
layer; propose kernel work only with evidence of a general need. Do not publish
source material or push the bundle unless the owner separately authorizes it.

### Prompt to give the migration agent

> Migrate this LLM wiki to native WikiWright v2 using this guide and the selected
> engine's current constitution, CLI and roadmap. Backward compatibility is not
> required. Preserve the knowledge, evidence, uncertainty, history and existing
> user changes. First inventory the actual bundle and produce a migration plan
> and old-to-new policy ledger. Redesign types, libraries and rules around this
> domain; do not mechanically port obsolete mechanisms or weaken policy to get
> green checks. Implement in an isolated checkout, test through the real CLI and
> both installed Git hook stages, then verify adoption in the actual bundle.
> Keep engine defects, library design issues, bundle issues and unsupported
> requirements distinct. Gather usability feedback and minimal synthetic
> reproductions. Deliver the completion report above with all remaining gaps.
> Keep source data inside the approved environment. Do not push or publish
> without separate authorization.

## References

- [Concepts](concepts.md): layers, typed pages, rules and states.
- [Constitution](constitution.md): exact data formats and interface bounds.
- [Extending](extending.md): libraries, section policies and example CEL rules.
- [CLI](cli.md): current commands, envelopes, gates and write operations.
- [V1 dispositions](v2-dispositions.md) and [changelog](../CHANGELOG.md): removal map.
- [Roadmap](roadmap.md): capability limits and deferred mechanisms.
- [Synthetic episode](../test/episode.test.ts): the complete correction loop.
