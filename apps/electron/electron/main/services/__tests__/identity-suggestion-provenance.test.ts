// @vitest-environment node

/**
 * ADV24-2 (round-25) — identity discovery + persisted-suggestion revalidation
 * route graph closeness / sharedTopics through the shared zero-provenance +
 * exclusion boundary (filterEligibleGraphEdgeIds). REAL temp DB, real services.
 *
 *  1. discoverContactMerges: a topic reached only via an ABOUT edge sourced by a
 *     VALUE-EXCLUDED or ZERO-PROVENANCE recording must NOT appear in a new
 *     suggestion's sharedTopics; an eligible-sourced topic must.
 *  2. revalidateSuggestionsForSurfacing (identity:getSuggestions read path):
 *     a pending suggestion whose graph/topic evidence became excluded is redacted
 *     and — when that evidence was load-bearing — dropped; eligible evidence
 *     survives; fail-closed on eligibility-lookup failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const dbPath = join(tmpdir(), `hidock-adv24-suggestion-prov-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import { initializeDatabase, closeDatabase, run, getIdentitySuggestions, getIdentitySuggestionById, type IdentitySuggestion } from '../database'
import {
  discoverContactMerges,
  revalidateSuggestionsForSurfacing,
  isSuggestionEligibleForAccept
} from '../identity-discovery'
import { normalizeName } from '../entity-normalize'

// --- seed helpers -----------------------------------------------------------

function createGraphTables(): void {
  run(`CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY, type TEXT, label TEXT, norm_key TEXT, props TEXT, created_at TEXT, updated_at TEXT)`)
  run(`CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, type TEXT, props TEXT, weight REAL, created_at TEXT)`)
  run(`CREATE TABLE IF NOT EXISTS graph_edge_sources (edge_id TEXT, recording_id TEXT, transcript_id TEXT)`)
}
function contact(id: string, name: string, opts: { role?: string; meetings?: number } = {}): void {
  run(
    `INSERT INTO contacts (id, name, type, role, first_seen_at, last_seen_at, meeting_count, created_at)
     VALUES (?, ?, 'team', ?, '2026-01-01', '2026-01-01', ?, '2026-01-01T00:00:00Z')`,
    [id, name, opts.role ?? null, opts.meetings ?? 0]
  )
}
function meeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
// v44/round-27: each attended meeting `m` is backed by a source recording `rec-${m}`
// (seedRecordingForMeeting), so the transcript-derived membership row is gated by
// that recording's eligibility — the ADV26-2 per-row mJac gate.
function attend(meetingId: string, contactId: string): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role, source, source_recording_id) VALUES (?, ?, 'attendee', 'transcript', ?)`, [
    meetingId,
    contactId,
    `rec-${meetingId}`
  ])
}
function node(id: string, type: string, label: string, normKey: string): void {
  run(`INSERT INTO graph_nodes (id, type, label, norm_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, [id, type, label, normKey])
}
function edge(id: string, source: string, target: string, type: string): void {
  run(`INSERT INTO graph_edges (id, source_id, target_id, type, created_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')`, [id, source, target, type])
}
function edgeSource(edgeId: string, recordingId: string): void {
  run('INSERT INTO graph_edge_sources (edge_id, recording_id) VALUES (?, ?)', [edgeId, recordingId])
}
function seedRecording(id: string): void {
  run('INSERT INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', [id, `${id}.hda`, new Date().toISOString()])
}
function seedRecordingForMeeting(id: string, meetingId: string): void {
  run('INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, ?, ?)', [
    id, `${id}.hda`, new Date().toISOString(), meetingId
  ])
}
function valueExclude(recordingId: string): void {
  run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)', [
    `cap-${recordingId}`, 'Cap', '2026-06-01', recordingId, 'garbage'
  ])
}

/**
 * Two contacts (Edu / Eduardo) that discovery will pair (name+role+shared
 * meetings). Both graph persons ATTENDED one shared graph-meeting that is ABOUT
 * topic "Falcon" via a single ABOUT edge whose provenance the caller controls.
 */
