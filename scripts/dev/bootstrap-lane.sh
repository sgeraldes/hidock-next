#!/usr/bin/env bash
# Reproducible lane-worktree install — the SAME sequence CI uses (see
# .github/workflows/ci.yml test-electron). Run from the worktree root.
#
# Gotchas this sequence exists for (learned 2026-07-13, do not "simplify"):
#  1. npm ci in a package with a file:-linked sibling runs the sibling's
#     `prepare` (tsup) before that sibling has devDeps -> install everything
#     with --ignore-scripts first, dependency-first order.
#  2. dist/ is not committed -> explicit build pass (alphabetical order
#     already builds connectors before connectors-slack, database before
#     knowledge-graph).
#  3. electron-builder install-app-deps (apps/electron postinstall) follows
#     the @hidock/database symlink and rebuilds ITS better-sqlite3 for the
#     Electron ABI, clobbering the Node-ABI copy vitest's DB shim loads ->
#     rebuild it again AFTER the electron install.
set -euo pipefail

PKGS="ai-providers audio-capture calendar-sync connectors connectors-slack database jensen-protocol knowledge-graph storage-controller transcription"

for n in $PKGS; do
  echo "== npm ci: packages/$n"
  (cd "packages/$n" && npm ci --ignore-scripts)
done

(cd packages/database && npm rebuild better-sqlite3)

for n in $PKGS; do
  echo "== build: packages/$n"
  (cd "packages/$n" && npm run build --if-present)
done

echo "== npm ci: apps/electron"
(cd apps/electron && npm ci)

echo "== restore Node-ABI better-sqlite3 (install-app-deps clobbered it)"
(cd packages/database && npm rebuild better-sqlite3)

echo "bootstrap-lane: done"
