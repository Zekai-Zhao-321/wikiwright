---
type: source-map
title: Repository layout
description: Directory-to-purpose lookup for the wikiwright repository.
tags: [repo]
pin: 0a97d3b551d29a6596102497ed7a849b8bfc7781
origin: .
covers: [package.json, tsconfig.json, packages/cli/constitutions/, packages/cli/skills/, packages/kit-code/, fixtures/, tools/, scripts/, .github/]
---

# Repository layout

## Layout

| Path | Purpose |
| --- | --- |
| `docs/` | The documentation: concepts, the constitution reference, the CLI reference (rendered from the binary), extending, architecture, the roadmap |
| `packages/core/` | `@wikiwright/core`: the kernel and the standard library (see [[registry-pipeline]]) |
| `packages/cli/` | The `wikiwright` binary: one module per verb, envelopes, the shell half of the Writer |
| `packages/cli/constitutions/` | The starters `init` scaffolds: `base`, and `code`, a bundle over the code kit |
| `packages/cli/skills/` | The two shipped skills and the generated lint-response playbook |
| `packages/kit-code/` | `@wikiwright/kit-code`: the shipped domain kit — the types, relation labels, templates and discipline of a code wiki, consumed by the `code` starter and by this bundle |
| `fixtures/` | The corpora the suite judges (`memory-synth`, `minimal-vault`), the conformance module fixture with its two bundles, and the OKF pin |
| `tools/` | Repository scripts: the build-info writer, the playbook renderer, the case-fold table generator, the uncovered-directory lister, the suite runner the gate uses, and the benchmark of `check` and `lint --staged` |
| `scripts/hooks/` | The development gate, `pre-commit` |
| `.github/workflows/` | The workflow `check.yml`: the gate and the node runner on every push and pull request, on Linux and macOS |
| `devwiki/` | This bundle: wikiwright documented by wikiwright over the code kit, a workspace member, judged by the suite |
| `AGENTS.md` | The operating rules for an agent working in this repository |
| `CHANGELOG.md` | What each release changed |
| `CONTRIBUTING.md` | Setup from a clone, the gate and the hook, the runners, the generated files, sending a change |