function seedPair(aboutProvenance: 'eligible' | 'excluded' | 'zero', opts: { meetings?: boolean } = {}): void {
  createGraphTables()
  contact('c-edu', 'Edu', { role: 'Project Manager', meetings: 2 })
  contact('c-eduardo', 'Eduardo', { role: 'PM', meetings: 3 })
  // Shared MEETINGS give discovery a name+role+meeting pair. The read-time
  // revalidation tests omit them (opts.meetings === false) so the ONLY graph
  // evidence between keeper and loser is the controlled "Falcon" topic edge.
  if (opts.meetings !== false) {
    for (const m of ['m1', 'm2']) {
      meeting(m); attend(m, 'c-edu'); attend(m, 'c-eduardo')
      // ADV25-2 (round-26): mJac now counts only ELIGIBLE meetings. Back these
      // shared meetings with a live (eligible) recording so the shared-meeting
      // signal survives — these topic-provenance tests are about topic edges, not
      // meeting-eligibility (that gate is exercised in its own describe below).
      seedRecordingForMeeting(`rec-${m}`, m)
    }
  }

  node('n-edu', 'person', 'Edu', normalizeName('Edu'))
  node('n-eduardo', 'person', 'Eduardo', normalizeName('Eduardo'))
  node('n-mg', 'meeting', 'Kickoff', 'kickoff')
  node('n-falcon', 'topic', 'Falcon', 'falcon')
  edge('att-edu', 'n-edu', 'n-mg', 'ATTENDED')
  edge('att-eduardo', 'n-eduardo', 'n-mg', 'ATTENDED')
  edge('ab-falcon', 'n-mg', 'n-falcon', 'ABOUT')

  if (aboutProvenance === 'eligible') {
    seedRecording('rec-ok')
    edgeSource('ab-falcon', 'rec-ok')
  } else if (aboutProvenance === 'excluded') {
    seedRecording('rec-bad')
    valueExclude('rec-bad')
    edgeSource('ab-falcon', 'rec-bad')
  }
  // 'zero' → ab-falcon has NO graph_edge_sources row.
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('discoverContactMerges — graph topic provenance (ADV24-2 write path)', () => {
  it('includes an eligible-sourced topic in sharedTopics', () => {
    seedPair('eligible')
    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1)
    const ev = JSON.parse(getIdentitySuggestions('pending')[0].evidence!)
    expect(ev.sharedTopics).toContain('Falcon')
  })

  it('suppresses a value-excluded-sourced topic from sharedTopics', () => {
    seedPair('excluded')
    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1) // still paired on name+role+meetings
    const ev = JSON.parse(getIdentitySuggestions('pending')[0].evidence!)
    expect(ev.sharedTopics).not.toContain('Falcon')
  })

  it('suppresses a zero-provenance (legacy) topic from sharedTopics', () => {
    seedPair('zero')
    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1)
    const ev = JSON.parse(getIdentitySuggestions('pending')[0].evidence!)
    expect(ev.sharedTopics).not.toContain('Falcon')
  })
})

// --- read-time revalidation --------------------------------------------------

/**
 * Insert a persisted pending suggestion whose graph signal is LOAD-BEARING:
 * composite 0.55 with graph 0.15 → removing the topic contribution drops it below
 * the 0.50 surfacing bar. Keeper/loser have NO shared meetings, so the ONLY graph
 * evidence is the "Falcon" topic (controlled by ab-falcon's provenance).
 */
function insertGraphOnlySuggestion(): void {
  const ev = {
    signals: { name: 0.65, email: 0, role: 0, graph: 0.15 },
    composite: 0.55,
    sharedTopics: ['Falcon'],
    sharedMeetings: 0,
    keeperId: 'c-eduardo',
    keeperName: 'Eduardo',
    loserId: 'c-edu',
    loserName: 'Edu',
    emailMatch: 'none'
  }
  run(
    `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
     VALUES (?, 'person', 'Edu', 'c-eduardo', 0.55, ?, 'pending', '2026-01-01T00:00:00Z')`,
    [randomUUID(), JSON.stringify(ev)]
  )
}
function surfaced(): IdentitySuggestion[] {
  return revalidateSuggestionsForSurfacing(getIdentitySuggestions('pending'))
}

