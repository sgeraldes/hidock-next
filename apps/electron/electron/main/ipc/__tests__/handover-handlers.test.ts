/**
 * @vitest-environment node
 *
 * Handover IPC handler tests (H9). The handover-service and outputs-handlers
 * helpers are mocked so the handlers' resolution + wiring — including the
 * opaque-bundleId contract and target validation — is asserted without touching
 * the filesystem, DB, or brains.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerHandoverHandlers } from '../handover-handlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: {
    getAppPath: vi.fn(() => 'C:\\app\\install'),
    getPath: vi.fn(() => 'C:\\app\\data'),
  },
}))

vi.mock('../../services/config', () => ({
  getConfig: vi.fn(() => ({ integrations: { handoffDirectory: '' } })),
  updateConfig: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../outputs-handlers', () => ({
  resolveProjectFolderForActionable: vi.fn(() => null),
}))

vi.mock('../../services/handover-service', () => ({
  validateTargetDir: vi.fn((dir: string) => dir),
  getRegisteredBundle: vi.fn(() => undefined),
  assembleHandoverBundle: vi.fn(() => ({
    bundleId: 'bundle-uuid-1',
    bundleDir: 'C:\\repo\\handover\\2026-07-11-090000-x',
    handoverPath: 'C:\\repo\\handover\\2026-07-11-090000-x\\HANDOVER.md',
    targetDir: 'C:\\repo',
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

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<{ success: boolean; data?: any; error?: any }>

describe('handover IPC handlers', () => {
  let handlers: Record<string, IpcHandler> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: unknown) => {
      handlers[channel] = handler as IpcHandler
      return undefined as any
    })
    const cfg = await import('../../services/config')
    vi.mocked(cfg.getConfig).mockReturnValue({ integrations: { handoffDirectory: '' } } as any)
    const oh = await import('../outputs-handlers')
    vi.mocked(oh.resolveProjectFolderForActionable).mockReturnValue(null)
    const svc = await import('../../services/handover-service')
    vi.mocked(svc.validateTargetDir).mockImplementation((dir: string) => dir)
    vi.mocked(svc.getRegisteredBundle).mockReturnValue(undefined)
    vi.mocked(svc.assembleHandoverBundle).mockReturnValue({
      bundleId: 'bundle-uuid-1',
      bundleDir: 'C:\\repo\\handover\\2026-07-11-090000-x',
      handoverPath: 'C:\\repo\\handover\\2026-07-11-090000-x\\HANDOVER.md',
      targetDir: 'C:\\repo',
      manifest: { slug: '2026-07-11-090000-x', files: ['HANDOVER.md'] },
    } as any)
    vi.mocked(svc.runHandoverAgent).mockResolvedValue({
      ok: true,
      brainId: 'claude-code',
      brainLabel: 'Claude Code',
      finalResponse: 'done',
      runLogPath: 'C:\\repo\\handover\\2026-07-11-090000-x\\RUN.log',
    } as any)
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

  it('createBundle VALIDATES an explicit targetDir, persists the canonical path, and returns the opaque bundleId', async () => {
    const cfg = await import('../../services/config')
    const svc = await import('../../services/handover-service')
    vi.mocked(svc.validateTargetDir).mockReturnValue('C:\\repo-canonical')
    const res = await handlers['handover:createBundle'](null, {
      content: '# H',
      actionableId: 'a-1',
      targetDir: 'C:\\repo',
      brain: { id: 'claude-code', label: 'Claude Code' },
    })
    expect(svc.validateTargetDir).toHaveBeenCalledWith('C:\\repo', expect.any(Array))
    expect(cfg.updateConfig).toHaveBeenCalledWith('integrations', { handoffDirectory: 'C:\\repo-canonical' })
    expect(svc.assembleHandoverBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDir: 'C:\\repo-canonical',
        handoverContent: '# H',
        brain: { id: 'claude-code', label: 'Claude Code' },
        source: expect.objectContaining({ actionableId: 'a-1' }),
        extraProtectedPaths: expect.any(Array),
      })
    )
    expect(res.success).toBe(true)
    expect(res.data.created).toBe(true)
    expect(res.data.bundleId).toBe('bundle-uuid-1')
  })

  it('createBundle rejects a protected/invalid explicit target with a VALIDATION_ERROR (nothing persisted)', async () => {
    const cfg = await import('../../services/config')
    const svc = await import('../../services/handover-service')
    vi.mocked(svc.validateTargetDir).mockImplementation(() => {
      throw new Error('The handover target is inside a protected location (C:\\Windows). Pick a project folder.')
    })
    const res = await handlers['handover:createBundle'](null, { content: '# H', targetDir: 'C:\\Windows\\System32' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('VALIDATION_ERROR')
    expect(res.error.message).toMatch(/protected location/i)
    expect(cfg.updateConfig).not.toHaveBeenCalled()
    expect(svc.assembleHandoverBundle).not.toHaveBeenCalled()
  })

  it('createBundle resolves the working dir from the source project folder (validated)', async () => {
    const oh = await import('../outputs-handlers')
    vi.mocked(oh.resolveProjectFolderForActionable).mockReturnValue('C:\\proj\\repo')
    const svc = await import('../../services/handover-service')
    const res = await handlers['handover:createBundle'](null, { content: '# H', actionableId: 'a-1' })
    expect(res.success).toBe(true)
    expect(svc.validateTargetDir).toHaveBeenCalledWith('C:\\proj\\repo', expect.any(Array))
    expect(svc.assembleHandoverBundle).toHaveBeenCalledWith(expect.objectContaining({ targetDir: 'C:\\proj\\repo' }))
  })

  it('createBundle falls back to needsFolder when the configured handoffDirectory fails validation', async () => {
    const cfg = await import('../../services/config')
    vi.mocked(cfg.getConfig).mockReturnValue({ integrations: { handoffDirectory: 'C:\\stale' } } as any)
    const svc = await import('../../services/handover-service')
    vi.mocked(svc.validateTargetDir).mockImplementation(() => {
      throw new Error('The handover folder does not exist: C:\\stale')
    })
    const res = await handlers['handover:createBundle'](null, { content: '# H' })
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ created: false, needsFolder: true })
  })

  it('runAgent rejects a forged/unknown bundleId (opaque-id contract)', async () => {
    const res = await handlers['handover:runAgent'](null, { bundleId: 'not-a-real-id' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
    const svc = await import('../../services/handover-service')
    expect(svc.runHandoverAgent).not.toHaveBeenCalled()
  })

  it('runAgent rejects renderer-supplied paths — only bundleId is accepted', async () => {
    // Old-shape payload with paths but no (known) bundleId must be refused.
    const res = await handlers['handover:runAgent'](null, {
      bundleDir: 'C:\\anywhere',
      targetDir: 'C:\\anywhere',
    })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })

  it('runAgent invokes the service with the registered bundleId only', async () => {
    const svc = await import('../../services/handover-service')
    vi.mocked(svc.getRegisteredBundle).mockReturnValue({
      bundleDir: 'C:\\repo\\handover\\x',
      targetDir: 'C:\\repo',
      createdAt: '2026-07-11T09:00:00Z',
    } as any)
    const res = await handlers['handover:runAgent'](null, { bundleId: 'bundle-uuid-1', brainId: 'codex' })
    expect(svc.runHandoverAgent).toHaveBeenCalledWith({ bundleId: 'bundle-uuid-1', brainId: 'codex' })
    expect(res.success).toBe(true)
    expect(res.data.ok).toBe(true)
    expect(res.data.brainId).toBe('claude-code')
  })
})
