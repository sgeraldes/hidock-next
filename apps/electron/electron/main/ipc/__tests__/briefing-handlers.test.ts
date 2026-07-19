import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerBriefingHandlers } from '../briefing-handlers'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('../../services/database', () => {
  // ADV15 (round-16) — briefing:get routes recording-backed rows through the
  // recording boundary AND pending actionables through the shared CAPTURE-aware
  // boundary. Tests drive getExcludedRecordingIds (recording exclusion) and a
  // `__captures` registry (id → {source_recording_id, quality_rating, deleted_at});
  // a source_knowledge_id NOT in the registry is treated as a legacy recording id.
  const getExcludedRecordingIds = vi.fn(() => ({ ids: new Set<string>(), failClosed: false }))
  const captures = new Map<string, { source_recording_id: string | null; quality_rating: string | null; deleted_at: string | null }>()
  return {
    getMeetings: vi.fn(),
    queryAll: vi.fn(),
    queryOne: vi.fn(),
    getExcludedRecordingIds,
    __captures: captures,
    getEligibleRecordingIds: (ids: Iterable<string>) => {
      const { ids: excluded, failClosed } = getExcludedRecordingIds()
      return failClosed
        ? { eligible: new Set<string>(), failClosed: true }
        : { eligible: new Set([...ids].filter((i) => i && !excluded.has(i))), failClosed: false }
    },
    getExistingCaptureIds: (ids: Iterable<string>) => ({
      ids: new Set([...ids].filter((i) => i && captures.has(i))),
      failClosed: false
    }),
    // ADV44-2 (round-46) — the stats.indexedChunks count routes vector_embeddings
    // provenance rows through filterEligibleProvenanceRows, which needs the
    // recording existence probe. Every recording id used in these tests names a
    // REAL recording (existence = identity); excluded ones still exist.
    getExistingRecordingIds: (ids: Iterable<string>) => ({
      ids: new Set([...ids].filter((i): i is string => !!i)),
      failClosed: false
    }),
    getCaptureEligibilityRows: (ids: Iterable<string>) => ({
      rows: [...ids].filter((i) => i && captures.has(i)).map((id) => ({ id, ...captures.get(id)! })),
      failClosed: false
    })
  }
})

vi.mock('../../services/config', () => ({
  getConfig: vi.fn()
}))

/**
 * Routes a queryAll call to a canned result by matching a distinctive fragment
 * of its SQL, so each query in the handler can be asserted independently.
 */
function routeQueryAll(routes: Array<{ match: RegExp; rows: unknown[] }>) {
  return (sql: string) => {
    for (const route of routes) {
      if (route.match.test(sql)) return route.rows
    }
    return []
  }
}