describe('revalidateSuggestionsForSurfacing — persisted evidence (ADV24-2 read path)', () => {
  it('keeps a suggestion whose topic evidence is still eligible', () => {
    seedPair('eligible', { meetings: false })
    insertGraphOnlySuggestion()
    const rows = surfaced()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].evidence!).sharedTopics).toContain('Falcon')
  })

  it('supersedes (drops) a suggestion whose topic evidence became value-excluded', () => {
    seedPair('excluded', { meetings: false })
    insertGraphOnlySuggestion()
    // The stale suggestion is NOT surfaced (graph/topic evidence load-bearing + gone).
    expect(surfaced()).toHaveLength(0)
    // Non-destructive: the DB row still exists (un-trash would re-surface it).
    expect(getIdentitySuggestions('pending')).toHaveLength(1)
  })

  it('supersedes (drops) a suggestion grounded on a zero-provenance legacy topic', () => {
    seedPair('zero', { meetings: false })
    insertGraphOnlySuggestion()
    expect(surfaced()).toHaveLength(0)
  })

  it('redacts excluded topics but KEEPS a suggestion that still clears the bar without them', () => {
    seedPair('excluded')
    // composite 0.75, graph 0.15 → without the topic, 0.60 ≥ 0.50 ⇒ kept, topics redacted.
    const ev = {
      signals: { name: 0.9, email: 0, role: 0, graph: 0.15 },
      composite: 0.75,
      sharedTopics: ['Falcon'],
      sharedMeetings: 0,
      keeperId: 'c-eduardo', keeperName: 'Eduardo', loserId: 'c-edu', loserName: 'Edu', emailMatch: 'none'
    }
    run(
      `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
       VALUES (?, 'person', 'Edu', 'c-eduardo', 0.75, ?, 'pending', '2026-01-01T00:00:00Z')`,
      [randomUUID(), JSON.stringify(ev)]
    )
    const rows = surfaced()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].evidence!).sharedTopics).toEqual([])
  })

  it('fails closed: suppresses a graph-grounded pending suggestion when eligibility throws', () => {
    seedPair('eligible', { meetings: false })
    insertGraphOnlySuggestion()
    // Break the positive allowlist (knowledge_captures NOT-EXISTS subquery).
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')
    // filterEligibleGraphEdgeIds fail-closed ⇒ topic dropped ⇒ composite 0.40 ⇒ dropped.
    expect(surfaced()).toHaveLength(0)
  })

  it('leaves a name/email-only suggestion (no graph component) untouched', () => {
    seedPair('excluded')
    const ev = {
      signals: { name: 0.9, email: 0.35, role: 0, graph: 0 },
      composite: 0.96,
      sharedTopics: [],
      sharedMeetings: 0,
      keeperId: 'c-eduardo', keeperName: 'Eduardo', loserId: 'c-edu', loserName: 'Edu', emailMatch: 'exact'
    }
    run(
      `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
       VALUES (?, 'person', 'Edu', 'c-eduardo', 0.96, ?, 'pending', '2026-01-01T00:00:00Z')`,
      [randomUUID(), JSON.stringify(ev)]
    )
    const rows = surfaced()
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].confidence)).toBeGreaterThanOrEqual(0.95)
  })
})

// --- ADV25-2: mJac eligible-meeting gating -----------------------------------

/**
 * Two contacts linked ONLY via shared meetings (no graph topic edges). The
 * meetings are backed by recordings whose provenance the caller controls, so the
 * shared-meeting mJac is the ONLY graph evidence. Composite 0.60 with graph 0.20 —
 * removing the mJac contribution drops it below the 0.50 surfacing bar.
 */
function seedMeetingOnlyPair(recProvenance: 'eligible' | 'excluded'): void {
  createGraphTables()
  contact('c-edu', 'Edu', { role: 'PM' })
  contact('c-eduardo', 'Eduardo', { role: 'PM' })
  for (const m of ['m1', 'm2']) {
    meeting(m); attend(m, 'c-edu'); attend(m, 'c-eduardo')
    seedRecordingForMeeting(`rec-${m}`, m)
    if (recProvenance === 'excluded') valueExclude(`rec-${m}`)
  }
}
function insertMeetingOnlySuggestion(): void {
  // ADV51-1 (round-53) FLIP: role is now recomputed from CURRENT field provenance at
  // surfacing. These seeded 'PM' roles carry no provenance marker (NULL
  // role_source_recording_id + NULL role_origin) so the field sanitizer treats them
  // as untrusted legacy roles and blanks them — a baked-in role:0.2 would therefore be
  // (correctly) removed and drop this meeting-gating suggestion for the wrong reason.
  // This test isolates the mJac (meeting) gate, so the role component is 0 here.
  const ev = {
    signals: { name: 0.6, email: 0, role: 0, graph: 0.2 },
    composite: 0.6,
    sharedTopics: [],
    sharedMeetings: 2,
    keeperId: 'c-eduardo', keeperName: 'Eduardo', loserId: 'c-edu', loserName: 'Edu', emailMatch: 'none'
  }
  run(
    `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
     VALUES (?, 'person', 'Edu', 'c-eduardo', 0.6, ?, 'pending', '2026-01-01T00:00:00Z')`,
    [randomUUID(), JSON.stringify(ev)]
  )
}

describe('revalidateSuggestionsForSurfacing — mJac eligible-meeting gating (ADV25-2)', () => {
  it('counts ELIGIBLE-meeting-backed links ⇒ keeps the suggestion', () => {
    seedMeetingOnlyPair('eligible')
    insertMeetingOnlySuggestion()
    expect(surfaced()).toHaveLength(1)
  })

  it('drops the mJac contribution of EXCLUDED-recording-backed meetings ⇒ below threshold ⇒ dropped', () => {
    seedMeetingOnlyPair('excluded')
    insertMeetingOnlySuggestion()
    expect(surfaced()).toHaveLength(0)
    // Non-destructive — the DB row remains (un-exclude would re-surface it).
    expect(getIdentitySuggestions('pending')).toHaveLength(1)
  })
})

// --- ADV25-5: below-threshold drop regardless of loserId + malformed evidence -

