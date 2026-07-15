// @vitest-environment node

/**
 * ADV14 (merge-gate round 14) + round-15 read-surface sweep — REAL temp-DB proof
 * that the transcript/graph-DERIVED read surfaces reachable from non-exempt
 * discovery UIs route recording ids through the shared fail-closed positive
 * allowlist. Covers:
 *   - getRecurringTopics   (db:get-recurring-topics → Explore, on-mount)
 *   - getMentionSnippets   (identity:getMentionSnippets → Identity merge cards)
 *   - getPersonContext     (identity:getPersonContext  → Identity merge cards)
 *
 * An eligible recording contributes; a personal / soft-deleted / value-excluded /
 * nonexistent one never does; an eligible contributor ranked behind excluded rows
 * still surfaces; a fail-closed eligibility lookup yields nothing (recording-
 * attributed) while legacy unattributed graph edges survive.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv14-read-sweep-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  getMentionSnippets,
  getPersonContext
} from '../database'
import { getRecurringTopics } from '../recurring-topics'

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    `${id}.hda`,
    // Recent so the recurring-topics 90-day window includes it.
    new Date().toISOString(),
    opts.personal ? 1 : 0,
    opts.deleted ? '2026-07-01T00:00:00.000Z' : null
  ])
}

/** Attach a garbage-rated capture (no keep) so the recording is value-excluded (F16). */
function valueExclude(recordingId: string): void {
  run(
    'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)',
    [`cap-${recordingId}`, 'Cap', '2026-06-01', recordingId, 'garbage']
  )
}

