# T3 — F16: Library surfacing + suggestion + resumable backfill

## Objective
The value index is visible and actionable in the Library, and the ~1,900 existing captures can be classified in a controlled, resumable batch.

## Current state (verified facts)
- Library filter UI already has a quality filter with Low-value option (src/features/library/components/LibraryFilters.tsx ~:277) and quality sort order (Library.tsx ~:514).
- SourceRow (src/features/library/components/SourceRow.tsx) renders per-row status; memo comparator already includes `recording.quality`.
- One-shot backfill pattern exists: `recordings:backfillDurations` IPC → duration backfill + classifyLowValueCaptures, triggered once per Library mount (Library.tsx ~:278-299).
- Boot-task freezes are a known owner pain (roadmap F15: meeting-wiki-backfill froze the app 30 s+) — the LLM backfill must NOT be a boot task.

## What's missing
1. Row badge: subtle indicator for `low-value` / `garbage` ratings (and reason on hover/tooltip), consistent with existing row iconography; both themes.
2. Suggestion affordance: when T1 classifies a capture `low`/`none`, surface a non-blocking "Marked low-value — Mark personal (ignore)?" toast/inline hint (reversible, never auto-applies `personal`).
3. Manual per-row override stays possible (rating set/reset from UI — verify existing affordance; add minimal menu entry if missing).
4. Backfill: user-triggered (Settings or Library action, NOT boot): batch-classify existing transcripted captures that are `unrated`, oldest-newest or newest-oldest (decide), chunked + yielded off the renderer path, rate-limited for the LLM provider, RESUMABLE (persisted cursor/queue), with progress + cancel. Respects never-downgrade rule. Idle/paused when provider unconfigured.
5. Tests: badge rendering per rating, suggestion trigger, backfill resumability (mock LLM).

## Dependencies
- T1 (classification callable per capture), T2 (so backfilled ratings actually gate).

## Constraints
- Fixture/temp DBs only; mock LLM in tests. Non-interactive commands. Renderer must never block (owner is running his own instance; ours is only for QA with isolated userData/ports).
