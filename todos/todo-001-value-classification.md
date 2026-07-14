# T1 — F16: Content-based value classification + storage

## Objective
Every transcribed capture gets a content-based VALUE assessment (is this conversation useful knowledge?) produced by the SAME LLM call that already generates the summary/analysis after transcription — no extra API round-trip. Result persists onto the existing rating taxonomy.

## Current state (verified facts — do not re-derive)
- Taxonomy exists: `quality_rating` on `knowledge_captures` — `valuable|archived|low-value|garbage|unrated` + `quality_confidence`, `quality_assessed_at` columns. Library filter/sort already understand ratings.
- The ONLY auto-classifier is `classifyLowValueCaptures()` (apps/electron/electron/main/services/database.ts ~:3875): narrow heuristic (<20 s AND <20 words AND no meeting link), only touches `unrated`, never downgrades user ratings. Keep it (it handles no-transcript junk); the new classifier handles everything with a transcript.
- `QualityAssessmentService` (electron/main/services/quality-assessment.ts) is METADATA-only (has transcript/meeting/duration/size), separate `quality_assessments` table + `quality:assessed` event consumed by storage-policy.ts. It rates a rich-but-worthless recording HIGH — do NOT overload it; the new value classification is capture-level.
- Motivating case: 32.5-min kitchen conversation (owner cooking), transcribed + summarized + 20 RAG chunks + graph-ingested, sits `unrated`.

## What's missing
1. Locate the post-transcription analysis step that writes the capture's summary (transcription pipeline → knowledge capture creation/analysis) and extend its prompt + response schema with:
   - `value`: one of `high | normal | low | none`
   - `value_reasons`: subset of `[personal_family, greeting_only_no_show, background_ambient, no_substance, off_topic_chatter]`
   - `value_confidence`: 0..1
   Language note: transcripts are mostly Spanish; prompt must be language-agnostic.
2. Mapping to persisted rating (only when current rating is `unrated` — never override user or prior explicit rating):
   - `none` → `garbage`, `low` → `low-value`; `high|normal` → leave `unrated` (per existing philosophy: "valuable is left to explicit user/AI action — don't over-claim").
   - Persist `quality_confidence`, `quality_assessed_at`; store reasons (new column or JSON — needs schema migration; follow the repo's migration pattern, next free version).
3. Re-transcription / re-analysis path must refresh the classification under the same never-downgrade-user-ratings rule.
4. Unit tests with fixture transcripts (Spanish cooking chatter → low/none; real work meeting → normal/high; "hi, nobody's here" → none + greeting_only_no_show).

## Dependencies
- None (first task). T2 gates and T3 UI consume the persisted rating + reasons.

## Constraints
- Fixture/temp DBs only; never F:\HiDock-Next-Data. Non-interactive commands only. No pushes.
