#!/bin/sh
# docs/architecture.md §The gate (the hook and the workflow run the gate on
# the platforms they reach, and the loss is stated rather than assumed).
#
# THE RELEASE MATRIX, RUN BY HAND. This script is not the workflow and does not
# pretend to be: nothing invokes it on a push, nothing reports its result, and a
# release that skipped it is indistinguishable from one that ran it unless a
# human says so. What it buys is that "run the matrix" is one command rather than
# a list somebody has to reconstruct from three documents.
#
#   sh scripts/release-matrix.sh
#
# Every arm prints PASS or FAIL and the script exits non-zero if any failed, so
# the output can be pasted into a release note as evidence.
#
# What it does NOT cover, stated so nobody reads a green run as more than it is:
# Windows, and any operating system but the one it runs on. The node runner arm
# below is the cross-RUNTIME half; the cross-PLATFORM half is the workflow's
# Linux and macOS matrix, and Windows has no carrier at all.

set -u

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO" || exit 1

FAILED=0
RESULTS=""

arm() {
  name=$1
  shift
  printf '\n=== %s ===\n' "$name"
  if "$@"; then
    RESULTS="${RESULTS}PASS  ${name}\n"
  else
    RESULTS="${RESULTS}FAIL  ${name}\n"
    FAILED=1
  fi
}

# 1. The gate itself: biome, the build, the test-project typecheck, the suite,
#    under bun. This is what `scripts/hooks/pre-commit` runs on every commit.
arm "bun: biome + build + typecheck + suite" bun run check

# 2. The node runner. `docs/architecture.md §Directories` says the shipped artifact is node-builtins-only,
#    and this is the only thing that proves it: bun tolerates shapes node
#    rejects, and an absolute-path dynamic import that only node refuses is a
#    defect this repository has actually shipped.
arm "node: the whole suite under the shipped runtime" \
  node --test "packages/core/test/*.test.ts" "packages/cli/test/*.test.ts"

# 3. Pack and install, as a consumer does. Covered by a test file too, so this
#    arm is the same assertion from outside the suite: if the packages cannot be
#    packed at all, the test that packs them never ran.
arm "pack: both packages build a tarball" sh -c '
  out=$(mktemp -d) || exit 1
  bun pm pack --destination "$out" --cwd packages/core >/dev/null 2>&1 &&
  bun pm pack --destination "$out" --cwd packages/cli  >/dev/null 2>&1 &&
  ls "$out"/*.tgz >/dev/null 2>&1
  status=$?
  rm -rf "$out"
  exit $status
'

# 4. Determinism: the same bytes twice. `docs/architecture.md §The gate` asserts this in-suite under
#    one runtime; this arm compares ACROSS runtimes, which no test in the suite
#    does.
arm "cross-runtime: one corpus, two runtimes, one verdict" sh -c '
  a=$(mktemp) || exit 1
  b=$(mktemp) || exit 1
  bun  packages/cli/src/main.ts lint --root fixtures/memory-synth --all --limit 100000 > "$a" 2>/dev/null
  node packages/cli/dist/main.js lint --root fixtures/memory-synth --all --limit 100000 > "$b" 2>/dev/null
  diff -q "$a" "$b" >/dev/null
  status=$?
  rm -f "$a" "$b"
  exit $status
'

# 5. A fresh build produces a binary. `tsc -b` trusts its buildinfo, and one
#    that survived a deleted `dist/` made a clean checkout's `bun run build`
#    emit nothing; the buildinfo now lives under `dist/`, and this arm proves a
#    build from nothing lands the binary.
arm "clean build: no dist, then a binary" sh -c '
  bun run clean >/dev/null 2>&1 &&
  rm -rf packages/core/dist packages/cli/dist &&
  bun run build >/dev/null 2>&1 &&
  test -f packages/cli/dist/main.js && test -f packages/core/dist/index.js
'

# 6. The corpora keep their verdicts. A release that changed one silently is the
#    failure `docs/architecture.md §The invariants` exists to catch; this arm is the whole-corpus
#    form of it.
arm "corpora: every shipped fixture still judges as it declares" \
  bun test packages/cli/test/fixture-verdicts.test.ts

printf '\n=== release matrix ===\n'
printf '%b' "$RESULTS"
printf '\nplatform: %s\nbun: %s\nnode: %s\n' \
  "$(uname -s -m)" "$(bun --version 2>/dev/null || echo absent)" "$(node --version 2>/dev/null || echo absent)"
printf '\nNOT covered by this run: Windows, any other operating system.\n'

exit "$FAILED"
