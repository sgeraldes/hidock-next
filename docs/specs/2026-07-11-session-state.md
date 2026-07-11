# Session State — 2026-07-11 (~10:30 local) — for post-compact resume

**Branch:** `refactor/monorepo-architecture` · **main HEAD at save:** run `git log --oneline -1` (last known: PixelRAG r2 pick on top of `abb9c464` lineage; ~35 commits today). Push is hook-blocked — everything local. Dev app runs via tracked bg shell + CDP :9222 (`scripts/dev/cdp.mjs`, `app-cycle.mjs`).

## The operating loop (owner-ordered, MUST continue until done)
Dynamic /loop, heartbeat via ScheduleWakeup 1500s, prompt re-arms itself. Per iteration: collect agent/Codex reports → cherry-pick to main + independent gates (typecheck 0, lint 0 errors, FULL suite green ~3390+) → `/codex:adversarial-review` on EVERY integrated diff (companion: `node C:/Users/Sebastian/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs adversarial-review --base <sha>`, background) → route findings back to the SAME agent via SendMessage (resume by name) → dispatch next backlog items as surfaces free. After every landed feature: re-score touched surfaces in `docs/specs/interaction-index.md` (C/E/D, pixel evidence) in the same commit as the roadmap mark. Keep `docs/specs/2026-07-10-nightly-roadmap.md` + the status-board artifact (republish same URL: https://claude.ai/code/artifact/03cc2ab4-93f8-4684-b8e5-e54b78bc2c38) current.
**EXIT CONDITION (only):** every roadmap item done except owner-gated G1 + interaction index fully scored + final board republished → ScheduleWakeup stop:true + closing ledger.

## Agents IN FLIGHT at save (all resumed post-session-limit-reset with state-aware instructions; they report to "main" via SendMessage)
| name | state | what's left |
|---|---|---|
| **f6f7** | gates were GREEN (3391), work uncommitted in tree | commit + final report (Calendar collision cascade — NO Outlook shrink per owner — + a11y) |
| **f8f9** | mid round-2, durable project_discovery rejection work in tree | finish lens honest copy + axis ticks + spacing floor + manual-empty state; possible SCHEMA bump |
| **features-i2** | mid renderer enforcement | Layout nav filtering/graying, FeatureDisabledPage, preset dropdown, tests (Track I Phase 1; zero behavior change under 'full') |
| **btrack** | final-micro + must explain a "NULs in committed blobs" discovery | persist success-empty per-component analysis state + remount test → closes B-track arc |
| **pixelrag** | one last HIGH | SQL-side eligibility (json_extract on metadata) or keyset cursor for the 500-row scan cap; >500-terminal regression test → F5 shippable |
| **c5-phase0** | 5 sub-suites done (37 tests), coordinator reconciling | unified gates + single commit (characterization net; 3 KNOWN-ODD discoveries incl. filelist-guard race) |

## Integration recipe (per report)
`git cherry-pick -x <sha>` from repo root → `cd apps/electron && npm run typecheck` (0) → targeted vitest suites → adversarial-review in bg → roadmap/index docs commit (use python one-liners from repo root; watch cwd resets — Bash cwd drifts). Worktrees: agents ff/plain-merge main HEAD themselves. New-worktree gotcha: junction node_modules for apps/electron AND packages/database (DB shim needs it). Hook gotcha: never write the words "kill"/"task""kill" in Bash strings/commit messages. Commit with `SKIP_TESTS=1 git commit` (never --no-verify).

## Pending queue after in-flight lanes close
1. Integrate all 6 lanes + their closing reviews (fix rounds if findings).
2. **F12** — spurious project auto-creation gate (org-reconciler ~534-552; may be partly covered by f8f9's rejection work — check).
3. **I3–I5** — Settings features panel + connector unification (GitHub gap!) + perf-meter + opt-in telemetry, per `docs/specs/2026-07-11-modular-features-spec.md` phases.
4. **D7** — transcription.test.ts vibevoice flake hardening.
5. **PONG E2E completion** — chat through claude-code/codex live: rag.chatLegacy needs a REAL conversation id; find the conversation-create IPC in preload (api.rag.* — createConversation wasn't it; inspect Chat.tsx's flow), then setEnabled+setDefault claude-code → expect PONG-CLAUDE (proves the fixed multi-hop routing); restore gemini-api default + disable agentic brains after.
6. **Final activation restart** (feature registry boot gating + PixelRAG backfill task are main-process) → verify live → final C/E/D scores for remaining surfaces (Library-list, Today, Calendar, MeetingDetail, People, Assistant, Settings, Sync, Titlebar rows still unscored) → republish board → closing ledger.

## Key facts/decisions tonight (don't re-litigate)
- Sol/Terra/sol-5.6 models REJECTED on ChatGPT-account Codex (400) — use default model; owner knows.
- CPU spike RESOLVED (74%→5-15%): 3 orphaned vite servers (deleted --config busy-loop), stopped via devproc; tsserver PID 56256 flagged to owner (editor restart reclaims a core); D5 lesson in roadmap.
- better-sqlite3 dual-ABI SOLVED: scoped vi.mock in src/test/setup-db.ts (main-db vitest project) + unmocked ABI smoke test; full suite green since.
- B-track arc: content-hash revision keys, structured errorKind (auth/quota/rate-limit/network/invalid-input/unknown) from timeline-analysis, timer-free retry-on-reopen, parseRetryAfter clamped 15min.
- Owner wants: adversarial review after EVERY loop (memory: feedback-codex-sol-track-c); C/E/D index updated per feature (docs/specs/interaction-index.md); Track I vision (memory: project-modular-features-vision).
- Device stack: byte-boundary settlement, quarantine + generation-owned bounded auto-reconnect, durable cancel_reason (schema v40), teardownInProgress refcount. Schema now v40.
- 6 AI brains live (gemini-api default; claude-code/codex login-first verified; kiro-cli login-first via whoami; trusted-roots exe resolution). H9 handover shipped (opaque bundle ids, revalidate-before-spawn, cwd threading).

## Verification norms
Live-verify visible changes via CDP screenshot; DOM-measure layout claims; never claim done without evidence. Restart = stop via app-cycle.mjs, `npm run dev` in tracked bg shell from apps/electron, wait CDP, verify.