describe('revalidateSuggestionsForSurfacing — below-threshold + malformed (ADV25-5)', () => {
  it('drops a graph-bearing suggestion WITHOUT a loserId whose recomputed composite is below threshold', () => {
    seedPair('excluded', { meetings: false }) // Falcon topic edge suppressed
    // No loserId → pre-round-26 this row was returned even below threshold.
    const ev = {
      signals: { name: 0.65, email: 0, role: 0, graph: 0.15 },
      composite: 0.55,
      sharedTopics: ['Falcon'],
      sharedMeetings: 0,
      keeperId: 'c-eduardo', keeperName: 'Eduardo', loserName: 'Edu', emailMatch: 'none'
    }
    run(
      `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
       VALUES (?, 'person', 'Edu', 'c-eduardo', 0.55, ?, 'pending', '2026-01-01T00:00:00Z')`,
      [randomUUID(), JSON.stringify(ev)]
    )
    expect(surfaced()).toHaveLength(0)
  })

  it('suppresses a pending suggestion whose evidence blob is malformed (fail-closed)', () => {
    run(
      `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
       VALUES (?, 'person', 'Edu', 'c-eduardo', 0.7, ?, 'pending', '2026-01-01T00:00:00Z')`,
      [randomUUID(), '{ this is not valid json']
    )
    expect(surfaced()).toHaveLength(0)
    // Non-destructive — the row remains.
    expect(getIdentitySuggestions('pending')).toHaveLength(1)
  })
})

// --- ADV26-1 (round-27): transcript-created suggestions (no graph evidence) ---

/**
 * applyTranscriptEntities creates suggestions with NO graph/topic evidence, so the
 * round-26 revalidator passed them through unvalidated. Round-27 persists the
 * authoritative source recording id(s) on the row and gates the suggestion through
 * the recording allowlist at SURFACE and ACCEPT: an excluded/purged source ⇒
 * suppressed + refused; a legacy (NULL-provenance, no-signals) transcript
 * suggestion ⇒ suppressed fail-closed.
 */
function insertTranscriptSuggestion(opts: { sourceIds: string[] | null; candidate?: string }): string {
  const id = randomUUID()
  const ev = { method: 'fuzzy', meetingId: 'm-t', coOccurring: [] } // NO signals / sharedTopics
  const src = opts.sourceIds === null ? null : JSON.stringify(opts.sourceIds)
  run(
    `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at, source_recording_ids)
     VALUES (?, 'person', ?, 'c-eduardo', 0.65, ?, 'pending', '2026-01-01T00:00:00Z', ?)`,
    [id, opts.candidate ?? 'Edu', JSON.stringify(ev), src]
  )
  return id
}

describe('transcript-created suggestions — recording-allowlist revalidation (ADV26-1)', () => {
  it('surfaces AND accepts a transcript suggestion whose source recording is ELIGIBLE', () => {
    contact('c-eduardo', 'Eduardo')
    contact('c-edu', 'Edu')
    seedRecording('rec-live')
    const id = insertTranscriptSuggestion({ sourceIds: ['rec-live'] })

    expect(surfaced()).toHaveLength(1)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(true)
  })

  it('does NOT surface and REFUSES accept when the source recording is value-excluded', () => {
    contact('c-eduardo', 'Eduardo')
    contact('c-edu', 'Edu')
    seedRecording('rec-bad')
    valueExclude('rec-bad')
    const id = insertTranscriptSuggestion({ sourceIds: ['rec-bad'] })

    expect(surfaced()).toHaveLength(0)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
    // Non-destructive — the row remains.
    expect(getIdentitySuggestions('pending')).toHaveLength(1)
  })

  it('does NOT surface a transcript suggestion whose source recording was hard-purged (absent)', () => {
    contact('c-eduardo', 'Eduardo')
    contact('c-edu', 'Edu')
    // No recording row for 'rec-gone' — the positive allowlist rejects a missing id.
    const id = insertTranscriptSuggestion({ sourceIds: ['rec-gone'] })

    expect(surfaced()).toHaveLength(0)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
  })

  it('does NOT surface a transcript suggestion with EMPTY known provenance', () => {
    contact('c-eduardo', 'Eduardo')
    contact('c-edu', 'Edu')
    const id = insertTranscriptSuggestion({ sourceIds: [] })

    expect(surfaced()).toHaveLength(0)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
  })

  it('suppresses a LEGACY (NULL provenance, no signals) transcript suggestion fail-closed', () => {
    contact('c-eduardo', 'Eduardo')
    contact('c-edu', 'Edu')
    const id = insertTranscriptSuggestion({ sourceIds: null }) // NULL column = legacy

    expect(surfaced()).toHaveLength(0)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
  })

  it('fails closed: suppresses a transcript suggestion when the eligibility lookup throws', () => {
    contact('c-eduardo', 'Eduardo')
    contact('c-edu', 'Edu')
    seedRecording('rec-live')
    const id = insertTranscriptSuggestion({ sourceIds: ['rec-live'] })
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures') // breaks the positive allowlist subquery

    expect(surfaced()).toHaveLength(0)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
  })
})

// --- ADV48-1 (round-50): rarity mention COUNT eligibility + recompute -----------