describe('Briefing IPC Handlers', () => {
  let handlers: Record<string, (...args: any[]) => any> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    const db: any = await import('../../services/database')
    db.__captures.clear()
    db.getExcludedRecordingIds.mockReturnValue({ ids: new Set<string>(), failClosed: false })
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
      handlers[channel] = handler
      return undefined as any
    })
    const { getConfig } = await import('../../services/config')
    vi.mocked(getConfig).mockReturnValue({
      calendar: { icsUrl: 'https://example.com/cal.ics', syncEnabled: true, lastSyncAt: null }
    } as any)
    registerBriefingHandlers()
  })

  it('registers the briefing:get handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('briefing:get', expect.any(Function))
  })

  it("lists today's follow-ups newest-first with calendar meeting subject + time", async () => {
    const { queryAll, getMeetings } = await import('../../services/database')
    vi.mocked(getMeetings).mockReturnValue([])
    vi.mocked(queryAll).mockImplementation(
      routeQueryAll([
        // recentKnowledge (LEFT JOIN, no day filter)
        { match: /LEFT JOIN recordings r ON r\.id = t\.recording_id/, rows: [] },
        // todayFollowUps (JOIN recordings, day-scoped) — backend already orders newest-first
        {
          match: /JOIN recordings r ON r\.id = t\.recording_id\s+LEFT JOIN meetings m/,
          rows: [
            {
              recording_id: 'rec-late',
              title_suggestion: 'Integración WebRTC Gateway',
              summary: 'Late summary',
              action_items: '["Ship it","Review PR"]',
              word_count: 4200,
              filename: 'REC-late.wav',
              date_recorded: '2026-07-09T19:02:00Z',
              meeting_id: 'm-1',
              meeting_subject: 'Daily Reto Connect - Gateway',
              meeting_start: '2026-07-09T19:02:00Z',
              meeting_end: '2026-07-09T19:30:00Z'
            },
            {
              recording_id: 'rec-early',
              title_suggestion: 'Standup notes',
              summary: 'Early summary',
              action_items: '[]',
              word_count: 900,
              filename: 'REC-early.wav',
              date_recorded: '2026-07-09T09:00:00Z',
              meeting_id: 'm-2',
              meeting_subject: 'Morning Standup',
              meeting_start: '2026-07-09T09:00:00Z',
              meeting_end: '2026-07-09T09:15:00Z'
            }
          ]
        },
        { match: /SELECT COUNT\(1\) AS n FROM recordings r/, rows: [{ n: 0 }] },
        { match: /FROM actionables/, rows: [] },
        { match: /FROM transcripts WHERE/, rows: [{ n: 2 }] },
        { match: /FROM vector_embeddings/, rows: [{ n: 0 }] }
      ])
    )

    const res = await handlers['briefing:get']()
    expect(res.success).toBe(true)
    const followUps = res.data.todayFollowUps
    expect(followUps).toHaveLength(2)
    // Newest first (order preserved from the DESC query).
    expect(followUps[0].recordingId).toBe('rec-late')
    expect(followUps[0].meetingSubject).toBe('Daily Reto Connect - Gateway')
    expect(followUps[0].meetingStart).toBe('2026-07-09T19:02:00Z')
    expect(followUps[0].actionItems).toEqual(['Ship it', 'Review PR'])
    expect(followUps[1].recordingId).toBe('rec-early')
    expect(res.data.todayRecordingsPending).toBe(0)
  })

  it('surfaces the honest unlinked state (no meeting fields) for a follow-up with no meeting', async () => {
    const { queryAll, getMeetings } = await import('../../services/database')
    vi.mocked(getMeetings).mockReturnValue([])
    vi.mocked(queryAll).mockImplementation(
      routeQueryAll([
        { match: /LEFT JOIN recordings r ON r\.id = t\.recording_id/, rows: [] },
        {
          match: /JOIN recordings r ON r\.id = t\.recording_id\s+LEFT JOIN meetings m/,
          rows: [
            {
              recording_id: 'rec-orphan',
              title_suggestion: 'Random note',
              summary: null,
              action_items: '[]',
              word_count: 120,
              filename: 'REC-orphan.wav',
              date_recorded: '2026-07-09T14:00:00Z',
              meeting_id: null,
              meeting_subject: null,
              meeting_start: null,
              meeting_end: null
            }
          ]
        },
        { match: /SELECT COUNT\(1\) AS n FROM recordings r/, rows: [{ n: 0 }] },
        { match: /FROM actionables/, rows: [] },
        { match: /FROM transcripts WHERE/, rows: [{ n: 1 }] },
        { match: /FROM vector_embeddings/, rows: [{ n: 0 }] }
      ])
    )

    const res = await handlers['briefing:get']()
    const item = res.data.todayFollowUps[0]
    expect(item.recordingId).toBe('rec-orphan')
    expect(item.meetingId).toBeUndefined()
    expect(item.meetingSubject).toBeUndefined()
    expect(item.meetingStart).toBeUndefined()
    expect(item.title).toBe('Random note')
  })

  it('reports the count of today\'s recordings still awaiting a transcript', async () => {
    const { queryAll, getMeetings } = await import('../../services/database')
    vi.mocked(getMeetings).mockReturnValue([])
    vi.mocked(queryAll).mockImplementation(
      routeQueryAll([
        { match: /LEFT JOIN recordings r ON r\.id = t\.recording_id/, rows: [] },
        { match: /JOIN recordings r ON r\.id = t\.recording_id\s+LEFT JOIN meetings m/, rows: [] },
        { match: /SELECT COUNT\(1\) AS n FROM recordings r/, rows: [{ n: 3 }] },
        { match: /FROM actionables/, rows: [] },
        { match: /FROM transcripts WHERE/, rows: [{ n: 0 }] },
        { match: /FROM vector_embeddings/, rows: [{ n: 0 }] }
      ])
    )

    const res = await handlers['briefing:get']()
    expect(res.data.todayFollowUps).toHaveLength(0)
    expect(res.data.todayRecordingsPending).toBe(3)
  })

  it('day-scopes follow-ups and the pending count with the same day bounds', async () => {
    const { queryAll, getMeetings } = await import('../../services/database')
    vi.mocked(getMeetings).mockReturnValue([])
    const calls: Array<{ sql: string; params?: unknown[] }> = []
    vi.mocked(queryAll).mockImplementation((sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      if (/SELECT COUNT\(1\) AS n FROM recordings r/.test(sql)) return [{ n: 0 }]
      if (/FROM transcripts WHERE/.test(sql)) return [{ n: 0 }]
      return []
    })

    await handlers['briefing:get']()

    // RE7-P2b (round-8) — the recent-knowledge + pending-actionables queries now
    // page with `LIMIT ? OFFSET ?` (2 numeric params), so match the day-scoped
    // queries by their date-bound SQL rather than by param count.
    const dayScoped = calls.filter((c) => /date_recorded >= \?/.test(c.sql))
    // todayFollowUps + todayRecordingsPending both carry [dayStart, dayEnd].
    expect(dayScoped.length).toBeGreaterThanOrEqual(2)
    const [dayStart, dayEnd] = dayScoped[0].params as [string, string]
    expect(new Date(dayEnd).getTime()).toBeGreaterThan(new Date(dayStart).getTime())
    // Every day-scoped query uses the SAME bounds.
    for (const c of dayScoped) {
      expect(c.params).toEqual([dayStart, dayEnd])
    }
  })

  // RE7-3 (round-7) — Today is an assistant-facing DISPLAY. Even though the SQL
  // already drops personal/soft-deleted, a VALUE-excluded recording (and a stale
  // actionable pointing at a now-excluded recording) must be filtered through the
  // shared eligibility boundary before being shown.
  it('drops value-excluded recordings and their stale actionables from the briefing', async () => {
    const db: any = await import('../../services/database')
    const { queryAll, getMeetings } = db
    vi.mocked(getMeetings).mockReturnValue([])
    // rec-drop is value-excluded; the boundary reports it excluded.
    db.getExcludedRecordingIds.mockReturnValue({ ids: new Set(['rec-drop']), failClosed: false })
    // Actionable a-drop's capture resolves to rec-drop; a-keep's to rec-keep.
    db.__captures.set('kc-drop', { source_recording_id: 'rec-drop', quality_rating: null, deleted_at: null })
    db.__captures.set('kc-keep', { source_recording_id: 'rec-keep', quality_rating: null, deleted_at: null })
    const followUpRow = (rid: string) => ({
      recording_id: rid, title_suggestion: rid, summary: 's', action_items: '[]',
      word_count: 10, filename: `${rid}.wav`, date_recorded: '2026-07-09T10:00:00Z',
      meeting_id: null, meeting_subject: null, meeting_start: null, meeting_end: null
    })
    vi.mocked(queryAll).mockImplementation(
      routeQueryAll([
        { match: /LEFT JOIN recordings r ON r\.id = t\.recording_id/, rows: [followUpRow('rec-keep'), followUpRow('rec-drop')] },
        { match: /JOIN recordings r ON r\.id = t\.recording_id\s+LEFT JOIN meetings m/, rows: [followUpRow('rec-keep'), followUpRow('rec-drop')] },
        { match: /SELECT COUNT\(1\) AS n FROM recordings r/, rows: [{ n: 0 }] },
        { match: /FROM actionables/, rows: [
          { id: 'a-keep', type: 'email', title: 'Keep', source_knowledge_id: 'kc-keep' },
          { id: 'a-drop', type: 'email', title: 'Drop', source_knowledge_id: 'kc-drop' }
        ] },
        { match: /FROM transcripts WHERE/, rows: [{ n: 2 }] },
        { match: /FROM vector_embeddings/, rows: [{ n: 0 }] }
      ])
    )

    const res = await handlers['briefing:get']()
    expect(res.success).toBe(true)
    expect(res.data.recentKnowledge.map((r: any) => r.recordingId)).toEqual(['rec-keep'])
    expect(res.data.todayFollowUps.map((r: any) => r.recordingId)).toEqual(['rec-keep'])
    expect(res.data.pendingActionables.map((a: any) => a.id)).toEqual(['a-keep'])
  })

  it('fails closed — returns no recording-backed rows when eligibility is unverifiable', async () => {
    const db: any = await import('../../services/database')
    const { queryAll, getMeetings } = db
    vi.mocked(getMeetings).mockReturnValue([])
    db.getExcludedRecordingIds.mockReturnValue({ ids: new Set<string>(), failClosed: true })
    // a-1's source_knowledge_id 'rec-1' is a legacy recording id (not a registered
    // capture) → recording-backed → dropped on fail-closed.
    const row = {
      recording_id: 'rec-1', title_suggestion: 't', summary: 's', action_items: '[]',
      word_count: 10, filename: 'r.wav', date_recorded: '2026-07-09T10:00:00Z',
      meeting_id: null, meeting_subject: null, meeting_start: null, meeting_end: null
    }
    vi.mocked(queryAll).mockImplementation(
      routeQueryAll([
        { match: /LEFT JOIN recordings r ON r\.id = t\.recording_id/, rows: [row] },
        { match: /JOIN recordings r ON r\.id = t\.recording_id\s+LEFT JOIN meetings m/, rows: [row] },
        { match: /SELECT COUNT\(1\) AS n FROM recordings r/, rows: [{ n: 0 }] },
        { match: /FROM actionables/, rows: [{ id: 'a-1', type: 'email', title: 'X', source_knowledge_id: 'rec-1' }] },
        { match: /FROM transcripts WHERE/, rows: [{ n: 1 }] },
        { match: /FROM vector_embeddings/, rows: [{ n: 0 }] }
      ])
    )

    const res = await handlers['briefing:get']()
    expect(res.success).toBe(true)
    expect(res.data.recentKnowledge).toEqual([])
    expect(res.data.todayFollowUps).toEqual([])
    expect(res.data.pendingActionables).toEqual([])
  })

  // RE7-P2c (round-8) — on failClosed, drop ONLY rows with a resolved recording
  // id; standalone (NULL-source) actionables are kept (matching actionables:getAll,
  // which does not drop them).
  it('RE7-P2c — keeps standalone (NULL-source) actionables on failClosed, drops recording-backed ones', async () => {
    const db: any = await import('../../services/database')
    const { queryAll, getMeetings } = db
    vi.mocked(getMeetings).mockReturnValue([])
    db.getExcludedRecordingIds.mockReturnValue({ ids: new Set<string>(), failClosed: true })
    // kc-standalone = an eligible standalone capture (no source recording) → kept
    // even when the recording exclusion lookup fails; kc-rec is recording-backed.
    db.__captures.set('kc-standalone', { source_recording_id: null, quality_rating: 'valuable', deleted_at: null })
    db.__captures.set('kc-rec', { source_recording_id: 'rec-1', quality_rating: null, deleted_at: null })
    vi.mocked(queryAll).mockImplementation(
      routeQueryAll([
        { match: /LEFT JOIN recordings r ON r\.id = t\.recording_id/, rows: [] },
        { match: /JOIN recordings r ON r\.id = t\.recording_id\s+LEFT JOIN meetings m/, rows: [] },
        { match: /SELECT COUNT\(1\) AS n FROM recordings r/, rows: [{ n: 0 }] },
        { match: /FROM actionables\s+WHERE status/, rows: [
          { id: 'a-standalone', type: 'email', title: 'S', source_knowledge_id: 'kc-standalone' },
          { id: 'a-rec', type: 'email', title: 'R', source_knowledge_id: 'kc-rec' }
        ] },
        { match: /FROM transcripts WHERE/, rows: [{ n: 0 }] },
        { match: /FROM vector_embeddings/, rows: [{ n: 0 }] }
      ])
    )

    const res = await handlers['briefing:get']()
    expect(res.success).toBe(true)
    // recentKnowledge/todayFollowUps are all recording-backed → honestly empty…
    expect(res.data.recentKnowledge).toEqual([])
    // …but the standalone actionable survives; only the recording-backed one is dropped.
    expect(res.data.pendingActionables.map((a: any) => a.id)).toEqual(['a-standalone'])
  })

  // RE7-P2b (round-8) — page pending actionables until the 8-item display list is
  // filled, even when a block larger than one page is value-excluded.
  it('RE7-P2b — pages pending actionables past a >1-page block of excluded ones to fill the display limit', async () => {
    const db: any = await import('../../services/database')
    const { queryAll, getMeetings } = db
    vi.mocked(getMeetings).mockReturnValue([])
    db.getExcludedRecordingIds.mockReturnValue({ ids: new Set(['rec-bad']), failClosed: false })
    // Full ordered actionables list: 40 excluded (kc-bad → rec-bad), then 8 eligible
    // (kc-ok → eligible standalone captures). Register both classes.
    for (let i = 0; i < 40; i++) db.__captures.set(`kc-bad-${i}`, { source_recording_id: 'rec-bad', quality_rating: null, deleted_at: null })
    for (let j = 0; j < 8; j++) db.__captures.set(`kc-ok-${j}`, { source_recording_id: null, quality_rating: 'valuable', deleted_at: null })
    const fullActionables = [
      ...Array.from({ length: 40 }, (_, i) => ({ id: `a-bad-${i}`, type: 'email', title: `B${i}`, source_knowledge_id: `kc-bad-${i}` })),
      ...Array.from({ length: 8 }, (_, j) => ({ id: `a-ok-${j}`, type: 'email', title: `O${j}`, source_knowledge_id: `kc-ok-${j}` }))
    ]
    vi.mocked(queryAll).mockImplementation((sql: string, params?: unknown[]) => {
      if (/FROM actionables\s+WHERE status/.test(sql)) {
        // Honor the paged LIMIT ? OFFSET ? so collectEligibleRows can page.
        const [limit, offset] = (params as number[]) ?? [fullActionables.length, 0]
        return fullActionables.slice(offset, offset + limit) as any
      }
      return [] as any
    })

    const res = await handlers['briefing:get']()
    expect(res.success).toBe(true)
    const ids = res.data.pendingActionables.map((a: any) => a.id)
    expect(ids).toHaveLength(8)
    expect(ids.every((id: string) => id.startsWith('a-ok-'))).toBe(true)
  })

  // ADV44-2 (round-46) — the displayed statistics (transcribedCount / indexedChunks
  // / pendingActionables) must count only ELIGIBLE derivatives. A raw COUNT(*)
  // over the derivative tables over-reports soft-deleted / personal / value-
  // excluded / hard-purged sources, contradicting the deletion + value controls.
  it('ADV44-2 — statistics count only eligible transcripts, vector chunks and actionables', async () => {
    const db: any = await import('../../services/database')
    const { queryAll, getMeetings } = db
    vi.mocked(getMeetings).mockReturnValue([])
    // rec-drop is value-excluded / soft-deleted; rec-keep is eligible.
    db.getExcludedRecordingIds.mockReturnValue({ ids: new Set(['rec-drop']), failClosed: false })
    db.__captures.set('kc-keep', { source_recording_id: 'rec-keep', quality_rating: null, deleted_at: null })
    db.__captures.set('kc-drop', { source_recording_id: 'rec-drop', quality_rating: null, deleted_at: null })

    vi.mocked(queryAll).mockImplementation(
      routeQueryAll([
        // --- stats queries (specific fragments FIRST so they win over display routes) ---
        { match: /SELECT id, source_knowledge_id FROM actionables/, rows: [
          { id: 'a-keep', source_knowledge_id: 'kc-keep' },
          { id: 'a-drop', source_knowledge_id: 'kc-drop' }
        ] },
        { match: /SELECT recording_id, capture_id FROM vector_embeddings/, rows: [
          { recording_id: 'rec-keep', capture_id: null },
          { recording_id: 'rec-keep', capture_id: null },
          { recording_id: 'rec-drop', capture_id: null }
        ] },
        { match: /SELECT recording_id FROM transcripts WHERE/, rows: [
          { recording_id: 'rec-keep' },
          { recording_id: 'rec-drop' }
        ] },
        // --- display queries (empty so the test focuses on stats) ---
        { match: /LEFT JOIN recordings r ON r\.id = t\.recording_id/, rows: [] },
        { match: /JOIN recordings r ON r\.id = t\.recording_id\s+LEFT JOIN meetings m/, rows: [] },
        { match: /SELECT COUNT\(1\) AS n FROM recordings r/, rows: [{ n: 0 }] },
        { match: /FROM actionables\s+WHERE status/, rows: [] }
      ])
    )

    const res = await handlers['briefing:get']()
    expect(res.success).toBe(true)
    // rec-drop dropped from all three totals; rec-keep (2 chunks) counted.
    expect(res.data.stats.transcribedCount).toBe(1)
    expect(res.data.stats.indexedChunks).toBe(2)
    expect(res.data.stats.pendingActionables).toBe(1)
  })

  it('ADV44-2 — statistics fail closed to zero for recording-backed derivatives when eligibility is unverifiable', async () => {
    const db: any = await import('../../services/database')
    const { queryAll, getMeetings } = db
    vi.mocked(getMeetings).mockReturnValue([])
    db.getExcludedRecordingIds.mockReturnValue({ ids: new Set<string>(), failClosed: true })
    // kc-1 is a legacy recording-backed actionable source (not a registered
    // capture) → recording-backed → dropped on fail-closed.
    vi.mocked(queryAll).mockImplementation(
      routeQueryAll([
        { match: /SELECT id, source_knowledge_id FROM actionables/, rows: [
          { id: 'a-1', source_knowledge_id: 'rec-1' }
        ] },
        { match: /SELECT recording_id, capture_id FROM vector_embeddings/, rows: [
          { recording_id: 'rec-1', capture_id: null }
        ] },
        { match: /SELECT recording_id FROM transcripts WHERE/, rows: [{ recording_id: 'rec-1' }] },
        { match: /LEFT JOIN recordings r ON r\.id = t\.recording_id/, rows: [] },
        { match: /JOIN recordings r ON r\.id = t\.recording_id\s+LEFT JOIN meetings m/, rows: [] },
        { match: /SELECT COUNT\(1\) AS n FROM recordings r/, rows: [{ n: 0 }] },
        { match: /FROM actionables\s+WHERE status/, rows: [] }
      ])
    )

    const res = await handlers['briefing:get']()
    expect(res.success).toBe(true)
    expect(res.data.stats.transcribedCount).toBe(0)
    expect(res.data.stats.indexedChunks).toBe(0)
    expect(res.data.stats.pendingActionables).toBe(0)
  })

  // RE8-P2a (round-9) — NO fixed page ceiling: 900 excluded rows precede the
  // eligible ones (well beyond the old 25-page ≈ 500-row ceiling that would have
  // left the list short). Pagination must exhaust them and still fill 8.
  it('RE8-P2a — pages past a block larger than the old fixed ceiling to fill the display limit', async () => {
    const db: any = await import('../../services/database')
    const { queryAll, getMeetings } = db
    vi.mocked(getMeetings).mockReturnValue([])
    db.getExcludedRecordingIds.mockReturnValue({ ids: new Set(['rec-bad']), failClosed: false })
    for (let i = 0; i < 900; i++) db.__captures.set(`kc-bad-${i}`, { source_recording_id: 'rec-bad', quality_rating: null, deleted_at: null })
    for (let j = 0; j < 8; j++) db.__captures.set(`kc-ok-${j}`, { source_recording_id: null, quality_rating: 'valuable', deleted_at: null })
    const fullActionables = [
      ...Array.from({ length: 900 }, (_, i) => ({ id: `a-bad-${i}`, type: 'email', title: `B${i}`, source_knowledge_id: `kc-bad-${i}` })),
      ...Array.from({ length: 8 }, (_, j) => ({ id: `a-ok-${j}`, type: 'email', title: `O${j}`, source_knowledge_id: `kc-ok-${j}` }))
    ]
    vi.mocked(queryAll).mockImplementation((sql: string, params?: unknown[]) => {
      if (/FROM actionables\s+WHERE status/.test(sql)) {
        const [limit, offset] = (params as number[]) ?? [fullActionables.length, 0]
        return fullActionables.slice(offset, offset + limit) as any
      }
      return [] as any
    })

    const res = await handlers['briefing:get']()
    expect(res.success).toBe(true)
    expect(res.data.pendingActionables.map((a: any) => a.id)).toHaveLength(8)
  })
})
