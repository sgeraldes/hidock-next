# INTELLIGENCE.md — The Core Intelligence of HiDock Meeting Intelligence

*Authored 2026-07-08 from a full session of discovery-and-correction (see
`.agents/context/GOAL.md` for the working method). This is the living
architecture document for the app's intelligence layer: definitions, driving
notions, what exists, what worked, what didn't, and a measured coverage map
that drives prioritization. Update it whenever a round lands.*

---

## 1. Driving principles

- **Assistant-first.** The app is a daily-work assistant, not a recordings
  manager. Every feature is judged by "does this help Sebastián act on his
  day?"
- **Recency principle.** Recent information outranks old information — encoded
  in code (transcription queue dequeues by `date_recorded DESC` with
  user-explicit requests first; verified live: wave 7 completed in strict date
  order), in the Today briefing, and eventually in every ranked surface.
- **Identity principle.** People, projects, and meetings are canonical
  entities (one row, referenced by id). Every mention is a node; editing the
  node propagates everywhere; new facts (an email learned in a meeting) attach
  to the entity and flow to all surfaces; duplicates get merged. Raw
  name-strings are technical debt.
- **Progressive understanding.** Every user correction (a merge, a speaker
  assignment, a rejected suggestion) is a training signal the system must
  remember, so certainty compounds and the same question is never asked twice.
- **Interaction metrics.** Every component is measured on:
  **clickability** (entity mentions navigate), **editability** (fields
  change in place and propagate), **discoverability** (hover/inspect reveals
  what the system knows), and **identity-linkage** (mentions resolve to
  canonical ids, not strings).

## 2. Core definitions (do not lose these)

| Notion | Definition | Status |
|---|---|---|
| **Canonical entity** | The single DB row for a person (`contacts`), project (`projects`), or meeting (`meetings`). All mentions reference its id. | Live (Rounds 1a/1b) |
| **Entity mention** | `<EntityMention>` renderer: click = navigate, hover = lazy hover card, unresolved = inert (never dead-links). | Live (Round 2) |
| **Speaker map** | `transcript_speakers(recording_id, speaker_label → contact_id)`. Assigning "Speaker 2 = Javier" is a mapping, not a transcript rewrite; transcripts stay immutable artifacts. Reset reverts all turns visibly. | Live (v25, Rounds 1a/1b/2b) |
| **Attendee projection** | `meetings.attendees` JSON is a *projection* regenerated from `meeting_contacts`; the junction is the source of truth. | Live (Round 1a) |
| **Propagation rule** | New facts attach to the canonical row: an email learned for a name-matched contact updates that contact (and thus every surface); email-matched placeholder names upgrade to real names. | Live (addAttendee path); string surfaces remain (see §5) |
| **Merge** | One-transaction fold of a loser entity into a keeper: child FKs repointed, fields folded (keeper wins, null-fill), counts recomputed, loser deleted. Pattern: `mergeDuplicateRecordings` → `mergeContacts` → (Round 3) `mergeProjects`. | Live for recordings + contacts |
| **Auto-dedupe** | Reconciliation merges ONLY exact matches (same email, or exact normalized name). Fuzzy variants (Sebas/Sebastián, Oscar/Óscar) are never auto-merged — they go to the resolver/suggestions. | Live (conservative by design) |
| **Alias memory** | `contact_aliases` / `project_aliases`: every merge, speaker assignment, and accepted suggestion writes a permanent alias with confidence. The system never re-asks a settled identity. | Designed (Round 4a) |
| **Confidence-scored resolver** | One shared `resolveContact/resolveProject(name, context)` → `{id?, confidence, method}`. Tiers: exact email 1.0 > exact name .95 > alias .9 > accent-normalized .85 > fuzzy+context .6–.8 (context = co-occurrence in meeting attendees / project). **≥.8 auto-link; .5–.8 suggestion (no new entity); <.5 new low-certainty entity.** Kills the duplicate factory (today `applyTranscriptEntities` matches exact name only). | Designed (Round 4a) |
| **Suggestion queue** | `identity_suggestions`: the .5–.8 band as reviewable cards ("Is 'Sebas' Sebastián? 0.72 — same meeting as Edu"). Accept = alias + link/merge; reject = alias-block. Surfaced in People + Today. | Designed (Round 4a/4b) |
| **Living knowledge graph** | Graph updates are event-driven, not manual: entity mutations emit domain events; a graph-sync subscriber does label-level node surgery (rename/merge — no LLM); new transcripts auto-enqueue LLM ingest (debounced). Full re-ingest becomes a repair pass, not the mechanism. | Designed (Round 4a); today graph is manual-ingest, name-keyed |
| **Discovery-and-correction loop** | Use the product as the user → find defects from real use → root-cause with evidence → delegate fixes to Opus agents → verify live → commit. | Standing method |