/**
 * The rarity scorer's transcript-mention COUNT (the `normal → common` promotion
 * that docks −0.15) must route recording provenance through the shared allowlist.
 * A name common ONLY via personal/soft-deleted/value-excluded/orphan(legacy)
 * transcripts must NOT be tagged 'common'; a lookup failure fails closed to 0
 * mentions. Persisted suggestions whose 'common' rarity derived from now-excluded
 * transcripts are recomputed at surfacing + accept.
 */

// A transcript FK-references its recording, so a hard-purge cascades the
// transcript too — an orphan (recording-gone) transcript can't exist. The retained
// states that DO keep the transcript around are personal / soft-deleted /
// value-excluded; those are what the mention count must exclude.
function mention(
  recId: string,
  text: string,
  opts: { personal?: boolean; deleted?: boolean; valueExcluded?: boolean } = {}
): void {
  seedRecording(recId)
  run(`INSERT INTO transcripts (id, recording_id, full_text) VALUES (?, ?, ?)`, [randomUUID(), recId, text])
  if (opts.personal) run('UPDATE recordings SET personal = 1 WHERE id = ?', [recId])
  if (opts.deleted) run('UPDATE recordings SET deleted_at = ? WHERE id = ?', ['2026-06-01T00:00:00Z', recId])
  if (opts.valueExcluded) valueExclude(recId)
}

/** Seed `n` transcripts mentioning `text`, all with the same exclusion opts. */
function seedMentions(prefix: string, text: string, n: number, opts: Parameters<typeof mention>[2] = {}): void {
  for (let i = 0; i < n; i++) mention(`${prefix}-${i}`, text, opts)
}

// Two contacts discovery pairs via a SHARED EXACT EMAIL (composite floored to 0.96,
// so the pair survives regardless of the rarity delta — isolating the rarity LABEL
// under test). Distinct SHORT first tokens ('ana'/'ane') with 1 bearer each keep
// bearers classified 'normal' so the transcript-mention COUNT drives rarity.
function seedEmailPair(): void {
  contact('c-al', 'Ana Lima', {})
  run(`UPDATE contacts SET email = 'a.lima@dfx5.com', meeting_count = 5 WHERE id = 'c-al'`)
  contact('c-al2', 'Ane Lima', {})
  run(`UPDATE contacts SET email = 'a.lima@dfx5.com', meeting_count = 1 WHERE id = 'c-al2'`)
}
function paired(): any {
  const rows = getIdentitySuggestions('pending')
  return rows.length ? JSON.parse(rows[0].evidence!) : null
}

describe('identity-discovery rarity mention COUNT — recording eligibility (ADV48-1 write path)', () => {
  it('tags rarity:common when the name is common across ELIGIBLE transcripts', () => {
    seedEmailPair()
    seedMentions('t-ok', 'Recap with Ana Lima today', 42) // 42 eligible ≥ COMMON_MENTIONS(40)
    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1)
    expect(paired().rarity).toBe('common')
  })

  it('does NOT tag common when the name is common ONLY via EXCLUDED transcripts', () => {
    seedEmailPair()
    // 45 excluded mentions (mixed states) + 3 eligible ⇒ eligible count 3 < 40.
    seedMentions('t-personal', 'Sync with Ana Lima', 15, { personal: true })
    seedMentions('t-deleted', 'Sync with Ana Lima', 15, { deleted: true })
    seedMentions('t-value', 'Sync with Ana Lima', 15, { valueExcluded: true })
    seedMentions('t-live', 'Sync with Ana Lima', 3)
    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1)
    expect(paired().rarity).not.toBe('common') // only 3 eligible ⇒ normal
  })

  it('fails closed (0 mentions ⇒ not common) when the eligibility lookup throws', () => {
    seedEmailPair()
    seedMentions('t-ok', 'Recap with Ana Lima today', 42) // would be common if counted raw
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures') // breaks the positive allowlist subquery
    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1)
    expect(paired().rarity).not.toBe('common') // fail-closed ⇒ 0 eligible mentions
  })
})

/**
 * Persisted suggestion tagged 'common' with the −0.15 baked into its composite
 * (i.e. a name-only 0.70 stored as 0.55). Keeper/loser bear SHORT distinct tokens
 * with 1 bearer each so bearers classify 'normal' — only the mention count can make
 * it 'common'.
 */
function insertCommonRaritySuggestion(): string {
  contact('c-al', 'Ana Lima', {})
  contact('c-al2', 'Ane Lima', {})
  const id = randomUUID()
  const ev = {
    signals: { name: 0.7, email: 0, role: 0, graph: 0 },
    composite: 0.55, // 0.70 name − 0.15 common delta
    sharedTopics: [],
    sharedMeetings: 0,
    keeperId: 'c-al',
    keeperName: 'Ana Lima',
    loserId: 'c-al2',
    loserName: 'Ane Lima',
    emailMatch: 'none',
    rarity: 'common',
  }
  run(
    `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
     VALUES (?, 'person', 'Ane Lima', 'c-al', 0.55, ?, 'pending', '2026-01-01T00:00:00Z')`,
    [id, JSON.stringify(ev)]
  )
  return id
}

