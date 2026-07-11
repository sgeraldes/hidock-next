# Session State — 2026-07-11 (~11:45 local) — WRAP-UP FOR OWNER REBOOT

**Branch:** `refactor/monorepo-architecture` · **HEAD:** `c6e35353` · main tree CLEAN (this doc's commit is last). Push is hook-blocked — everything local. Dev server STOPPED cleanly for the reboot. Claude subagent session limit exhausted — **resets 4pm America/Buenos_Aires**.

## NEW OWNER DIRECTIVE (2026-07-11 morning — standing role assignment)
- **Execution tasks → Codex agent, model Terra, HIGH effort.**
- **Troubleshooting → Opus 4.8 agents.**
- **Adversarial code review → Codex, Sol 5.6, high** (companion has no model flag — model comes from Codex `config.toml`; earlier Sol/Terra 400-rejections may be fixed by the owner's re-setup; try, fall back to default, report honestly).
- **Fable 5 (this session) → orchestration only** + C/E/D audit passes.

## Landed this morning (all gated: typecheck 0, lint 0 errors, FULL suite green at each step; final 3510 tests / 264 files)
| Commit | What |
|---|---|
| `52797d76` | F6 calendar overlap CASCADE (assignOverlapLanes; owner's "no Outlook shrink" honored — replaced a violating column-split that had grown on main) + F7 full keyboard/ARIA on all event surfaces |
| `bfcbb834` | F8 r2 honest ordinal axis (date ticks, buildTimeScale density binning) + F9 r2 durable dismissal — **SCHEMA v41** (`project_discovery_rejections` tombstone, projects:dismissDiscovered IPC) |
| `fc7eadfe` | F5 final: PixelRAG backfill eligibility IN SQL (json_extract predicates; 520-terminal starvation regression test). F5 SHIPPABLE |
| `618890bc` | B-track close: per-component timeline completion persisted (v2 envelope in sentiment_segments, contentHash reconciliation, no re-bill on remount/restart) + de-NUL timeline-analysis.ts (database.ts still has 1 benign literal NUL SEP — noted for cleanup) |
| `5097e554` | docs: roadmap F5–F11 all marked done + C/E/D re-scores (Calendar 7/3/7, Projects 7/6/8, Context Graph 5/3/7) |
| `9d61970c`+`c6e35353` | **Track I Phase 1** (feature registry, presets, fail-closed IPC gate, gated boot tasks, FeatureRoute/nav enforcement, ~75 new tests) + orchestrator fixup carrying F5's image-capture-backfill into boot-tasks (assistant-owned). Conflict in main/index.ts resolved by taking the gated-registrar side + re-adding the F5 task |

App was restarted after integration; CDP came up (schema v41 applied to the live DB). Full E-walk verification is PENDING post-reboot.

## OPEN FIX ROUNDS (Codex adversarial reviews — both "needs-attention", findings NOT yet fixed)
**Review 1 (f8f9 commit bfcbb834):**
- [HIGH] `projects:dismissDiscovered` deletes ANY project UUID — no server-side discovery-provenance check (renderer visibility is the only guard). Fix: DB-enforced provenance (likely schema v42), transactional check+tombstone+delete, handler test that manual projects can't be dismissed.
- [MEDIUM] tombstone normalizeName lacks Unicode NFKC — composed/decomposed names bypass dismissal.
- **STATE: ~80% done UNCOMMITTED in worktree `.claude/worktrees/agent-ac0072f48aa208937`** (agent died at "Now the v42 contract test"). Modified: projects-handlers.ts, database.ts, entity-normalize.ts, org-reconciler.ts + 5 version-assertion tests. NEXT SESSION: resume agent f8f9 (SendMessage, after 4pm) OR transplant the worktree diff to main and hand completion to Codex Terra. Remaining: v42 contract test + gates + commit.

**Review 2 (Track I 9d61970c):**
- [CRITICAL] restart-gated device-sync can be live-enabled → jensen/device-pipeline IPC callable immediately (gate reads persisted DESIRED config) — violates USB safety. Fix: effective-runtime state separate from desired; gate rejects until next boot.
- [HIGH] transcription-owned recordings:* channels unclassified (transcribe, addToQueue, processQueue, reprocessWith, startTranscriptionProcessor pass through when transcription disabled). Fix: exact-map + registrar-inventory completeness test.
- [MEDIUM] pendingRestart cleared by unrelated toggles. Fix: derive from desired-vs-boot-effective, union.
- **STATE: NOT STARTED.** Worktree `.claude/worktrees/agent-a0ace3cb65ca85b0a` is mid-merge (AA conflicts) — abort/redo the merge or dispatch fresh (Codex Terra on main tree is fine; full brief is in this session's transcript, findings above are complete).

## Pending queue (unchanged unless noted)
1. The two fix rounds above (highest priority — both reviews said no-ship).
2. **c5-phase0** — status UNKNOWN since the earlier session-limit kill; coordinator was reconciling 5 sub-suites/37 characterization tests. Locate its worktree, check `git status`, resume or re-dispatch.
3. **F12** spurious project auto-creation gate — BLOCKED behind f8f9-r3 (same files: org-reconciler).
4. **D7** vibevoice flake harden; **D8 (NEW)** dev-script findings from an accidental Codex mini-review: check-native.mjs `--help` triggers a DESTRUCTIVE rebuild; app-cycle.mjs/cdp.mjs help = source-line slicing. Both filed in roadmap. Good Codex Terra fodder (disjoint files).
5. **I3–I5** per modular-features spec; **PONG E2E** (find the real conversation-create IPC — createConversation was not it; inspect Chat.tsx flow); **final E-walk + C/E/D scores** for Library-list, Today, MeetingDetail, People, Actionables, Assistant, Settings×2, Sync, Titlebar; **board republish** (same URL) + closing ledger. G1 owner-gated.

## Notes / discipline
- The dynamic /loop was STOPPED for the reboot. Re-arm next session: `/loop <the standing backlog-loop prompt>` (verbatim copy lives in this session's transcript; essence = integrate→gates→adversarial-review→fix-rounds→dispatch→C/E/D→board, exit only when all done except G1).
- Transparency: orchestrator ran `git checkout --theirs` once to resolve the index.ts cherry-pick conflict (forbidden-family command; worked as intended, nothing lost — hand-edit conflicts going forward).
- Worktrees of completed lanes (f6f7 a703b2c9…, pixelrag a74d0d7f…, btrack a01d22d5…) are merged into main via cherry-pick and can be cleaned up after the open rounds close.