## 3. The intelligence pipeline (current state)

```
capture (device/MP3-in-.wav) 
  → transcription (Gemini, MP3/WAV frame-boundary chunking, [MM:SS] Speaker N
    turns, no-silent-drop, recency-first queue)                        [95%]
  → analysis (summary/actions/topics/title/participants/project;
    json-mime + repair pass + plain-text fallback + startup self-heal) [85%]
  → entity application (participants→contacts, project→projects;
    exact-name matching — DUPLICATE FACTORY until Round 4 resolver)    [60%]
  → embeddings (gemini-embedding-001, batch, auto-index)               [90%]
  → wiki export (per-meeting markdown, stale-page cleanup, self-heal)  [90%]
  → knowledge graph (LLM extraction per transcript; MANUAL ingest only,
    name-keyed nodes — Round 4 makes it living)                        [40%]
  → actionables/suggestions (AI-detected follow-ups, CTA generation)   [70%]
  → assistant (RAG chat, Gemini-first, cited sources)                  [80%]
```

## 4. Session evaluation — what worked, what didn't

**Worked (verified live):**
- Chunked MP3/WAV transcription: ~86 unique audios this session; hour-long
  recordings complete with speaker turns (Rec43: 8,168 words, 295 segments;
  previously truncated at 5,921 with goodbyes missing).
- Recency-first queue: wave 7 completed in strict newest-first order.
- Self-healing: analysis backfill repaired stuck transcripts on every boot;
  1,057 duplicate recording rows merged on first boot after the dedupe fix.
- JSON repair pass: zero 'Analysis failed' sentinels after landing; the
  plain-text fallback absorbs the residual corruption classes.
- Identity Rounds 1–2b end-to-end: speaker assignment popover verified live
  (329 labels on one recording), user actively assigning identities within
  minutes of shipping.
- Assistant RAG: accurate, source-cited answer about the SIP-to-WebRTC
  Gateway from the freshly built knowledge base.

**Didn't work / lessons:**
- Gemini json-mime output is systematically malformed for this model+content
  (unescaped quotes, control chars, bracket imbalance, dangling keys, content
  splices). Verdict forming: swap attempt order (plain-text first) to save
  the wasted call; measure fallback rate first.
- Exact-name entity matching created the duplicate-people problem the user
  hit immediately (Sebas/Sebastián/Sebastian/Seba/Sebastián Geraldes all
  exist). Conservative auto-merge was right; the resolver is the real fix.
- Passivity is a failure mode: watching the queue "self-correct" instead of
  fixing ordering in code drew a direct correction — disagree and commit.
