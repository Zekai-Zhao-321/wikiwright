---
type: subsystem
title: "Skills and the brief"
description: "Generated bundle brief and repository-held consume, write and maintain guidance."
tags: [cli]
pin:
  commit: 5e9abce0e1f7ae60507b3ec1c6ef22663f72d245
  origin: .
  covers: ["packages/cli/src/generated.ts", "docs/skills/wikiwright-consume/SKILL.md", "docs/skills/wikiwright-write/SKILL.md", "docs/skills/wikiwright-maintain/SKILL.md", "tools/render-playbook.ts"]
---

# Skills and the brief

## Responsibilities

Check --write renders generated/BRIEF.md from a bundle's current types, vocabularies and command table. It lists concrete types with inherited use_when and avoid_when guidance. Type list --concrete selects those types; normal type show keeps complete vocabulary values, while --brief gives short writing guidance. The three hand-written skill documents under docs/skills describe the judgment each role brings.

## Entry points

Current source at this pin: `packages/cli/src/generated.ts`, `docs/skills/wikiwright-consume/SKILL.md`, `docs/skills/wikiwright-write/SKILL.md`, `docs/skills/wikiwright-maintain/SKILL.md`, `tools/render-playbook.ts`.

## State

The finding-response playbook is generated from the verdict table. Neither the package nor a command installs these skills into a host or bundle.

## Invariants

The brief describes the law the bundle actually loaded. The skill files are guidance, not filesystem permission or engine role enforcement.

## Failure modes

An old brief is generated-drift. A host that has not been given these documents will not discover them automatically; a reader must still check the bundle identity.

## Relations

- part-of [[command-runtime]]
- mapped-in [[repository-layout]]
- verified-by [[testing-guide]]
