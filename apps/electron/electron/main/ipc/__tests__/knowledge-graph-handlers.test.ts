/**
 * Tests for knowledge-graph-handlers.ts
 *
 * Mocks the service layer and verifies:
 * - All 7 channels are registered
 * - Handlers return { success, data } on success
 * - Handlers return { success: false, error } on failure
 * - graph:ingestFolder rejects path traversal
 * - the removed graph:listNodes / graph:resolvePerson channels are NOT registered
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

// Mock Electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

// Mock the knowledge-graph service
vi.mock('../../services/knowledge-graph-service', () => ({
  queryStats: vi.fn(),
  ingestAllGraphSources: vi.fn(),
  ingestFromFolder: vi.fn(),
  queryTopAttendees: vi.fn(),
  queryTopSkill: vi.fn(),
  queryPersonProfile: vi.fn(),
  queryMeetingGraph: vi.fn(),
  removeRecordingProvenanceCore: vi.fn(),
}))

// Mock the database module the reingest handler lazy-imports.
vi.mock('../../services/database', () => ({
  run: vi.fn(),
  queryAll: vi.fn(),
  runInTransaction: vi.fn((fn: () => unknown) => fn()), // execute the txn body inline
}))

import {
  queryStats,
  ingestAllGraphSources,
  ingestFromFolder,
  queryTopAttendees,
  queryTopSkill,
  queryPersonProfile,
  queryMeetingGraph,
  removeRecordingProvenanceCore,
} from '../../services/knowledge-graph-service'
import { run, queryAll, runInTransaction } from '../../services/database'

import { registerKnowledgeGraphHandlers } from '../knowledge-graph-handlers'

describe('knowledge-graph IPC handlers', () => {
  let handlers: Record<string, (...args: any[]) => any> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    ;(ipcMain.handle as any).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
      handlers[channel] = handler
    })
    registerKnowledgeGraphHandlers()
  })

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------
  it('registers all 8 channels', () => {
    const expectedChannels = [
      'graph:stats',
      'graph:ingestAll',
      'graph:reingestRecordings',
      'graph:ingestFolder',
      'graph:topAttendees',
      'graph:topSkill',
      'graph:personProfile',
      'graph:meetingGraph',
    ]
    for (const channel of expectedChannels) {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function))
    }
  })

  // ADV33-1 (round 35): graph:listNodes was a DEAD IPC (no renderer consumer) that
  // returned raw GraphNode objects leaking a suppressed backing contact's id. It was
  // removed entirely; assert it is NOT registered and that no handler exists for it.
  it('does NOT register the removed graph:listNodes channel', () => {
    const registered = (ipcMain.handle as any).mock.calls.map((c: any[]) => c[0])
    expect(registered).not.toContain('graph:listNodes')
    expect(handlers['graph:listNodes']).toBeUndefined()
  })

  // ADV34-2 (round 36): graph:resolvePerson was a DEAD IPC (no renderer consumer)
  // that returned a raw, unfiltered Contact (id/email/role/company/notes/tags/
  // provenance) — leaking the identity of a contact backed only by an excluded /
  // hard-purged recording. It was removed entirely; assert it is NOT registered.
  it('does NOT register the removed graph:resolvePerson channel', () => {
    const registered = (ipcMain.handle as any).mock.calls.map((c: any[]) => c[0])
    expect(registered).not.toContain('graph:resolvePerson')
    expect(handlers['graph:resolvePerson']).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // graph:stats
  // -------------------------------------------------------------------------
  describe('graph:stats', () => {
    it('returns success with stats data', async () => {
      const mockStats = { nodes: 10, edges: 20, nodesByType: { person: 3 } }
      ;(queryStats as any).mockReturnValue(mockStats)

      const result = await handlers['graph:stats']({})
      expect(result).toEqual({ success: true, data: mockStats })
    })

    it('returns error on service failure', async () => {
      ;(queryStats as any).mockImplementation(() => { throw new Error('DB error') })
      const result = await handlers['graph:stats']({})
      expect(result.success).toBe(false)
      expect(result.error).toContain('DB error')
    })
  })

  // -------------------------------------------------------------------------
  // graph:ingestAll
  // -------------------------------------------------------------------------
  describe('graph:ingestAll', () => {
    it('returns success with ingest result', async () => {
      const mockResult = { ingested: 5, skipped: 2, errors: [] }
      ;(ingestAllGraphSources as any).mockResolvedValue(mockResult)

      const result = await handlers['graph:ingestAll']({})
      expect(result).toEqual({ success: true, data: mockResult })
    })

    it('returns error when no provider configured', async () => {
      ;(ingestAllGraphSources as any).mockRejectedValue(new Error('No AI provider configured'))
      const result = await handlers['graph:ingestAll']({})
      expect(result.success).toBe(false)
      expect(result.error).toContain('No AI provider configured')
    })
  })

  // -------------------------------------------------------------------------
  // graph:ingestFolder — includes traversal rejection
  // -------------------------------------------------------------------------
  describe('graph:ingestFolder', () => {
    it('returns success with ingest result for valid path', async () => {
      const mockResult = { ingested: 3, skipped: 0, errors: [] }
      ;(ingestFromFolder as any).mockResolvedValue(mockResult)

      const result = await handlers['graph:ingestFolder']({}, '/valid/folder/path')
      expect(result).toEqual({ success: true, data: mockResult })
      expect(ingestFromFolder).toHaveBeenCalledWith('/valid/folder/path')
    })

    it('rejects path traversal at the IPC layer (before service call)', async () => {
      const result = await handlers['graph:ingestFolder']({}, '/some/path/../../../etc')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Path traversal not allowed')
      // Service should NOT have been called
      expect(ingestFromFolder).not.toHaveBeenCalled()
    })

    it('rejects missing folderPath', async () => {
      const result = await handlers['graph:ingestFolder']({}, undefined)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('rejects non-string folderPath', async () => {
      const result = await handlers['graph:ingestFolder']({}, 42)
      expect(result.success).toBe(false)
      expect(ingestFromFolder).not.toHaveBeenCalled()
    })

    it('returns error when service throws', async () => {
      ;(ingestFromFolder as any).mockRejectedValue(new Error('Folder does not exist'))
      const result = await handlers['graph:ingestFolder']({}, '/valid/path')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Folder does not exist')
    })
  })

  // -------------------------------------------------------------------------
  // graph:topAttendees
  // -------------------------------------------------------------------------
  describe('graph:topAttendees', () => {
    it('returns ranked attendees', async () => {
      const mockData = [{ person: 'Alice', personId: 'person:alice', meetings: 3 }]
      ;(queryTopAttendees as any).mockReturnValue(mockData)

      const result = await handlers['graph:topAttendees']({}, 'Project Alpha')
      expect(result).toEqual({ success: true, data: mockData })
      expect(queryTopAttendees).toHaveBeenCalledWith('Project Alpha')
    })

    it('returns error for missing name', async () => {
      const result = await handlers['graph:topAttendees']({}, '')
      expect(result.success).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // graph:topSkill
  // -------------------------------------------------------------------------
  describe('graph:topSkill', () => {
    it('returns skill demonstrators', async () => {
      const mockData = [{ person: 'Bob', personId: 'person:bob', weight: 2 }]
      ;(queryTopSkill as any).mockReturnValue(mockData)

      const result = await handlers['graph:topSkill']({}, 'TypeScript')
      expect(result).toEqual({ success: true, data: mockData })
    })

    it('returns error for missing skill', async () => {
      const result = await handlers['graph:topSkill']({}, null)
      expect(result.success).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // graph:personProfile
  // -------------------------------------------------------------------------
  describe('graph:personProfile', () => {
    it('returns person profile', async () => {
      const mockProfile = { personId: 'person:alice', personLabel: 'Alice', meetings: [], skills: [], actionItems: [] }
      ;(queryPersonProfile as any).mockReturnValue(mockProfile)

      const result = await handlers['graph:personProfile']({}, 'Alice')
      expect(result).toEqual({ success: true, data: mockProfile })
    })

    it('returns success with undefined data if person not found', async () => {
      ;(queryPersonProfile as any).mockReturnValue(undefined)
      const result = await handlers['graph:personProfile']({}, 'Unknown Person')
      expect(result.success).toBe(true)
      expect(result.data).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // graph:meetingGraph
  // -------------------------------------------------------------------------
  describe('graph:meetingGraph', () => {
    it('returns meeting graph', async () => {
      const mockGraph = { meeting: { id: 'meeting:test' }, nodes: [], edges: [] }
      ;(queryMeetingGraph as any).mockReturnValue(mockGraph)

      const result = await handlers['graph:meetingGraph']({}, 'mtg-001')
      expect(result).toEqual({ success: true, data: mockGraph })
    })

    it('returns error for missing meetingId', async () => {
      const result = await handlers['graph:meetingGraph']({}, undefined)
      expect(result.success).toBe(false)
    })
  })


  // -------------------------------------------------------------------------
  // graph:reingestRecordings — the surgical re-ingest REMOVAL half (destructive)
  // -------------------------------------------------------------------------
  describe('graph:reingestRecordings', () => {
    // Two recordings in scope: rec-1 has a capture with B1 rows; rec-2 has NO
    // matching capture_id (must not error, must not attempt a B1 delete).
    const SCOPE = [
      { recording_id: 'rec-1', capture_id: 'cap-1' },
      { recording_id: 'rec-2', capture_id: null },
    ]

    function primeMocks() {
      // queryAll is used for: (1) the scope query, then per rec-1 the two COUNT
      // queries (decisions, action_items). rec-2 has no capture so no counts.
      ;(queryAll as any).mockImplementation((sql: string) => {
        if (/FROM graph_ingested_transcripts/i.test(sql)) return SCOPE
        if (/FROM decisions WHERE knowledge_capture_id/i.test(sql)) return [{ n: 2 }]
        if (/FROM action_items WHERE knowledge_capture_id/i.test(sql)) return [{ n: 3 }]
        return []
      })
      ;(removeRecordingProvenanceCore as any).mockImplementation((rid: string, opts: any) => ({
        ok: true, recordingId: rid, dryRun: !!opts?.dryRun,
        markersRemoved: 1, edgesRemoved: 4, edgeSourceRowsRemoved: 5,
        meetingNodesRemoved: 1, orphanNodesRemoved: 2, orphanNodesByType: {},
        sharedEdgesKept: 1, unattributedResidueKept: 0,
      }))
    }

    beforeEach(() => {
      primeMocks()
    })

    it('dry-run writes NOTHING but still reports scope + counts', async () => {
      const result = await handlers['graph:reingestRecordings']({}, { dryRun: true })
      expect(result.success).toBe(true)
      expect(result.data.dryRun).toBe(true)
      expect(result.data.recordingsInScope).toBe(2)
      expect(result.data.recordingIds).toEqual(['rec-1', 'rec-2'])
      // removeRecordingProvenanceCore called with dryRun:true for each recording
      expect(removeRecordingProvenanceCore).toHaveBeenCalledTimes(2)
      expect(removeRecordingProvenanceCore).toHaveBeenCalledWith('rec-1', { dryRun: true })
      expect(removeRecordingProvenanceCore).toHaveBeenCalledWith('rec-2', { dryRun: true })
      // NO writes: no B1 deletes, no transaction opened
      expect(run).not.toHaveBeenCalled()
      expect(runInTransaction).not.toHaveBeenCalled()
      // counts still aggregated (rec-1: 2 decisions / 3 actions; markers 1+1)
      expect(result.data.totals.markersRemoved).toBe(2)
      expect(result.data.totals.decisionsRemoved).toBe(2)
      expect(result.data.totals.actionItemsRemoved).toBe(3)
    })

    it('real-run deletes B1 rows AND calls removeRecordingProvenanceCore per in-scope recording, atomically', async () => {
      const result = await handlers['graph:reingestRecordings']({}, { dryRun: false })
      expect(result.success).toBe(true)
      expect(result.data.dryRun).toBe(false)
      // provenance removal invoked per recording with dryRun:false
      expect(removeRecordingProvenanceCore).toHaveBeenCalledWith('rec-1', { dryRun: false })
      expect(removeRecordingProvenanceCore).toHaveBeenCalledWith('rec-2', { dryRun: false })
      // each recording wrapped in its own transaction (2 recordings → 2 txns)
      expect(runInTransaction).toHaveBeenCalledTimes(2)
      // B1 deletes fired ONLY for the capture-backed recording (rec-1): 2 deletes
      const deleteCalls = (run as any).mock.calls.filter((c: any[]) => /DELETE FROM (decisions|action_items)/i.test(c[0]))
      expect(deleteCalls).toHaveLength(2)
      expect(deleteCalls.some((c: any[]) => /decisions/.test(c[0]) && c[1][0] === 'cap-1')).toBe(true)
      expect(deleteCalls.some((c: any[]) => /action_items/.test(c[0]) && c[1][0] === 'cap-1')).toBe(true)
    })

    it('a recording with no matching capture_id does not error and skips the B1 delete', async () => {
      // Scope with ONLY the capture-less recording.
      ;(queryAll as any).mockImplementation((sql: string) =>
        /FROM graph_ingested_transcripts/i.test(sql) ? [{ recording_id: 'rec-2', capture_id: null }] : []
      )
      const result = await handlers['graph:reingestRecordings']({}, { dryRun: false })
      expect(result.success).toBe(true)
      expect(result.data.recordingsInScope).toBe(1)
      expect(removeRecordingProvenanceCore).toHaveBeenCalledWith('rec-2', { dryRun: false })
      // No B1 delete attempted (no capture)
      const deleteCalls = (run as any).mock.calls.filter((c: any[]) => /DELETE FROM/i.test(c[0]))
      expect(deleteCalls).toHaveLength(0)
      expect(result.data.totals.decisionsRemoved).toBe(0)
      expect(result.data.totals.actionItemsRemoved).toBe(0)
    })

    it('returns { success:false, error } if removal throws', async () => {
      ;(removeRecordingProvenanceCore as any).mockImplementation(() => { throw new Error('provenance boom') })
      const result = await handlers['graph:reingestRecordings']({}, { dryRun: false })
      expect(result.success).toBe(false)
      expect(result.error).toContain('provenance boom')
    })
  })
})
