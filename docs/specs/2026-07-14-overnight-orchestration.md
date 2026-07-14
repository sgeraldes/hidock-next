# Overnight Orchestration — 2026-07-14 (owner asleep; Fable orchestrates, agents execute)

**Branch:** everything lands on `beta/meeting-intelligence` ONLY. No pushes to `main` tonight (promote = owner's call, G1-style). CI must stay green after every integration push.

**Roles (owner directive):** Fable 5 = orchestration/coordination only (no self-execution). Execution → **Codex Terra high**. Completion/design-heavy lanes → **Claude Code Opus 4.8 high**. Adversarial review of THIS PLAN before dispatch; `/codex:review` on every lane result before integration.

**Absolutes:**
- USB SAFETY: no hardware probing anywhere, mocks only; during final E-walk only the app's own normal behavior (overnight = idle window). Device-sync gating code (Lane A) integrates BEFORE any device-adjacent lane.
- Agents work in their own worktrees from beta: `git worktree add .claude/worktrees/lane-<id> -b lane/<id> beta/meeting-intelligence`. Never touch the main checkout (`G:\Code\hidock-next`).
- Install recipe inside a lane worktree = ci.yml sequence: packages `npm ci --ignore-scripts` (dep-first order) → `npm rebuild better-sqlite3` in packages/database → package builds → `apps/electron npm ci` → re-run the database rebuild (install-app-deps clobbers the Node-ABI copy). Install only what the lane needs.
- Agents MUST: commit early/often in-worktree; run typecheck + lint + targeted tests (full suite when the lane is DB/core); STOP any dev/preview server they start before reporting (D5 lesson); report commit SHAs + gate evidence.
- Machine load: max 1 Codex + 2 Opus lanes concurrently; stagger full-suite runs.
- After each lane: codex review → orchestrator cherry-picks to beta in the main checkout → FULL gates there (typecheck 0 / lint 0 / vitest all-green) → commit → push → CI watch. Ledger row updated + committed each time.

## Lanes

| id | scope | executor | prio | status |
|---|---|---|---|---|
| A | Track I CRITICAL fix round: effective-runtime feature state split from persisted desired (restart-gated device-sync must NOT be live-enableable; gate rejects until next boot); exact-map classification for transcription-owned `recordings:*` channels + registrar-inventory completeness test; pendingRestart derived from desired-vs-boot-effective union. Findings: docs/specs/2026-07-11-session-state.md §Review 2 | Codex Terra | P0 | pending |
| B | f8f9 r3 completion from WIP `07bafca9` (branch `worktree-agent-ac0072f48aa208937`): schema-v42 DB-enforced discovery provenance (transactional check+tombstone+delete), handler test that manual projects can't be dismissed, NFKC normalizeName, gates | Opus 4.8 | P0 | pending |
| C | c5-phase0 unification: WIP `9e866517` + rescued suites (`hidock-device-scan-c5`, `jensen-device-queueing-c5`, committed tonight on `worktree-agent-af8263443997a87c2`) → one gated commit of the characterization suites | Opus 4.8 | P1 | pending |
| D | F15 boot freeze (30s+ Not Responding): per-boot-task duration capture in BootScheduler, chunk/yield meeting-wiki-backfill off the main thread's critical path, never run calendar sync concurrently with boot tasks, ECONNRESET backoff in syncCalendar | Codex Terra | P1 | pending |
| E | F13 incremental calendar sync: delta/changed-since (M365 calendarView delta where supported) + content-hash skip so unchanged events never touch DB/UI, chunked+yielded processing, visible "last synced / N changed" status | Opus 4.8 | P1 | pending |
| F | Desktop suite: fix the 104 legacy test failures (test_transcription_module mocks, test_version exports, etc.), keep 1234 passing green, then re-enable a desktop pytest CI job (windows-latest, py3.12) | Codex Terra | P2 | pending |
| G | Electron suite Linux-clean: fix the 22 test files with platform-specific assumptions (trusted-root exe resolution, path handling) so ubuntu passes; then add ubuntu to the CI test-electron matrix | Opus 4.8 | P2 | pending |
| H | Small batch (disjoint files): C1 DownloadService "Skipping X" 1300-line spam → one summary line; C4 Chromium USB/Autofill stderr — suppress via launch redirect or document-as-cosmetic decision; D7 vibevoice transcription.test.ts flake (mock runInTransaction + teardown); D8 check-native.mjs `--help` destructive rebuild + app-cycle/cdp source-line help slicing | Codex Terra | P2 | pending |
| I | PR #54 (fresh-boot DB-init crash) adversarial review: verify the two claimed root causes, check whether beta's database.ts/engine.ts still has either bug, produce verdict + recommendation. MERGE STAYS OWNER-GATED | Codex review | P2 | pending |
| J | Python-apps dependency vulns (~15 Dependabot: uv/black group + npm groups in audio-insights) — bump on beta, test-gated | Opus 4.8 | P3 | pending |
| K | F12 spurious project auto-creation gate (org-reconciler.ts:534-552 confidence floor / ≥2-meetings / defer-to-suggestion) — BLOCKED until B integrates (same files) | Codex Terra | P3 | blocked(B) |
| L | I3 Settings Features panel + presets (modular-features spec) — stretch, only if all above land | Opus 4.8 | P4 | pending |
| M | Final: E-walk via CDP on integrated beta (no USB experiments), C/E/D re-scores, ledger close, final push, CI green confirmation | orchestrator | last | pending |

## Waves
1. A (codex) + B (opus) + C (opus)
2. D (codex, after A integrates) + E (opus) + H (codex after D or slotted when codex free)
3. F (codex) + G (opus) + I (codex review slot)
4. J + K (+L stretch)
5. M

## Ledger (append per integration)
- 2026-07-14 ~00:4x — c5 orphan suites rescued to git (pre-plan hygiene). Plan written; adversarial plan review dispatched.
