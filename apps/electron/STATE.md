# STATE.md — Session Handoff & Master Todo

*Written 2026-07-09 ~00:30 (end of the 2026-07-08 marathon session) for memory
compaction. THE definitive "where are we" — supersedes stale statuses in other
docs. Companions: ROADMAP.md (audit ledger + coverage map), INTELLIGENCE.md
(architecture + definitions), CONNECTORS.md (connector design), RETRO.md
(process retrospective), OVERNIGHT_PLAN.md (session issue log), GOAL.md
(mission + method).*

## 0. CURRENT STATE — 2026-07-10 ~03:10 (READ THIS FIRST, supersedes below)

**HEAD `2c1023cb`, schema v38, all pushed. better-sqlite3/WAL engine.
Suite **2603 passing / 0 fail** (independently re-run after each of the 4
merges: library, badge, bundling+status, ctxgraph, shell-chrome). ALL THREE
overnight UI agents + bundling LANDED. Only wer-hybrid-spike (docs) still out.
NOTE: shell-chrome forced a renderer full-reload (new Layout exports) → device
pill briefly shows "Connecting…"; that's renderer-only (main/USB NOT restarted),
clears on next status sync or the pending restart. Do NOT touch USB. IMPORTANT: after cherry-picking any
knowledge-graph SOURCE change, `cd packages/knowledge-graph && npm run build`
(tsup) — the electron app resolves @hidock/knowledge-graph via the junctioned
package's `dist`; stale dist = stale graph behavior.
NOTE: main-process changes need an app RESTART; renderer arrives via HMR.
RESTART PENDING to activate (bundle into ONE restart, not mid-meeting — dock =
live call audio):
  1. library `recordings:backfillDurations` (durations NULL until it runs).
  2. status SELF-HEAL (healRecordingStatusFromTranscripts, auto at boot) — fixes
     the "Not transcribed over a real transcript" data drift across all rows.
  3. misbundle repair IPC (`repair:previewMisbundled` dry-run → `repair:applyMisbundled`
     {confirm:true}) — GATED, run preview first, apply on user OK to heal the
     recurring "Engineering EDF team 1" cross-month bundle.
  4. contextGraph:* IPC (node inspector edit/merge/convert/locate).
Then run the dogfood + impeccable walk on Library, Context Graph, MeetingDetail,
and (once shell-chrome lands) the shell at 3 widths × 2 sidebar states.**

### DEV/ABI GOTCHA (critical): the on-disk `better-sqlite3` binary is the
ELECTRON ABI (the running app holds it). So:
- Run vitest via: `cd apps/electron && ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe node_modules/vitest/vitest.mjs run <files>`. Plain `npm run test:run`/`npx vitest` under system node fails with ~71 native-ABI errors — NOT real failures.
- After any `npm install` touching better-sqlite3: `npx @electron/rebuild -f -w better-sqlite3` for the app to boot; check-native.mjs swaps back to Node ABI for tests.
- typecheck (`npm run typecheck`) is safe under system node.

### AGENTS IN FLIGHT (they seed from stale `main` 89cb03ac and MUST ff to the branch tip; VERIFY base in their report; CHERRY-PICK their commit onto current HEAD since HEAD advances, don't ff-merge):
- **transcription-queue-backend** (a8bf67156cc864a93, base 46a60644): complete the
  dock's deferred backend — real queue PAUSE/RESUME (pause stops dequeue; in-flight
  finishes) + real REORDER so prioritize/deprioritize changes actual processing
  order (not just the renderer view); new transcription:pause/resume/reorder/
  queueState IPC; enable the OperationsPanel Pause button. Owns transcription.ts,
  a transcription IPC handler + handlers.ts + preload, useTranscriptionStore.ts,
  OperationsPanel.tsx. On land: cherry-pick + gates.