- Bare-name pickers are useless at scale; every list item needs metadata
  (who's who) — discoverability is a first-class metric, not polish.
- Two agents editing the same file (SCHEMA_VERSION) requires explicit
  serialization; parallel agents work only with disjoint file sets.

## 5. Coverage map — components × metrics

Scores 0–100 (grounded in the 2026-07-08 audits + rounds landed; re-score as
rounds land). **Identity** = mentions resolve to canonical ids.

| Surface | Click | Edit | Discover | Identity | Notes / biggest gap |
|---|---|---|---|---|---|
| TranscriptViewer | 80 | 70 | 85 | 70 | action items inert; transcript text not editable |
| SourceReader | 65 | 60 | 55 | 50 | title/category editable; metadata row inert |
| Library rows/cards | 60 | 50 | 55 | 40 | topics chips inert; no project assignment |
| PersonDetail | 65 | 85 | 60 | 80 | no alias list yet; tags not links |
| People list | 70 | 20 | 45 | 70 | Add Person is a stub; no merge from list; no hover cards |
| MeetingDetail | 70 | 65 | 55 | 75 | start/end times not editable; no project assignment |
| Calendar | 75 | 25 | 70 | 60 | day cells inert; no event create/edit |
| Projects | 50 | 40 | 45 | 55 | NO RENAME; no member/knowledge assignment UI (R3) |
| Actionables | 55 | 30 | 55 | 45 | title/recipients not editable; no assignee picker |
| Explore | 90 | 0 | 70 | 85 | editability n/a by design |
| KnowledgeGraph | 65 | 0 | 50 | 40 | name-keyed graph; results now navigate (R2) |
| Assistant/Chat | 60 | 30 | 55 | 55 | conversations not renameable; chunk cards inert |
| Today | 70 | 0 | 35 | 45 | organizer inert; action-item lines inert |
| TitleBar | 90 | n/a | 60 | n/a | connect pill live (056fb4b7) |
| Connectors (framework) | 0 | 0 | 0 | 0 | designed (CONNECTORS.md); C1=PDF vertical queued |

**Pipeline-level identity coverage:** resolution 35 (Round 4 pending), alias
memory 0 (designed), suggestion queue 0 (designed), graph liveness 20
(manual), propagation 55 (contacts canonical; assignee/owner/recipients/
graph-nodes still name-strings).

## 6. Prioritization (derived from §5, lowest×highest-value first)

1. **Round 4a — resolver + alias memory + entity events + graph auto-update**
   (identity resolution 35, graph 40): stops duplicate creation at the
   source; makes the graph living. IN QUEUE behind Round 3a.
2. **Round 4b — suggestion review queue + confidence badges** (People +
   Today): closes the progressive-understanding loop.
3. **Round 3 UI — project rename, project assignment pickers, meeting
   time edit, actionable assignee/recipients edit** (Projects edit 40,
   Actionables edit 30, MeetingDetail edit 65).
4. **People list: real Add Person, hover cards, merge-from-list** (edit 20).
5. **Today discoverability** (35): organizer/action-items as mentions.
6. **Calendar day-cell click → day view; event create** (edit 25).
7. **Graph re-key by contact id (R4c)** — after events land.
8. **Transcript text correction + action-item mentions in TranscriptViewer.**
9. **Connector framework C1–C4** (CONNECTORS.md): MCP-first external systems —
   identity enrichment (email autocomplete, HR/Slack metadata), living
   knowledge sources (Slack channels, GitHub md, PDFs, images), entity
   actions, graph signals. Interleaves with rounds by file-set availability.

## 7. Standing quality gates

Every change: `npm run typecheck` + `npm run lint` (0 errors) +
`npm run test:run` green, then live verification in the running app (CDP/
screenshot), then commit+push. Issues live in OVERNIGHT_PLAN.md (session log)
and this file (architecture); rounds tracked in INTERACTIVITY_PLAN.md.

## 8. Merge safety & reversibility (design — v29 follow-up)

Merges are destructive folds (`mergeContacts`/`mergeProjects`): child FKs are
repointed and the loser row is deleted. Discovery (Round 4b) proposes them but
never executes — the user clicks. To make that click *reversible*, a merge must
record what it did.

**`merge_journal` table (v29 follow-up — NOT yet added; a schema-owner adds it):**

| Column | Purpose |
|---|---|
| `id` | journal entry id |
| `kind` | `'person'` \| `'project'` |
| `keeper_id` | surviving entity |
| `loser_snapshot` | JSON of the deleted loser row (all columns) — enough to recreate it |
| `manifest` | JSON `{ table → [pk...] }`: exactly the child rows this merge repointed loser→keeper (e.g. `meeting_contacts`, `transcript_speakers`, `*_aliases`) |
| `created_at` | ISO timestamp |

The merge writes one journal row inside the same transaction as the fold.

**`contacts:unmerge(journalId)` semantics:**
1. Recreate the loser from `loser_snapshot` (re-INSERT with its original id).
2. Repoint back *exactly* the rows in `manifest` (keeper→loser) — no more, no less.
3. Rows linked to the keeper **after** the merge are NOT in the manifest, so they
   stay with the keeper and are returned as a **manual-review list**. This is the
   "a meeting got wrongly attached to the merged person — find it and reassign it"
   flow the user described: unmerge restores the split, then the user moves the
   one stray link by hand rather than the system guessing.
4. Delete the alias rows the merge created (folded loser-name → keeper) and the
   journal entry. Recompute counts on both entities.

**Pre-merge warning heuristic:** if BOTH entities are heavily linked (each with
> N links across `meeting_contacts`/`transcript_speakers`/`meeting_projects`;
start N≈10), the merge dialog requires the user to **type the loser's name** to
confirm — a wrong merge of two well-established entities is the expensive mistake,
and unmerge's manual-review step is the safety net, not a substitute for the gate.

Discovery's `evidence.autoMergeable` flag never bypasses this — it only pre-selects
the card; execution is always an explicit, journaled, reversible click.
