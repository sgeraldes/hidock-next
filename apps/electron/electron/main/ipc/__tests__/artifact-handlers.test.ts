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
  getArtifactById: vi.fn(),
  listArtifactTypes: vi.fn(() => [
    { kind: 'image', exts: ['png', 'jpg'], presentation: { label: 'Image', pluralLabel: 'Images', capabilities: ['rateable', 'previewable'] } },
    { kind: 'pdf', exts: ['pdf'], presentation: { label: 'PDF', pluralLabel: 'PDFs', capabilities: ['rateable', 'previewable'] } }
  ])
}))

vi.mock('fs', async () => {
  const readFileSync = vi.fn()
  const statSync = vi.fn()
  return {
    readFileSync,
    statSync,
    default: { readFileSync, statSync }
  }
})

// ADV17-3 — gate getForCapture / openInFolder on the shared capture allowlist.
vi.mock('../../services/recording-eligibility', () => ({
  isCaptureEligible: vi.fn(() => true)
}))

describe('Artifact IPC Handlers', () => {
  let handlers: Record<string, (...args: any[]) => any> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
      handlers[channel] = handler
      return undefined as never
    })
    registerArtifactHandlers()
  })

  it('registers all expected channels', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:listTypes', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:import', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:pickAndImport', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:getForCapture', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:getContent', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('artifacts:openInFolder', expect.any(Function))
  })

  it('artifacts:listTypes exposes renderer-safe built-in and registered descriptors', async () => {
    const result = await handlers['artifacts:listTypes']()

    expect(result.success).toBe(true)
    expect(result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'audio', pluralLabel: 'Audio', capabilities: expect.arrayContaining(['timed', 'transcribable']) }),
      expect.objectContaining({ id: 'image', pluralLabel: 'Images', extensions: expect.arrayContaining(['png']) }),
      expect.objectContaining({ id: 'pdf', pluralLabel: 'PDFs', extensions: ['pdf'] })
    ]))
    expect(result.data.every((item: any) => typeof item.extractText === 'undefined')).toBe(true)
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

  // ─── ADV17-3 (round-18) capture-eligibility gate ───────────────────────────
  it('artifacts:getForCapture returns empty for an ineligible capture without querying', async () => {
    const { isCaptureEligible } = await import('../../services/recording-eligibility')
    const { getArtifactsForCapture } = await import('../../services/artifact-service')
    vi.mocked(isCaptureEligible).mockReturnValueOnce(false)

    const result = await handlers['artifacts:getForCapture']({}, 'cap-excluded')

    expect(result.success).toBe(true)
    expect(result.data).toEqual([])
    // Fail-closed: never even reads the capture's artifacts.
    expect(getArtifactsForCapture).not.toHaveBeenCalled()
  })

  it('artifacts:openInFolder refuses to reveal an ineligible capture\'s artifact', async () => {
    const { isCaptureEligible } = await import('../../services/recording-eligibility')
    const { getArtifactById } = await import('../../services/artifact-service')
    const { shell } = await import('electron')
    vi.mocked(getArtifactById).mockReturnValue({
      id: 'art-1',
      knowledge_capture_id: 'cap-excluded',
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
    vi.mocked(isCaptureEligible).mockReturnValueOnce(false)

    const result = await handlers['artifacts:openInFolder']({}, 'art-1')

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('NOT_FOUND')
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })

  // ─── artifacts:getContent ─────────────────────────────────────────────────
  it('returns extracted text for text-like kinds without a blob', async () => {
    const { getArtifactById } = await import('../../services/artifact-service')
    vi.mocked(getArtifactById).mockReturnValue({
      id: 'art-md',
      knowledge_capture_id: 'cap-1',
      kind: 'md',
      mime: 'text/markdown',
      storage_path: '/data/artifacts/md/ab/art-md.md',
      size: 42,
      content_hash: 'h',
      extracted_text: '# Hello',
      metadata: null,
      source_connector_id: null,
      source_ref: null,
      created_at: '2026-07-08T00:00:00Z'
    })

    const result = await handlers['artifacts:getContent']({}, { id: 'art-md' })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      kind: 'md',
      mime: 'text/markdown',
      storagePath: '/data/artifacts/md/ab/art-md.md',
      textContent: '# Hello'
    })
    expect(result.data).not.toHaveProperty('blobBase64')
  })

  it('returns base64 blob for image kinds', async () => {
    const { getArtifactById } = await import('../../services/artifact-service')
    const { readFileSync, statSync } = await import('fs')
    vi.mocked(getArtifactById).mockReturnValue({
      id: 'art-img',
      knowledge_capture_id: 'cap-1',
      kind: 'image',
      mime: 'image/png',
      storage_path: '/data/artifacts/img/ab/art-img.png',
      size: 12,
      content_hash: 'h',
      extracted_text: null,
      metadata: null,
      source_connector_id: null,
      source_ref: null,
      created_at: '2026-07-08T00:00:00Z'
    })
    vi.mocked(statSync).mockReturnValue({ size: 12 } as any)
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('hello-image'))

    const result = await handlers['artifacts:getContent']({}, { id: 'art-img' })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      kind: 'image',
      mime: 'image/png',
      storagePath: '/data/artifacts/img/ab/art-img.png',
      textContent: null,
      blobBase64: Buffer.from('hello-image').toString('base64')
    })
    expect(readFileSync).toHaveBeenCalledWith('/data/artifacts/img/ab/art-img.png')
  })

  it('returns both text and blob for pdf kinds', async () => {
    const { getArtifactById } = await import('../../services/artifact-service')
    const { readFileSync, statSync } = await import('fs')
    vi.mocked(getArtifactById).mockReturnValue({
      id: 'art-pdf',
      knowledge_capture_id: 'cap-1',
      kind: 'pdf',
      mime: 'application/pdf',
      storage_path: '/data/artifacts/pdf/ab/art-pdf.pdf',
      size: 100,
      content_hash: 'h',
      extracted_text: 'PDF text',
      metadata: null,
      source_connector_id: null,
      source_ref: null,
      created_at: '2026-07-08T00:00:00Z'
    })
    vi.mocked(statSync).mockReturnValue({ size: 100 } as any)
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('pdf-bytes'))

    const result = await handlers['artifacts:getContent']({}, { id: 'art-pdf' })

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({
      kind: 'pdf',
      textContent: 'PDF text',
      blobBase64: Buffer.from('pdf-bytes').toString('base64')
    })
  })

  it('rejects files larger than 25 MB', async () => {
    const { getArtifactById } = await import('../../services/artifact-service')
    const { readFileSync, statSync } = await import('fs')
    vi.mocked(getArtifactById).mockReturnValue({
      id: 'art-big',
      knowledge_capture_id: 'cap-1',
      kind: 'pdf',
      mime: 'application/pdf',
      storage_path: '/data/artifacts/pdf/ab/art-big.pdf',
      size: 26 * 1024 * 1024,
      content_hash: 'h',
      extracted_text: 'too big',
      metadata: null,
      source_connector_id: null,
      source_ref: null,
      created_at: '2026-07-08T00:00:00Z'
    })
    vi.mocked(statSync).mockReturnValue({ size: 26 * 1024 * 1024 } as any)

    const result = await handlers['artifacts:getContent']({}, { id: 'art-big' })

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(readFileSync).not.toHaveBeenCalled()
  })

  it('artifacts:getContent returns NOT_FOUND for an unknown id', async () => {
    const { getArtifactById } = await import('../../services/artifact-service')
    vi.mocked(getArtifactById).mockReturnValue(undefined)

    const result = await handlers['artifacts:getContent']({}, { id: 'art-missing' })

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('artifacts:getContent returns NOT_FOUND for an ineligible capture', async () => {
    const { isCaptureEligible } = await import('../../services/recording-eligibility')
    const { getArtifactById } = await import('../../services/artifact-service')
    const { readFileSync } = await import('fs')
    vi.mocked(getArtifactById).mockReturnValue({
      id: 'art-excluded',
      knowledge_capture_id: 'cap-excluded',
      kind: 'md',
      mime: 'text/markdown',
      storage_path: '/data/artifacts/md/ab/art-excluded.md',
      size: 10,
      content_hash: 'h',
      extracted_text: 'hidden',
      metadata: null,
      source_connector_id: null,
      source_ref: null,
      created_at: '2026-07-08T00:00:00Z'
    })
    vi.mocked(isCaptureEligible).mockReturnValueOnce(false)

    const result = await handlers['artifacts:getContent']({}, { id: 'art-excluded' })

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('NOT_FOUND')
    expect(readFileSync).not.toHaveBeenCalled()
  })
})