describe('revalidateSuggestionsForSurfacing — rarity recompute (ADV48-1 read path)', () => {
  it('corrects a persisted common rarity to normal when its mentions are now all EXCLUDED', () => {
    const id = insertCommonRaritySuggestion()
    // 42 EXCLUDED mentions — an unfiltered count would keep it 'common'.
    seedMentions('t-personal', 'Talk with Ana Lima', 21, { personal: true })
    seedMentions('t-deleted', 'Talk with Ana Lima', 21, { deleted: true })

    const rows = surfaced()
    expect(rows).toHaveLength(1)
    const ev = JSON.parse(rows[0].evidence!)
    expect(ev.rarity).toBeUndefined() // demoted from 'common'
    // −0.15 penalty removed ⇒ composite raised 0.55 → 0.70.
    expect(Number(rows[0].confidence)).toBeCloseTo(0.7, 2)

    // Accept revalidates through the same path ⇒ eligible (clears the bar).
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(true)
  })

  it('keeps common when the name is genuinely common across ELIGIBLE transcripts', () => {
    insertCommonRaritySuggestion()
    seedMentions('t-live', 'Talk with Ana Lima', 42) // eligible ≥ 40

    const rows = surfaced()
    expect(rows).toHaveLength(1)
    const ev = JSON.parse(rows[0].evidence!)
    expect(ev.rarity).toBe('common') // still common ⇒ penalty preserved
    expect(Number(rows[0].confidence)).toBeCloseTo(0.55, 2)
  })

  // ADV49-3 (round-51) FLIP of the round-50 "fail-closed to 0" behavior: a rarity
  // mention-count lookup FAILURE must NOT be treated as a confident 0 (which would
  // REMOVE the 'common' penalty and RAISE confidence). It must SUPPRESS at surfacing
  // and REJECT at accept — otherwise a below-threshold suggestion could cross the
  // accept bar precisely while eligibility can't be verified, authorizing a merge.
  it('SUPPRESSES at surfacing and REFUSES accept when the rarity mention lookup fails (ADV49-3)', () => {
    const id = insertCommonRaritySuggestion()
    // Matching transcripts EXIST (so the eligibility lookup is actually attempted)…
    seedMentions('t-live', 'Talk with Ana Lima', 3)
    // …but the eligibility allowlist cannot complete (value-exclusion subquery table gone).
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')

    // Surfacing suppresses the suggestion — a bare-0 count must not raise confidence.
    expect(surfaced()).toHaveLength(0)
    // Accept refuses the merge (confidence not raised, merge not authorized).
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
  })
})

// --- ADV50-2 (round-52): rarity BEARER-corpus lookup fails closed ----------------

/**
 * The rarity recompute consults TWO corpora: the transcript-mention count (ADV49-3,
 * already fail-closed) AND the BEARER corpus (SELECT name FROM contacts/projects).
 * The bearer lookup used to swallow a query failure into an EMPTY map ⇒ bearerCount 0
 * ⇒ for a LONG token pairRarity classifies the pair RARE (+0.05) WITHOUT consulting
 * the mention counter, RAISING confidence during a DB fault. The bearer lookup must
 * fail CLOSED like the mention lookup: EITHER corpus unverifiable ⇒ suppress at
 * surfacing + refuse at accept, confidence NOT raised.
 *
 * Distinct LONG first tokens ('yaravid'/'yaravon', >4 chars, 1 bearer each) drive the
 * RARE early-return branch that never consults the mention counter — exactly where the
 * bug lived. An exact-email match would otherwise floor the composite so the pair
 * survives, isolating the fail-closed SUPPRESSION under test.
 */
function insertLongTokenRareSuggestion(): string {
  contact('c-yv', 'Yaravid Ortega', {})
  contact('c-yv2', 'Yaravon Ortega', {})
  const id = randomUUID()
  const ev = {
    signals: { name: 0.7, email: 1, role: 0, graph: 0 },
    composite: 0.96, // email-exact floored — survives absent the fail-closed drop
    sharedTopics: [],
    sharedMeetings: 0,
    keeperId: 'c-yv',
    keeperName: 'Yaravid Ortega',
    loserId: 'c-yv2',
    loserName: 'Yaravon Ortega',
    emailMatch: 'exact',
  }
  run(
    `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
     VALUES (?, 'person', 'Yaravon Ortega', 'c-yv', 0.96, ?, 'pending', '2026-01-01T00:00:00Z')`,
    [id, JSON.stringify(ev)]
  )
  return id
}

