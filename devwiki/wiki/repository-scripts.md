---
type: ops-reference
title: "Repository scripts"
description: "Build, gate, generator and release commands for this repository."
tags: [repo]
pin:
  commit: f1dc7deae8b129b74e9db2eb37da44b927ae22f6
  origin: .
  covers: ["package.json", "tools/run-suite.ts", "tools/write-build-info.ts", "tools/render-playbook.ts", "docs/render-cli.ts", "scripts/release-matrix.sh"]
---

# Repository scripts

## Reference

Bun run check executes formatting, build, test typecheck and the whole suite. The run-suite tool starts one Bun test process per file, runs the complete episode after parallel workers, and reports exact pass, fail and file counts.

Current source at this pin: `package.json`, `tools/run-suite.ts`, `tools/write-build-info.ts`, `tools/render-playbook.ts`, `docs/render-cli.ts`, `scripts/release-matrix.sh`.

Build-info stamps the CLI; render-playbook and render-cli own their generated documents. The release matrix is a separate manual pre-release command.

Every generated output has one generator and its check mode. Tests write working bundles under os.tmpdir(), with dates pinned when a write stamps them.

A stale generated file fails its comparison. The packed-install test needs the network, and heavy machine load can cause a bounded test timeout.

## Relations

- part-of [[wikiwright-architecture]]
- mapped-in [[repository-layout]]
