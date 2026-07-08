# Interactivity & Entity-Propagation Initiative — Design

Mission (Sebastián, 2026-07-08): maximize editability/clickability/hoverability of
every entity mention (people, projects, meetings, transcripts, dates, metadata),
with canonical-entity semantics: edit once → propagates everywhere; meeting info
(emails) flows to attendees; duplicate people get merged.

Audit basis: full data-model + per-surface inventory (2026-07-08). Key findings:
- `contacts`/`projects` are canonical; the ONLY id links are meeting_contacts /
  meeting_projects. Everything else stores raw NAME strings (attendees JSON,
  organizer, transcript speakers, action_items.assignee, follow_ups.owner,
  decisions.participants, actionables.suggested_recipients, graph nodes).
- Duplicate-generator: applyTranscriptEntities matches by LOWER(name) while
  upsertContactsFromMeetings matches by LOWER(email) → same person = 2 rows.
- No merge IPC, no attendee editing, no speaker→person mapping, no popover/
  hover-card/chip/combobox primitives, people clickable only in Explore.

## Architecture

Canonical entity + id-based mentions:
1. `transcript_speakers` map table (migration v25): recording_id + speaker_label
   → contact_id. Rendering resolves labels through the map; no transcript
   rewriting on assignment (transcripts stay immutable transcription artifacts).
2. `contacts.merge` + auto-dedupe pass modeled on mergeDuplicateRecordings
   (keeper ranking + child-FK repoint in one transaction).
3. Attendee edits go through contact upsert (email-first identity), then the
   meeting's attendees JSON is regenerated FROM meeting_contacts — the JSON
   becomes a projection, not a source of truth.
4. Propagation rule: adding an email to a name-only contact (or vice versa)
   updates the contact row; all id-linked surfaces follow automatically. A
   backfill pass re-links name-string surfaces opportunistically.
5. `<EntityMention>` renderer component (Round 2): person/project/meeting/date;
   click = navigate, hover = HoverCard (quick stats), optional inline edit.

## Rounds

### Round 1a — Identity backend (agent: r1-identity-backend)
- Migration v25: `transcript_speakers(recording_id, speaker_label, contact_id,
  UNIQUE(recording_id, speaker_label))`.
- `contacts:merge(keeperId, loserId)` — repoint meeting_contacts (OR IGNORE +
  delete collisions), transcript_speakers; fold email/role/company/notes/tags/
  type/meeting_count (keeper wins, null-fill from loser); delete loser. One tx.
- `mergeDuplicateContacts()` in org-reconciler: auto-merge ONLY on equal
  LOWER(email) (non-empty) or exact LOWER(name); ranked keeper (has email >
  has role/company > older). Runs in reconcileOrganization.
- `transcripts:assignSpeaker(recordingId, speakerLabel, { contactId | newName })`
  — upsert contact, write map row, link contact to recording's meeting via
  meeting_contacts when meeting_id present. Returns resolved contact.
- `transcripts:getSpeakerMap(recordingId)`.
- `meetings:addAttendee(meetingId, {name?, email?})` / `meetings:removeAttendee`
  / organizer edit in meetings:update — attendee ops upsert contact
  (email-first, then name), write meeting_contacts, regenerate attendees JSON.
  Email added to an existing name-matched contact UPDATES that contact (the
  propagation scenario).
- Preload + validation wiring; unit tests for merge ranking, assignSpeaker,
  attendee upsert propagation.

### Round 1b — Identity UI (agent: r1-identity-ui, after 1a lands)
- TranscriptViewer: speaker label becomes a button → popover (existing contacts
  list + "create person" input) → assignSpeaker; assigned labels render the
  person's name, styled as an entity.
- PersonDetail: "Merge into…" action (picker + confirm) → contacts:merge; type
  becomes editable (select), tags editable.
- MeetingDetail: attendee chips → /person/:id when resolvable; add-attendee
  (name+email) and remove; organizer editable.
- People page: "Add Person" stub → real create dialog (contacts.create wiring).

### Round 2 — Mentions everywhere (primitives + wiring)
- New primitives: popover, hover-card, badge/chip, command(combobox).
- `<EntityMention>` + `<PersonHoverCard>` / `<ProjectHoverCard>` /
  `<MeetingHoverCard>`.