describe('rarity BEARER corpus — fail-closed (ADV50-2)', () => {
  it('both corpora healthy ⇒ the suggestion surfaces and is acceptable', () => {
    const id = insertLongTokenRareSuggestion()
    const rows = surfaced()
    expect(rows).toHaveLength(1)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(true)
  })

  it('SUPPRESSES at surfacing and REFUSES accept when the bearer corpus lookup fails', () => {
    const id = insertLongTokenRareSuggestion()
    // Break ONLY the bearer corpus query (contacts) — the mention lookup stays healthy,
    // isolating the BEARER fail-closed path (a bare-0 bearerCount must NOT classify the
    // long-token pair rare + raise confidence during a DB fault).
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE contacts')

    // Surfacing suppresses (confidence not raised from an unverifiable corpus).
    expect(surfaced()).toHaveLength(0)
    // Accept refuses the merge (not authorized while the corpus can't be verified).
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
  })
})

// --- ADV51-2 (round-53): mention transcript CORPUS query fails closed -------------

/**
 * Round 51 propagated only the ELIGIBILITY-lookup failure to failClosed; the
 * transcript CORPUS SELECT still used safeQueryAll (catch ⇒ empty ⇒ trusted 0). A
 * transcript-query failure must fail CLOSED too: a false 0 removes the 'common'
 * penalty and raises confidence while the corpus can't be read. Here bearers + the
 * eligibility subquery stay healthy and ONLY the transcripts table is broken.
 */
describe('rarity mention CORPUS query — fail-closed (ADV51-2)', () => {
  it('SUPPRESSES at surfacing and REFUSES accept when the transcript SELECT itself throws', () => {
    const id = insertCommonRaritySuggestion() // short 'ana'/'ane' tokens ⇒ mention count consulted
    seedMentions('t-live', 'Talk with Ana Lima', 3) // would be counted if the query worked
    // Break ONLY the transcript corpus query — contacts (bearers) + knowledge_captures
    // (eligibility subquery) remain intact, isolating the CORPUS-query fail-closed path.
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE transcripts')

    expect(surfaced()).toHaveLength(0)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
  })
})

// --- ADV51-3 (round-53): bearer corpus is VISIBILITY-filtered ---------------------

