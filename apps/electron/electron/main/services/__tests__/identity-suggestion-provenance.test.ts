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
  const ev = {
    signals: { name: 0.6, email: 0, role: 0.2, graph: 0.2 },
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
