import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerArtifactHandlers } from '../artifact-handlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(() => null), getAllWindows: vi.fn(() => []) }
}))

vi.mock('../../services/artifact-service', () => ({
  importArtifact: vi.fn(),
  getArtifactsForCapture: vi.fn(),
  getArtifactById: vi.fn()
}))

describe('Artifact IPC Handlers', () => {
  let handlers: Record<string, Function> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
      handlers[channel] = handler
      return undefined as never
    })
    registerArtifactHandlers()
  })

  it('registers all expected channels', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:import', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:pickAndImport', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:getForCapture', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:openInFolder', expect.any(Function))
  })

  it('artifacts:getForCapture returns a success Result of slim summaries', async () => {
    const { getArtifactsForCapture } = await import('../../services/artifact-service')
    vi.mocked(getArtifactsForCapture).mockReturnValue([
      {
        id: 'art-1',
        knowledge_capture_id: 'cap-1',
        kind: 'md',
        mime: 'text/markdown',
        storage_path: '/data/artifacts/md/ab/art-1.md',
        size: 42,
        content_hash: 'abc',
        extracted_text: 'hello',
        metadata: '{"jsonValid":true}',
        source_connector_id: null,
        source_ref: null,
        created_at: '2026-07-08T00:00:00Z'
      }
    ])

    const result = await handlers['artifacts:getForCapture']({}, 'cap-1')

    expect(getArtifactsForCapture).toHaveBeenCalledWith('cap-1')
    expect(result.success).toBe(true)
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ id: 'art-1', kind: 'md', hasText: true })
    // The full extracted_text blob is not leaked to the renderer.
    expect(result.data[0]).not.toHaveProperty('extracted_text')
  })

  it('artifacts:getForCapture rejects an invalid capture id', async () => {
    const result = await handlers['artifacts:getForCapture']({}, '')
    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('artifacts:openInFolder reveals the stored file', async () => {
    const { getArtifactById } = await import('../../services/artifact-service')
    const { shell } = await import('electron')
    vi.mocked(getArtifactById).mockReturnValue({
      id: 'art-1',
      knowledge_capture_id: 'cap-1',
      kind: 'pdf',
      mime: 'application/pdf',
      storage_path: '/data/artifacts/pdf/ab/art-1.pdf',
      size: 10,
      content_hash: 'h',
      extracted_text: null,
      metadata: null,
      source_connector_id: null,
      source_ref: null,
      created_at: '2026-07-08T00:00:00Z'
    })

    const result = await handlers['artifacts:openInFolder']({}, 'art-1')
    expect(result.success).toBe(true)
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/data/artifacts/pdf/ab/art-1.pdf')
  })
})
