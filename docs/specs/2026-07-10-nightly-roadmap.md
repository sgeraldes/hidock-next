# Nightly Roadmap — 2026-07-10

Autonomous overnight backlog. Worked one/two agents at a time (low system
footprint — transcription queue paused, no needless app restarts). Each item:
build in an isolated worktree → gate (typecheck/lint/targeted tests) → cherry-pick
onto the branch → dogfood when it's a visible change → mark done → next.

Legend: **P0** blocking · **P1** quality/noise · **P2** polish/nice-to-have.

---

## Track H — URGENT owner feedback (2026-07-10 late) — DO FIRST
- [x] **H1 (P0)** STOP transcriptions — DONE (cancelled; queue empty; frees the main process).
- [x] **H2 (P0)** Waveform must **MATCH THE MOCKUP**: colored bars + a sentiment curve on a subtle gradient panel + **numbered circular markers sitting ON the curve** + the event list below. — DONE (`e5c6807d`): WaveformPlayer full mode rebuilt to the approved composition (gradient stage panel, ＋/－ axis labels, markers-on-curve, bright playhead + play-zone, per-speaker bars, time axis, cross-linked event list). Verified live via HMR screenshot.
- [x] **H3 (P0)** Action items are **DUPLICATED** — shown in the timeline event-list AND again in the transcript/summary. — DONE (`e5c6807d`): action items now have ONE home (the timeline event-list); TranscriptViewer rendered with `showActionItems={false}`.
- [x] **H4 (P1)** **REMOVE the on-hover checkbox** from library rows entirely (no reveal-on-hover). — DONE (`f1db2204`): `SourceRow` renders no checkbox in any state; props kept for caller compat; tests rewritten (15/15).
- [x] **H5 (P0)** Kill the ugly **"Loading waveform…" overlay**. Generate peaks ONCE, **CACHE ON DISK**, load instantly. — DONE (`e5c6807d`): new `waveform-cache.ts` (+IPC+preload) stores one JSON per recording at `<userData>/cache/waveform/<id>.json`; `useAudioPlayback` loads from cache first (no loading state), computes+persists on miss; half-drawn overlay replaced by a clean "Preparing waveform…" placeholder. ⚠️ cache/IPC is main-process — needs app restart to activate.
- [x] **H6 (P0)** **"Transcript not available" + no-color waveform** when selecting via sidebar Library nav. — DONE (`e5c6807d`): SourceReader fetches the transcript directly (`transcripts.getByRecordingId`) as a fallback → feeds speaker-range colors AND the viewer, so both render on first paint regardless of selection path.
- [x] **H7 (P0)** Meeting/calendar row icons randomly disappear; lists take forever / never load; **Refresh spins with no activity**. — DONE (`eeed308d`): the P0 root cause was a synchronous ~1878-meeting calendar-sync upsert blocking the main event loop; now chunked (200/txn) with `yieldToEventLoop()`, plus a 60s device-fetch timeout so a hung read can't leave Refresh spinning. Verified live: list icons render, no phantom spin.
- [x] **H8 (P0)** App **randomly auto-navigates to Today** with no input (full reload resetting the route). — DONE (`eeed308d`): `routePersistence` records the active route to sessionStorage and `RootRedirect` restores it after a background reload instead of snapping to Today. Verified live: the app held `#/library` through a full dev-server restart.
- [x] **H9 (P1 feature)** **Claude Code handover** — SHIPPED (2bb00e7a + 3 hardening rounds → 743b9810): a real handover BUNDLE (HANDOVER.md + transcript + summary + action-items + decisions + manifest) written into the target repo, plus in-app agentic run via the brains seam (opaque bundle ids, canonical+revalidated paths, home-dir guard, atomic allocation, real cwd, threat-modeled residual documented). Fallbacks (copy/terminal) kept. Dialog on Actionables + Today.
- [x] **H10 (P1 feature)** **Pluggable AI "brains"** — **SHIPPED + LIVE-VERIFIED** (Settings → AI Brains screenshot on the running app). Delivered: `AIBrain` abstraction + `BrainRouter` (capability-guarded routing, Gemini-first/Ollama-fallback preserved) · encrypted per-brain credential vault (closes the plaintext-key gap; atomic + self-healing sync) · **5 registered brains** — Gemini (API), Ollama, **Claude Code**, **Codex**, **Gemini CLI** (headless CLI adapters: win32 PATH/PATHEXT + cmd.exe shim exec, stdin prompts, output byte-caps, confirmed process-tree teardown, honest auth probes) · Settings panel with enable toggles, Default radio, live auth badges. Hardened through 4 Codex adversarial rounds (`5d805f00`→`c12cb8c3`→`2f8a736d`/`ea021bc5`/`35131024`→`7bb544fb`→`ed20544e`→`17c99eef`). Remaining: route more call sites through non-default brains as they're enabled (follow-on), H9 handover builds on this seam.

