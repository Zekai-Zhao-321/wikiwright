---
type: code/architecture-overview
title: Seed catalogue architecture
description: The seed catalogue service in two layers, anchored to its two entry points.
pin:
  commit: 0123456789abcdef0123456789abcdef01234567
  origin: .
  covers: [src/server.ts, src/catalogue/]
---

# Seed catalogue architecture

## System shape

A request enters at `src/server.ts:12`, which parses it and hands it to the
catalogue; the catalogue answers from its index and never writes.

## Layers

- The server: parsing, routing and the response envelope.
- The catalogue: the index of seed varieties and the lookups over it.
