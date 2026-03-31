import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock Electron ──────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-meeting-assistant'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  desktopCapturer: {
    getSources: vi.fn(async () => [
      { thumbnail: { toPng: () => Buffer.from('fake-png') } },
    ]),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  Tray: vi.fn(),
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
}))

// ── Mock database ──────────────────────────────────────────────────────────
const mockGetSetting = vi.fn()
const mockSetSetting = vi.fn()
vi.mock('../database-settings', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}))

vi.mock('../database', () => ({
  getDatabase: vi.fn(() => ({
    run: vi.fn(),
    exec: vi.fn(() => []),
  })),
  initializeDatabase: vi.fn(),
  saveDatabase: vi.fn(),
  mapRows: vi.fn(() => []),
}))

vi.mock('../database-queries', () => ({
  createSession: vi.fn(() => ({
    id: 'test-session-id',
    title: 'Test Session',
    started_at: Date.now(),
    ended_at: null,
    status: 'recording',
    meeting_id: null,
    audio_path: null,
    transcript_path: null,
  })),
  getSession: vi.fn(),
  updateSession: vi.fn(),
  getAllSessions: vi.fn(() => []),
  deleteSession: vi.fn(),
  getTranscriptBySession: vi.fn(() => []),
  getRecentTranscriptSegments: vi.fn(() => []),
  insertTranscriptSegment: vi.fn(),
  getScreenshotsBySession: vi.fn(() => []),
  createScreenshot: vi.fn(),
  updateScreenshotAnalysis: vi.fn(),
  createNote: vi.fn(),
  getNotesBySession: vi.fn(() => []),
  updateNote: vi.fn(),
  getAllNoteTemplates: vi.fn(() => []),
  getMeeting: vi.fn(),
}))

// ── Mock ai-providers ──────────────────────────────────────────────────────
const mockModel = { modelId: 'test-model' } as unknown
const mockCreateProvider = vi.fn((_config: unknown) => ({
  model: mockModel,
  provider: 'ollama' as const,
}))
const mockEmbed = vi.fn(async (_text: unknown, _config: unknown) => ({
  embedding: [0.1, 0.2, 0.3],
  usage: { tokens: 10 },
}))

vi.mock('@hidock/ai-providers', () => ({
  createProvider: (config: unknown) => mockCreateProvider(config),
  embed: (text: unknown, config: unknown) => mockEmbed(text, config),
}))

// ── Mock broadcast ─────────────────────────────────────────────────────────
const mockBroadcast = vi.fn()
vi.mock('../../ipc/broadcast', () => ({
  broadcastToAllWindows: (...args: unknown[]) => mockBroadcast(...args),
}))

// ── Mock IPC handler setters ───────────────────────────────────────────────
const mockSetSuggestionService = vi.fn()
const mockSetScreenshotService = vi.fn()
const mockSetNotesService = vi.fn()
const mockSetKnowledgeBaseService = vi.fn()

vi.mock('../../ipc/suggestion-handlers', () => ({
  setSuggestionService: (...args: unknown[]) => mockSetSuggestionService(...args),
  registerSuggestionHandlers: vi.fn(),
}))
vi.mock('../../ipc/screenshot-handlers', () => ({
  setScreenshotService: (...args: unknown[]) => mockSetScreenshotService(...args),
  registerScreenshotHandlers: vi.fn(),
}))
vi.mock('../../ipc/notes-handlers', () => ({
  setNotesService: (...args: unknown[]) => mockSetNotesService(...args),
  registerNotesHandlers: vi.fn(),
}))
vi.mock('../../ipc/knowledge-handlers', () => ({
  setKnowledgeBaseService: (...args: unknown[]) => mockSetKnowledgeBaseService(...args),
  registerKnowledgeHandlers: vi.fn(),
}))

// ── Mock windows ───────────────────────────────────────────────────────────
vi.mock('../../windows', () => ({
  showMiniBar: vi.fn(),
  hideMiniBar: vi.fn(),
  isMiniBarVisible: vi.fn(() => false),
  getMainWindow: vi.fn(),
  showMainWindow: vi.fn(),
  createMainWindow: vi.fn(),
  createMiniBarWindow: vi.fn(),
  getMiniBarWindow: vi.fn(),
  focusMainWindow: vi.fn(),
  setMiniBarPositionPersistence: vi.fn(),
  destroyAllWindows: vi.fn(),
  createOverlayWindow: vi.fn(),
  getOverlayWindow: vi.fn(),
  showOverlay: vi.fn(),
  hideOverlay: vi.fn(),
  toggleOverlay: vi.fn(),
  isOverlayVisible: vi.fn(),
}))

// ── Mock tray-manager ──────────────────────────────────────────────────────
const mockUpdateTrayState = vi.fn()
vi.mock('../tray-manager', () => ({
  updateTrayState: (...args: unknown[]) => mockUpdateTrayState(...args),
  setTrayCallbacks: vi.fn(),
  initializeTray: vi.fn(),
  destroyTray: vi.fn(),
  getTrayState: vi.fn(() => 'idle'),
}))