- **wer-hybrid-spike** (aced5f54d46abb8af): RESEARCH doc — still out; send WER to user.
- ~~**ctxgraph-affordances**~~ **DONE — landed `cf82c1dc`** (cherry-picked 1f2f3d8a;
  package rebuilt; 2574 green): NodeInspector panel — linked-contact vs
  extracted-name badge, what-this-is card (role/org/#meetings/first-last-seen/
  aliases/pronouns/provenance), clickable source rows → MeetingDetail/PersonDetail,
  Rename-as-correction (propagates via entity:contact-changed), To-contact,
  Set-identity (MergeIntoDialog), Pronouns, Locate, Merge (blast-radius preview),
  Remove. Deferred: bulk multi-select; pronouns not promoted to contact record
  (no column); name-only rename doesn't rewrite historical transcript text.
  Original brief (Context Graph clickability/editability/discoverability):
  Node detail = what-each-person-IS (role/org/#meetings/aliases/provenance);
  RENAME as a CORRECTION ("Jiarabi"→"Yaraví" propagates everywhere, He/Him);
  convert name-only node → real contact (manual tier); clickable source line
  → MeetingDetail; locate/focus-node; merge-two-nodes (blast-radius preview);
  remove/hide. MUST reuse existing entity-resolver + contacts merge UI, not a
  parallel system. Owns ContextGraph.tsx + components/context-graph/** +
  packages/knowledge-graph + graph IPC (+ shared handlers.ts/preload this wave).
  Based on `4d200e9f`. Do NOT touch Library/database SCHEMA_VERSION.
- ~~**bundling-rootcause**~~ **DONE — landed `93eaf392`** (2574 green). VERDICT:
  months-apart bundle = STALE DATA, not a live bug (regression test proves
  current fit-based binding is correct). Shipped: status write-side fix +
  auto boot self-heal; GATED misbundle repair (preview→apply confirm:true);
  NUL-byte delimiter hardening. Badge display fix already landed (3f45bc74).
  ACTION: run repair:previewMisbundled after restart, apply on user OK.
  Original brief (months-apart
  bundling — a recurring Teams meeting ("Engineering EDF team 1", May 27) has 4
  recordings incl. a July-1 Rec09. Root-cause recurring-OCCURRENCE resolution
  (recording bound to anchor occurrence not the date-matching one) + the
  status-drift write-side (status stays 'none' with a transcript → resolveRecordingId
  target). Live-bug-vs-stale-data verdict first; fix logic + GATED repair
  (reports count before rewrite) + idempotent status self-heal. Owns database.ts,
  transcription.ts, org-reconciler.ts, calendar-utils.ts, recording-match-scoring.ts
  + repair IPC. MAY own v39 if needed (ctxgraph/shell told NOT to bump).
- ~~**shell-chrome**~~ **DONE — landed `2c1023cb`** (0ce767bd; 2603 green; live-
  verified via CDP: A1 divider edge-to-edge, A2 identity in sidebar-width cell
  w/ border-r continuity + dropped subtitle, A3 collapsed rail centered on 32px
  axis, counters Today=3/Actionables=99+/Sync=hidden, dock collapse+overlay).
  DEFERRED BACKEND (need main-process + IPC, not faked): real transcription
  PAUSE/RESUME (transcription.ts + channel); real queue REORDER (prioritize now
  reorders renderer view/intent only); true pop-out OS window; Activity-Log
  entries carry no source ref → not yet clickable.
  Original brief (renderer-only shell): divider-not-reaching-right, identity
  straddling the sidebar seam, collapsed-rail centering/alignment to titlebar
  (one shared left-gutter grid). Nav COUNTERS on Today/Actionables/Sync (from
  existing stores, no IPC). Make the bottom Transcriptions/Activity-Log dock
  (OperationsPanel) collapsible+expandable + per-item observability (what it is,
  go-to-meeting, prioritize/deprioritize; pause only if store supports it).
  Owns src/components/layout/{Layout,TitleBar,OperationsPanel}.tsx + a UI store
  for dock state. MUST NOT touch preload/handlers/*-handlers.ts (2 other agents
  edit those), transcription.ts, or the ctxgraph/library/bundling files.
- ~~library-redesign~~ **DONE — landed `4d200e9f`** (cherry-picked from ad1642b9,
  gates re-run green 2558/0): dockable AI assistant (2-pane default), multi-
  format rows (image=type+date not duration), simplified filters + source-type
  segmented control + working duration filter/sort, list-search relabelled
  (de-dup vs global), duration backfill IPC (NULL 1903/1911 — needs RESTART to
  populate), honest Quality empty-state + narrow low-value classifier,
  responsiveness (dropped max-w-4xl). NEEDS restart-verify + dogfood walk.
- **wer-hybrid-spike** (aced5f54d46abb8af): RESEARCH — WER comparison Gemini-only vs hybrid (local VAD/turn chunks→Gemini) vs full-local WhisperX vs top Spanish model (Canary-Qwen 2.5B / ARK-ASR-3B). USER CARES: Gemini Spanish WER is reportedly MUCH better than WhisperX, so we do NOT just switch to local — test the hybrid. Heavy GPU + web-leaderboard research; produces docs/experiments/wer-hybrid-spike.md + side-by-side transcripts for the user to judge. **USER ASKED: send them the WER results when in.**
- ~~responsive-layout~~ DONE (4437b001): wide-window dead-gutters fixed on
  non-Library pages via shared src/lib/pageLayout.ts (pageContent/pageWide/
  proseMeasure); Today now 2-col at 2xl. Needs a restart-verify at 800/1280/
  2200 widths (per dogfood B8) — do this on the next restart.

### QUEUED (dispatch after library-redesign frees Library/database files):
- **Merge "Correct" mode + transcript entity-linking**: distinguish ALIAS
  (valid alt name) from CORRECTION (ASR error like Noman→Nouman → find-replace
  the wrong form across transcript text, don't keep as alias); + mentions of
  known people in transcript BODY become clickable EntityMentions. Shares
  database.ts + TranscriptViewer — sequence after redesign.
- **Speaker-intelligence Wave C**: unlink cascade (provenance reset + dirty
  rebuild), recording SPLIT tool (one .wav → N logical segments for the
  meeting-switch-mid-recording case), re-attribution post-process (LLM
  cross-checks candidate parallel meetings after summary, auto-place best or
  make ad-hoc). Reversible/journaled.
- **Wave D (GATED on explicit user OK — destructive):** repair Memo↔Luis
  mis-identity (unmerge), + bulk re-attribution re-run over existing polluted
  data (rewrites participant lists — DB-checkpoint first).

### NEW BUGS FOUND (not yet fixed):
- **Explore global search FAILED** (2026-07-10 screenshot): "Search failed /
  Global search failed", 0 results. The whole Explore/global search is broken
  — investigate the search IPC/handler. HIGH: it's the app's global search.
- Quality never auto-classified (900 unrated) → no value/personal tags.
- quality-assessment.ts apparently never wrote ratings — root-cause.
- Pre-existing flaky `hidock-device.test.ts` EnvironmentTeardownError under
  full-suite parallel load (passes in isolation) — quiet its teardown logging.
- ~135 eslint warnings; apps/electron has NO eslint config.
- **knowledge-graph PACKAGE tests broken + ungated** (found 2026-07-10): after
  the better-sqlite3 migration, `@hidock/database` engine REQUIRES
  `config.betterSqlite3` (engine.ts throws "betterSqlite3 is required";
  `initSqlJs` is vestigial). But `packages/knowledge-graph/tests/*.test.ts`
  (lens/etc.) still build `new DatabaseEngine({ initSqlJs })` → throw. They run
  via the package's own `vitest run`, and the electron suite only includes
  `**/__tests__/**`, so they're in NO gate — the 2558-green baseline never runs
  them. ACTION ITEM: rewire those package tests to inject better-sqlite3 +
  Electron-ABI runner (or fold into the electron suite) so the graph package is
  actually gated. Package.json still lists sql.js as the test dep.

### PENDING USER DECISIONS (on the ops dashboard as clickable items):
- ASR pipeline direction — awaits WER spike results (keep Gemini / hybrid /
  local model). Then: pilot re-transcribe ~20 → maybe full ~1,900 archive.
- Entra app client ID for M365 (register in DFX5 tenant; personal-account reg
  is deprecated by Microsoft) → paste to me → I bake into default-app.ts.
- Rec46→Retro Belcorp confirm; backlog routing; 5 flagged re-transcriptions;
  delete merged worktree branches.

### SHIPPED THIS SESSION (2026-07-09/10, all pushed):
Context Graph v2 (lens/strata/provenance/budgets), connector platform
(host+M365+Slack), transcript triage, better-sqlite3 migration (2GB→673MB),
single-instance lock, waveform-play fix, ambiguous-name per-recording
resolution + signal-tiers, **attribution scorer** (all-day bridge 1.00→0.11),
**reader/meeting UX** (clickable timestamped speakers in MeetingDetail,
auto-scroll, contrast, past-meeting Join hidden, none→Not-transcribed),
**self-ID pass** (roll-call self-intros→named speakers, v0.97 tier, Rec47
yields Santiago de la Colina/Óscar Pereda), **per-turn/split speaker
correction** (v37 — the Memo-at-0:00 fix), **source deletion cascade** (v38 —
mark-personal + soft/hard delete of all derived data + audio file).

### ROADMAP additions (in ROADMAP.md §C-NEW): PixelRAG PDF/image visual
index (next major feature), WhisperLive real-time streaming (add-on), Mac
on-device ASR, Library redesign, deletion, correct-mode+entity-linking.

### OPS DASHBOARD (private artifact, republished each loop tick):
https://claude.ai/code/artifact/46d6454c-62ab-4d46-a824-1809a6a29d45 —
source file: `<scratchpad>/hidock-ops-dashboard.html` (Artifact tool, same
path re-publishes to same URL). Has clickable waiting-on-you items w/ steps.

### DEV WORKFLOW: worktree agents ALWAYS collide-check — one agent per
file-set, migrations claimed by number, CHERRY-PICK not ff-merge when HEAD
advanced, verify agent base commit, remove worktree + its stray `NUL` file
after merge (`cmd /c 'del /f /q "\\?\...\NUL"'` then `git worktree remove`).
dogfood skill now has B8 Responsiveness (screenshot ≥3 widths each round).
The Sean/HiDock email (firmware/mic-array/loaner asks) is DRAFTED + given to
the user to send — not a code task.

---

## 1. IN FLIGHT RIGHT NOW (STALE — 2026-07-08, see §0 above)

All three audit-fix slices LANDED (2026-07-08 evening, all pushed):
- 222f6b95 group merge cards (canonical-name picker, swap, topic overlap,
  role hygiene, keeper-death cascade) — verified live: Nauman/Numan folded
  into Nouman via "All the same person…", journaled, undo offered.
- c13c97c6 Today ribbon regressions (end times all variants, hover cards on
  capsule rows, clickable legend popover, "Meeting" fallback label) —
  verified live via CDP walk.
- b95ecbe2 Actionables decidability (inline ActionableDetail, per-template
  "Generate X" labels, WILL GENERATE panel) — verified live.

- f0ca8653 actionable source dual-resolution (capture → recording fallback,
  honest "Source unavailable") — found in the re-walk, fixed by agent, gates
  re-run independently (typecheck 0, 2,183 tests green), verified live
  (SOURCE renders the recording filename + date as a Library link).

Design-language rollout (queue item 1) — three more surfaces landed 2026-07-08
late evening, all gated (typecheck 0, full suite green) + verified live via CDP:
- ae14b750 Library list: human times replace .hda filenames, status legend
  popover, hover elevation/stagger, meeting provenance chips, EmptyState.
- 6531c4ba Projects: sidebar row treatment, Knowledge card now lists actual
  clickable items → Library, tooltips on all glyphs. (Members add/remove
  skipped — no IPC exists yet.)
- 26f78eeb People: card hover-cards (lazy personContext), PersonDetail pass,
  REAL Add Person dialog + new contacts:create IPC with duplicate guard.
- 0d50b5ac fix: Projects hub was fully evicted (clipped, unreachable) by the
  taller redesigned suggestion cards — now a compact "N suggestions — Review"
  banner when a project is open. Found ONLY by the live walk; unit tests
  passed throughout. Suite at 2,201.

Late-night wave (all landed, gated, pushed, live-verified on the real app):
- cfb80f4a Actionables visual pass (side-stripes gone, humanized type labels).
- ee859997/de00e560/884c8bbb Calendar: category color language + legend,
  honest states ("Not linked to a meeting", "Scheduled — not recorded"),
  unlinked blocks show transcript titles, hover leads with title/summary.
- 30348b17 Verify-Recording-Match decidability: header shows transcript
  title/summary/speakers; real scoring (overlap fraction + proximity +
  LLM-free lexical title↔subject signal with reason phrases; best-match
  preselect). User's Rec46 case verified live: Retro Belcorp 65% best match
  ("Title mentions 'retro', 'belcorp'"), others 19%/5% with honest reasons.
- 8e2086bb Claude Code handoff loop: "Open in Claude Code" launches a
  terminal in the resolved folder (pick → project folder_path → saved
  handoffDirectory), generation moves items out of Pending + toast w/ file.
- 58d1f98d **P0: knowledge_captures was EMPTY BY OMISSION — never populated**
  (NOT a wipe; forensics: no freelist pages, no dangling FKs, migrateToV11
  never ran). Fix: capture creation wired into transcription, boot self-heal
  backfill (ran live: 183 captures created), mass-delete tripwire on
  protected tables, rotating boot backups (hidock.db.bak-<date>, keep 3).
  DB snapshot kept at F:\HiDock-Next-Data\data\hidock.db.snapshot-2026-07-08-2355.

- 6d1f6265 Today's follow-ups DAY DIGEST: replaces the single ambiguous
  recentKnowledge[0] card — today's recorded meetings newest-first, each with
  CALENDAR subject+time chip + transcript title + action counts, expandable;
  honest "N still processing"; fallback "Latest analyzed meeting" heading
  with the chip. Live-verified (fallback path — 0 recordings after midnight);
  digest list surfaces with the next recorded day. Suite at 2,270.

## 2026-07-09 early-AM wave (SIX parallel agents; all landed/gated/pushed
through cde8f755; schema now v35; suite 2,375):
- **Context Graph** (fe711048): Knowledge Graph replaced — interactive force
  graph (13,387 nodes live), neighborhood focus, search, R4c contact-id
  re-key + ingest UNIQUE-collision fix, getNeighborhood IPC wired into RAG.
  POLISH NEEDED (live-walk findings): initial render is the whole-graph
  hairball (brief said neighborhood-first) + garbage entity nodes ("All
  attendees", "Team", "Project Manager") need extraction stop-words.
- **Connector platform** (b99ad7b9/6c670fa6/72a75c11/a8eaead0):
  @hidock/connectors host contract+registry; C3 M365/Graph connector
  (device-code MSAL — user must register an Entra app; Settings walks
  through it); C2 Slack connector (98ac13f7/5fc0b168, 43 tests) registered.
  Settings→Connectors live. Connector-tables migration DEFERRED (encrypted
  connectors.json suffices; take next free schema version when needed).
- **Transcript upgrade** (b91270b7 + rework swept into 72a75c11): LLM-free
  triage + cheap text reformat. REAL live-DB counts: only 9 flat legacy
  transcripts (4 reformat — kicked tonight; 5 flagged for user's
  re-transcription call). The "278 old transcripts" memory figure was the
  STALE C:\Users\Sebastian\HiDock legacy DB.
- **Ambiguous-name identity** (6b0ba5bb/cde8f755/fcadde5a): bare-first-name
  buckets (11 live: Sebas 64, Sebastián 57, Luis 37, Santi 36...) resolve
  PER RECORDING, not by merging. Signal hierarchy codified (signal-tiers.ts,
  INTELLIGENCE.md §9): connector-email > calendar-attendee > manual-sovereign
  > speaker-map > transcript-context > lexical; LLM never auto-links.
  Upgrade-only re-runnable sweep → M365 attendee backfill auto-upgrades.
  Resolve-per-meeting cards live on People. DB FACT: 0/1,951 meetings have
  ICS attendee data (Outlook feed strips them) — M365 connector is the fix.
- Backlog processing RUNNING (user-ordered): ~1,700 queued via Process All,
  newest-first, est $60-100 Gemini Flash (user offered local-ASR reroute —
  no decision yet; queue continues).
- PROCESS LESSONS (add to agent-dispatch): 6 agents sharing one working
  tree caused 2 git races (commit-sweep, index clobber) — next wave:
  isolation:worktree or serialized commits. detect-secrets pragma needed
  for key-NAME constants.

Data noise spotted: surname-fragment contacts ("Sergio Tado" ≈ mangled
Hurtado) — normal merge-flow candidates.

## 2026-07-09 daytime (all landed/gated/pushed through 5439e9d0):
- **Context Graph v2** (78f5411c + 0895760c + 5b125395): the user's "Pollock"
  critique → lens-first entry (Your context / Person / Project / Decision /
  This week), stratified reasoning bands (Decisions/Work/People/Meetings),
  shared time axis, provenance trails w/ narrative panel, per-stratum budgets
  with honest "20 of 806" counts, moiré + sizing fixes. VERIFIED LIVE.
- **P1 SCALING FIX** (5439e9d0): transcription.ts flushed the FULL ~570MB DB
  synchronously after EVERY transcript → main-process starvation (empty CDP,
  splash-stuck boot, one "Array buffer allocation failed", one "database is
  locked" restart race). Now: adaptive size-scaled flush intervals
  (<50MB none / ≥60s / ≥300s), flushNow() escape hatch, every-10-transcripts
  durability gate, flush cost logging (warn >3s). VERIFIED: CDP stable 3/3
  under active backlog. REAL FIX PENDING USER DECISION: better-sqlite3/WAL
  migration (on the ops dashboard as a decision item).
- Ops dashboard artifact for the user (auto-republished each loop tick):
  status strip, waves, agent roster w/ health, roadmap, clickable
  waiting-on-you items with step-by-step instructions.
- Worktree isolation is now the dispatch norm (2 shared-tree git races on
  07-08 night; zero since).

## 2026-07-09 evening — P0 DB EMERGENCY, RESOLVED (29d38e0b, pushed):
- DB hit 2.0GB (568MB same morning); sql.js collapsed: 10× export-buffer
  alloc failures, 4s flush freezes, statement-collision "locked" errors,
  UNCAUGHT main-process crash. App taken down deliberately; 2GB snapshot
  secured (hidock.db.pre-migration-snapshot-2026-07-09-2010).
- ROOT CAUSE: vector_embeddings stored as JSON TEXT = 94.8% of the file
  (46,629 rows × ~39KB). Backlog transcription made it explode.
- FIX: engine migrated to better-sqlite3 + WAL (sql.js-compatible facade —
  all 234 raw call sites untouched); migration v36 (schema now 36): dedupe
  (58 rows) + Float32-BLOB compaction (46,571) + VACUUM. LIVE RESULT:
  1918.8MB → 673.4MB in 7.1s; app stable; transcriptions completing again.
- ABI NOTE (dev workflow): vitest needs the Node-ABI better-sqlite3 binary,
  the app needs the Electron ABI. After any npm install affecting it:
  `npx @electron/rebuild -f -w better-sqlite3` for the app; check-native.mjs
  swaps for its test then restores Node ABI. FOLLOW-UP: make dev/test ABI
  coexistence automatic (e.g. tests via ELECTRON_RUN_AS_NODE).
- FOLLOW-UPS filed: VectorStore still decodes all embeddings into JS heap
  (~1.1GB) — lazy/Float32Array retention next; sibling apps (meeting-
  assistant/recorder) need npm install for better-sqlite3.
Also today: consumer-grade M365 auth (1861b792 — loopback popup flow,
shipped-default client id plumbing, multi-account instances) awaiting the
user's Entra registration (DFX5 tenant; personal-account registration was
deprecated by Microsoft).

Backlog: ~1,200 queued, draining again post-migration. NOTHING in flight.
Pushed through 29d38e0b.

## 2. DEVICE STATE

- H1E CONNECTED (user replugged ~21:15 after the zombie saga) — downloads +
  transcriptions flowing again. VERIFY: zombies (113444/85848/108308) actually
  cleared post-replug; recording indicator (CMD 18 poll) fires on the next
  real meeting; preassignment card appears while recording.
- Root causes all fixed in code: protocol serialization (6c931cf2), clean
  half-connect teardown, connectivity-gated downloads, newest-first ordering,
  gentle auto-reconnect + honest pill, app-cycle orphan detection.
- STANDING CONSTRAINT: HiDock docked = live USB AUDIO path for Teams calls —
  NEVER reset/replug the USB node during a meeting (severs the recording +
  audio blip). Recovery only in idle windows. (memory: project-hidock-usb-audio-mode)

## 3. DECISIONS WAITING ON SEBASTIÁN

1. **Process-All backlog**: ~1,600 older recordings untranscribed (API cost —
   rough order: avg ~8k words/recording ≈ Gemini transcription+analysis cost;
   needs explicit budget go).
2. Old-format transcripts (~278, pre-speaker-turns): re-transcribe to upgrade,
   or leave with paragraph-fallback rendering?
3. Connector priority confirmation: C2 Slack vs C3 M365/Graph first (M365
   gives real attendees + email autocomplete; Slack gives living channel
   captures).

## 4. NEXT UP (prioritized queue, nothing started)

1. **Design language to remaining surfaces** — only Today got the ribbon
   treatment; Library/People/Projects/Actionables/Calendar still old layout
   (theme tokens apply globally, per-surface craft does not). User explicitly
   flagged. Run as impeccable-directed rounds per surface.
2. **C3 M365/Graph connector** (real attendees w/ emails, email autocomplete
   on People edit) or **C2 connector host + Slack** — per decision #3.
3. **/verify-journeys + /dogfood full pass** after in-flight agents land;
   rescore ROADMAP §D; fix what the walk finds.
4. **Context Graph redesign** (user directive 2026-07-08, ROADMAP §C.9):
   replace the Knowledge Graph surface entirely — rename to *Context Graph*,
   real interactive visualization (entity nodes + relationship edges,
   neighborhood focus, click-through), usable by BOTH human and AI (assistant/
   RAG walks graph edges for context). Current text console "does not help".
   R4c (re-key person nodes by contact id) is the data prerequisite.
5. **Person-type auto-classification** (everyone 'unknown' unless hand-set).
6. **RECITATION chunk retry** (ISSUE-15, 1 occurrence): temp-adjusted retry +
   visible "[content blocked]" placeholder.
7. **Wiki browser in-app** (Karpathy-wiki view over F:\HiDock-Next-Transcripts\wiki).
8. ROADMAP §D leftovers: Calendar day-cell click/day view + event create;
   chat conversation rename; chunk cards clickable; Add Person real dialog
   (still stub); topics chips → search links.
9. Tooling debt: devproc alive() unreliable for Electron PIDs (user's hook
   file — needs their call); block-kill hook false-positives on commit
   messages containing "kill".

## 5. WHAT SHIPPED TODAY (compressed — 45+ commits, all pushed)

- **Transcription**: MP3-in-.wav chunking, speaker turns, no-silent-drop,
  JSON repair pass, plain-text-first analysis, self-healing backfills,
  recency-first queue (verified live), ~200 recordings transcribed.
- **Identity platform** (v25–v27): transcript_speakers map + assignment UI +
  hover discoverability, contacts/projects merge + auto-dedupe, confidence
  resolver (thresholds .8/.5) replacing exact-name matching, alias memory +
  alias chips, identity_suggestions + Discover sweep (146 pairs→25 suggs) +
  review queue w/ evidence (snippets, co-presence disproof, context circles,
  impact preview, rarity caution), merge journal + unmerge + type-name gate
  (v30), name-rarity scoring, "Different person…" third door.
- **Device vertical** (v31): CMD 18 recording poll (serialized protocol),
  live-recording card + meeting attribution/preassignment, frozen-clock fix,
  ran-over states, honest connect pill + gentle retry.
- **Calendar** (v32): RRULE expansion (60d/90d window, EXDATE/RECURRENCE-ID),
  twin-row dedupe + reconciler cleanup, calendar:synced → live Today refresh,
  all-day DATE semantics + subtle banner.
- **Design**: dual light/dark theme system (measured contrast, pre-paint
  bootstrap, titlebar toggle), real elevation + motion language, Today as a
  time-compressed ribbon (collapse/fade/hero zones + now-line).
- **Entity types/connectors**: artifacts registry (md/txt/json/image/pdf) +
  import→capture→embeddings (C0+C1).
- **Meta**: dogfood skill (B1–B7 incl. decidability sub-rules), agent-dispatch
  rules, dev toolkit (app-cycle/cdp/verify-journeys), GOAL/RETRO/ROADMAP/
  INTELLIGENCE/CONNECTORS docs.

## 6. STANDING METHOD (compressed)

Orchestrator ideates/designs/verifies; Opus agents implement with precise
briefs (root cause + contract + gates + report-as-last-action). Gates:
typecheck + lint 0 errors + FULL test:run (2,153+ green as of last commit),
re-run independently before every commit. Verification is JOURNEY-driven
(dogfood batteries), never diff-driven — walk one untouched surface each
round. Coverage scores count only what pixels let a user see/do. One agent
per file-set; migrations claimed by number (next free: v33). Commit often,
push always. USB: mock-first, one clean attempt, no resets during meetings.
