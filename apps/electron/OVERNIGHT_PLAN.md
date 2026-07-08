# Overnight Improvement Plan — 2026-07-08

Mission (from Sebastián): transcribe 50+ audios as feedback loops, observe what
the app does with each, and continuously improve — errors, transcription
reliability, UI/UX as an assistant-first app. Orchestrator ideates/coordinates;
all code fixes are implemented by Opus 4.8 coding agents and verified live.

## Loop
1. Enqueue a wave of untranscribed recordings (app IPC, ~10-16 per wave).
2. Watch pipeline logs (transcription, analysis, entities, wiki, actionables).
3. Inspect artifacts + UI as a user; file concrete issues below.
4. Dispatch an Opus agent per issue (precise brief, verify gates).
5. Verify fix live, commit, continue.

## Waves
- Wave 1 (in progress): 16 queued → 9 unique after cancelling 7 .hda duplicates.
  Includes Jul7 Rec43 re-run to validate JSON-forced analysis.

## Issue log
- [x] ISSUE-1 (agent: fix-dedupe, Opus): duplicate recordings rows (.hda + .wav
      same content) → double transcription + duplicate library entries.
      Fix: mergeDuplicateRecordings() in org-reconciler + keeper selection.
      VERIFIED LIVE: merged 1,057 duplicate groups on first boot. Commit bd84e6e3.
- [~] ISSUE-0a: analysis/actionables JSON flakiness on large transcripts.
      First hardening (responseMimeType json + thinkingBudget 0) still failed on
      a real 5.9k-word transcript ("Analysis failed", small prompts fine) →
      ISSUE-3.
- [x] ISSUE-0b: transcription queue enqueued both .hda/.wav (mitigated at queue
      level for wave 1 by cancelling twins; permanent fix = ISSUE-1).
- [x] ISSUE-3 (agent: fix-analysis, Opus): analysis failures are invisible and
      permanent. Fix: log finishReason/usage on failure, plain-text retry
      fallback, reanalyzeFailedTranscripts() startup backfill (max 3/run) that
      repairs transcript rows + re-exports wiki.
      VERIFIED LIVE: healed 3 transcripts + re-exported wikis on first boot.
      Commit bd84e6e3.
- [~] ISSUE-5 (agent: fix-transcript-quality, Opus; USER-REPORTED at 06:30):
      (a) "Urgent Call" transcript ends mid-sentence ("Vean, el asunto aquí"),
      goodbyes missing — data vs display truncation under investigation;
      (b) transcript renders as one flat blob: no turns/timestamps/speakers.
      Fix: chunk-coverage/no-silent-drop in gemini-engine, [MM:SS] Speaker N
      turn structure stored as segments, turn-based renderer with fallback.
- [ ] ISSUE-6 (queued; root-cause after ISSUE-5 lands — same file
      transcription.ts): json-mime analysis attempt consistently fails to
      parse even with finishReason=STOP and valid-looking JSON head (seen on
      both 9k-token and 2.4k-token Spanish prompts). Fallback masks it at 2×
      API cost. Suspect unescaped control chars in Gemini json-mode string
      values or a bug in extractAnalysisJson. Evidence: two [Analysis] log
      events 07:0x, wave 3 — now 3/3 failures (9k, 2.4k, 9.1k prompts), i.e.
      deterministic. Read-only code review: extractAnalysisJson does greedy
      {…} match + bare JSON.parse; parse error message/position is swallowed.
      Fix brief: (1) capture JSON.parse e.message (has exact position) + the
      ±120 chars around it in logAnalysisFailure; (2) likely repair = strip
      raw control chars inside strings or jsonrepair-style tolerant parse;
      (3) if json-mime stays broken, demote it to the fallback slot.
- [x] ISSUE-5 verified live: Rec43 re-transcribed 44,191 chars (was 32,249),
      goodbyes present, 295 speaker segments covering full 60.1 min; Rec16
      (previously hard-failed) now 10,669 words. Commits f34468aa, 9f8da3f4.
- [x] ISSUE-7: parseTurns inline-marker split (engine, commit 1d064a82) +
      render-time splitInlineTurns for legacy stored segments (54391b68).
      VERIFIED LIVE: Rec43 renders as timestamped speaker turns.
- [x] ISSUE-8: root cause was wiki FILENAME DRIFT (title-derived slug changes
      between runs, orphaning stale pages) — removeStaleWikiPages self-heals
      (1d064a82); orphaned Rec43 page deleted manually.
- [x] ISSUE-9: bracket-stack balancing in repairJsonString + rootClosed
      discard of content after JSON root closes (1d064a82, 893d0add).
- [x] ISSUE-10 (found by orchestrator UI test): hooks-order crash selecting a
      recording — transcriptSegments useMemo below the early return. Fixed +
      2 regression tests (39dd65af). VERIFIED LIVE.
- [x] ISSUE-11: flaky perf budget test — now times only the synchronous
      click→commit; waitFor untimed; suite green 2× consecutively (5ef9cb48).
