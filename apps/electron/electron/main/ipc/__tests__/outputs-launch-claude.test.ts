/**
 * @vitest-environment node
 *
 * Tests for the "Open in Claude Code" handoff launch channel
 * (outputs:launchClaudeCode) — cwd resolution order, CLI-missing error path,
 * and the needsFolder prompt.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerOutputsHandlers } from '../outputs-handlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  clipboard: { writeText: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  shell: { showItemInFolder: vi.fn() }
}))

vi.mock('../../services/file-storage', () => ({
  getTranscriptsPath: vi.fn(() => '/tmp/transcripts')
}))

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

vi.mock('../../services/database', () => ({
  run: vi.fn(),
  runInTransaction: vi.fn((fn: () => void) => fn()),
  queryOne: vi.fn()
}))

vi.mock('../../services/config', () => ({
  getConfig: vi.fn(() => ({ integrations: { handoffDirectory: '' } })),
  updateConfig: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
  spawnSync: vi.fn(() => ({ status: 0, stdout: 'C:\\Users\\me\\claude.cmd\n' }))
}))

vi.mock('../../services/output-generator', () => ({
  getOutputGeneratorService: () => ({
    getTemplates: vi.fn().mockReturnValue([]),
    generate: vi.fn()
  })
}))

vi.mock('../../validation/outputs', () => ({
  GenerateOutputRequestSchema: { safeParse: (data: any) => ({ success: true, data }) }
}))

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto')
  return { ...actual, default: actual, randomUUID: () => 'test-uuid' }
})

describe('outputs:launchClaudeCode', () => {
  let handlers: Record<string, Function> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
      handlers[channel] = handler
      return undefined as any
    })
    // Restore default happy-path mocks after clearAllMocks reset them
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const cp = await import('child_process')
    vi.mocked(cp.spawnSync).mockReturnValue({ status: 0, stdout: 'C:\\Users\\me\\claude.cmd\n' } as any)
    vi.mocked(cp.spawn).mockReturnValue({ on: vi.fn(), unref: vi.fn() } as any)
    const cfg = await import('../../services/config')
    vi.mocked(cfg.getConfig).mockReturnValue({ integrations: { handoffDirectory: '' } } as any)
    registerOutputsHandlers()
  })

  it('registers the launch handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('outputs:launchClaudeCode', expect.any(Function))
  })

  it('resolves cwd from the source project folder and launches', async () => {
    const { queryOne } = await import('../../services/database')
    const cp = await import('child_process')
    vi.mocked(queryOne)
      .mockReturnValueOnce({ source_knowledge_id: 'kc-1' } as any) // actionable lookup
      .mockReturnValueOnce({ folder_path: 'C:\\proj\\repo' } as any) // knowledge_projects → project

    const res = await handlers['outputs:launchClaudeCode'](null, {
      filePath: 'C:\\out\\handoff.md',
      actionableId: 'a-1'
    })

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ launched: true, cwd: 'C:\\proj\\repo' })
    expect(cp.spawn).toHaveBeenCalled()
  })

  it('falls back to the configured handoffDirectory when no project folder', async () => {
    const { queryOne } = await import('../../services/database')
    const cfg = await import('../../services/config')
    // resolveProjectFolderForActionable: first query returns null → no project
    vi.mocked(queryOne).mockReturnValue(undefined as any)
    vi.mocked(cfg.getConfig).mockReturnValue({ integrations: { handoffDirectory: 'C:\\configured\\dir' } } as any)

    const res = await handlers['outputs:launchClaudeCode'](null, {
      filePath: 'C:\\out\\handoff.md',
      actionableId: 'a-1'
    })

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ launched: true, cwd: 'C:\\configured\\dir' })
  })

  it('persists an explicitly picked folder as the handoffDirectory', async () => {
    const cfg = await import('../../services/config')

    const res = await handlers['outputs:launchClaudeCode'](null, {
      filePath: 'C:\\out\\handoff.md',
      cwd: 'C:\\picked\\folder'
    })

    expect(res.success).toBe(true)
    expect(res.data.launched).toBe(true)
    expect(cfg.updateConfig).toHaveBeenCalledWith('integrations', { handoffDirectory: 'C:\\picked\\folder' })
  })

  it('returns needsFolder when no cwd can be resolved', async () => {
    // No actionableId, empty configured dir → nothing to resolve
    const res = await handlers['outputs:launchClaudeCode'](null, {
      filePath: 'C:\\out\\handoff.md'
    })

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ launched: false, needsFolder: true })
  })

  it('errors honestly when the Claude Code CLI is not found', async () => {
    const cp = await import('child_process')
    // `where claude` fails → CLI not on PATH
    vi.mocked(cp.spawnSync).mockReturnValue({ status: 1, stdout: '' } as any)

    const res = await handlers['outputs:launchClaudeCode'](null, {
      filePath: 'C:\\out\\handoff.md',
      cwd: 'C:\\picked\\folder'
    })

    expect(res.success).toBe(false)
    expect(res.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(res.error.message).toContain('Claude Code CLI not found')
    expect(cp.spawn).not.toHaveBeenCalled()
  })

  it('materializes the handoff file from content when no valid filePath', async () => {
    const fs = await import('fs')
    // filePath missing on disk → fall back to writing content
    vi.mocked(fs.existsSync).mockImplementation((p: any) => p !== 'C:\\missing.md')

    const res = await handlers['outputs:launchClaudeCode'](null, {
      filePath: 'C:\\missing.md',
      content: '# Follow-up\nDo the thing.',
      templateId: 'claude_code_prompt',
      cwd: 'C:\\picked\\folder'
    })

    expect(res.success).toBe(true)
    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  it('returns NOT_FOUND when neither a file nor content is available', async () => {
    const res = await handlers['outputs:launchClaudeCode'](null, {
      cwd: 'C:\\picked\\folder'
    })

    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })
})