function visibleContact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, source, first_seen_at, last_seen_at, meeting_count, created_at)
     VALUES (?, ?, 'team', 'calendar', '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z')`,
    [id, name]
  )
}
/** A transcript-origin contact whose ONLY source recording is value-excluded ⇒ suppressed. */
function excludedOnlyContact(id: string, name: string): void {
  const rec = `rec-exc-${id}`
  seedRecording(rec)
  valueExclude(rec)
  run(
    `INSERT INTO contacts (id, name, type, source, source_recording_id, first_seen_at, last_seen_at, meeting_count, created_at)
     VALUES (?, ?, 'team', 'transcript', ?, '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z')`,
    [id, name, rec]
  )
}

describe('rarity BEARER corpus — visibility filtering (ADV51-3)', () => {
  it('does NOT count EXCLUDED-ONLY entities as bearers ⇒ a name common only via them is demoted', () => {
    insertCommonRaritySuggestion() // tagged 'common' via a persisted −0.15
    // Three more 'Ana …' bearers, each a suppressed (excluded-only) entity. They must
    // NOT count toward the 'ana' base rate ⇒ the persisted 'common' is demoted at surface.
    for (let i = 0; i < 3; i++) excludedOnlyContact(`c-anaX-${i}`, `Ana Ex${i}`)
    const rows = surfaced()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].evidence!).rarity).toBeUndefined() // excluded bearers don't skew ⇒ normal
  })

  it('DOES count VISIBLE entities as bearers ⇒ keeps common (control)', () => {
    insertCommonRaritySuggestion()
    for (let i = 0; i < 3; i++) visibleContact(`c-anaV-${i}`, `Ana Vis${i}`)
    const rows = surfaced()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].evidence!).rarity).toBe('common') // 3 visible 'ana' bearers ⇒ common
  })
})

// --- ADV51-1 (round-53): discovery ROLE evidence is provenance-sanitized ----------

/** Insert a contact with an explicit role provenance (role_source_recording_id/role_origin). */
function contactWithRole(
  id: string,
  name: string,
  role: string,
  opts: { roleSourceRecordingId?: string; roleOrigin?: string } = {}
): void {
  run(
    `INSERT INTO contacts (id, name, type, role, role_source_recording_id, role_origin, source, first_seen_at, last_seen_at, meeting_count, created_at)
     VALUES (?, ?, 'team', ?, ?, ?, 'calendar', '2026-01-01', '2026-01-01', 0, '2026-01-01T00:00:00Z')`,
    [id, name, role, opts.roleSourceRecordingId ?? null, opts.roleOrigin ?? null]
  )
}

/**
 * A ROLE-load-bearing person suggestion: composite 0.65 with a role boost of 0.20
 * (PM ≈ Project Manager). Removing the role component drops it to 0.45 < 0.50. The
 * names bear distinct short first tokens ('edu'/'eduardo' ⇒ token 'edu') so rarity is
 * a no-op and only the role recompute moves the composite.
 */
function insertRoleSuggestion(keeperId: string, loserId: string): string {
  const id = randomUUID()
  const ev = {
    signals: { name: 0.45, email: 0, role: 0.2, graph: 0 },
    composite: 0.65,
    sharedTopics: [],
    roleOverlap: ['project', 'manager'],
    sharedMeetings: 0,
    keeperId,
    keeperName: 'Edu',
    loserId,
    loserName: 'Eduardo',
    emailMatch: 'none',
  }
  run(
    `INSERT INTO identity_suggestions (id, kind, candidate_name, target_id, confidence, evidence, status, created_at)
     VALUES (?, 'person', 'Eduardo', ?, 0.65, ?, 'pending', '2026-01-01T00:00:00Z')`,
    [id, keeperId, JSON.stringify(ev)]
  )
  return id
}

describe('discovery role evidence — field-provenance sanitize + recompute (ADV51-1)', () => {
  it('keeps a suggestion whose role is a trusted (manual) role', () => {
    contactWithRole('c-edu', 'Edu', 'Project Manager', { roleOrigin: 'manual' })
    contactWithRole('c-eduardo', 'Eduardo', 'PM', { roleOrigin: 'manual' })
    const id = insertRoleSuggestion('c-edu', 'c-eduardo')
    const rows = surfaced()
    expect(rows).toHaveLength(1)
    const ev = JSON.parse(rows[0].evidence!)
    expect(ev.signals.role).toBeGreaterThan(0) // role preserved
    expect(ev.roleOverlap).toEqual(expect.arrayContaining(['project', 'manager']))
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(true)
  })

  it('drops the role boost + roleOverlap when the role source recording is EXCLUDED ⇒ suggestion falls below threshold', () => {
    seedRecording('rec-bad')
    valueExclude('rec-bad')
    // Keeper's role was learned from a now value-excluded recording ⇒ blanked ⇒ no boost.
    contactWithRole('c-edu', 'Edu', 'Project Manager', { roleSourceRecordingId: 'rec-bad' })
    contactWithRole('c-eduardo', 'Eduardo', 'PM', { roleOrigin: 'manual' })
    const id = insertRoleSuggestion('c-edu', 'c-eduardo')
    // 0.65 − 0.20 role = 0.45 < 0.50 ⇒ suppressed at surfacing + refused at accept.
    expect(surfaced()).toHaveLength(0)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
    // Non-destructive — the row remains (un-exclude the recording would re-surface it).
    expect(getIdentitySuggestions('pending')).toHaveLength(1)
  })

  it('SUPPRESSES at surfacing and REFUSES accept when the role provenance lookup fails (fail-closed)', () => {
    seedRecording('rec-x')
    contactWithRole('c-edu', 'Edu', 'Project Manager', { roleSourceRecordingId: 'rec-x' })
    contactWithRole('c-eduardo', 'Eduardo', 'PM', { roleOrigin: 'manual' })
    const id = insertRoleSuggestion('c-edu', 'c-eduardo')
    // Break the role-eligibility lookup (value-exclusion subquery table gone) — the role
    // is attributed to a recording whose eligibility can no longer be verified.
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')
    expect(surfaced()).toHaveLength(0)
    expect(isSuggestionEligibleForAccept(getIdentitySuggestionById(id)!)).toBe(false)
  })

  it('does NOT feed an excluded transcript-derived role into a NEW discovery suggestion (write path)', () => {
    // Both contacts pair on an EXACT email (composite floored 0.96 ⇒ survives) so the
    // suggestion is created regardless; the ROLE tokens must be absent because the
    // shared role was learned from an excluded recording and is blanked before scoring.
    seedRecording('rec-bad')
    valueExclude('rec-bad')
    run(
      `INSERT INTO contacts (id, name, email, type, role, role_source_recording_id, source, first_seen_at, last_seen_at, meeting_count, created_at)
       VALUES ('c-r1', 'Marco Vela', 'm.vela@dfx5.com', 'team', 'Project Manager', 'rec-bad', 'calendar', '2026-01-01', '2026-01-01', 5, '2026-01-01T00:00:00Z')`
    )
    run(
      `INSERT INTO contacts (id, name, email, type, role, role_source_recording_id, source, first_seen_at, last_seen_at, meeting_count, created_at)
       VALUES ('c-r2', 'Marc Vela', 'm.vela@dfx5.com', 'team', 'Project Manager', 'rec-bad', 'calendar', '2026-01-01', '2026-01-01', 1, '2026-01-01T00:00:00Z')`
    )
    const res = discoverContactMerges()
    expect(res.suggestionsCreated).toBe(1)
    const ev = JSON.parse(getIdentitySuggestions('pending')[0].evidence!)
    expect(ev.signals.role).toBe(0) // excluded role contributes nothing
    expect(ev.roleOverlap).toEqual([])
  })
})
