import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerBrainsHandlers } from '../brains-handlers'
import { getConfig, updateConfig } from '../../services/config'
import { getBrainRegistry } from '../../services/brains/brain-registry'
import { getBrainCredentialStore } from '../../services/brains/brain-credential-store'
import type { AIBrain, BrainAuthStatus, BrainCapability } from '../../services/brains/types'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../../services/config', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}))

vi.mock('../../services/brains/brain-registry', () => ({
  getBrainRegistry: vi.fn(),
}))

vi.mock('../../services/brains/brain-credential-store', () => ({
  getBrainCredentialStore: vi.fn(),
}))

/** Minimal fake brain: only the surface brains:list reads. */
function fakeBrain(
  id: AIBrain['id'],
  label: string,
  caps: BrainCapability[],
  auth: BrainAuthStatus | (() => Promise<BrainAuthStatus>)
): AIBrain {
  return {
    id,
    label,
    capabilities: () => new Set(caps),
    authStatus: typeof auth === 'function' ? auth : () => Promise.resolve(auth),
    generate: async () => null,
    chat: async () => null,
  }
}

const BRAINS = [
  fakeBrain('gemini-api', 'Gemini (API key)', ['generate', 'chat', 'embed', 'analyzeAudio'], {
    configured: true,
    method: 'api-key',
    detail: 'Key set',
  }),
  fakeBrain('claude-code', 'Claude Code SDK', ['generate', 'chat', 'agentic'], {
    configured: false,
    method: 'cli-login',
    detail: 'Needs login',
  }),
]

const CONFIG_BRAINS = {
  enabled: { 'gemini-api': true, ollama: true, 'claude-code': false, codex: false, 'gemini-cli': false },
  defaultBrain: 'gemini-api',
  taskRouting: {},
  models: {},
}

type IpcHandler = (event?: any, ...args: any[]) => any

describe('Brains IPC Handlers', () => {
  let handlers: Record<string, IpcHandler> = {}
  const setSecret = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation(((channel: string, handler: IpcHandler) => {
      handlers[channel] = handler
      return undefined as any
    }) as any)
    vi.mocked(getConfig).mockReturnValue({ brains: CONFIG_BRAINS } as any)
    vi.mocked(updateConfig).mockResolvedValue(undefined)
    vi.mocked(getBrainRegistry).mockReturnValue({ list: () => BRAINS } as any)
    vi.mocked(getBrainCredentialStore).mockReturnValue({ setSecret } as any)
    registerBrainsHandlers()
  })

  it('registers all five brains:* channels', () => {
    for (const ch of ['brains:list', 'brains:setEnabled', 'brains:setDefault', 'brains:setTaskRouting', 'brains:setCredential']) {
      expect(ipcMain.handle).toHaveBeenCalledWith(ch, expect.any(Function))
    }
  })

  it('brains:list projects registry + config + auth into serialisable items', async () => {
    const res = await handlers['brains:list']()
    expect(res).toHaveLength(2)
    expect(res[0]).toEqual({
      id: 'gemini-api',
      label: 'Gemini (API key)',
      capabilities: ['generate', 'chat', 'embed', 'analyzeAudio'],
      enabled: true,
      isDefault: true,
      auth: { configured: true, method: 'api-key', detail: 'Key set' },
    })
    expect(res[1]).toMatchObject({ id: 'claude-code', enabled: false, isDefault: false })
    expect(res[1].auth).toEqual({ configured: false, method: 'cli-login', detail: 'Needs login' })
  })

  it('brains:list survives a brain whose authStatus throws', async () => {
    vi.mocked(getBrainRegistry).mockReturnValue({
      list: () => [
        BRAINS[0],
        fakeBrain('codex', 'Codex', ['generate', 'agentic'], () => Promise.reject(new Error('boom'))),
      ],
    } as any)
    registerBrainsHandlers()
    const res = await handlers['brains:list']({} as any)
    expect(res).toHaveLength(2)
    expect(res[1].id).toBe('codex')
    expect(res[1].auth.configured).toBe(false)
  })

  it('brains:setEnabled persists a merged enabled map', async () => {
    const res = await handlers['brains:setEnabled']({}, { id: 'claude-code', enabled: true })
    expect(res).toEqual({ success: true })
    expect(updateConfig).toHaveBeenCalledWith('brains', {
      enabled: { ...CONFIG_BRAINS.enabled, 'claude-code': true },
    })
  })

  it('brains:setDefault persists the new default brain', async () => {
    await handlers['brains:setDefault']({}, { id: 'ollama' })
    expect(updateConfig).toHaveBeenCalledWith('brains', { defaultBrain: 'ollama' })
  })

  it('brains:setTaskRouting sets and clears a per-task override', async () => {
    await handlers['brains:setTaskRouting']({}, { task: 'chat', id: 'ollama' })
    expect(updateConfig).toHaveBeenCalledWith('brains', { taskRouting: { chat: 'ollama' } })

    vi.mocked(getConfig).mockReturnValue({
      brains: { ...CONFIG_BRAINS, taskRouting: { chat: 'ollama' } },
    } as any)
    await handlers['brains:setTaskRouting']({}, { task: 'chat', id: null })
    expect(updateConfig).toHaveBeenLastCalledWith('brains', { taskRouting: {} })
  })

  it('brains:setCredential writes to the credential store', async () => {
    const res = await handlers['brains:setCredential']({}, { id: 'codex', field: 'OPENAI_API_KEY', value: 'sk-x' })
    expect(res).toEqual({ success: true })
    expect(setSecret).toHaveBeenCalledWith('codex', 'OPENAI_API_KEY', 'sk-x')
  })
})
