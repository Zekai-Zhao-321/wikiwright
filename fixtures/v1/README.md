# fixtures/v1

Frozen copies of the corpora as they stood on the v1 law — a
`config/constitution.json` at schema version 3 — before
`tools/migrate-spellings.ts` moved each onto the v2 law (the v2 contracts,
§12 step 5). The old command table's tests read them: a bundle on schema
version 4 is answered by the new table, so a test of an old verb needs a
bundle the old table answers. Nothing else reads them, no generator writes
them, and they leave with the old verbs and their tests (§12 step 6).

- `minimal-vault/`: `fixtures/minimal-vault` before its migration.
- `handbooks/orchard/`, `handbooks/allotment/`: the two handbooks before
  theirs, each with the exports it declared rendered under `skills/`. The
  two-bundle tests read them as a pair, so both were frozen when the first
  of them moved.