### H11–H14 — Titlebar #138 (2026-07-11 owner feedback) — DONE (`70d9715a`; solid `#0f1626` bar, h-14/56px + overlay synced, grouped cluster, full-width divider). ⚠️ needs app restart for the native-gutter height/color to show.
- [x] **H11 (P1)** **Gradient clashes with the flat native window buttons.** Remove the titlebar gradient → solid dark bar, AND set Electron `titleBarOverlay.color` to that same solid so the native-controls gutter blends. No seam. (Or, rejected alt: give the window buttons a matching gradient — we chose SOLID.)
- [x] **H12 (P1)** **Bar too short.** `h-10` (40px) → taller (~`h-14`/56px) to fit the two-line "Meeting / Intelligence" logo + buttons like the mockup. Must bump `titleBarOverlay.height` in `electron/main/index.ts` to match (needs app restart to take effect).
- [x] **H13 (P1)** **Right-cluster icons (bell/activity/cog/device/user) too condensed / uniformly spaced / badly placed.** Give proper rhythm: group the three icon-buttons, larger gap before the device pill, then the user menu; align on one baseline; both themes.
- [x] **H14 (P1)** **No line under the window controls.** The bottom divider stops before the native-controls gutter (`pr-[138px]` in `Layout.tsx`) → extend it FULL width so one continuous line separates the whole bar (incl. under — ▢ ✕) from the app.

