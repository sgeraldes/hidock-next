/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerOutputsHandlers } from '../outputs-handlers'

// Mock electron
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  clipboard: { writeText: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  shell: { showItemInFolder: vi.fn() }
}))

// Mock file-storage (imports config → electron app at module level)
vi.mock('../../services/file-storage', () => ({
  getTranscriptsPath: vi.fn(() => '/tmp/transcripts')
}))

// Mock fs for the auto-export path
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true)
  }
})

// Mock database
vi.mock('../../services/database', () => ({
  run: vi.fn(),
  runInTransaction: vi.fn((fn: () => void) => fn()),
  queryOne: vi.fn()
}))

// Mock config (outputs-handlers imports it for the launch channel; config.ts
// touches electron.app at module load, which this suite's electron mock omits)
vi.mock('../../services/config', () => ({
  getConfig: vi.fn(() => ({ integrations: { handoffDirectory: '' } })),
  updateConfig: vi.fn().mockResolvedValue(undefined)
}))

// Mock child_process (launch channel uses spawn/spawnSync)
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '' }))
}))

// Mock output generator
vi.mock('../../services/output-generator', () => ({
  getOutputGeneratorService: () => ({
    getTemplates: vi.fn().mockReturnValue([]),
    generate: vi.fn().mockResolvedValue({
      content: '# Test output',
      templateId: 'meeting_minutes',
      generatedAt: new Date().toISOString()
    })
  })
}))

// Mock validation
vi.mock('../../validation/outputs', () => ({
  GenerateOutputRequestSchema: {
    safeParse: (data: any) => ({
      success: true,
      data: data
    })
  }
}))

// Mock crypto with default export preserved
vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto')
  return {
    ...actual,
    default: actual,
    randomUUID: () => 'test-uuid-1234'
  }
})

describe('Outputs IPC Handlers - B-ACT-001 & B-ACT-004', () => {
  let handlers: Record<string, (...args: any[]) => any> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
      handlers[channel] = handler
      return undefined as any
    })
    registerOutputsHandlers()
  })

  it('should register outputs:getByActionableId handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('outputs:getByActionableId', expect.any(Function))
  })

  describe('outputs:getByActionableId (B-ACT-004)', () => {
    it('should return error for non-string actionableId', async () => {
      const result = await handlers['outputs:getByActionableId'](null, 123)
      expect(result.success).toBe(false)
      expect(result.error.code).toBe('VALIDATION_ERROR')
    })

    it('should return error for empty string actionableId', async () => {
      const result = await handlers['outputs:getByActionableId'](null, '')
      expect(result.success).toBe(false)
      expect(result.error.code).toBe('VALIDATION_ERROR')
    })

    it('should return NOT_FOUND when actionable does not exist', async () => {
      const { queryOne } = await import('../../services/database')
      vi.mocked(queryOne).mockReturnValue(undefined)

      const result = await handlers['outputs:getByActionableId'](null, 'a-nonexistent')
      expect(result.success).toBe(false)
      expect(result.error.code).toBe('NOT_FOUND')
    })

    it('should return null when actionable has no artifact_id', async () => {
      const { queryOne } = await import('../../services/database')
      vi.mocked(queryOne).mockReturnValue({ artifact_id: null })

      const result = await handlers['outputs:getByActionableId'](null, 'a-1')
      expect(result.success).toBe(true)
      expect(result.data).toBeNull()
    })

    it('should return output data when artifact exists', async () => {
      const { queryOne } = await import('../../services/database')
      vi.mocked(queryOne)
        .mockReturnValueOnce({ artifact_id: 'output-1' }) // actionable lookup
        .mockReturnValueOnce({                              // output lookup
          content: '# Meeting Minutes',
          template_id: 'meeting_minutes',
          generated_at: '2025-06-15T10:00:00Z'
        })

      const result = await handlers['outputs:getByActionableId'](null, 'a-1')
      expect(result.success).toBe(true)
      expect(result.data).toEqual({
        content: '# Meeting Minutes',
        templateId: 'meeting_minutes',
        generatedAt: '2025-06-15T10:00:00Z'
      })
    })

    it('should return null when artifact_id references missing output', async () => {
      const { queryOne } = await import('../../services/database')
      vi.mocked(queryOne)
        .mockReturnValueOnce({ artifact_id: 'stale-output-id' }) // actionable lookup
        .mockReturnValueOnce(undefined)                           // output not found

      const result = await handlers['outputs:getByActionableId'](null, 'a-1')
      expect(result.success).toBe(true)
      expect(result.data).toBeNull()
    })
  })
})
