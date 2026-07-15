import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerActionablesHandlers } from '../actionables-handlers'

// Mock electron ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

// Mock database
vi.mock('../../services/database', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
  // RE7-3 (round-7) — getAll/getByMeeting route rows through the real
  // eligibility boundary, which reads getExcludedRecordingIds. Default:
  // nothing excluded, not fail-closed (so all rows remain eligible).
  getExcludedRecordingIds: vi.fn(() => ({ ids: new Set<string>(), failClosed: false }))
}))

describe('Actionables IPC Handlers', () => {
  let handlers: Record<string, Function> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
      handlers[channel] = handler
      return undefined as any
    })
    registerActionablesHandlers()
  })

  it('should register all expected handlers', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('actionables:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('actionables:updateStatus', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('actionables:generateOutput', expect.any(Function))
  })

  describe('actionables:getAll', () => {
    it('should return all actionables mapped to correct interface', async () => {
      const { queryAll } = await import('../../services/database')
      const mockRows = [
        {
          id: 'a-1',
          type: 'email',
          title: 'Follow up with client',
          description: 'Send meeting notes',
          source_knowledge_id: 'k-1',
          source_action_item_id: 'ai-1',
          suggested_template: 'follow_up_email',
          suggested_recipients: '["client@example.com"]',
          status: 'pending',
          confidence: 0.85,
          artifact_id: null,
          generated_at: null,
          shared_at: null,
          created_at: '2025-06-15T10:00:00Z',
          updated_at: '2025-06-15T10:00:00Z'
        }
      ]
      vi.mocked(queryAll).mockReturnValue(mockRows)

      const result = await handlers['actionables:getAll'](null)

      expect(queryAll).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM actionables'),
        []
      )
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 'a-1',
        type: 'email',
        title: 'Follow up with client',
        description: 'Send meeting notes',
        sourceKnowledgeId: 'k-1',
        sourceActionItemId: 'ai-1',
        suggestedTemplate: 'follow_up_email',
        suggestedRecipients: ['client@example.com'],
        status: 'pending',
        confidence: 0.85,
        artifactId: null,
        generatedAt: null,
        sharedAt: null,
        createdAt: '2025-06-15T10:00:00Z',
        updatedAt: '2025-06-15T10:00:00Z'
      })
    })

    it('should filter by status when provided', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([])

      await handlers['actionables:getAll'](null, { status: 'pending' })

      expect(queryAll).toHaveBeenCalledWith(
        expect.stringContaining('WHERE status = ?'),
        ['pending']
      )
    })

    it('should not filter when no options are provided', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([])

      await handlers['actionables:getAll'](null)

      const callArgs = vi.mocked(queryAll).mock.calls[0]
      expect(callArgs[0]).not.toContain('WHERE')
      expect(callArgs[1]).toEqual([])
    })

    it('should handle safe optional access for undefined options', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([])

      // Call without the options argument at all
      const result = await handlers['actionables:getAll'](null, undefined)

      expect(result).toEqual([])
      expect(queryAll).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        []
      )
    })

    it('should handle invalid JSON in suggested_recipients gracefully', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([
        {
          id: 'a-2',
          type: 'task',
          title: 'Test',
          description: null,
          source_knowledge_id: 'k-2',
          source_action_item_id: null,
          suggested_template: null,
          suggested_recipients: 'not-valid-json',
          status: 'pending',
          confidence: null,
          artifact_id: null,
          generated_at: null,
          shared_at: null,
          created_at: '2025-06-15T10:00:00Z',
          updated_at: '2025-06-15T10:00:00Z'
        }
      ])

      const result = await handlers['actionables:getAll'](null)

      expect(result[0].suggestedRecipients).toEqual([])
    })

    it('should handle null suggested_recipients', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([
        {
          id: 'a-3',
          type: 'task',
          title: 'Test',
          description: null,
          source_knowledge_id: 'k-3',
          source_action_item_id: null,
          suggested_template: null,
          suggested_recipients: null,
          status: 'pending',
          confidence: null,
          artifact_id: null,
          generated_at: null,
          shared_at: null,
          created_at: '2025-06-15T10:00:00Z',
          updated_at: '2025-06-15T10:00:00Z'
        }
      ])

      const result = await handlers['actionables:getAll'](null)

      expect(result[0].suggestedRecipients).toEqual([])
    })

    it('should return empty array on database error', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockImplementation(() => {
        throw new Error('Database error')
      })

      const result = await handlers['actionables:getAll'](null)

      expect(result).toEqual([])
    })
  })

  describe('actionables:updateStatus', () => {
    it('should update status for a valid transition (pending -> in_progress)', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'pending' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'in_progress')

      expect(run).toHaveBeenCalledWith(
        'UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['in_progress', 'a-1']
      )
      expect(result).toEqual({ success: true })
    })

    it('should update status for transition pending -> dismissed', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'pending' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'dismissed')

      expect(run).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })

    it('should update status for transition in_progress -> generated', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'in_progress' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'generated')

      expect(run).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })

    it('should update status for transition generated -> shared', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'generated' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'shared')

      expect(run).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })

    it('should update status for transition dismissed -> pending', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'dismissed' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'pending')

      expect(run).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })

    // C-ACT-001: shared -> pending is now allowed for re-processing
    it('should allow transition shared -> pending', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'shared' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'pending')

      expect(run).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })

    // C-ACT-001: pending -> generated is now allowed for direct completion
    it('should allow transition pending -> generated', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'pending' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'generated')

      expect(run).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })

    // Idempotent no-op: setting the status the actionable already has succeeds
    // without an UPDATE. This is what the approve flow relies on when it calls
    // updateStatus('generated') after outputs:generate already set 'generated'.
    it('should treat same-status update as an idempotent no-op success', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'generated', artifact_id: 'out-1' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'generated')

      expect(result).toEqual({ success: true })
      // No UPDATE and (critically) no artifact cleanup for a no-op
      expect(run).not.toHaveBeenCalled()
    })

    it('should reject truly invalid status transition (shared -> in_progress)', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'shared' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'in_progress')

      expect(run).not.toHaveBeenCalled()
      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('Invalid status transition')
      })
    })

    // C-ACT-002: Cleanup generated outputs on dismiss
    it('should clean up output artifact when dismissing a generated actionable', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'generated', artifact_id: 'out-1' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'dismissed')

      // Should delete the output and clear artifact reference
      expect(run).toHaveBeenCalledWith('DELETE FROM outputs WHERE id = ?', ['out-1'])
      expect(run).toHaveBeenCalledWith('UPDATE actionables SET artifact_id = NULL, generated_at = NULL WHERE id = ?', ['a-1'])
      // Should also update the status
      expect(run).toHaveBeenCalledWith(
        'UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['dismissed', 'a-1']
      )
      expect(result).toEqual({ success: true })
    })

    // C-ACT-002: Cleanup generated outputs when reverting to pending
    it('should clean up output artifact when reverting generated to pending', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'generated', artifact_id: 'out-2' }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'pending')

      expect(run).toHaveBeenCalledWith('DELETE FROM outputs WHERE id = ?', ['out-2'])
      expect(result).toEqual({ success: true })
    })

    it('should not attempt cleanup when no artifact_id exists', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'pending', artifact_id: null }])

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'dismissed')

      // Should NOT call delete on outputs
      const deleteCalls = vi.mocked(run).mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM outputs')
      )
      expect(deleteCalls).toHaveLength(0)
      expect(result).toEqual({ success: true })
    })

    it('should return error if actionable not found', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([])

      const result = await handlers['actionables:updateStatus'](null, 'nonexistent', 'in_progress')

      expect(result).toEqual({
        success: false,
        error: 'Actionable nonexistent not found'
      })
    })

    it('should return error on database failure', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockImplementation(() => {
        throw new Error('DB connection lost')
      })

      const result = await handlers['actionables:updateStatus'](null, 'a-1', 'in_progress')

      expect(result).toEqual({
        success: false,
        error: 'DB connection lost'
      })
    })
  })

  describe('actionables:generateOutput', () => {
    it('should set status to in_progress and return generation data', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{
        id: 'a-1',
        status: 'pending',
        source_knowledge_id: 'k-1',
        suggested_template: 'meeting_notes'
      }])

      const result = await handlers['actionables:generateOutput'](null, 'a-1')

      expect(run).toHaveBeenCalledWith(
        'UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['in_progress', 'a-1']
      )
      expect(result).toEqual({
        success: true,
        data: {
          actionableId: 'a-1',
          sourceKnowledgeId: 'k-1',
          suggestedTemplate: 'meeting_notes'
        }
      })
    })

    it('should return error if actionable not found', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([])

      const result = await handlers['actionables:generateOutput'](null, 'nonexistent')

      expect(result).toEqual({
        success: false,
        error: 'Actionable nonexistent not found'
      })
    })

    // C-ACT-001: Now allows both 'pending' and 'generated' status
    it('should return error if actionable is in in_progress status', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'in_progress' }])

      const result = await handlers['actionables:generateOutput'](null, 'a-1')

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("Cannot generate from 'in_progress' status")
      })
    })

    it('should allow regeneration from generated status', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{
        id: 'a-1',
        status: 'generated',
        source_knowledge_id: 'k-1',
        suggested_template: 'meeting_notes'
      }])

      const result = await handlers['actionables:generateOutput'](null, 'a-1')

      expect(run).toHaveBeenCalledWith(
        'UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['in_progress', 'a-1']
      )
      expect(result).toEqual({
        success: true,
        data: {
          actionableId: 'a-1',
          sourceKnowledgeId: 'k-1',
          suggestedTemplate: 'meeting_notes'
        }
      })
    })

    it('should reject generation from dismissed status', async () => {
      const { queryAll } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{ id: 'a-1', status: 'dismissed' }])

      const result = await handlers['actionables:generateOutput'](null, 'a-1')

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("Cannot generate from 'dismissed' status")
      })
    })

    it('should revert to pending on database error during status update', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{
        id: 'a-1',
        status: 'pending',
        source_knowledge_id: 'k-1',
        suggested_template: 'email'
      }])
      // First call to run (set in_progress) throws, second call (revert to pending) succeeds
      vi.mocked(run)
        .mockImplementationOnce(() => { throw new Error('Update failed') })
        .mockImplementationOnce(() => undefined)

      const result = await handlers['actionables:generateOutput'](null, 'a-1')

      expect(result).toEqual({
        success: false,
        error: 'Update failed'
      })
      // Should have attempted to revert status
      expect(run).toHaveBeenCalledTimes(2)
      expect(run).toHaveBeenLastCalledWith(
        'UPDATE actionables SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['pending', 'a-1']
      )
    })

    it('should handle revert failure gracefully', async () => {
      const { queryAll, run } = await import('../../services/database')
      vi.mocked(queryAll).mockReturnValue([{
        id: 'a-1',
        status: 'pending',
        source_knowledge_id: 'k-1',
        suggested_template: 'email'
      }])
      // Both the update and the revert fail
      vi.mocked(run).mockImplementation(() => {
        throw new Error('DB completely down')
      })

      const result = await handlers['actionables:generateOutput'](null, 'a-1')

      // Should still return the original error, not the revert error
      expect(result).toEqual({
        success: false,
        error: 'DB completely down'
      })
    })
  })

  // RE7-3 (round-7) — actionables lists are assistant-facing DISPLAY of
  // recording-derived content, routed through the shared eligibility boundary.
  describe('eligibility filtering (RE7-3)', () => {
    const row = (id: string, skid: string) => ({
      id, type: 'email', title: id, description: null, source_knowledge_id: skid,
      source_action_item_id: null, suggested_template: null, suggested_recipients: null,
      status: 'pending', confidence: null, artifact_id: null, generated_at: null,
      shared_at: null, created_at: '2026-07-09T10:00:00Z', updated_at: '2026-07-09T10:00:00Z'
    })

    it('getAll drops actionables whose source recording is excluded, keeps standalone rows', async () => {
      const { queryAll, queryOne, getExcludedRecordingIds } = await import('../../services/database')
      // a-keep → rec-keep (eligible); a-drop → rec-drop (excluded); a-standalone → no capture.
      vi.mocked(queryOne).mockImplementation((_sql: string, params?: unknown[]) => {
        const id = params?.[0]
        if (id === 'kc-keep') return { source_recording_id: 'rec-keep' } as any
        if (id === 'kc-drop') return { source_recording_id: 'rec-drop' } as any
        // kc-standalone: a real capture NOT backed by any recording → always kept.
        if (id === 'kc-standalone') return { source_recording_id: null } as any
        return null as any
      })
      vi.mocked(getExcludedRecordingIds).mockReturnValue({ ids: new Set(['rec-drop']), failClosed: false } as any)
      vi.mocked(queryAll).mockReturnValue([row('a-keep', 'kc-keep'), row('a-drop', 'kc-drop'), row('a-standalone', 'kc-standalone')])

      const result = await handlers['actionables:getAll'](null)
      expect(result.map((a: any) => a.id).sort()).toEqual(['a-keep', 'a-standalone'])
    })

    it('getAll fails closed — drops every recording-backed actionable when eligibility is unverifiable', async () => {
      const { queryAll, queryOne, getExcludedRecordingIds } = await import('../../services/database')
      vi.mocked(queryOne).mockImplementation((_sql: string, params?: unknown[]) => {
        const id = params?.[0]
        if (id === 'kc-1') return { source_recording_id: 'rec-1' } as any
        // kc-free: a real standalone capture (no source recording) → always kept.
        if (id === 'kc-free') return { source_recording_id: null } as any
        return null as any
      })
      vi.mocked(getExcludedRecordingIds).mockReturnValue({ ids: new Set<string>(), failClosed: true } as any)
      // a-rec is recording-backed (dropped on fail-closed); a-free is standalone (kept).
      vi.mocked(queryAll).mockReturnValue([row('a-rec', 'kc-1'), row('a-free', 'kc-free')])

      const result = await handlers['actionables:getAll'](null)
      expect(result.map((a: any) => a.id)).toEqual(['a-free'])
    })
  })
})
