/**
 * Tests for knowledge-graph-handlers.ts
 *
 * Mocks the service layer and verifies:
 * - All 8 channels are registered
 * - Handlers return { success, data } on success
 * - Handlers return { success: false, error } on failure
 * - graph:ingestFolder rejects path traversal
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
  ingestFromDbTranscripts: vi.fn(),
  ingestFromFolder: vi.fn(),
  queryTopAttendees: vi.fn(),
  queryTopSkill: vi.fn(),
  queryPersonProfile: vi.fn(),
  queryMeetingGraph: vi.fn(),
}))

// Mock the database (graph:resolvePerson uses getContactByName); avoids pulling
// the real sql.js/file-storage/config chain into this service-mock test.
vi.mock('../../services/database', () => ({
  getContactByName: vi.fn(),
}))

import {
  queryStats,
  ingestFromDbTranscripts,
  ingestFromFolder,
  queryTopAttendees,
  queryTopSkill,
  queryPersonProfile,
  queryMeetingGraph,
} from '../../services/knowledge-graph-service'
import { getContactByName } from '../../services/database'

import { registerKnowledgeGraphHandlers } from '../knowledge-graph-handlers'

describe('knowledge-graph IPC handlers', () => {
  let handlers: Record<string, Function> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    ;(ipcMain.handle as any).mockImplementation((channel: string, handler: Function) => {
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
      'graph:ingestFolder',
      'graph:topAttendees',
      'graph:topSkill',
      'graph:personProfile',
      'graph:meetingGraph',
      'graph:resolvePerson',
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

  // -------------------------------------------------------------------------
  // graph:resolvePerson
  // -------------------------------------------------------------------------
  describe('graph:resolvePerson', () => {
    it('returns the resolved contact', async () => {
      const contact = { id: 'c1', name: 'Alice', email: null }
      ;(getContactByName as any).mockReturnValue(contact)

      const result = await handlers['graph:resolvePerson']({}, 'Alice')
      expect(result).toEqual({ success: true, data: contact })
      expect(getContactByName).toHaveBeenCalledWith('Alice')
    })

    it('returns null data when no contact matches', async () => {
      ;(getContactByName as any).mockReturnValue(undefined)
      const result = await handlers['graph:resolvePerson']({}, 'Nobody')
      expect(result).toEqual({ success: true, data: null })
    })

    it('rejects a non-string name', async () => {
      const result = await handlers['graph:resolvePerson']({}, 123)
      expect(result.success).toBe(false)
      expect(result.error).toContain('name must be a non-empty string')
    })
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
      ;(ingestFromDbTranscripts as any).mockResolvedValue(mockResult)

      const result = await handlers['graph:ingestAll']({})
      expect(result).toEqual({ success: true, data: mockResult })
    })

    it('returns error when no provider configured', async () => {
      ;(ingestFromDbTranscripts as any).mockRejectedValue(new Error('No AI provider configured'))
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

})