function seedTranscript(recordingId: string, opts: { fullText?: string; topics?: string[] }): void {
  run(
    'INSERT INTO transcripts (id, recording_id, full_text, topics) VALUES (?, ?, ?, ?)',
    [
      `t-${recordingId}`,
      recordingId,
      opts.fullText ?? 'placeholder body',
      opts.topics ? JSON.stringify(opts.topics) : null
    ]
  )
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('getRecurringTopics — value-eligibility gate (ADV14)', () => {
  it('only eligible recordings contribute topics and counts', () => {
    seedRecording('rt-ok')
    seedTranscript('rt-ok', { topics: ['Roadmap', 'Budget'] })

    seedRecording('rt-personal', { personal: true })
    seedTranscript('rt-personal', { topics: ['Roadmap', 'Secrets'] })

    seedRecording('rt-deleted', { deleted: true })
    seedTranscript('rt-deleted', { topics: ['Roadmap', 'Gossip'] })

    seedRecording('rt-value')
    valueExclude('rt-value')
    seedTranscript('rt-value', { topics: ['Roadmap', 'Garbage'] })

    const topics = getRecurringTopics()
    const byTopic = new Map(topics.map((t) => [t.topic, t.recordingCount]))
    // Roadmap counted ONCE (only rt-ok is eligible); excluded-only topics vanish.
    expect(byTopic.get('Roadmap')).toBe(1)
    expect(byTopic.get('Budget')).toBe(1)
    expect(byTopic.has('Secrets')).toBe(false)
    expect(byTopic.has('Gossip')).toBe(false)
    expect(byTopic.has('Garbage')).toBe(false)
  })

  it('surfaces an eligible topic even when excluded rows rank ahead', () => {
    // Three value-excluded recordings all mention "Noise"; one eligible has "Signal".
    for (const n of [1, 2, 3]) {
      seedRecording(`noise-${n}`)
      valueExclude(`noise-${n}`)
      seedTranscript(`noise-${n}`, { topics: ['Noise'] })
    }
    seedRecording('sig')
    seedTranscript('sig', { topics: ['Signal'] })

    expect(getRecurringTopics(1)).toEqual([{ topic: 'Signal', recordingCount: 1 }])
  })

  it('a recording whose row is later purged stops contributing', () => {
    // Seed eligible, then hard-purge the recording row (delete its transcript
    // first to satisfy the FK). The positive allowlist no longer resolves the id,
    // so even a lingering topics row could not contribute.
    seedRecording('rt-purge')
    seedTranscript('rt-purge', { topics: ['Ephemeral'] })
    expect(getRecurringTopics().some((t) => t.topic === 'Ephemeral')).toBe(true)
    run('DELETE FROM transcripts WHERE recording_id = ?', ['rt-purge'])
    run('DELETE FROM recordings WHERE id = ?', ['rt-purge'])
    expect(getRecurringTopics()).toEqual([])
  })
})

describe('getMentionSnippets — transcript-excerpt gate (ADV14)', () => {
  const NAME = 'Yaravi'

  it('excludes excerpts + recording ids from ineligible recordings', () => {
    seedRecording('ms-ok')
    seedTranscript('ms-ok', { fullText: `Kickoff with ${NAME} about latency.` })

    seedRecording('ms-personal', { personal: true })
    seedTranscript('ms-personal', { fullText: `${NAME} personal aside, ignore.` })

    seedRecording('ms-deleted', { deleted: true })
    seedTranscript('ms-deleted', { fullText: `${NAME} in a trashed call.` })

    seedRecording('ms-value')
    valueExclude('ms-value')
    seedTranscript('ms-value', { fullText: `${NAME} in a garbage recording.` })

    const res = getMentionSnippets(NAME, 10)
    expect(res.recordingIds).toEqual(['ms-ok'])
    expect(res.snippets.map((s) => s.recordingId)).toEqual(['ms-ok'])
    expect(res.snippets.every((s) => !s.snippet.includes('garbage'))).toBe(true)
    expect(res.snippets.every((s) => !s.snippet.includes('trashed'))).toBe(true)
    expect(res.snippets.every((s) => !s.snippet.includes('personal aside'))).toBe(true)
  })

  it('fails closed (empty) when the eligibility lookup throws', () => {
    seedRecording('ms-ok')
    seedTranscript('ms-ok', { fullText: `Meeting with ${NAME}.` })
    // Drop a table the positive allowlist depends on so getEligibleRecordingIds
    // throws (knowledge_captures is empty here, so the FK-checked implicit DELETE
    // during DROP succeeds; `recordings` can't be dropped while a transcript FK
    // references it).
    run('DROP TABLE knowledge_captures')
    expect(getMentionSnippets(NAME)).toEqual({ snippets: [], recordingIds: [] })
  })
})

describe('getPersonContext — graph topic-provenance gate (ADV14)', () => {
  // The graph tables are created by the graph service after first ingest, not the
  // base schema — create them (incl. graph_edge_sources for provenance).
  function createGraphTables(): void {
    run(`CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY, type TEXT, label TEXT, norm_key TEXT, props TEXT, created_at TEXT, updated_at TEXT
    )`)
    run(`CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, type TEXT, props TEXT, weight REAL, created_at TEXT
    )`)
    run(`CREATE TABLE IF NOT EXISTS graph_edge_sources (
      edge_id TEXT, recording_id TEXT, transcript_id TEXT
    )`)
  }
  function node(id: string, type: string, label: string, normKey: string): void {
    run(
      `INSERT INTO graph_nodes (id, type, label, norm_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
      [id, type, label, normKey]
    )
  }
  function edge(id: string, source: string, target: string, type: string): void {
    run(
      `INSERT INTO graph_edges (id, source_id, target_id, type, created_at) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')`,
      [id, source, target, type]
    )
  }
  function edgeSource(edgeId: string, recordingId: string): void {
    run('INSERT INTO graph_edge_sources (edge_id, recording_id) VALUES (?, ?)', [edgeId, recordingId])
  }

  /**
   * Person "Pat" attended three meetings, each ABOUT a distinct topic:
   *   - m-ok    → ABOUT edge sourced by an ELIGIBLE recording          → KEEP "Eligible"
   *   - m-bad   → ABOUT edge sourced by a VALUE-EXCLUDED recording     → DROP "Excluded"
   *   - m-legacy→ ABOUT edge with NO provenance rows (pre-F18 / legacy) → KEEP "Legacy"
   */
  function seedGraph(): void {
    createGraphTables()
    node('n-pat', 'person', 'Pat', 'pat')
    node('m-ok', 'meeting', 'OK Meeting', 'ok-meeting')
    node('m-bad', 'meeting', 'Bad Meeting', 'bad-meeting')
    node('m-legacy', 'meeting', 'Legacy Meeting', 'legacy-meeting')
    node('t-eligible', 'topic', 'Eligible', 'eligible')
    node('t-excluded', 'topic', 'Excluded', 'excluded')
    node('t-legacy', 'topic', 'Legacy', 'legacy')

    edge('att-ok', 'n-pat', 'm-ok', 'ATTENDED')
    edge('att-bad', 'n-pat', 'm-bad', 'ATTENDED')
    edge('att-legacy', 'n-pat', 'm-legacy', 'ATTENDED')
    edge('about-ok', 'm-ok', 't-eligible', 'ABOUT')
    edge('about-bad', 'm-bad', 't-excluded', 'ABOUT')
    edge('about-legacy', 'm-legacy', 't-legacy', 'ABOUT')

    seedRecording('gp-ok')
    seedRecording('gp-bad')
    valueExclude('gp-bad')
    edgeSource('about-ok', 'gp-ok')
    edgeSource('about-bad', 'gp-bad')
    // about-legacy intentionally has NO graph_edge_sources rows.
  }

  it('keeps eligible + legacy topics, drops value-excluded-sourced topics', () => {
    seedGraph()
    const topics = getPersonContext('pat', 10).topics
    expect(topics).toContain('Eligible')
    expect(topics).toContain('Legacy')
    expect(topics).not.toContain('Excluded')
  })

  it('fails closed: recording-attributed topics suppressed, legacy survives', () => {
    seedGraph()
    // Force the positive allowlist to throw (see getMentionSnippets fail-closed
    // note). knowledge_captures has one row (cap-gp-bad) but no child rows, so the
    // FK-checked implicit DELETE during DROP succeeds.
    run('DROP TABLE knowledge_captures')
    const topics = getPersonContext('pat', 10).topics
    // Legacy edge has no provenance → not recording-attributed → still kept.
    expect(topics).toContain('Legacy')
    // Both provenance-bearing edges are suppressed when eligibility can't resolve.
    expect(topics).not.toContain('Eligible')
    expect(topics).not.toContain('Excluded')
  })
})
