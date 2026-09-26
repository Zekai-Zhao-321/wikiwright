---
type: code/decision
title: D-001 — The catalogue is read-only
description: The catalogue answers lookups and never writes; imports rebuild it whole.
decision_id: D-001
decided: 2026-02-03
---

# D-001 — The catalogue is read-only

## Context

Two writers once changed the same variety at once, and a lookup read half of
each change.

## Decision

The catalogue is rebuilt whole by the import and answers lookups only.

## Consequences

- 2026-02-03 — Recorded.
- 2026-03-10 — The import takes forty seconds on the full list, measured.
