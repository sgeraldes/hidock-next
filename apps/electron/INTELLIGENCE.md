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
- The device-incident chain (2026-07-08 afternoon): a NEW periodic protocol
  command (CMD 18 poll) interleaved with in-flight commands → protocol
  desync → half-connected state (SN null, empty file list) → a read blocked
  forever → the app kill left an UNKILLABLE zombie (IRP-stuck) holding the
  USB claim → every later connect failed LIBUSB_ERROR_ACCESS → only a USB
  node reset clears it. Lessons: single-outstanding-command protocols need a
  hard mutex at the service layer (not "skip if busy" guards); a failed
  connect must tear down cleanly, never half-connect; on Windows, stopping
  the npm tree leaks the Electron main (app-cycle stop now verifies
  orphans); liveness checks flicker unreliably against IRP-stuck zombies.
  And the dock is the LIVE call audio path — no USB resets during meetings.

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

**Pipeline-level identity coverage (re-scored after Rounds 3b/4/5 + C0,
2026-07-08 ~13:30):** resolution 80 (confidence resolver live in
applyTranscriptEntities; connector signals pending), alias memory 85 (live,
auto-populated; alias list UI pending), suggestion queue 85 (live: review
queue + Discover sweep, verified 25 real suggestions), graph liveness 65
(entity events + LLM-free surgery + debounced auto-ingest; nodes still
name-keyed → R4c), propagation 70 (attendee/email propagation + events;
recipients/owner strings remain). Projects surface re-score: click 70,
edit 80 (rename/folder/url/notes/assignment), discover 60, identity 65.
People: edit 75 (quick merge + suggestions). Platform: freeze fixed
(debounced persistence), downloads gated on connectivity + newest-first.

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

## 8. Merge safety & reversibility (BUILT — schema v30)

Merges are destructive folds (`mergeContacts`/`mergeProjects`): child FKs are
repointed and the loser row is deleted. Discovery (Round 4b) proposes them but
never executes — the user clicks. To make that click *reversible*, a merge
records what it did in `merge_journal`.

**`merge_journal` table (schema v30):**

| Column | Purpose |
|---|---|
| `id` | journal entry id |
| `kind` | `'contact'` \| `'project'` |
| `keeper_id` | surviving entity |
| `loser_snapshot` | JSON of the deleted loser row (all columns) — enough to recreate it |
| `repointed_manifest` | JSON of everything the fold touched: per junction the rows **repointed** loser→keeper and the ones **collided** (dropped), the loser's own aliases (cascade-deleted with it), the merge-created alias norm, and the keeper's **pre-merge** link set (for orphan detection) |
| `folded_fields` | JSON `{ field: {from, to} }` — the keeper fields the merge filled from the loser, with before/after values |
| `created_at` | ISO timestamp |
| `undone_at` | set when the merge is reversed (a journal row is unmerged at most once) |

The merge writes one journal row inside the same transaction as the fold. IPC:
`contacts:unmerge(journalId)` / `projects:unmerge(journalId)`,
`identity:getMergeJournal({kind, keeperId})` (open merges for an entity's "Merge
history"), and `identity:getMergeImpact({kind, keeperId, loserId})` (link counts
for the pre-merge gate).

**`contacts:unmerge(journalId)` semantics (implemented):**
1. Recreate the loser from `loser_snapshot` (re-INSERT with its original id).
2. Repoint back *exactly* the rows in `manifest` (keeper→loser) — no more, no less.
3. Rows linked to the keeper **after** the merge are NOT in the manifest, so they
   stay with the keeper and are returned as a **manual-review list**. This is the
   "a meeting got wrongly attached to the merged person — find it and reassign it"
   flow the user described: unmerge restores the split, then the user moves the
   one stray link by hand rather than the system guessing.
4. Delete the alias rows the merge created (folded loser-name → keeper), restore
   the folded keeper fields **only where the keeper still holds the folded value**
   (a newer user edit is never clobbered), recompute counts on both entities, and
   stamp `undone_at` (the journal row is kept as an audit trail, not deleted).
   Manifest rows that no longer exist (deleted / reassigned since the merge) are
   skipped and counted.

