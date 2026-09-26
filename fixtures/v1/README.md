# fixtures/v1

Frozen copies of the corpora as they stood on the v1 law — a
`config/constitution.json` at schema version 3 — before
`tools/migrate-spellings.ts` moved each onto the v2 law (the v2 contracts,
§12 step 5). The old registry's core tests read them
(`packages/core/test/registry-invariants.test.ts`, `lifecycle.test.ts`):
they load a v1 constitution, and every corpus of the repository is on the v2
law. Nothing else reads them, no generator writes them, and they leave with
the old registry (§12 step 6). The old verbs' tests, which read them before,
left with the old verbs.

- `minimal-vault/`: `fixtures/minimal-vault` before its migration.
- `handbooks/orchard/`, `handbooks/allotment/`: the two handbooks before
  theirs, each with the exports it declared rendered under `skills/`.
- `devwiki/`: `devwiki` before its migration, without its `package.json`
  (a copy a test judges installs the v1 kit itself).
