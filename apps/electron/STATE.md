# STATE.md — Session Handoff & Master Todo

*Written 2026-07-09 ~00:30 (end of the 2026-07-08 marathon session) for memory
compaction. THE definitive "where are we" — supersedes stale statuses in other
docs. Companions: ROADMAP.md (audit ledger + coverage map), INTELLIGENCE.md
(architecture + definitions), CONNECTORS.md (connector design), RETRO.md
(process retrospective), OVERNIGHT_PLAN.md (session issue log), GOAL.md
(mission + method).*

## 1. IN FLIGHT RIGHT NOW

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

NOTHING in flight. Pushed through cde8f755.

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
