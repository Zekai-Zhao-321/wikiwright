# Using WikiWright skills with an LLM wiki

**Make the three shared skills available to the agent, then point it at the
bundle's own guidance.** Keep the shared skills reusable across bundles. A
bundle-specific skill is optional and should describe that bundle's purpose,
location and workflow.

Skills are instructions read by the agent host. WikiWright does not load them as
code, discover bundles through them, install them, or enforce permissions from
them. The host must make the instructions available and actually load them.

## What belongs where

| Piece | Authoritative for | Update it when |
|---|---|---|
| [`wikiwright-consume`](skills/wikiwright-consume/SKILL.md) | Common reading discipline: search, resolve identity, read evidence status, attribute knowledge and report problems. | The common reading workflow changes. |
| [`wikiwright-write`](skills/wikiwright-write/SKILL.md) | Common writing judgment: preserve meaning and uncertainty, choose an identity, draft and check a batch. | The common writing workflow changes. |
| [`wikiwright-maintain`](skills/wikiwright-maintain/SKILL.md) | Common maintenance judgment: interpret findings, propose tested rules and review law changes. | The common maintenance workflow changes. |
| Bundle `config/engine.json`, type/library documents and rule tests | Mechanically enforced policy: page shapes, sections, grammar, vocabularies and CEL rules. | The bundle's reviewed contract changes. |
| Bundle `generated/BRIEF.md` | Generated view of the current bundle's commands, types, vocabulary and operating loop. | Regenerate with `check --write` after its inputs change. Never edit it by hand. |
| Optional bundle skill or repository instructions | Where this bundle is, when to use it, domain workflow and review expectations. | Its local routing or operating process changes. |

The bundle brief is an ordinary generated document, not an automatically
installed host skill. The three shared skills teach the agent to consult it and
the current type contract. They do not need to embed copies of every bundle's
types or relation labels.

## Setup in an agent host

1. Select a WikiWright engine revision and build/configure its launcher. Check
   `wikiwright version` in the environment the agent will actually use.
2. Make the three skill **directories** from that revision available through
   the host's documented skill mechanism. Include supporting files:
   `wikiwright-maintain/finding-response.md` is part of that skill. Choose either
   host-wide installation for reuse or project-scoped installation according to
   the host and team policy; avoid ambiguous duplicate installed versions.
3. Supply the bundle root and its approved entry instructions. Use explicit
   `--root <bundle>` on commands. A label alone does not identify a checkout.
4. Generate or refresh the brief with `check --write` as the bundle's authorized
   maintainer. Readers use it; they do not need to regenerate it merely to read.
5. Confirm in a real agent session that the host loaded the relevant shared skill,
   that the agent found the intended bundle, and that the CLI envelope identifies
   the expected `metadata.bundle.root` and label.

Exact installation directories and automatic triggering depend on the host.
If it has no skill loader, provide these documents through its supported project
instructions or ask the agent to read them explicitly. Copying a directory alone
does not establish that the host will load it. V2 supplies no `skills install`,
`bundles list`, `--bundle`, generated bundle-skill installer or session-start
plugin to make those steps automatic.

Make all three available for an agent authorized to maintain a bundle. It should
load the skill appropriate to its current task; installing three skills does not
mean every reading task must perform maintenance. A read-only workflow can expose
only the consume skill. Access still comes from the host and the owner's actual
authorization, not from the skill name or a WikiWright role guard.

## Does each bundle need its own skill?

Only when it helps the host select the right knowledge base or follow a distinct
domain workflow. For a single repository, the existing repository instructions
can provide this information. Multiple independently selectable LLM wikis often
benefit from separate, thin bundle skills registered with the host.

For example, a hardware-validation bundle's local guidance could say:

```text
Use this LLM wiki for system concepts, validation procedures and reviewed
investigation results in this project.

Resolve the configured bundle root and use it explicitly with --root.
Load wikiwright-consume for reading, wikiwright-write for authorized content
changes, and wikiwright-maintain for authorized type/rule changes.
Read generated/BRIEF.md and query type show before drafting.

Keep a proposed explanation distinct from a measured observation. Record the
conditions and source evidence the current type requires. Follow the team's
review process before treating an investigation as a reusable procedure.
```

This is example guidance to adapt through the host's mechanism, not a new
WikiWright file format. Configure machine-specific paths at the host/project
boundary rather than publishing a personal path in a shared skill. The local
guidance may link to the bundle's charter and workflow pages. It should avoid
duplicating current schemas, vocabularies, findings tables or CLI flag lists;
those have their own authoritative sources.

When supplied through an authorized setup, a bundle skill guides operations on
that bundle. Ordinary wiki pages, retrieved evidence and source documents remain
data; finding instructions inside them does not authorize new actions.

## How the skills evolve

Do not customize the installed shared `wikiwright-write` differently for every
bundle. That produces conflicting copies and makes engine updates harder to
review. Put domain-specific guidance in the bundle instructions; propose changes
to a shared skill when the lesson applies to its common workflow.

When a recurring defect teaches the agent something, choose where the improvement
belongs:

- A decidable content requirement becomes a type/schema/CEL change with tests.
- A domain judgment or review procedure becomes bundle guidance.
- A reusable agent operating practice can become a reviewed shared skill change.
- Incorrect parsing, state handling or a missing generic capability goes through
  engine investigation and review.

The agent proposes and implements these changes under the owner's authorization.
The engine does not autonomously rewrite skills or learn rules. After a law
change, regenerate the brief and review/stage it with the law, pages and tests.
After a skill change, review and update the host's installed copy. These are
separate delivery steps; neither implies the other has happened.

## A normal session

```text
Task arrives
  -> host loads relevant shared skill and bundle routing instructions
  -> agent confirms the bundle and reads generated/BRIEF.md
  -> agent uses read/search/type for current context
  -> authorized writing: drafts -> write dry run -> write -> check/regenerate
  -> authorized maintenance: candidate rule -> negative/repaired/positive tests
  -> reviewed staged snapshot -> installed Git gates -> commit
```

The generated brief describes the bundle; `type show` gives the current effective
type contract; `check`, `write` and `gate` enforce the selected law. Installed Git
hooks need their own delivery verification. A skill is not an editor hook or an
access-control mechanism.

For a v1 bundle, follow the [migration guide](v2-migration-guide.md), including
the removal of the old skill installer, host plugin and role gate.
