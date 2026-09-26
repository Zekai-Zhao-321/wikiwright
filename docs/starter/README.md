# Hand-copied v2 starter

Copy this directory into a Git repository as the new bundle root. Give it a
lowercase hyphenated `label` in `config/engine.json`, edit the `note` type and
sample page, then run the built binary:

```sh
cp -R /path/to/wikiwright/docs/starter ./garden-notes
bun /path/to/wikiwright/packages/cli/dist/bin.js check --root ./garden-notes --write
bun /path/to/wikiwright/packages/cli/dist/bin.js check --root ./garden-notes
```

Stage `generated/` with the pages and law it describes. Add the published
gate from [the CLI guide](../cli.md#gate) to the consuming repository's
pre-commit and commit-msg stages. `check --write` renders the initial
`generated/` files; none is stored in this starter.

This is a directory to copy, not an `init` command. The first `check` is
the completeness test of a hand-made bundle.
