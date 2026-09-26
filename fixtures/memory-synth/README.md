# memory-synth

A fictional, frozen vault of synthetic pages: a personal-memory bundle whose
people, places and claims are invented. Every name is built from syllable
tables, every claim core from a lorem word table, every date from a 2031
window; nothing in it describes a real person or a real event. The vault is
edited by hand and never regenerated, so the numbers the suite asserts on it
stay put.

Pages: 41 (35 under wiki/, 5 daily notes under journal/, and one weekly
review). Categories declared: 29, two left unused on purpose.

It is on the v2 law: `tools/migrate-spellings.ts` wrote its `constitution/`
from the v1 `config/constitution.json` and respelled its pages into the one
spelling each grammar reads (98 relations, 52 entries). `fixture-verdicts`
holds its verdict under `check` and `gate`: the one planted `section-depth`
(a `### Timeline` under `## Notes`), the nine items the migration could not
respell without inventing a date, a link or a category — among them the
relation with no link and the fact with no category planted for the v1
dialect census, which the v2 grammar has no census for — and the one page
whose `status: draft` the reserved `status` does not admit. The `daily` and
`review` types carry the `append-only` fragment, whose `body-append-only`
rule re-expresses v1's page-wide `body.lifecycle: "append-only"`; its test
set is under `rule-tests/`.
