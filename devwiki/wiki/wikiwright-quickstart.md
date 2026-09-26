---
type: quickstart
title: wikiwright quickstart
description: "From-zero Bun setup and the first typed bundle check."
tags: [repo]
pin:
  commit: 179fb9f6edc0eec03b113c33bd5c2c0648231ff2
  origin: .
  covers: ["README.md", "package.json", "docs/starter/README.md", "packages/cli/src/main.ts", "scripts/hooks/pre-commit"]
---

# wikiwright quickstart

## Setup

Install the Bun version pinned by .bun-version, run bun install and bun run build, then run the binary's version verb. Copy the documented starter into a Git repository and edit its label and note type.

Current source at this pin: `README.md`, `package.json`, `docs/starter/README.md`, `packages/cli/src/main.ts`, `scripts/hooks/pre-commit`.

## Run

Run check --write on the copied bundle to render generated output, then check to judge it. Read type show --brief before drafting pages and stage generated output with the pages it describes.

## Verify

The development repository uses bun run check and its local pre-commit hook. A consuming bundle needs the published gate hook installed separately.

There is no init command. A missing engine.json is bundle-not-found; an invalid type document is constitution-invalid, and the first check is the completeness test.

## Relations

- decided-by [[D-003]]
- decided-by [[D-007]]
- part-of [[wikiwright-architecture]]