**Pre-merge warning heuristic (implemented):** if BOTH entities are heavily
linked (each with > N links across `meeting_contacts`/`transcript_speakers` for
contacts, `meeting_projects`/`knowledge_projects` for projects; N = 10 via
`getMergeImpact`), the merge UI (People quick-merge bar + PersonDetail dialog)
requires the user to **type the loser's name** to confirm — a wrong merge of two
well-established entities is the expensive mistake, and unmerge's manual-review
step is the safety net, not a substitute for the gate.

Discovery's `evidence.autoMergeable` flag never bypasses this — it only pre-selects
the card; execution is always an explicit, journaled, reversible click.

## 9. Ambiguous mention buckets + signal hierarchy (BUILT — schema v35)

A bare first name or nickname ("Sergio", "Sergi", "Santi", "Sebas") linked to dozens
of recordings is NOT a person — it is an **unresolved mention bucket** that may denote
several distinct people (Sergio Hurtado, Sergio Reyes). Merging real people into it,
or it into one of them, is wrong for ~half the mentions. Detection is a pure, tested
predicate (`detectAmbiguousName`): a single-token/nickname name that prefix- or
accent-matches ≥2 **distinct surname-bearing** contacts. Such a name is resolved
**per recording**, never by a global merge:

- The resolver never auto-links a bare first name to one of several surname-matches.
  With meeting context, exactly one matching attendee resolves it; zero or several
  keep it in the bucket, flagged `ambiguous`.
- `mention_resolutions(recording_id, source_name → resolved_contact_id, method)` stores
  the per-recording decision (UNIQUE per pair; `NULL` contact = explicit "Unclear").
- The "Resolve per meeting" card groups a bucket's recordings by best guess (with the
  signal shown), offering per-group "Assign all N" + per-recording override; discovery
  no longer proposes merging a real person into a bucket.

### Signal hierarchy (design principle — `signal-tiers.ts` is the source of truth)

> "this is better and easier if there is a meeting related, with calendar, emails, than
> if we rely completely on context." — prefer objective meeting/calendar/email evidence
> over transcript context; **never auto-link on LLM inference.**

| Tier | Method | ~Confidence | Source |
|---|---|---|---|
| 1 | `connector-email` | 1.00 | Connector-confirmed identity (email match: M365/Slack/Bamboo) |
| 2 | `attendee-email` | 0.90 | Linked-meeting attendee from **calendar** data (`attendees`/`organizer_email`) |
| — | `manual` | (user) | Explicit human pick in the card. **Sovereign — never auto-overwritten.** |
| 3 | `speaker-map` | 0.85 | User-confirmed transcript speaker assignment (`transcript_speakers`) |
| 4 | `attendee-context` | 0.70 | Sole candidate among the meeting's people, but those people are **transcript-derived** (today's reality — weak) |
| 5 | `lexical` | 0.60 | Full-name mention / co-presence in the transcript |
| 6 | `inferred` | — | LLM-inferred. **Never auto-links.** |

**CRITICAL DB FACT (verified read-only 2026-07-09):** 0 of 1,951 meetings carry
attendee JSON or `organizer_email` — the Outlook ICS feed strips them, so **all** current
`meeting_contacts` links are transcript-derived. Consequences, all built:
- `attendee-context` sits at Tier 4 (weak) today; `attendee-email` (Tier 2) only appears
  once a connector backfills real attendees.
- The auto-split sweep (`autoSplitAmbiguousBuckets`, run in `reconcileOrganization` +
  `identity:autoSplitBuckets`) is **upgrade-only and re-runnable** (`canUpgrade`): a
  higher-tier signal overwrites a lower-tier resolution, an equal/lower one is left alone
  (idempotent), and a `manual` pick is never touched. So when the **M365 connector**
  backfills real calendar attendees, a re-sweep upgrades those recordings
  `attendee-context → attendee-email` automatically.
- The card is **honest** about weak context: when a meeting has no calendar attendees it
  says "No calendar attendee lists yet — connect Microsoft 365 for automatic resolution"
  rather than showing a transcript guess as if it were authoritative. An **unlinked**
  recording's first action is "Link recording to its meeting" (linkage is upstream of
  identity).
