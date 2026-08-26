/**
 * Retrieval Orchestrator tests — intent routing, temporal grounding, and the
 * structured actionables/digests context builders (real sql.js database).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import initSqlJs from 'sql.js'

const deps = vi.hoisted(() => ({
  // eligibility knobs: ids in these sets are DROPPED by the mocked boundary
  excludedSources: new Set<string>(),
  excludedCaptures: new Set<string>(),
  excludedRecordings: new Set<string>(),
}))

let dbInstance: import('sql.js').Database | null = null

vi.mock('../database', () => ({
  getDatabase: () => dbInstance,
  queryAll: (sql: string, params: unknown[] = []) => {
    if (!dbInstance) return []
    const result = dbInstance.exec(sql, params as import('sql.js').BindParams)
    if (result.length === 0) return []
    return result[0].values.map((values) => {
      const row: Record<string, unknown> = {}
      result[0].columns.forEach((col, i) => {
        row[col] = values[i]
      })
      return row
    })
  },
}))

vi.mock('../actionable-eligibility', () => ({
  filterEligibleActionableRows: (rows: Array<{ source_knowledge_id?: string | null }>, getSrc: (r: never) => string | null | undefined) =>
    rows.filter((r) => {
      const src = getSrc(r as never)
      return !src || !deps.excludedSources.has(src)
    }),
}))

vi.mock('../recording-eligibility', () => ({
  filterEligibleRecordingIds: (ids: Iterable<string>) => ({
    eligible: new Set([...ids].filter((i) => !deps.excludedRecordings.has(i))),
    failClosed: false,
  }),
  filterEligibleCaptureIds: (ids: Iterable<string>) => ({
    eligible: new Set([...ids].filter((i) => !deps.excludedCaptures.has(i))),
    failClosed: false,
  }),
}))

import {
  buildActionablesContext,
  buildDigestsContext,
  dateGroundingPart,
  detectIntent,
  inRange,
  resolveTemporalRange,
} from '../retrieval-orchestrator'

// ── Intent ──────────────────────────────────────────────────────────────────

describe('detectIntent', () => {
  it('routes action/commitment questions (EN + ES)', () => {
    expect(detectIntent('What actions do I have for this week?')).toBe('actions')
    expect(detectIntent('what commitments did I take last month?')).toBe('actions')
    expect(detectIntent('my pending tasks and follow-ups')).toBe('actions')
    expect(detectIntent('¿qué acciones tengo esta semana?')).toBe('actions')
    expect(detectIntent('compromisos del mes pasado')).toBe('actions')
    expect(detectIntent('next steps from the Apollo meeting')).toBe('actions')
  })

  it('routes report requests (incl. top-N and most-discussed)', () => {
    expect(detectIntent('Prepare a complete report on the most discussed topic')).toBe('report')
    expect(detectIntent('prepare a report of the top 5 needs for my team')).toBe('report')
    expect(detectIntent('prepara un informe del tema más discutido')).toBe('report')
  })

  it('routes topic/overview questions', () => {
    expect(detectIntent('what were the main topics discussed last week?')).toBe('topics')
    expect(detectIntent('give me an overview of recent discussions')).toBe('topics')
    expect(detectIntent('¿qué temas se trataron?')).toBe('topics')
  })

  it('leaves everything else general', () => {
    expect(detectIntent('who is Jane Doe?')).toBe('general')
    expect(detectIntent('what did we decide about the gateway architecture?')).toBe('general')
  })
})

// ── Temporal grounding ──────────────────────────────────────────────────────

describe('resolveTemporalRange', () => {
  // Monday 2026-07-20 (a Monday)
  const now = new Date(2026, 6, 20, 12, 0, 0)

  it('this week → Monday..Sunday of the current week', () => {
    const r = resolveTemporalRange('what actions do I have for this week?', now)!
    expect(r.start).toBe('2026-07-20')
    expect(r.end).toBe('2026-07-26')
    expect(r.label).toContain('this week')
  })

  it('this week works on Sundays too (Monday-start weeks)', () => {
    const sunday = new Date(2026, 6, 26, 9, 0, 0)
    const r = resolveTemporalRange('this week', sunday)!
    expect(r.start).toBe('2026-07-20')
    expect(r.end).toBe('2026-07-26')
  })

  it('last week → previous Monday..Sunday', () => {
    const r = resolveTemporalRange('main topics discussed last week', now)!
    expect(r.start).toBe('2026-07-13')
    expect(r.end).toBe('2026-07-19')
  })

  it('last month → full previous calendar month', () => {
    const r = resolveTemporalRange('commitments I took last month', now)!
    expect(r.start).toBe('2026-06-01')
    expect(r.end).toBe('2026-06-30')
  })

  it('Spanish variants resolve identically', () => {
    expect(resolveTemporalRange('acciones de esta semana', now)!.start).toBe('2026-07-20')
    expect(resolveTemporalRange('la semana pasada', now)!.start).toBe('2026-07-13')
    expect(resolveTemporalRange('el mes pasado', now)!.start).toBe('2026-06-01')
    expect(resolveTemporalRange('hoy', now)!.start).toBe('2026-07-20')
    expect(resolveTemporalRange('ayer', now)!.start).toBe('2026-07-19')
  })

  it('today / yesterday', () => {
    expect(resolveTemporalRange('what happened today?', now)).toMatchObject({ start: '2026-07-20', end: '2026-07-20' })
    expect(resolveTemporalRange('yesterday', now)).toMatchObject({ start: '2026-07-19', end: '2026-07-19' })
  })

  it('returns null without a temporal anchor', () => {
    expect(resolveTemporalRange('who is the project lead?', now)).toBeNull()
  })
})

describe('inRange / dateGroundingPart', () => {
  const range = { start: '2026-07-13', end: '2026-07-19', label: 'last week' }

  it('matches full ISO datetimes by day, inclusive bounds', () => {
    expect(inRange('2026-07-13T09:30:00.000Z', range)).toBe(true)
    expect(inRange('2026-07-19', range)).toBe(true)
    expect(inRange('2026-07-20', range)).toBe(false)
    expect(inRange('2026-07-12', range)).toBe(false)
    expect(inRange(undefined, range)).toBe(false)
    expect(inRange('2026-07-15', null)).toBe(false)
  })

  it('date grounding names the weekday and the resolved range', () => {
    const part = dateGroundingPart(new Date(2026, 6, 20), range)
    expect(part).toContain('Monday, July 20, 2026')
    expect(part).toContain('last week')
    expect(part).toContain('2026-07-13')
  })

  it('date grounding works with no range', () => {
    expect(dateGroundingPart(new Date(2026, 6, 20), null)).toContain('Today is Monday, July 20, 2026')
  })
})

// ── Structured context builders (real sql.js) ───────────────────────────────

describe('structured context builders', () => {
  beforeEach(async () => {
    deps.excludedSources = new Set()
    deps.excludedCaptures = new Set()
    deps.excludedRecordings = new Set()
    const SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    dbInstance.run(`
      CREATE TABLE actionables (id TEXT, type TEXT, title TEXT, description TEXT, status TEXT, created_at TEXT, source_knowledge_id TEXT);
      CREATE TABLE knowledge_captures (id TEXT, title TEXT, summary TEXT, captured_at TEXT, deleted_at TEXT, meeting_id TEXT, source_recording_id TEXT);
      CREATE TABLE recordings (id TEXT, date_recorded TEXT);
      CREATE TABLE meetings (id TEXT, subject TEXT);

      INSERT INTO recordings VALUES ('rec-1', '2026-07-15'), ('rec-2', '2026-07-08'), ('rec-x', '2026-07-16');
      INSERT INTO meetings VALUES ('m-1', 'Gateway Architecture');
      INSERT INTO knowledge_captures VALUES
        ('kc-1', 'Gateway cost review', 'Reviewed gateway costs and scaling plan.', '2026-07-15', NULL, 'm-1', 'rec-1'),
        ('kc-2', 'Old infra sync', 'Legacy topic.', '2026-07-08', NULL, NULL, 'rec-2'),
        ('kc-x', 'Excluded capture', 'Should never surface.', '2026-07-16', NULL, NULL, 'rec-x');
      INSERT INTO actionables VALUES
        ('a-1', 'action_items', 'Update resource plan', 'Bring updated plans by 3pm', 'pending', '2026-07-15T10:00:00Z', 'kc-1'),
        ('a-2', 'follow_up_work', 'QA AI testing setup', 'Have AI build QA tests', 'pending', '2026-07-14T09:00:00Z', 'kc-1'),
        ('a-3', 'action_items', 'Done item', 'Already shared', 'generated', '2026-07-14T09:00:00Z', 'kc-1'),
        ('a-4', 'decision_log', 'Not an action type', 'Decided X', 'pending', '2026-07-15T09:00:00Z', 'kc-1'),
        ('a-5', 'action_items', 'Old action', 'From last week', 'pending', '2026-07-08T09:00:00Z', 'kc-2'),
        ('a-6', 'action_items', 'Excluded source action', 'Never surfaces', 'pending', '2026-07-16T09:00:00Z', 'kc-x');
    `)
  })

  afterEach(() => {
    dbInstance?.close()
    dbInstance = null
  })

  it('actionables: pending action types only, newest first, with meeting attribution', () => {
    const out = buildActionablesContext(null, 15)
    expect(out.rowCount).toBe(4) // a-1, a-2, a-5, a-6 (a-3 shared, a-4 wrong type)
    const text = out.parts.join('\n')
    expect(text).toContain('STRUCTURED ACTION ITEMS')
    expect(text).toContain('Update resource plan')
    expect(text).toContain('QA AI testing setup')
    expect(text).toContain('from "Gateway cost review"')
    expect(text).not.toContain('Done item')
    expect(text).not.toContain('Not an action type')
    expect(out.recordingIds.has('rec-1')).toBe(true)
    expect(out.captureIds.has('kc-1')).toBe(true)
  })

  it('actionables: current range lists ALL open items unscoped (pending = still open)', () => {
    // "actions this week" on the week's first day: nothing was EXTRACTED this
    // week, but older pending items are still open and must surface.
    const thisWeek = { start: '2026-07-20', end: '2026-07-26', label: 'this week' }
    const out = buildActionablesContext(thisWeek, 15, false)
    const text = out.parts.join('\n')
    expect(text).toContain('Old action') // pending from 2026-07-08 — still open
    expect(text).toContain('Update resource plan')
    expect(text).toContain('all currently OPEN')
  })

  it('actionables: range-scoped by extraction date', () => {
    const thisWeek = { start: '2026-07-13', end: '2026-07-19', label: 'this week' }
    const out = buildActionablesContext(thisWeek, 15)
    const text = out.parts.join('\n')
    expect(text).toContain('Update resource plan')
    expect(text).not.toContain('Old action')
    expect(text).toContain('this week')
  })

  it('actionables: eligibility gate drops excluded sources', () => {
    deps.excludedSources = new Set(['kc-1'])
    const out = buildActionablesContext(null, 15)
    const text = out.parts.join('\n')
    expect(text).not.toContain('Update resource plan')
    expect(text).not.toContain('QA AI testing setup')
    expect(out.rowCount).toBe(2) // a-5 (kc-2) + a-6 (kc-x) survive; kc-1 rows dropped
  })

  it('actionables: empty when nothing pending', () => {
    dbInstance!.run("UPDATE actionables SET status = 'generated'")
    const out = buildActionablesContext(null, 15)
    expect(out.rowCount).toBe(0)
    expect(out.parts).toEqual([])
  })

  it('digests: titled, non-deleted captures in range, dated, with summary', () => {
    const range = { start: '2026-07-13', end: '2026-07-19', label: 'this week' }
    const out = buildDigestsContext(range, 12)
    const text = out.parts.join('\n')
    expect(text).toContain('MEETING DIGESTS')
    expect(text).toContain('2026-07-15: Gateway cost review')
    expect(text).toContain('Reviewed gateway costs')
    expect(text).toContain('[meeting: Gateway Architecture]')
    expect(text).not.toContain('Old infra sync') // outside range
    expect(out.recordingIds.has('rec-1')).toBe(true)
  })

  it('digests: capture-level and recording-level exclusion both apply', () => {
    deps.excludedCaptures = new Set(['kc-x'])
    deps.excludedRecordings = new Set()
    const range = { start: '2026-07-13', end: '2026-07-19', label: 'this week' }
    let out = buildDigestsContext(range, 12)
    expect(out.parts.join('\n')).not.toContain('Excluded capture')

    deps.excludedCaptures = new Set()
    deps.excludedRecordings = new Set(['rec-1'])
    out = buildDigestsContext(range, 12)
    expect(out.parts.join('\n')).not.toContain('Gateway cost review')
  })
})
