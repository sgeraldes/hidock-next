// @vitest-environment node

/**
 * v39 — meeting-timeline analysis (sentiment segments + event markers).
 *
 * Pure pieces (windowing, fuzzy matching, parsers) are tested without any
 * network; the DB pieces (getTimelineAnalysis / analyzeTimeline persistence +
 * idempotency) run against the real sql.js/better-sqlite3 engine with an
 * injected sentiment scorer so Gemini is never called.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-v39-timeline-${process.pid}.sqlite`)

vi.mock('../file-storage', () => ({
  getDatabasePath: () => dbPath
}))

import { initializeDatabase, closeDatabase, run, queryOne } from '../database'
import {
  parseSpeakerTurns,
  buildSentimentWindows,
  deriveSentimentSegments,
  deriveEventMarkers,
  parseWindowScores,
  getTimelineItemsForRecording,
  getTimelineAnalysis,
  analyzeTimeline,
  type SpeakerTurn,
  type TimelineItem,
  type SentimentWindow
} from '../timeline-analysis'

// A small timestamped transcript fixture (absolute seconds).
const TURNS: SpeakerTurn[] = [
  { speaker: 'Speaker 1', start: 0, end: 20, text: 'Welcome everyone, thanks for joining the weekly sync.' },
  { speaker: 'Speaker 2', start: 20, end: 55, text: 'We agreed to migrate the billing service to the new cluster by Friday.' },
  { speaker: 'Speaker 1', start: 55, end: 95, text: 'Carlos will prepare the rollback plan before the deploy window.' },
  { speaker: 'Speaker 2', start: 95, end: 140, text: 'I am frustrated that the previous outage was never explained to the team.' }
]

const SPEAKERS_JSON = JSON.stringify(TURNS)

function seedRecording(id: string): void {
  run('INSERT INTO recordings (id, filename, date_recorded) VALUES (?, ?, ?)', [
    id,
    `${id}.wav`,
    '2026-01-01T10:00:00.000Z'
  ])
}

function seedTranscript(recordingId: string, speakersJson: string): void {
  run(
    'INSERT INTO transcripts (id, recording_id, full_text, speakers) VALUES (?, ?, ?, ?)',
    [`trans_${recordingId}`, recordingId, TURNS.map((t) => t.text).join('\n'), speakersJson]
  )
}

/**
 * Seed a transcript the way a FRESH transcription does: action items + key
 * points as JSON string arrays on the transcript row, with NO first-class
 * action_items/decisions rows and (optionally) no knowledge_capture. This is the
 * real shape a just-transcribed device recording has.
 */
function seedFreshTranscript(
  recordingId: string,
  speakersJson: string,
  actionItems: string[],
  keyPoints: string[]
): void {
  run(
    'INSERT INTO transcripts (id, recording_id, full_text, speakers, action_items, key_points) VALUES (?, ?, ?, ?, ?, ?)',
    [
      `trans_${recordingId}`,
      recordingId,
      TURNS.map((t) => t.text).join('\n'),
      speakersJson,
      JSON.stringify(actionItems),
      JSON.stringify(keyPoints)
    ]
  )
}