- Wire: KnowledgeGraph results → /person + /meeting; Chat source chips →
  meeting/library; Actionables recipients → person chips; Today organizer;
  Project member rows → /person; dates → /calendar{date} everywhere.

### Round 4 — Progressive entity resolution + living knowledge graph
(User directive 2026-07-08 ~12:00: certainty values so the system stops
creating duplicate people/projects; entity metadata changes trigger graph
re-discovery; graph constantly and effortlessly updated.)

Recon facts (2026-07-08): graph nodes keyed by (type, normalized label) NOT
contact id — renames/merges orphan nodes; applyTranscriptEntities resolves by
exact LOWER(name) only (duplicate factory); graph ingest = LLM per transcript,
incremental via graph_ingested_transcripts, renderer-triggered ONLY (no
startup/event hook); event-bus exists but has no entity events; contacts has
no phone column.

R4a backend (after R3a lands; migration v27):
1. `contact_aliases(alias_norm UNIQUE, contact_id, source
   merge|speaker_assign|manual|inferred, confidence, created_at)` +
   `project_aliases`. Auto-populated: contacts:merge writes loser-name alias
   (1.0); assignSpeaker writes non-generic labels; accent-normalization pass.
2. `entity-resolver.ts`: resolveContact(name, ctx)/resolveProject(name, ctx) →
   {id?, confidence, method}. Tiers: exact email 1.0 > exact name .95 >
   alias .9 > accent-normalized .85 > fuzzy+context .6–.8 (context boost:
   candidate co-occurs in meeting attendees / same project). ≥.8 auto-link;
   .5–.8 → identity_suggestion row (NO new entity); <.5 → create new entity
   flagged low-certainty. Replace exact-name matching in
   applyTranscriptEntities; use in addAttendee + recipient resolution.
3. `identity_suggestions(id, kind person|project, candidate_name, target_id,
   confidence, evidence JSON, status pending|accepted|rejected)` + IPC
   list/accept/reject. Accept → alias + link (or merge); reject → alias-block.
4. Event bus: new domain events entity:contact-changed/merged,
   entity:speaker-assigned, entity:transcript-ready emitted at mutation
   points. Graph-sync subscriber: label-level node UPDATE/merge on contact
   rename/merge (no LLM — direct graph_nodes/graph_edges surgery); new
   transcripts auto-enqueue LLM ingest (debounced) so the graph updates
   without manual "Ingest".
5. Later (R4c): re-key person nodes by contact id during ingest.

R4b UI: identity-suggestions review queue (People page + Today card),
confidence badge on auto-created entities, alias list on PersonDetail.

### Round 3 — Deep editability
- Project rename inline (IPC already supports name) + projects:merge.
- Direct project assignment: knowledge/recording/actionable ↔ project junction
  + picker UI.
- Meeting start/end time inputs; actionable title/recipients editable;
  action_items assignee → contact picker.
- Knowledge-graph nodes keyed by contact id (re-ingest).

## Status
- [x] Round 1a — backend (commit 774c4904; migration v25 verified live)
- [x] Round 1b — UI (commit 2c2c54a8; speaker popover VERIFIED LIVE — 329
      speaker buttons on Rec43, popover lists full contact roster)
- [x] Round 2 — mentions everywhere (primitives: badge, hover-card; `<EntityMention>` +
      person/project/meeting hover cards; `useContactResolver`; wired into KnowledgeGraph,
      Chat source chips, Actionables recipients, Projects members, Today dates,
      MeetingDetail date-mention, Explore result cards, PersonDetail timeline)
- [~] Round 2b — speaker discoverability (USER FEEDBACK 11:4x with screenshots,
      agent r2b-speaker-discovery): hover cards on speaker labels (assigned →
      full person metadata; unassigned → identify hint), assigned-speaker
      actions (view person / change identity / reset to unidentified,
      left-click + right-click), rich picker rows (avatar, role · company,
      meeting count) — bare-name list useless with Sebas/Sebastián dupes.
- [~] Round 3a — deep-edit backend (agent r3-edit-backend): v26
      knowledge_projects junction, projects:merge, knowledge:setProjects,
      action_items.assignee_contact_id, graph:resolvePerson.
- [ ] Enhancement queue: accent/diacritic-normalized auto-merge (Oscar=Óscar
      safe); diminutive suggestions (Sebas→Sebastián) as UI hints, never auto.
      Also: recency-first queue landed with 774c4904 (recency principle).
