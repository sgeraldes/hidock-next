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
- [ ] **H7 (P0)** Meeting/calendar row icons randomly disappear; lists take forever / never load; **Refresh spins with no activity**. Investigate the data-loading / re-render (was likely main-process saturation from transcription — now cancelled; verify + harden).
- [ ] **H8 (P0)** App **randomly auto-navigates to Today** with no input (looks like a full reload resetting the route). Find + stop the unwanted navigation/reload.
- [ ] **H9 (P1 feature)** **Claude Code handover** currently only copies to clipboard / writes a file — build it PROPERLY (a real, usable handoff).
- [ ] **H10 (P1 feature)** **Pluggable AI "brains"**: add official **Claude Code SDK**, **Codex SDK**, **Gemini CLI SDK** as toggleable provider options/add-ons alongside the current Gemini-API-key path, for all in-app LLM work (transcription analysis, summaries, RAG, handover). A provider abstraction + Settings toggle.

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
- [ ] **A1 (P1)** Wire **⌘K** to focus/open the titlebar search (placeholder only today).
- [ ] **A2 (P1)** Notifications 🔔: idle click is a no-op + duplicates the sidebar Operations badge — give it a real popover (recent ops/notifications) and reconcile with the sidebar badge.
- [ ] **A3 (P2)** Activity ⚡: unify open-state with the still-mounted sidebar `ActivityLogPanel` (two entry points, one state).
- [ ] **A4 (P2)** User menu: **About** → a real dialog (version, repo/links); make the **Brand** a clickable "home" affordance (→ Today).
- [ ] **A5 (P2)** Titlebar responsive pass: verify brand/search/cluster at narrow widths + collapsed rail; both themes.

## Track B — Waveform / meeting-timeline follow-ups
- [ ] **B1 (P1)** Marker → transcript **cross-highlight**: clicking a numbered marker (or event-list row) scrolls to + highlights the matching turn / action item in `TranscriptViewer` (refId/onEventClick already surfaced).
- [ ] **B2 (P2)** `useReaderPeople` dedup: a linked-meeting contact who also spoke can get a fallback bar color — align the color key so chip + bar always match.
- [ ] **B3 (P2)** Backfill timeline analysis for already-transcribed recordings on open when markers/sentiment are empty (so existing recordings show the rich timeline without a manual re-analyze).

## Track C — Device / sync bugs (from remaining-bugs.md; verify-then-fix — USB SAFETY)
> Do NOT probe hardware. Fix with mocks/unit tests; verify against logs only.
- [ ] **C1 (P1)** **BUG-R4**: DownloadService "Skipping X: in synced_files" log spam (1300+ lines/sync) → one summary line. (Confirmed live: reconciliation logs seen.)
- [ ] **C2 (P0?)** **BUG-R1/R2/R3/R5**: verify whether the file-list re-scan loop + double auto-sync are already fixed by recent commits; if not, set `autoSyncTriggeredRef` before `listRecordings` + stop emitting 'ready' from the finally block.
- [ ] **C3 (P2)** **BUG-R8** `downloadFile()` no timeout (`jensen.ts:1458`); **BUG-R9** cancel uses 'failed' not 'cancelled'; **BUG-R10** onNewFiles never passed; **BUG-R11** unused `step1Success`.
- [ ] **C4 (P1)** **BUG-R6/R7**: Chromium USB / Autofill stderr noise — suppress via launch redirect or accept as cosmetic (document the decision).
- [ ] **C5 (arch)** **BUG-R13 / DevicePipeline**: collapse scattered device-action policy gates into one coordinator (big; scope + spec first, don't rush).

## Track D — Test / infra hygiene
- [ ] **D1 (P1)** `src/services/__tests__/hidock-device.test.ts` vitest **worker-teardown race** ("Closing rpc while onUserConsoleLog pending") — quiet teardown logging or isolate that file's pool so the full suite is 0-error.
- [ ] **D2 (P2)** Address the 122–125 pre-existing eslint warnings (unused caught errors, no-useless-escape) incrementally.

## Track E — Cross-surface audit loop (expands this list)
Dogfood each un-hardened surface, file findings back here, fix, re-walk:
- [ ] **E1** Calendar · **E2** Context Graph · **E3** Projects · **E4** Explore · **E5** Settings · **E6** Actionables · **E7** Sync/Device · **E8** Assistant/RAG
- Per surface: clickability / editability / discoverability + liveness + hierarchy; log new items as F-series.

## Track F — Discovered during audit (append as found)
- _(populated by the audit-loop agent)_

## Track G — Security / release (owner-gated)
- [ ] **G1** Promote the Dependabot security fix (0-vuln) from this branch to `main` — **owner's call** (QA-first policy; do not push to main unprompted).

---

### Working order (tonight)
1. Audit loop (E) in parallel to expand the backlog → append to F.
2. Safe, high-value, low-risk first: A (titlebar polish), C1/C4 (log noise), D1 (flaky test).
3. Then B (timeline follow-ups), C2/C3 (device bugs, verify-first).
4. Architectural (C5 DevicePipeline) scoped last — spec before building.
5. G1 held for the owner.
