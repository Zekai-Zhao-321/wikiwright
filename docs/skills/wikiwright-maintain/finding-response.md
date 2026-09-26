# Responding to a finding

**Generated** by `tools/render-playbook.ts` from the verdict table, every code
the judge and the verbs beside it emit. Do not edit: a hand-maintained list of
the codes the binary prints is a list that goes stale on the next change.

## The whole instruction, in two sentences and one clause

If a finding has `fix`, run its `argv`. If it has `queue`, it is a judgment
for the bundle's maintainer: continue. And at the gate, a queued error on a
line the commit did not touch is a warning (`details.demoted_from`), not a block.

An `info` finding carries neither: it is a census row, and the count is the
point.

## A page

| code | severity | route | carries the v1 ids |
|---|---|---|---|
| `source-path-missing` | `error` | queue `source-review` | — |
| `source-path-kind` | `error` | queue `source-review` | — |
| `source-path-unmeasured` | `warning` | queue `source-review` | — |
| `page-too-large` | `error` | queue `syntax-review` | — |
| `page-not-utf8` | `error` | queue `syntax-review` | — |
| `malformed-frontmatter` | `error` | queue `syntax-review` | `malformed-frontmatter` |
| `frontmatter-not-mapping` | `error` | queue `syntax-review` | `frontmatter-not-mapping` |
| `duplicate-key` | `error` | queue `syntax-review` | `duplicate-key` |
| `type-unknown` | `error` | queue `type-review` | `unknown-type` |
| `abstract-type` | `error` | queue `type-review` | `abstract-type` |
| `page-shape-invalid` | `error` | queue `syntax-review` | `missing-required-field`, `field-shape`, `unknown-frontmatter-key`, `invalid-tags-field`, `tag-form`, `malformed-pin` |
| `page-ref-type` | `error` | queue `link-review` | `field-shape` |
| `vocabulary-unknown` | `error` | queue `category-review` | `unknown-tag`, `unknown-category`, `unknown-label` |
| `vocabulary-retired` | `error` | queue `category-review` | `tag-retired`, `vocabulary-retired` |
| `wikilink-unresolved` | `warning` | queue `link-review` | `wikilink-unresolved` |
| `wikilink-alias-target` | `error` | queue `link-review` | `wikilink-alias-target` |
| `renamed-without-alias` | `error` | queue `identity-review`; a transition, `unevaluated` without a base | `renamed-without-alias` |
| `section-count` | `error` | queue `grammar-review` | `sections` |
| `section-order` | `error` | queue `grammar-review` | `sections` |
| `section-undeclared` | `error` | queue `grammar-review` | `sections` |
| `section-depth` | `error` | queue `grammar-review` | `section-depth` |
| `item-unparsed` | `error` | queue `grammar-review` | `grammar-unparsed`, `entry-date-missing` |
| `category-not-allowed` | `error` | queue `category-review` | `category-not-allowed` |
| `claim-provenance` | `error` | queue `provenance-backfill` | `claim-provenance` |
| `claim-closed` | `error` | queue `grammar-review` | `closed-claim-in-facts` |
| `claim-open` | `error` | queue `grammar-review` | `history-marker` |
| `relation-target-unresolved` | `warning` | queue `link-review` | `relation-target-unresolved` |
| `require-unmet` | `error` | queue `label-review` | `relation-require` |
| `entry-edited` | `error` | queue `grammar-review`; a transition, `unevaluated` without a base | `entry-mutated` |
| `claims-transition` | `error` | queue `grammar-review`; a transition, `unevaluated` without a base | `claims-transition` |
| `relation-removed` | `error` | queue `label-review`; a transition, `unevaluated` without a base | `relation-removed` |
| `folder-segment-registered` | `error` | queue `tag-review` | `folder-segment-registered` |
| `folder-tags-present` | `error` | fix `wikiwright check --fix` where `details.materialize`, else queue `tag-review` | `folder-tags-present` |
| `former-folder-tags-review` | `warning` | queue `tag-review`; a transition, `unevaluated` without a base | `former-folder-tags-review` |
| `exception-applied` | `info` | none: an info finding | — |
| `exception-stale` | `warning` | queue `exception-review` | `exception-stale` |
| `exception-illegal` | `error` | queue `exception-review` | `exception-illegal` |
| `rule-error` | `error` | queue `rule-review` | — |
| `unevaluated` | `info` | none: an info finding | — |

## The vault as a whole

| code | severity | route | carries the v1 ids |
|---|---|---|---|
| `identity-collision` | `error` | queue `identity-review` | `identity-collision` |
| `path-skipped` | `warning` | queue `identity-review` | — |
| `instances-min` | `error` | queue `type-review` | `instances` |
| `instances-max` | `error` | queue `type-review` | `instances` |

## The law itself: rule tests, examples, the law diff

| code | severity | route | carries the v1 ids |
|---|---|---|---|
| `rule-untested` | the rule's own | queue `rule-review` | — |
| `rule-test-fails` | `error` | queue `rule-review` | — |
| `example-fails` | `error` | queue `rule-review` | — |
| `law-changed` | `info` | none: an info finding | — |
| `law-relaxed` | `error` | queue `law-review` | — |

## Beside the judge: pins, generated files, base OKF

| code | severity | route | carries the v1 ids |
|---|---|---|---|
| `generated-drift` | `error` | fix `wikiwright check --write` | `generated-drift`, `brief-stale` |
| `okf-missing-type` | `error` | queue `type-review` | `okf-missing-type` |
| `pin-stale` | `warning` | queue `source-review` | `stale-capture` |
| `pin-unknown` | `warning` | queue `source-review` | `pin-unknown-to-origin` |
| `pin-coverage-invalid` | `warning` | queue `source-review` | — |
| `pin-unmeasured` | `info` | none: an info finding | `freshness-unavailable` |
| `citation-unresolved` | `warning` | queue `source-review` | `citation-unresolved` |
| `stale-source-cited` | `warning` | queue `source-review` | `stale-source-cited` |

## A rule the law declares

A CEL rule a type or a fragment declares is its own row, under its own id:
its severity is the one it declares, and it routes to the queue `rule-review`.
`rule-error` is a rule that did not evaluate to a boolean; `rule-untested`
a rule with no negative, repaired or positive test page, a warning under
`check` and an error at the gate for a rule the commit adds or changes.

## The queues

The lane set is closed: `category-review`, `exception-review`, `grammar-review`, `identity-review`, `label-review`, `law-review`, `link-review`, `provenance-backfill`, `rule-review`, `source-review`, `syntax-review`, `tag-review`, `type-review`.

A lane is a human queue. Its depth is the evidence a rule is ready to ratchet
from warning to error, which is why a queued finding is counted rather than
silenced; `generated/queue.md` holds the queue of the pages as they stand.

## Exceptions

A finding you have judged and ruled intentional is excepted on the page, with
a reason, through the page's own `exceptions:` key (`{rule, reason}`) — never
by lowering a severity. An excepted finding stays visible as
`exception-applied`; an exception that closes nothing is `exception-stale`, and
one naming no rule, or a law a page may not waive, is `exception-illegal`.
