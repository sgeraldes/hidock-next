# STATE.md — Session Handoff & Master Todo

*Written 2026-07-09 ~00:30 (end of the 2026-07-08 marathon session) for memory
compaction. THE definitive "where are we" — supersedes stale statuses in other
docs. Companions: ROADMAP.md (audit ledger + coverage map), INTELLIGENCE.md
(architecture + definitions), CONNECTORS.md (connector design), RETRO.md
(process retrospective), OVERNIGHT_PLAN.md (session issue log), GOAL.md
(mission + method).*

## 1. IN FLIGHT RIGHT NOW (3 Opus agents, uncommitted work in tree)

| Agent | Scope | Files |
|---|---|---|
| fix-group-merge-card | 7 fixes to identity suggestion group cards: consolidated one-keeper-panel layout, per-candidate direction swap, **group action "all the same person — pick correct name (or type it)"**, stuck "checking transcripts…" regression, semantic (fuzzy) topic overlap for the different-circles warning, role hygiene strip "(mencionado)", keeper-death suggestion cascade | src/components/identity/*, identity-handlers, entity-resolver (topic helper) |
| fix-ribbon-regressions | Today ribbon: restore END TIMES on all row variants, MeetingHoverCard on expanded-capsule rows, category-color legend as clickable popover + dot tooltips | Today.tsx, meeting-timing.ts |
| fix-actionables-decide | Actionables B7 round: card click → full detail (title/desc/source-meeting link/recipient chips), explicit "Will generate: Meeting minutes" template naming, per-template button labels | Actionables.tsx, MeetingActionables.tsx |

On their reports: gate (typecheck+lint+full test:run), commit each slice, then
run /verify-journeys + /dogfood re-walk, rescore ROADMAP §D.

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
4. **R4c**: re-key knowledge-graph person nodes by contact id (ingest-time);
   visual graph view (KnowledgeGraph page is still a text console).
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