- [x] ISSUE-12: Assistant chat was the LAST Ollama-only path ("Ollama
      offline", dead input). New chat-llm service: Gemini-first w/ Ollama
      fallback; rag:status exposes backend; also fixed latent retrieval bug
      (query embeddings now same vector space as index). Commits 07298be1,
      2e53dd13. VERIFIED LIVE: "Gemini · 4249 chunks", full RAG answer about
      SIP-to-WebRTC Gateway citing Rec43.
- [x] ISSUE-13 (USER-REQUESTED): titlebar pill = Sync page Connect control.
      useDeviceConnection shared hook (module-level in-flight guard, one
      click = one attempt), popover Disconnect when connected, toast errors.
      Commit 056fb4b7, VERIFIED LIVE ("Connect device" pill renders).
- [~] INITIATIVE (USER-REQUESTED 07:4x, task #21): interactivity & entity
      propagation — everything editable/clickable/hoverable; person edits
      propagate everywhere; meeting info flows to attendees; person merge.
      Round 0 audit agent running; then design → implementation rounds.
      Note from live RAG answer: assistant cites "Speaker 2/Speaker 3" —
      speaker→person mapping is the highest-value identity gap.
- [x] ISSUE-2 (design, Opus — after fix-analysis lands, shares index.ts):
      unified Office-365-style titlebar: frameless BrowserWindow with overlay
      window controls, app identity + global actions in the custom titlebar,
      remove duplicated "HiDock Next" sidebar header. User-requested.
- [~] ISSUE-4 (design, same agent as ISSUE-2): app reads flat — white
      backgrounds everywhere, no shadows/elevation, effectively 2 colors.
      User's explicit feedback. Introduce depth system (elevation tokens,
      surface tints, committed accent usage) per impeccable product register +
      PRODUCT.md (.agents/context/PRODUCT.md).

## Wave progress (target ≥50 unique audios)
- Completed tonight pre-waves: Rec41/Rec42/Rec43 (Jun16) + Rec43 (Jul7) = 4
- Wave 1: 9 unique queued (7 .hda twins cancelled); Rec43 re-run done.
- Wave 2: ~8 unique done (Jun19 Rec58/60, Jun24 Rec75-78, Jun25 Rec84,
  Jun26 Rec85-89). Running total ≈ 18 unique.
- Wave 3 (done): 15 audios Jun12–Jun18. Total ≈ 33.
- Wave 4 (done): 15 new (Jun9–Jun12) + 3 re-runs — Rec43 re-transcribed FULL
  (8,168 words, was 5,921 truncated), Rec16 10,669 words + Rec14 19,277 words
  (both previously hard-failed; MP3 chunking fixed them). TOTAL ≈ 53 unique —
  ≥50 TARGET REACHED.
- Wave 5+6 (done): ~21 more unique (Jun5–Jun9). Total ≈ 74.
- Wave 7 (done, 12/12): RECENCY QUEUE VERIFIED LIVE — completions arrived in
  strict date_recorded DESC order (Rec84→…→Rec74 all Jun5, then Jun4 Rec73
  LAST). Total ≈ 86 unique audios transcribed this session.
- Organization state: 37 people, 5 auto-projects (Itaú Integration, DFX5
  Gateway, Resource Mgmt, TSC Platform, WTS Transition), 1,905 captures after
  1,057-row dedupe. Feedback filed: "Alex" vs "Alex / Óscar" person dedupe,
  contact type always UNKNOWN.

## Observations (not yet actionable)
- ISSUE-15 (1 occurrence, 2026-07-08 16:5x): Gemini RECITATION block failed a
  backlog transcription (chunk resembled copyrighted content — music/video in
  the meeting audio). no-silent-drop correctly failed loudly. Fix design when
  it recurs: per-chunk RECITATION retry with temperature adjustment; if still
  blocked, insert a visible "[content blocked by provider]" chunk placeholder
  and continue — loud gap, not a dropped transcript. Identify the recording
  via the failed queue row.
- ISSUE-14 (queued; transcription.ts busy with fix-queue-priority agent): new
  json-mime malformation class — DANGLING KEY then duplicated key
  (`"participants":\n  "participants": [],` — key emitted with no value,
  re-emitted next line). repairJsonString can't fix; fallback absorbed it.
  Repair rule to add: key token followed by another key token → drop the
  dangling key. Seen 10:5x wave 6, small English prompt (563 tokens).
- json-mime SPLICE corruption (string closes, next line resumes mid-content):
  seen at 27.8k tokens (Rec16) AND now 6.2k tokens (wave 7, 11:3x) — not
  size-bound, not an escaping bug; repair can't fix corrupted content. The
  plain-text fallback absorbs every instance (zero 'Analysis failed'
  sentinels since backfill). VERDICT forming: json-mime responseMimeType is
  unreliable for this model+content; consider swapping attempt order
  (plain-text first, json-mime fallback) to save the wasted first call —
  measure fallback rate first.
- Flaky perf test: library-performance "switches view modes" 203.79ms vs
  200ms budget once under full-suite load; passes in isolation. If it fails
  again in a gate run, relax budget or isolate the timing.

## Watchlist (evaluate during waves)
- Download/progress indicators quality (user flagged)
- Assistant-first UX: is Today useful? Assistant page quality with grown KB
- People/Projects pages as data accumulates (dupes? naming quality?)
- Wiki page quality per meeting; Spanish/English handling
- Rate limits / API failures under sustained load
