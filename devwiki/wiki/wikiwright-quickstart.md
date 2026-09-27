---
type: quickstart
title: wikiwright quickstart
description: "From-zero Bun setup and the first typed bundle check."
tags: [repo]
pin:
  commit: 1a1a90c11329d82c9b2c6e92c6fa8e16160c0613
  origin: .
  covers: ["README.md", "package.json", "docs/starter/README.md", "packages/cli/src/main.ts", "scripts/hooks/pre-commit"]
---

# wikiwright quickstart

## Setup

Install the Bun version pinned by .bun-version, run bun install and bun run build, then run the binary's version verb. Copy the documented starter into a Git repository and edit its label and note type.

Current source at this pin: `README.md`, `package.json`, `docs/starter/README.md`, `packages/cli/src/main.ts`, `scripts/hooks/pre-commit`.

## Run

Run check --write on the copied bundle to render generated output, then check to judge it. Use type list --concrete to choose a writable type, type show --brief for a short skeleton and normal type show for complete vocabulary values before drafting. Stage generated output with the pages it describes.

## Verify

The development repository uses bun run check and its local pre-commit hook. A consuming bundle needs the published gate hook installed separately.

There is no init command. A missing engine.json is bundle-not-found; an invalid type document is constitution-invalid, and the first check is the completeness test.

## Relations

- decided-by [[D-003]]
- decided-by [[D-007]]
- part-of [[wikiwright-architecture]]
