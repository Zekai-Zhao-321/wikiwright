# Responding to a finding

**Generated** by `tools/render-playbook.ts` from the pass table — the kernel's
rows and the standard library's arms — and the fixer registry. Do not edit: a
hand-maintained list of the ids the binary prints is a
list that goes stale on the next slice, which is how a manual came to be silent
about eleven arms its own `check` was reporting.

## The whole instruction, in two sentences and one clause

If a finding has `fix`, run its `argv` — filling any placeholders first. If it has
`queue`, it is not yours: continue. And a queued finding on a line you did not
write is a warning, not a block.

An `info` finding carries neither: it is a census row, and the count is the point.
The one exception you may act on deliberately is `canonical-form`, whose fixer runs
only when you name the rule.

## Applicability

- **MachineApplicable** — the engine derived the exact ops and proves them gone.
- **MaybeIncorrect** — the op is right by the engine's preference, not by law; it
  applies only under an explicit `--expect N` naming the rule.
- **HasPlaceholders** — the rendering carries `<...>` you must fill. `--propose`
  prints it; no count ever applies it.

## LAW — always on

| id | severity | route |
|---|---|---|
| `module-failure` | `error` | queue `module-review` |
| `malformed-frontmatter` | `error` | queue `syntax-review` |
| `frontmatter-not-mapping` | `error` | queue `syntax-review` |
| `duplicate-key` | `error` | queue `syntax-review` |
| `unknown-type` | `error` | queue `type-review` |
| `tombstone` | `error` | fixer `retype` (MachineApplicable) — else queue `type-review` |
| `missing-required-field` | `error` | fixer `frontmatter-set` (MachineApplicable) — else queue `syntax-review` |
| `field-shape` | `error` | fixer `frontmatter-set` (MachineApplicable) — else queue `syntax-review` |
| `unknown-frontmatter-key` | `error` | fixer `frontmatter-delete` (MachineApplicable) — else queue `syntax-review` |
| `invalid-tags-field` | `error` | queue `syntax-review` |
| `unknown-tag` | `error` | queue `tag-review` |
| `tag-alias-target` | `error` | fixer `tag-rename` (MachineApplicable) — else queue `tag-review` |
| `tag-retired` | `error` | fixer `tag-rename` (MachineApplicable) — else queue `tag-review` |
| `identity-collision` | `error` | queue `identity-review` |
| `sections` | `error` | fixer `section-stub` (MachineApplicable) — else queue `grammar-review` |
| `section-depth` | `error` | fixer `heading-depth` (MachineApplicable) — else queue `grammar-review` |
| `max-chars` | `warning` | queue `grammar-review` |
| `wikilink-alias-target` | `error` | fixer `link-rewrite` (MachineApplicable) — else queue `link-review` |
| `wikilink-unresolved` | `warning` | queue `link-review` |
| `generated-drift` | `error` | fixer `check --write` (MachineApplicable) — else queue `—` |
| `okf-missing-type` | `error` | queue `type-review` |
| `template-placeholder-unknown` | `warning` | queue `template-review` |
| `template-field-unknown` | `warning` | queue `template-review` |
| `template-orphan` | `warning` | queue `template-review` |
| `freshness-unavailable` | `warning` | queue `source-review` |
| `origin-unreachable` | `warning` | queue `source-review` |
| `abstract-type` | `error` | queue `type-review` |
| `tag-form` | `error` | queue `tag-review` |
| `vocabulary-alias-target` | `error` | queue `category-review` |
| `vocabulary-retired` | `error` | queue `category-review` |
| `skills-stale` | `warning` | queue `skills-review` |
| `skills-missing` | `info` | advisory: `skills update` |
| `brief-stale` | `info` | advisory: `check --write` |
| `hook-stale` | `warning` | fixer `hook install` (MachineApplicable) — else queue `—` |
| `renamed-without-alias` | `error` | fixer `frontmatter-set` (MachineApplicable) — else queue `—` |
| `exception-stale` | `warning` | queue `exception-review` |
| `exception-illegal` | `error` | queue `exception-review` |

## POLICY — off unless the bundle declares its key

| id | severity | route |
|---|---|---|
| `folder-segment-registered` | `error` | queue `tag-review` |
| `folder-tags-present` | `error` | fixer `folder-tags` (MachineApplicable, where the bundle's mode admits it) — else queue `tag-review` |
| `former-folder-tags-review` | `warning` | queue `tag-review` |
| `unregistered-extension` | `error` | queue `syntax-review` |

## type-declared — on where a type says so

| id | severity | route |
|---|---|---|
| `malformed-pin` | `error` | queue `source-review` |
| `stale-capture` | `warning` | queue `source-review` |
| `stale-source-cited` | `warning` | queue `source-review` |
| `citation-unresolved` | `warning` | queue `source-review` |
| `pin-unknown-to-origin` | `warning` | queue `source-review` |
| `grammar-unparsed` | the section's own `severity` | queue `grammar-review` |
| `canonical-form` | `info` | census — nothing to route |
| `tag-requires-link` | the section's own `severity` | queue `link-review` |
| `instances` | the section's own `severity` | queue `type-review` |
| `body-append-only` | the section's own `severity` | queue `grammar-review` |
| `unknown-category` | the section's own `severity` | queue `category-review` |
| `journal-only-category` | the section's own `severity` | queue `category-review` |
| `category-not-allowed` | the section's own `severity` | queue `category-review` |
| `owned-by` | the section's own `severity` | queue `category-review` |
| `claim-provenance` | the section's own `severity` | queue `provenance-backfill` |
| `closed-claim-in-facts` | the section's own `severity` | queue `grammar-review` |
| `history-marker` | the section's own `severity` | fixer `history-close` (HasPlaceholders) — else queue `grammar-review` |
| `marker-like` | `info` | census — nothing to route |
| `sourced-inferred` | `info` | census — nothing to route |
| `provenance-path-only` | `info` | census — nothing to route |
| `provenance-weak` | `info` | census — nothing to route |
| `hearsay` | `info` | census — nothing to route |
| `claims-transition` | the section's own `severity` | queue `grammar-review` |
| `claim-landing` | `info` | census — nothing to route |
| `unknown-label` | the section's own `severity` | queue `label-review` |
| `relation-range` | the section's own `severity` | queue `label-review` |
| `relation-target-unresolved` | the section's own `severity` | queue `link-review` |
| `relation-removed` | the section's own `severity` | queue `label-review` |
| `relation-retired` | `info` | census — nothing to route |
| `relation-require` | the section's own `severity` | queue `label-review` |
| `entry-date-missing` | the section's own `severity` | queue `grammar-review` |
| `entry-mutated` | the section's own `severity` | queue `grammar-review` |

## The queues

The lane set is closed: `category-review`, `exception-review`, `grammar-review`, `identity-review`, `label-review`, `link-review`, `module-review`, `provenance-backfill`, `skills-review`, `source-review`, `syntax-review`, `tag-review`, `template-review`, `type-review`.

A lane is a human queue. Its depth is the evidence a row is ready to ratchet from
warning to error, which is why a queued finding is counted rather than silenced.

## Waivers

A finding you have judged and ruled intentional is waived on the page, with a
reason, through the page's own `exceptions:` block — never by lowering a severity.
A waiver naming a fix-routed row or a parse law is illegal, and a waiver matching
no finding is stale; both are findings of their own.