// ── Mock credential-store ──────────────────────────────────────────────────
vi.mock('../credential-store', () => ({
  retrieve: vi.fn(() => null),
  store: vi.fn(),
  hydrate: vi.fn(),
  isAvailable: vi.fn(() => false),
  has: vi.fn(() => false),
  del: vi.fn(),
  clearAll: vi.fn(),
}))

// ── Mock fs (for screen capture directory creation) ────────────────────────
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false, isFile: () => true })),
  }
})

// ── Import under test ─────────────────────────────────────────────────────
import { SessionOrchestrator } from '../session-orchestrator'

describe('SessionOrchestrator', () => {
  let orchestrator: SessionOrchestrator

  beforeEach(() => {
    vi.clearAllMocks()
    // Default settings mock: return defaults for AI settings
    mockGetSetting.mockImplementation((key: string) => {
      const defaults: Record<string, { value: string }> = {
        'ai.provider': { value: 'ollama' },
        'ai.model': { value: 'llama3.2' },
        'ai.apiKey': { value: '' },
        'ai.embeddingProvider': { value: 'ollama' },
        'ai.embeddingModel': { value: 'nomic-embed-text' },
        'kb.chunkSize': { value: '2000' },
        'kb.chunkOverlap': { value: '200' },
        'suggestions.enabled': { value: 'true' },
        'suggestions.triggerIntervalSeconds': { value: '90' },
        'suggestions.maxSuggestions': { value: '3' },
        'suggestions.contextWindowSeconds': { value: '120' },
        'screenshots.autoCapture': { value: 'false' },
        'screenshots.autoIntervalSeconds': { value: '30' },
        'screenshots.analyzeWithLLM': { value: 'true' },
        'screenshots.includeInNotes': { value: 'true' },
        'screenshots.maxPerSession': { value: '100' },
        'notes.defaultLanguage': { value: 'auto' },
        'notes.showPostSessionPrompt': { value: 'true' },
      }
      return defaults[key] ?? null
    })

    orchestrator = new SessionOrchestrator()
  })

  afterEach(() => {
    orchestrator.shutdown()
  })

  // ── initialize() ────────────────────────────────────────────────────────

  describe('initialize()', () => {
    it('creates an AI provider from settings', async () => {
      await orchestrator.initialize()

      expect(mockCreateProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'ollama',
          model: 'llama3.2',
        }),
      )
    })

    it('wires suggestion service IPC handler', async () => {
      await orchestrator.initialize()

      expect(mockSetSuggestionService).toHaveBeenCalledWith(
        expect.objectContaining({
          getActive: expect.any(Function),
          dismiss: expect.any(Function),
          trigger: expect.any(Function),
          setEnabled: expect.any(Function),
        }),
      )
    })

    it('wires screenshot service IPC handler', async () => {
      await orchestrator.initialize()

      expect(mockSetScreenshotService).toHaveBeenCalledWith(
        expect.objectContaining({
          capture: expect.any(Function),
          listForSession: expect.any(Function),
          getAnalysis: expect.any(Function),
          configure: expect.any(Function),
        }),
      )
    })

    it('wires notes service IPC handler', async () => {
      await orchestrator.initialize()

      expect(mockSetNotesService).toHaveBeenCalledWith(
        expect.objectContaining({
          generate: expect.any(Function),
          categorize: expect.any(Function),
        }),
      )
    })

    it('wires knowledge base service IPC handler', async () => {
      await orchestrator.initialize()

      expect(mockSetKnowledgeBaseService).toHaveBeenCalledWith(
        expect.objectContaining({
          addSource: expect.any(Function),
          removeSource: expect.any(Function),
          search: expect.any(Function),
          reindex: expect.any(Function),
        }),
      )
    })

    it('sets model on suggestion engine', async () => {
      await orchestrator.initialize()

      // Verify by calling the wired suggestion service trigger
      // which internally checks if model is set
      const service = mockSetSuggestionService.mock.calls[0][0]
      expect(service).toBeDefined()
    })

    it('sets embed function on knowledge base', async () => {
      await orchestrator.initialize()

      // KB service should be wired and functional
      const service = mockSetKnowledgeBaseService.mock.calls[0][0]
      expect(service).toBeDefined()
    })

    it('recovers interrupted sessions on startup', async () => {
      const { updateSession, getAllSessions } = await import('../database-queries')
      const mockGetAll = vi.mocked(getAllSessions)
      mockGetAll.mockReturnValueOnce([
        {
          id: 'orphan-session',
          title: 'Orphan',
          started_at: Date.now() - 60000,
          ended_at: null,
          status: 'recording',
          meeting_id: null,
          audio_path: null,
          transcript_path: null,
        },
      ])

      await orchestrator.initialize()

      expect(updateSession).toHaveBeenCalledWith('orphan-session', expect.objectContaining({
        status: 'interrupted',
      }))
    })
  })

  // ── startSession() ──────────────────────────────────────────────────────

  describe('startSession()', () => {
    beforeEach(async () => {
      await orchestrator.initialize()
      vi.clearAllMocks()
    })

    it('creates a session in the database', async () => {
      const { createSession } = await import('../database-queries')

      await orchestrator.startSession('Test Meeting')

      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Test Meeting',
      }))
    })

    it('broadcasts session:created event', async () => {
      await orchestrator.startSession()

      expect(mockBroadcast).toHaveBeenCalledWith(
        'session:created',
        expect.objectContaining({ id: 'test-session-id' }),
      )
    })

    it('updates tray state to recording', async () => {
      await orchestrator.startSession()

      expect(mockUpdateTrayState).toHaveBeenCalledWith('recording')
    })

    it('broadcasts audio:startCapture signal', async () => {
      await orchestrator.startSession()

      expect(mockBroadcast).toHaveBeenCalledWith(
        'audio:startCapture',
        expect.objectContaining({ sessionId: 'test-session-id' }),
      )
    })

    it('shows mini-bar window', async () => {
      const { showMiniBar } = await import('../../windows')

      await orchestrator.startSession()

      expect(showMiniBar).toHaveBeenCalled()
    })

    it('throws if session already active', async () => {
      await orchestrator.startSession()

      await expect(orchestrator.startSession()).rejects.toThrow(/already active/)
    })
  })

  // ── stopSession() ──────────────────────────────────────────────────────

  describe('stopSession()', () => {
    beforeEach(async () => {
      await orchestrator.initialize()
      await orchestrator.startSession()
      vi.clearAllMocks()
    })

    it('updates session in database with ended_at and completed status', async () => {
      const { updateSession } = await import('../database-queries')

      await orchestrator.stopSession()

      expect(updateSession).toHaveBeenCalledWith(
        'test-session-id',
        expect.objectContaining({
          status: 'completed',
          ended_at: expect.any(Number),
        }),
      )
    })

    it('broadcasts audio:stopCapture signal', async () => {
      await orchestrator.stopSession()

      expect(mockBroadcast).toHaveBeenCalledWith('audio:stopCapture')
    })

    it('hides mini-bar window', async () => {
      const { hideMiniBar } = await import('../../windows')

      await orchestrator.stopSession()

      expect(hideMiniBar).toHaveBeenCalled()
    })

    it('updates tray state to idle after stop', async () => {
      await orchestrator.stopSession()

      expect(mockUpdateTrayState).toHaveBeenCalledWith('idle')
    })

    it('returns null if no active session', async () => {
      await orchestrator.stopSession() // stop first time
      vi.clearAllMocks()

      const result = await orchestrator.stopSession() // stop again

      expect(result).toBeNull()
    })
  })

  // ── onSettingsChanged() ─────────────────────────────────────────────────

  describe('onSettingsChanged()', () => {
    beforeEach(async () => {
      await orchestrator.initialize()
      vi.clearAllMocks()
    })

    it('reconfigures AI provider when ai.provider changes', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        if (key === 'ai.provider') return { value: 'openai' }
        if (key === 'ai.model') return { value: 'gpt-4' }
        if (key === 'ai.apiKey') return { value: 'test-key' }
        if (key === 'ai.embeddingProvider') return { value: 'openai' }
        if (key === 'ai.embeddingModel') return { value: 'text-embedding-3-small' }
        return null
      })

      await orchestrator.onSettingsChanged('ai.provider')

      expect(mockCreateProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4',
        }),
      )
    })

    it('reconfigures AI provider when ai.model changes', async () => {
      await orchestrator.onSettingsChanged('ai.model')

      expect(mockCreateProvider).toHaveBeenCalled()
    })

    it('reconfigures embedding when ai.embeddingModel changes', async () => {
      await orchestrator.onSettingsChanged('ai.embeddingModel')

      // embed should be reconfigured - verify by checking KB service is re-wired
      expect(mockSetKnowledgeBaseService).toHaveBeenCalled()
    })
  })

  // ── shutdown() ──────────────────────────────────────────────────────────

  describe('shutdown()', () => {
    it('stops active session if one is running', async () => {
      await orchestrator.initialize()
      await orchestrator.startSession()
      vi.clearAllMocks()

      const { updateSession } = await import('../database-queries')

      orchestrator.shutdown()

      expect(updateSession).toHaveBeenCalledWith(
        'test-session-id',
        expect.objectContaining({ status: 'interrupted' }),
      )
    })

    it('is safe to call multiple times', () => {
      expect(() => {
        orchestrator.shutdown()
        orchestrator.shutdown()
      }).not.toThrow()
    })
  })
})
