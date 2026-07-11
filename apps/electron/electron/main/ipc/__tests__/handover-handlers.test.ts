/**
 * @vitest-environment node
 *
 * Handover IPC handler tests (H9). The handover-service and outputs-handlers
 * helpers are mocked so the handlers' resolution + wiring is asserted without
 * touching the filesystem, DB, or brains.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerHandoverHandlers } from '../handover-handlers'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return { ...actual, default: actual, existsSync: vi.fn(() => true) }
})

vi.mock('../../services/config', () => ({
  getConfig: vi.fn(() => ({ integrations: { handoffDirectory: '' } })),
  updateConfig: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../outputs-handlers', () => ({
  resolveProjectFolderForActionable: vi.fn(() => null),
}))

vi.mock('../../services/handover-service', () => ({
  assembleHandoverBundle: vi.fn(() => ({
    bundleDir: 'C:\\repo\\handover\\2026-07-11-090000-x',
    handoverPath: 'C:\\repo\\handover\\2026-07-11-090000-x\\HANDOVER.md',
    manifest: { slug: '2026-07-11-090000-x', files: ['HANDOVER.md'] },
  })),
  runHandoverAgent: vi.fn(async () => ({
    ok: true,
    brainId: 'claude-code',
    brainLabel: 'Claude Code',
    finalResponse: 'done',
    runLogPath: 'C:\\repo\\handover\\2026-07-11-090000-x\\RUN.log',
  })),
}))

describe('handover IPC handlers', () => {
  let handlers: Record<string, Function> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
      handlers[channel] = handler
      return undefined as any
    })
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const cfg = await import('../../services/config')
    vi.mocked(cfg.getConfig).mockReturnValue({ integrations: { handoffDirectory: '' } } as any)
    const oh = await import('../outputs-handlers')
    vi.mocked(oh.resolveProjectFolderForActionable).mockReturnValue(null)
    registerHandoverHandlers()
  })

  it('registers both handover channels', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('handover:createBundle', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('handover:runAgent', expect.any(Function))
  })

  it('createBundle requires prompt content', async () => {
    const res = await handlers['handover:createBundle'](null, { targetDir: 'C:\\repo' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('VALIDATION_ERROR')
  })

  it('createBundle returns needsFolder when no directory resolves', async () => {
    const res = await handlers['handover:createBundle'](null, { content: '# H' })
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ created: false, needsFolder: true })
  })

  it('createBundle persists an explicit targetDir and assembles the bundle', async () => {
    const cfg = await import('../../services/config')
    const svc = await import('../../services/handover-service')
    const res = await handlers['handover:createBundle'](null, {
      content: '# H',
      actionableId: 'a-1',
      targetDir: 'C:\\repo',
      brain: { id: 'claude-code', label: 'Claude Code' },
    })
    expect(cfg.updateConfig).toHaveBeenCalledWith('integrations', { handoffDirectory: 'C:\\repo' })
    expect(svc.assembleHandoverBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDir: 'C:\\repo',
        handoverContent: '# H',
        brain: { id: 'claude-code', label: 'Claude Code' },
        source: expect.objectContaining({ actionableId: 'a-1' }),
      })
    )
    expect(res.success).toBe(true)
    expect(res.data.created).toBe(true)
    expect(res.data.bundleDir).toContain('handover')
  })

  it('createBundle resolves the working dir from the source project folder', async () => {
    const oh = await import('../outputs-handlers')
    vi.mocked(oh.resolveProjectFolderForActionable).mockReturnValue('C:\\proj\\repo')
    const svc = await import('../../services/handover-service')
    const res = await handlers['handover:createBundle'](null, { content: '# H', actionableId: 'a-1' })
    expect(res.success).toBe(true)
    expect(svc.assembleHandoverBundle).toHaveBeenCalledWith(expect.objectContaining({ targetDir: 'C:\\proj\\repo' }))
  })

  it('runAgent errors when the bundle folder is missing', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const res = await handlers['handover:runAgent'](null, { bundleDir: 'C:\\missing', targetDir: 'C:\\repo' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })

  it('runAgent invokes the service and returns its result', async () => {
    const svc = await import('../../services/handover-service')
    const res = await handlers['handover:runAgent'](null, {
      bundleDir: 'C:\\repo\\handover\\x',
      targetDir: 'C:\\repo',
      brainId: 'codex',
    })
    expect(svc.runHandoverAgent).toHaveBeenCalledWith(
      expect.objectContaining({ bundleDir: 'C:\\repo\\handover\\x', targetDir: 'C:\\repo', brainId: 'codex' })
    )
    expect(res.success).toBe(true)
    expect(res.data.ok).toBe(true)
    expect(res.data.brainId).toBe('claude-code')
  })
})