### H15–H16 — Chrome placement (2026-07-11 owner, REPEATED complaints) — DONE + TRIPWIRED
- [x] **H15** **Activity Log must NOT be in the sidebar** (it's already the titlebar ⚡ button). — DONE (`a5132b5a`): removed the sidebar entry point; **deleted** `ActivityLogPanel.tsx` + test. TRIPWIRE: if a sidebar Activity Log ever reappears, remove it — the titlebar is the single owner.
- [x] **H16 (= D10)** **Collapse button in the WRONG place** (was sidebar top-right corner). Owner: "IT GOES IN THE MIDDLE OF THE SIDEBAR, VERTICALLY, MID-RIGHT." — DONE (`529bcdae`): moved OFF the titlebar onto the sidebar's right border, vertically centred at mid-height. TRIPWIRE: it must stay mid-right on the sidebar edge, never the top corner / titlebar.

### H17 — Library list layout ("for the millionth time", R144–R156) — RESOLVED + DOM-VERIFIED
Owner's four complaints (images #119–121) — all confirmed fixed via live DOM measurement (2026-07-11), evidence not just a claim:
- [x] **No horizontal scroll** — sources scroller `scrollWidth-clientWidth = 0`.
- [x] **No excess left padding** — title starts 12px from row edge; the old checkbox+status-icon left gutter (~44px) is gone (checkbox removed in H4 `f1db2204`; status icons moved to the RIGHT cluster).
- [x] **Icons on the left moved right** — `SourceRow` status/meeting icons live in the right cluster, one baseline.
- [x] **Separators reach both edges** — `border-t` on the full-width (100%) row wrapper measures `rowLeft==listLeft (224)` and `rowRight==listRight (561)` → `spansFullWidth: true`.
TRIPWIRE: the sources list must never horizontally scroll and its row separators must span the full panel width (no left/right inset). Verify with a DOM measure, not eyeballing, if re-touched.

## Track A — Titlebar / chrome polish (agent-flagged gaps)
- [x] **A1 (P1)** Wire **⌘K** to focus/open the titlebar search. — DONE (`022de7a7`): ⌘K/Ctrl+K keydown focuses+selects the titlebar search (guards against stealing focus from other fields/modals).
- [x] **A2 (P1)** Notifications 🔔 real popover. — DONE (`022de7a7`): NotificationsButton with a recent-ops popover.
- [x] **A3 (P2)** Activity ⚡ unify open-state. — DONE (`022de7a7` + `a5132b5a`/H15): the titlebar ⚡ owns the single overlay; the sidebar ActivityLogPanel was removed entirely, so there is one entry point + one state.
- [x] **A4 (P2)** User menu **About** dialog + **Brand** = home affordance. — DONE (`022de7a7`): About dialog in the UserMenu; Brand has an `onHome` → navigate('/today').
- [ ] **A5 (P2)** Titlebar responsive pass: verify brand/search/cluster at narrow widths + collapsed rail; both themes.

## Track B — Waveform / meeting-timeline follow-ups
- [x] **B1 (P1)** Marker → transcript cross-highlight — DONE (`a246ca8e` pick): marker/event-row click scrolls the matching turn centered + 1.6s pulse (reduced-motion honored), keyboard-activatable.
- [x] **B2 (P2)** Reader-people color-key dedup — DONE: labelColorKey maps every diarization label to its representing chip key; chip swatch and bars always match.
- [x] **B3 (P2)** Timeline backfill on open — DONE: existing backfill now guarded once-per-recording-per-session (no re-run churn on legitimately-empty recordings).

## Track C — Device / sync bugs (from remaining-bugs.md; verify-then-fix — USB SAFETY)
> Do NOT probe hardware. Fix with mocks/unit tests; verify against logs only.
- [ ] **C1 (P1)** **BUG-R4**: DownloadService "Skipping X: in synced_files" log spam (1300+ lines/sync) → one summary line. (Confirmed live: reconciliation logs seen.)
- [x] **C2** **BUG-R1/R2/R3/R5** — DONE via Codex + 5 hardening rounds (latch-before-list + reset-on-failure; conditional terminal scan status). **BUG-R1/R2/R3/R5**: verify whether the file-list re-scan loop + double auto-sync are already fixed by recent commits; if not, set `autoSyncTriggeredRef` before `listRecordings` + stop emitting 'ready' from the finally block.
- [x] **C3** — DONE via Codex + hardening (byte-boundary settlement, quarantine + generation-owned bounded auto-reconnect, durable cancel_reason v40, age-based prune). **BUG-R8** `downloadFile()` no timeout (`jensen.ts:1458`); **BUG-R9** cancel uses 'failed' not 'cancelled'; **BUG-R10** onNewFiles never passed; **BUG-R11** unused `step1Success`.
- [ ] **C4 (P1)** **BUG-R6/R7**: Chromium USB / Autofill stderr noise — suppress via launch redirect or accept as cosmetic (document the decision).
- [ ] **C5 (arch)** **BUG-R13 / DevicePipeline**: collapse scattered device-action policy gates into one coordinator. — **SPEC DONE** (`docs/specs/2026-07-11-device-pipeline-spec.md`, via Codex; 18 cited commits independently verified). KEY FINDING: an additive-but-inert Phase-2 `device-pipeline.ts` (+instance, IPC, hook, tests; commits 0212ca3e/177419db/4fabe72c/015012b2) ALREADY EXISTS — the spec's plan is to harden + activate it behind a flag (phases 0–6, each with rollback), not build greenfield. Next: Phase 0 characterization tests after owner reviews the spec.

## Track D — Test / infra hygiene
- [ ] **D1 (P1)** `src/services/__tests__/hidock-device.test.ts` vitest **worker-teardown race** ("Closing rpc while onUserConsoleLog pending") — quiet teardown logging or isolate that file's pool so the full suite is 0-error.
- [ ] **D2 (P2)** Address the 122–125 pre-existing eslint warnings (unused caught errors, no-useless-escape) incrementally.
- [ ] **D3 (P1) — ACTION ITEM (infra, caused by tonight's dev-server restart).** The 19 DB-dependent vitest files (~141 failures) fail with `better-sqlite3` **NODE_MODULE_VERSION 140 vs 147** ABI mismatch: `node_modules/better-sqlite3` is built for the running Electron app (ABI 140), but Node-based vitest needs ABI 147. Proven pre-existing to the brains change (identical failure set on `77b7354b` before cherry-pick). Dual-ABI conflict — one build can't satisfy both. FIX OPTIONS: (a) mock `@hidock/database`/`better-sqlite3` in the DB tests so they're ABI-independent (best); (b) a test script that `npm rebuild better-sqlite3` for Node before the suite + electron-rebuild after; (c) run DB tests only in CI with the app not running. **Do NOT rebuild for Node while the app is being dogfooded — it breaks the running app's DB on its next restart.** Non-DB suites (brains, layout, waveform, etc.) are unaffected and green.

- [ ] **D4 (P2) — flake watch.** Chat.test.tsx failed ONCE (1-in-4) when run combined with src/components/assistant immediately after cherry-pick 215fbbda under heavy parallel-agent load; 4 subsequent runs (single + 3x combined) all green. Suspect the timing-sensitive ResizeObserver/font-size test. Repro: `npx vitest run src/pages/__tests__/Chat.test.tsx src/components/assistant` in a loop under load. If it recurs, deflake the observer test (fake timers / explicit flush), do NOT skip it.

## Track E — Cross-surface audit loop (expands this list)
Dogfood each un-hardened surface, file findings back here, fix, re-walk:
- [ ] **E1** Calendar · **E2** Context Graph · **E3** Projects · **E4** Explore · **E5** Settings · **E6** Actionables · **E7** Sync/Device · **E8** Assistant/RAG
- Per surface: clickability / editability / discoverability + liveness + hierarchy; log new items as F-series.

## Track F — Discovered during audit (append as found)
- [x] **F1 (P1, owner-reported 2026-07-11, img #142)** **Projects → Identity suggestions: every KEEPS/ALIAS row shows "Couldn't check transcripts."** — DONE (`af08ffd7`). ROOT CAUSE: renderer queue-starvation — the hook fired one 5s-timeout mention lookup per pending suggestion of EVERY kind in one Promise.all against a serial sql.js queue (~178ms each, ~125s total); low-confidence project suggestions sort to the tail → all timed out → cached error. FIX: kind-scoped fetches + concurrency cap 6. LIVE-VERIFIED: 69× error → 0 on /projects (5 real-evidence + 64 neutral). On the Projects merge/identity-suggestions panel ("N names may be X: … (67%)"), each suggestion card (both the KEEPS project and each ALIAS candidate) renders an amber "Couldn't check transcripts" warning — systematic, not occasional. Likely the transcript-evidence check for PROJECT-entity merge suggestions is erroring or querying the wrong table/id (works for people/speaker identity, fails for projects). Investigate the project-suggestion transcript lookup (identity-discovery / suggestions handler) — is it calling a transcripts query that throws or returns empty for project entities? Fix so it shows real transcript evidence (or hides the line when genuinely none), not a blanket error. Verify live on the Projects page.

### F2–F5 — Assistant × Brains × RAG (owner questions 2026-07-11, img #142) — honest answer was "not thoroughly checked"
- [x] **F2 (P1)** **Assistant placement matrix dogfood + overlay layout bug.** — DONE (`ec0296c0`). ROOT CAUSE: GlobalAssistant renders the full desktop Chat page inside the 22rem overlay; Chat had a fixed 256px history sidebar → chat column crushed to ~96px. FIX: Chat is now @container-responsive (sidebar → History drawer below @lg, compact header, truncate+hide caption). Matrix walked: floating L/R were broken (now fixed), embedded L/R were fine. LIVE-VERIFIED post-HMR on /today. Owner's screenshot shows the FLOATING overlay rendering the Chat squeezed into a broken two-column layout (page content bleeding behind, send column crushed to ~80px with wrapped caption text). Walk ALL four combos — floating/embedded × left/right — fix the overlay layout, verify pin-to-embed and collapse behaviors, both themes, live via CDP.
- [ ] **F3 (P1)** **Assistant E2E with EACH brain.** Prove a chat actually routes through the selected default brain: enable Claude Code / Codex / Gemini CLI one at a time, send a real prompt from the Assistant, verify the reply came from that brain (and that failures degrade honestly). Revert default to Gemini afterward. Nobody has verified the router→agentic-brain path from the UI.
- [ ] **F4 (P1)** **Brains awareness of RAG + Context Graph.** Today rag.ts injects only 1-hop neighborhoodFacts when the message literally names an entity (rag.ts:314-318) — verify that context actually reaches whichever brain is selected, then DEEPEN: graph facts for implicit references, meeting/project scoping, and document the context budget per brain.
- [ ] **F5 (P2 feature)** **PixelRAG** — image/screenshot retrieval into assistant context. Clipboard screenshots + image captures exist as artifacts but are NOT in the vector store and can't be retrieved by the RAG (0 image/vision references in rag.ts / vector-store.ts). Design: OCR/vision-index image captures (Gemini API brain has vision), embed the extracted text, retrieve alongside transcript chunks, and let the assistant cite the source image.

## Track G — Security / release (owner-gated)
- [ ] **G1** Promote the Dependabot security fix (0-vuln) from this branch to `main` — **owner's call** (QA-first policy; do not push to main unprompted).

---

### Working order (tonight)
1. Audit loop (E) in parallel to expand the backlog → append to F.
2. Safe, high-value, low-risk first: A (titlebar polish), C1/C4 (log noise), D1 (flaky test).
3. Then B (timeline follow-ups), C2/C3 (device bugs, verify-first).
4. Architectural (C5 DevicePipeline) scoped last — spec before building.
5. G1 held for the owner.
