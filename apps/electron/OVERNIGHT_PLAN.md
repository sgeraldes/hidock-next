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
- [~] ISSUE-2 (design, Opus — after fix-analysis lands, shares index.ts):
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
- Wave 3 (queued 06:40): 15 audios Jun12–Jun18 (Rec28-30, Rec31-40, Rec46,
  Rec50). Post-dedupe: no twin cancels needed. Target total ≈ 33.
- Organization state: 37 people, 5 auto-projects (Itaú Integration, DFX5
  Gateway, Resource Mgmt, TSC Platform, WTS Transition), 1,905 captures after
  1,057-row dedupe. Feedback filed: "Alex" vs "Alex / Óscar" person dedupe,
  contact type always UNKNOWN.

## Watchlist (evaluate during waves)
- Download/progress indicators quality (user flagged)
- Assistant-first UX: is Today useful? Assistant page quality with grown KB
- People/Projects pages as data accumulates (dupes? naming quality?)
- Wiki page quality per meeting; Spanish/English handling
- Rate limits / API failures under sustained load