function seedCapture(captureId: string, recordingId: string): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id)
     VALUES (?, ?, ?, ?)`,
    [captureId, 'Weekly sync', '2026-01-01T10:00:00.000Z', recordingId]
  )
}

// Deterministic fake scorer: score = index * 0.1 - 0.5 (spans negative→positive).
const fakeScorer = async (windows: SentimentWindow[]) => {
  const m = new Map<number, number>()
  for (const w of windows) m.set(w.index, w.index * 0.1 - 0.5)
  return m
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('schema v39 timeline columns', () => {
  it('is at schema version 43', () => {
    // F16/spec-003 bumped SCHEMA_VERSION 42 -> 43 (value_backfill_state).
    const row = queryOne<{ version: number }>('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
    expect(row?.version).toBe(43)
  })

  it('transcripts has sentiment_segments + event_markers columns', () => {
    const info = queryOne<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='transcripts'"
    )
    expect(info?.sql).toContain('sentiment_segments')
    expect(info?.sql).toContain('event_markers')
  })
})

describe('parseSpeakerTurns', () => {
  it('parses the speakers JSON into numeric turns', () => {
    const turns = parseSpeakerTurns(SPEAKERS_JSON)
    expect(turns).toHaveLength(4)
    expect(turns[0].start).toBe(0)
    expect(turns[1].text).toContain('billing service')
  })

  it('returns [] for empty / malformed input', () => {
    expect(parseSpeakerTurns(null)).toEqual([])
    expect(parseSpeakerTurns('')).toEqual([])
    expect(parseSpeakerTurns('not json')).toEqual([])
    expect(parseSpeakerTurns('{"a":1}')).toEqual([])
  })
})

describe('buildSentimentWindows', () => {
  it('coalesces turns into windows spanning ~targetWindowSec', () => {
    const windows = buildSentimentWindows(TURNS, 45)
    expect(windows.length).toBeGreaterThan(0)
    // Windows are contiguous, indexed, and carry text.
    windows.forEach((w, i) => {
      expect(w.index).toBe(i)
      expect(w.endSec).toBeGreaterThanOrEqual(w.startSec)
      expect(w.text.length).toBeGreaterThan(0)
    })
    // First window starts at the first turn.
    expect(windows[0].startSec).toBe(0)
  })

  it('caps the number of windows for very long recordings', () => {
    const many: SpeakerTurn[] = Array.from({ length: 500 }, (_, i) => ({
      start: i * 30,
      end: i * 30 + 30,
      text: `turn ${i}`
    }))
    const windows = buildSentimentWindows(many, 30)
    expect(windows.length).toBeLessThanOrEqual(40)
  })

  it('returns [] for no turns', () => {
    expect(buildSentimentWindows([])).toEqual([])
  })
})

describe('deriveSentimentSegments', () => {
  it('produces a scored time-series from a fixture transcript', async () => {
    const segments = await deriveSentimentSegments(TURNS, { scoreWindows: fakeScorer })
    expect(segments.length).toBeGreaterThan(0)
    for (const s of segments) {
      expect(s.score).toBeGreaterThanOrEqual(-1)
      expect(s.score).toBeLessThanOrEqual(1)
      expect(s.endSec).toBeGreaterThanOrEqual(s.startSec)
    }
  })

  it('clamps out-of-range scores and drops unscored windows', async () => {
    const segments = await deriveSentimentSegments(TURNS, {
      scoreWindows: async (windows) => {
        const m = new Map<number, number>()
        // Only score the first window, and out of range.
        m.set(windows[0].index, 5)
        return m
      }
    })
    expect(segments).toHaveLength(1)
    expect(segments[0].score).toBe(1) // clamped from 5
  })

  it('returns [] when scoring throws', async () => {
    const segments = await deriveSentimentSegments(TURNS, {
      scoreWindows: async () => {
        throw new Error('boom')
      }
    })
    expect(segments).toEqual([])
  })
})

describe('parseWindowScores', () => {
  it('parses a bare JSON array', () => {
    const m = parseWindowScores('[{"i":0,"score":-0.3},{"i":1,"score":0.8}]')
    expect(m.get(0)).toBeCloseTo(-0.3)
    expect(m.get(1)).toBeCloseTo(0.8)
  })

  it('parses a fenced block and clamps', () => {
    const m = parseWindowScores('```json\n[{"index":2,"value":9}]\n```')
    expect(m.get(2)).toBe(1)
  })

  it('returns empty map for junk', () => {
    expect(parseWindowScores('no json here').size).toBe(0)
  })
})

describe('deriveEventMarkers (fuzzy match)', () => {
  it('recovers atSec by matching item text against the timestamped turns', () => {
    const items: TimelineItem[] = [
      { id: 'a1', kind: 'action', text: 'Prepare the rollback plan before the deploy window' },
      { id: 'd1', kind: 'decision', text: 'Migrate the billing service to the new cluster by Friday' }
    ]
    const markers = deriveEventMarkers(items, TURNS)
    expect(markers).toHaveLength(2)
    const byRef = Object.fromEntries(markers.map((m) => [m.refId, m]))
    // "rollback plan" turn starts at 55; "billing service" turn starts at 20.
    expect(byRef['a1'].atSec).toBe(55)
    expect(byRef['a1'].kind).toBe('action')
    expect(byRef['d1'].atSec).toBe(20)
    expect(byRef['d1'].kind).toBe('decision')
    // Markers are returned in chronological order.
    expect(markers[0].atSec).toBeLessThanOrEqual(markers[1].atSec)
  })

  it('prefers the verbatim extractedFrom snippet', () => {
    const items: TimelineItem[] = [
      {
        id: 'a2',
        kind: 'action',
        text: 'Someone handles the rollback',
        extractedFrom: 'Carlos will prepare the rollback plan before the deploy window.'
      }
    ]
    const markers = deriveEventMarkers(items, TURNS)
    expect(markers).toHaveLength(1)
    expect(markers[0].atSec).toBe(55)
  })

  it('drops items with no confident turn match', () => {
    const items: TimelineItem[] = [
      { id: 'x', kind: 'action', text: 'Completely unrelated content about quarterly gardening budgets' }
    ]
    expect(deriveEventMarkers(items, TURNS)).toEqual([])
  })

  it('anchors an unmatchable item to the turn mentioning its assignee', () => {
    // Text is unrelated to any turn, but the assignee "Carlos" is mentioned in
    // the turn starting at 55s ("Carlos will prepare the rollback plan...").
    const items: TimelineItem[] = [
      { id: 'as1', kind: 'action', text: 'Follow up on the vendor contract paperwork', assignee: 'Carlos' }
    ]
    const markers = deriveEventMarkers(items, TURNS)
    expect(markers).toHaveLength(1)
    expect(markers[0].atSec).toBe(55)
    expect(markers[0].refId).toBe('as1')
  })

  it('still drops an item whose assignee is never mentioned', () => {
    const items: TimelineItem[] = [
      { id: 'as2', kind: 'action', text: 'Completely unrelated gardening budget line item', assignee: 'Wilhelmina' }
    ]
    expect(deriveEventMarkers(items, TURNS)).toEqual([])
  })

  it('truncates long labels to <= 80 chars', () => {
    const long = 'Migrate the billing service to the new cluster by Friday and also handle every downstream consumer carefully'
    const markers = deriveEventMarkers([{ id: 'l', kind: 'action', text: long }], TURNS)
    expect(markers[0].label.length).toBeLessThanOrEqual(80)
  })
})

describe('getTimelineItemsForRecording (DB link)', () => {
  it('collects action_items + decisions via the knowledge_capture', () => {
    seedRecording('rec1')
    seedTranscript('rec1', SPEAKERS_JSON)
    seedCapture('cap1', 'rec1')
    run('INSERT INTO action_items (id, knowledge_capture_id, content) VALUES (?, ?, ?)', [
      'ai1',
      'cap1',
      'Prepare the rollback plan before the deploy window'
    ])
    run('INSERT INTO decisions (id, knowledge_capture_id, content) VALUES (?, ?, ?)', [
      'de1',
      'cap1',
      'Migrate the billing service to the new cluster by Friday'
    ])
    const items = getTimelineItemsForRecording('rec1')
    expect(items).toHaveLength(2)
    expect(items.filter((i) => i.kind === 'action')).toHaveLength(1)
    expect(items.filter((i) => i.kind === 'decision')).toHaveLength(1)
  })

  it('collects items from the fresh-transcription JSON columns (no first-class rows, no capture)', () => {
    // The real device-first shape: transcript with action_items/key_points JSON,
    // no action_items/decisions rows and no knowledge_capture at all.
    seedRecording('recFresh')
    seedFreshTranscript(
      'recFresh',
      SPEAKERS_JSON,
      ['Carlos will prepare the rollback plan before the deploy window'],
      ['Migrate the billing service to the new cluster by Friday']
    )
    const items = getTimelineItemsForRecording('recFresh')
    expect(items.filter((i) => i.kind === 'action')).toHaveLength(1)
    expect(items.filter((i) => i.kind === 'decision')).toHaveLength(1)
    expect(items.find((i) => i.kind === 'action')?.text).toContain('rollback plan')
    expect(items.find((i) => i.kind === 'decision')?.text).toContain('billing service')
  })

  it('de-duplicates a first-class row and an identical transcript-JSON entry', () => {
    seedRecording('recDup')
    seedFreshTranscript(
      'recDup',
      SPEAKERS_JSON,
      ['Prepare the rollback plan before the deploy window'],
      []
    )
    seedCapture('capDup', 'recDup')
    // Same text as the transcript JSON action item.
    run('INSERT INTO action_items (id, knowledge_capture_id, content) VALUES (?, ?, ?)', [
      'aiDup',
      'capDup',
      'Prepare the rollback plan before the deploy window'
    ])
    const items = getTimelineItemsForRecording('recDup')
    const actions = items.filter((i) => i.kind === 'action')
    expect(actions).toHaveLength(1)
    // First-class row wins (carries the stable refId).
    expect(actions[0].id).toBe('aiDup')
  })

  it('returns [] when the recording has neither captures nor a transcript', () => {
    seedRecording('recBare')
    expect(getTimelineItemsForRecording('recBare')).toEqual([])
  })
})

describe('getTimelineAnalysis', () => {
  it('returns empty arrays before analysis', () => {
    seedRecording('rec2')
    seedTranscript('rec2', SPEAKERS_JSON)
    const result = getTimelineAnalysis('rec2')
    expect(result).toEqual({ sentimentSegments: [], eventMarkers: [] })
  })

  it('returns empty arrays for an unknown recording', () => {
    expect(getTimelineAnalysis('nope')).toEqual({ sentimentSegments: [], eventMarkers: [] })
  })
})

describe('analyzeTimeline (persist + idempotent)', () => {
  beforeEach(() => {
    seedRecording('rec3')
    seedTranscript('rec3', SPEAKERS_JSON)
    seedCapture('cap3', 'rec3')
    run('INSERT INTO action_items (id, knowledge_capture_id, content) VALUES (?, ?, ?)', [
      'ai3',
      'cap3',
      'Carlos will prepare the rollback plan before the deploy window'
    ])
    run('INSERT INTO decisions (id, knowledge_capture_id, content) VALUES (?, ?, ?)', [
      'de3',
      'cap3',
      'Migrate the billing service to the new cluster by Friday'
    ])
  })

  it('derives, persists, and returns the timeline shape', async () => {
    const result = await analyzeTimeline('rec3', undefined, { scoreWindows: fakeScorer })
    expect(result.sentimentSegments.length).toBeGreaterThan(0)
    expect(result.eventMarkers.length).toBe(2)

    // Persisted onto the transcript row and readable back.
    const persisted = getTimelineAnalysis('rec3')
    expect(persisted.eventMarkers.map((m) => m.refId).sort()).toEqual(['ai3', 'de3'])
    expect(persisted.sentimentSegments.length).toBe(result.sentimentSegments.length)
  })

  it('P2 (round-3) — shouldPersist()=false returns the computed result WITHOUT persisting', async () => {
    const result = await analyzeTimeline('rec3', undefined, { scoreWindows: fakeScorer }, () => false)
    // Computed + returned to the caller…
    expect(result.sentimentSegments.length).toBeGreaterThan(0)
    expect(result.eventMarkers.length).toBe(2)
    // …but NOTHING is written back (a purge landed during the sentiment await).
    const persisted = getTimelineAnalysis('rec3')
    expect(persisted.sentimentSegments.length).toBe(0)
    expect(persisted.eventMarkers.length).toBe(0)
  })

  it('is idempotent — re-running yields the same persisted result', async () => {
    const first = await analyzeTimeline('rec3', undefined, { scoreWindows: fakeScorer })
    const second = await analyzeTimeline('rec3', undefined, { scoreWindows: fakeScorer })
    expect(second).toEqual(first)

    // Exactly one row, not duplicated.
    const count = queryOne<{ n: number }>('SELECT COUNT(*) as n FROM transcripts WHERE recording_id = ?', ['rec3'])
    expect(count?.n).toBe(1)
  })

  it('emits progress stages', async () => {
    const stages: string[] = []
    await analyzeTimeline('rec3', (p) => stages.push(p.stage), { scoreWindows: fakeScorer })
    expect(stages).toContain('sentiment')
    expect(stages).toContain('markers')
    expect(stages).toContain('complete')
  })

  it('returns empty arrays when the recording has no transcript', async () => {
    seedRecording('rec4')
    const result = await analyzeTimeline('rec4', undefined, { scoreWindows: fakeScorer })
    expect(result).toEqual({ sentimentSegments: [], eventMarkers: [] })
  })

  it('populates markers for a FRESH recording (transcript JSON only, no first-class rows)', async () => {
    // This is the regression the fix targets: before, a freshly-transcribed
    // recording (action_items/key_points JSON, no migration rows) yielded 0
    // markers. It must now recover N>0 markers with plausible atSec values.
    seedRecording('recFresh2')
    seedFreshTranscript(
      'recFresh2',
      SPEAKERS_JSON,
      ['Carlos will prepare the rollback plan before the deploy window'],
      ['Migrate the billing service to the new cluster by Friday']
    )

    const result = await analyzeTimeline('recFresh2', undefined, { scoreWindows: fakeScorer })
    expect(result.eventMarkers.length).toBe(2)

    const byKind = Object.fromEntries(result.eventMarkers.map((m) => [m.kind, m]))
    // "rollback plan" turn starts at 55; "billing service" turn starts at 20.
    expect(byKind.action.atSec).toBe(55)
    expect(byKind.decision.atSec).toBe(20)
    for (const m of result.eventMarkers) {
      expect(m.atSec).toBeGreaterThanOrEqual(0)
      expect(m.label.length).toBeGreaterThan(0)
    }

    // Persisted + idempotent.
    const persisted = getTimelineAnalysis('recFresh2')
    expect(persisted.eventMarkers.length).toBe(2)
    const second = await analyzeTimeline('recFresh2', undefined, { scoreWindows: fakeScorer })
    expect(second.eventMarkers).toEqual(result.eventMarkers)
  })
})

// ---------------------------------------------------------------------------
// Persisted per-component completion (v2 sentiment envelope) — success-empty
// must survive app restarts (any fresh read of the DB) without re-billing,
// while a retranscription (content change) invalidates the flags. No schema
// bump: the envelope lives inside the existing sentiment_segments column.
// ---------------------------------------------------------------------------
describe('analysisStatus — persisted success-empty completion', () => {
  // A scorer that legitimately returns no scores → honestly-empty sentiment.
  const emptyScorer = async () => new Map<number, number>()

  it('a success with EMPTY results persists completed flags readable on a fresh read (restart-equivalent)', async () => {
    seedRecording('recEnv1')
    seedTranscript('recEnv1', SPEAKERS_JSON) // speakers, but no items → both components empty

    const result = await analyzeTimeline('recEnv1', undefined, { scoreWindows: emptyScorer })
    expect(result.sentimentSegments).toEqual([])
    expect(result.eventMarkers).toEqual([])
    expect(result.analysisStatus).toEqual({ sentimentAnalyzed: true, markersAnalyzed: true })

    // A brand-new read from the DB (what a remounted reader / restarted app
    // sees) carries the SAME completion — consumers skip the backfill.
    const persisted = getTimelineAnalysis('recEnv1')
    expect(persisted.sentimentSegments).toEqual([])
    expect(persisted.eventMarkers).toEqual([])
    expect(persisted.analysisStatus).toEqual({ sentimentAnalyzed: true, markersAnalyzed: true })
  })

  it('a CONTENT change (retranscription) reads the flags back as false', async () => {
    seedRecording('recEnv2')
    seedTranscript('recEnv2', SPEAKERS_JSON)
    await analyzeTimeline('recEnv2', undefined, { scoreWindows: emptyScorer })
    expect(getTimelineAnalysis('recEnv2').analysisStatus).toEqual({ sentimentAnalyzed: true, markersAnalyzed: true })

    // Retranscription rewrites content (id / created_at may be identical).
    run('UPDATE transcripts SET full_text = ? WHERE recording_id = ?', ['a completely different second pass', 'recEnv2'])
    expect(getTimelineAnalysis('recEnv2').analysisStatus).toEqual({ sentimentAnalyzed: false, markersAnalyzed: false })
  })

  it('a FAILED sentiment pass persists sentimentAnalyzed=false while markers stay completed', async () => {
    seedRecording('recEnv3')
    seedFreshTranscript(
      'recEnv3',
      SPEAKERS_JSON,
      ['Carlos will prepare the rollback plan before the deploy window'],
      []
    )
    const throwingScorer = async () => {
      throw Object.assign(new Error('scorer down'), { status: 503 })
    }
    const result = await analyzeTimeline('recEnv3', undefined, { scoreWindows: throwingScorer })
    expect(result.analysisStatus).toEqual({ sentimentAnalyzed: false, markersAnalyzed: true })
    expect(result.analysisError?.kind).toBe('network')
    expect(result.eventMarkers.length).toBe(1)

    // The persisted read agrees: markers completed, sentiment retry-eligible.
    const persisted = getTimelineAnalysis('recEnv3')
    expect(persisted.analysisStatus).toEqual({ sentimentAnalyzed: false, markersAnalyzed: true })
    expect(persisted.eventMarkers.length).toBe(1)
  })

  it('legacy bare-array persistence still parses — segments returned, NO analysisStatus', async () => {
    seedRecording('recEnv4')
    seedTranscript('recEnv4', SPEAKERS_JSON)
    run('UPDATE transcripts SET sentiment_segments = ? WHERE recording_id = ?', [
      JSON.stringify([{ startSec: 0, endSec: 10, score: 0.5 }]),
      'recEnv4'
    ])
    const result = getTimelineAnalysis('recEnv4')
    expect(result.sentimentSegments).toEqual([{ startSec: 0, endSec: 10, score: 0.5 }])
    expect(result.analysisStatus).toBeUndefined()
  })
})
