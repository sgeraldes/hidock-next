import { app, desktopCapturer } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createProvider, embed } from '@hidock/ai-providers'
import type { LanguageModel } from 'ai'
import type { AIProviderKey, EmbeddingProviderConfig } from '@hidock/ai-providers'
import { settingsStore } from './settings-store'
import * as credentialStore from './credential-store'
import {
  createSession,
  updateSession,
  getAllSessions,
  getRecentTranscriptSegments,
  getScreenshotsBySession,
} from './database-queries'
import { saveDatabase } from './database'
import { SuggestionEngine } from './suggestion-engine'
import { ScreenCaptureService } from './screen-capture'
import { NotesGenerator } from './notes-generator'
import { KnowledgeBase } from './knowledge-base'
import { MeetingDetector } from './meeting-detector'
import { MicMonitor } from './mic-monitor'
import { setSuggestionService } from '../ipc/suggestion-handlers'
import { setScreenshotService } from '../ipc/screenshot-handlers'
import { setNotesService } from '../ipc/notes-handlers'
import { setKnowledgeBaseService } from '../ipc/knowledge-handlers'
import { broadcastToAllWindows } from '../ipc/broadcast'
import { showMiniBar, hideMiniBar } from '../windows'
import { updateTrayState } from './tray-manager'

export class SessionOrchestrator {
  private currentModel: LanguageModel | null = null
  /** Current AI provider key, used for diagnostics */
  get provider(): AIProviderKey | null { return this._provider }
  private _provider: AIProviderKey | null = null

  private suggestionEngine: SuggestionEngine | null = null
  private screenCapture: ScreenCaptureService | null = null
  private notesGenerator: NotesGenerator | null = null
  private knowledgeBase: KnowledgeBase | null = null
  private meetingDetector: MeetingDetector | null = null
  private micMonitor: MicMonitor | null = null

  private activeSessionId: string | null = null
  private activeSessionDir: string | null = null
  /** Timestamp when the current session started, used by audio pipeline (Phase 7B) */
  private _sessionStartTime: number = 0
  get sessionStartTime(): number { return this._sessionStartTime }
  private isShutdown = false

  async initialize(): Promise<void> {
    // 1. Recover interrupted sessions
    this.recoverInterruptedSessions()

    // 2. Configure AI provider
    this.configureAIProvider()

    // 3. Configure embedding
    const embedFn = this.createEmbedFunction()

    // 4. Instantiate services
    this.knowledgeBase = new KnowledgeBase({
      chunkSize: settingsStore.get('kb.chunkSize'),
      chunkOverlap: settingsStore.get('kb.chunkOverlap'),
    })
    if (embedFn) {
      this.knowledgeBase.setEmbedFunction(embedFn)
    }

    this.suggestionEngine = new SuggestionEngine({
      triggerIntervalMs: settingsStore.get('suggestions.triggerIntervalSeconds') * 1000,
      maxSuggestions: settingsStore.get('suggestions.maxSuggestions'),
      contextWindowSeconds: settingsStore.get('suggestions.contextWindowSeconds'),
    })
    if (this.currentModel) {
      this.suggestionEngine.setModel(this.currentModel)
    }
    this.suggestionEngine.setKnowledgeSearch(
      (query, topK) => this.knowledgeBase!.search(query, topK).then(
        results => results.map(r => ({ text: r.text, score: r.score })),
      ),
    )
    this.suggestionEngine.setDataAccessors({
      getRecentTranscript: (sessionId, limit) =>
        getRecentTranscriptSegments(sessionId, limit),
      getScreenshots: (sessionId) =>
        getScreenshotsBySession(sessionId),
      getMeetingInfo: () => null,
    })

    this.screenCapture = new ScreenCaptureService({
      autoIntervalSeconds: settingsStore.get('screenshots.autoIntervalSeconds'),
      maxPerSession: settingsStore.get('screenshots.maxPerSession'),
      analyzeWithLLM: settingsStore.get('screenshots.analyzeWithLLM'),
      includeInNotes: settingsStore.get('screenshots.includeInNotes'),
    })
    if (this.currentModel) {
      this.screenCapture.setModel(this.currentModel)
    }
    this.screenCapture.setCaptureFunction(async () => {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      })
      if (sources.length === 0) return null
      return sources[0].thumbnail.toPNG()
    })

    this.notesGenerator = new NotesGenerator({
      defaultLanguage: settingsStore.get('notes.defaultLanguage'),
    })
    if (this.currentModel) {
      this.notesGenerator.setModel(this.currentModel)
    }

    // 5. Wire IPC handler services
    this.wireIpcHandlers()

    console.log('[SessionOrchestrator] Initialized')
  }

  async startSession(title?: string): Promise<void> {
    if (this.activeSessionId) {
      throw new Error('A session is already active')
    }

    const session = createSession({ title })
    this.activeSessionId = session.id
    this._sessionStartTime = Date.now()

    // Create session directory for screenshots and audio
    const sessionDir = join(app.getPath('userData'), 'sessions', session.id)
    mkdirSync(sessionDir, { recursive: true })
    this.activeSessionDir = sessionDir

    // Signal renderer to start audio capture
    broadcastToAllWindows('audio:startCapture', { sessionId: session.id })

    // Start suggestion engine
    if (this.suggestionEngine && settingsStore.get('suggestions.enabled')) {
      this.suggestionEngine.start(session.id)
    }

    // Start auto-capture screenshots if enabled
    if (this.screenCapture && settingsStore.get('screenshots.autoCapture')) {
      this.screenCapture.startAutoCapture(session.id, sessionDir)
    }

    // Show mini-bar and update tray
    showMiniBar()
    updateTrayState('recording')

    // Broadcast session created
    broadcastToAllWindows('session:created', session)

    // Broadcast recording state for mini-bar and other UI
    broadcastToAllWindows('app:recordingState', { isRecording: true, sessionId: session.id })

    saveDatabase()
  }

  async stopSession(): Promise<unknown> {
    if (!this.activeSessionId) {
      return null
    }

    const sessionId = this.activeSessionId

    // Stop audio capture in renderer
    broadcastToAllWindows('audio:stopCapture')

    // Stop services
    this.suggestionEngine?.stop()
    this.screenCapture?.stopAutoCapture()

    // Update database
    updateSession(sessionId, {
      ended_at: Date.now(),
      status: 'processing',
    })
    saveDatabase()

    // Update UI
    hideMiniBar()
    updateTrayState('processing')

    // Broadcast status change
    broadcastToAllWindows('session:statusChanged', {
      sessionId,
      status: 'processing',
    })

    // Complete session
    updateSession(sessionId, { status: 'completed' })
    saveDatabase()

    this.activeSessionId = null
    this.activeSessionDir = null
    updateTrayState('idle')

    // Broadcast recording state stopped
    broadcastToAllWindows('app:recordingState', { isRecording: false, sessionId: null })

    return { sessionId }
  }

  async onSettingsChanged(key: string): Promise<void> {
    if (key.startsWith('ai.provider') || key.startsWith('ai.model') || key.startsWith('ai.apiKey')) {
      this.configureAIProvider()
      this.setModelOnServices()
    }

    if (key.startsWith('ai.embedding')) {
      const embedFn = this.createEmbedFunction()
      if (embedFn && this.knowledgeBase) {
        this.knowledgeBase.setEmbedFunction(embedFn)
      }
      // Re-wire KB service
      this.wireKnowledgeBaseService()
    }
  }

  shutdown(): void {
    if (this.isShutdown) return
    this.isShutdown = true

    // If there's an active session, mark it as interrupted
    if (this.activeSessionId) {
      try {
        updateSession(this.activeSessionId, { status: 'interrupted' })
        saveDatabase()
      } catch {
        // Best effort during shutdown
      }
      this.activeSessionId = null
    }

    // Stop all services
    this.suggestionEngine?.stop()
    this.screenCapture?.stopAutoCapture()
    this.meetingDetector?.stop()
    this.micMonitor?.stop()
  }

  // ── Private methods ─────────────────────────────────────────────────────

  private configureAIProvider(): void {
    const provider = settingsStore.get('ai.provider')
    const model = settingsStore.get('ai.model')
    const apiKey = credentialStore.retrieve('ai.apiKey', settingsStore.get('ai.apiKey')) ?? settingsStore.get('ai.apiKey')

    try {
      const config = this.buildProviderConfig(provider, model, apiKey)
      const result = createProvider(config)
      this.currentModel = result.model
      this._provider = result.provider
    } catch (error) {
      console.error('[SessionOrchestrator] Failed to configure AI provider:', error)
      this.currentModel = null
      this._provider = null
    }
  }

  private buildProviderConfig(
    provider: string,
    model: string,
    apiKey: string,
  ): Parameters<typeof createProvider>[0] {
    switch (provider) {
      case 'ollama':
        return { provider: 'ollama', model }
      case 'openai':
        return { provider: 'openai', model, apiKey }
      case 'anthropic':
        return { provider: 'anthropic', model, apiKey }
      case 'google':
        return { provider: 'google', model, apiKey }
      case 'bedrock':
        return { provider: 'bedrock', model }
      default:
        return { provider: 'ollama', model }
    }
  }

  private createEmbedFunction(): ((text: string) => Promise<number[]>) | null {
    const provider = settingsStore.get('ai.embeddingProvider')
    const model = settingsStore.get('ai.embeddingModel')

    const config: EmbeddingProviderConfig = { provider, model }

    return async (text: string): Promise<number[]> => {
      const result = await embed(text, config)
      return result.embedding
    }
  }

  private setModelOnServices(): void {
    if (!this.currentModel) return

    this.suggestionEngine?.setModel(this.currentModel)
    this.screenCapture?.setModel(this.currentModel)
    this.notesGenerator?.setModel(this.currentModel)
  }

  private wireIpcHandlers(): void {
    // Wire suggestion service
    setSuggestionService({
      getActive: async () =>
        this.suggestionEngine?.getActiveSuggestions() ?? [],
      dismiss: async (id) => {
        this.suggestionEngine?.dismiss(id)
      },
      trigger: async () => {
        await this.suggestionEngine?.trigger()
      },
      setEnabled: async (enabled) => {
        if (enabled && this.activeSessionId) {
          this.suggestionEngine?.start(this.activeSessionId)
        } else {
          this.suggestionEngine?.stop()
        }
      },
    })

    // Wire screenshot service
    setScreenshotService({
      capture: async (_sessionId) => {
        if (!this.screenCapture || !this.activeSessionId || !this.activeSessionDir) return null
        // Ensure capture context is set (startAutoCapture sets sessionId/sessionDir on the service)
        if (!this.screenCapture.isAutoCapturing()) {
          this.screenCapture.startAutoCapture(this.activeSessionId, this.activeSessionDir)
          this.screenCapture.stopAutoCapture()
        }
        await this.screenCapture.capture(true)
        return null
      },
      listForSession: async (sessionId) =>
        getScreenshotsBySession(sessionId),
      getAnalysis: async (_screenshotId) => null,
      configure: async (_options) => {
        // Reconfigure screen capture with new options
      },
    })

    // Wire notes service
    setNotesService({
      generate: async (sessionId, templateId) => {
        if (!this.notesGenerator) throw new Error('Notes generator not initialized')
        return this.notesGenerator.generate(sessionId, templateId)
      },
      categorize: async (sessionId) => {
        if (!this.notesGenerator) throw new Error('Notes generator not initialized')
        return this.notesGenerator.categorize(sessionId)
      },
    })

    // Wire knowledge base service
    this.wireKnowledgeBaseService()
  }

  private wireKnowledgeBaseService(): void {
    setKnowledgeBaseService({
      addSource: async (path) => {
        await this.knowledgeBase?.addSource(path)
      },
      removeSource: async (sourcePath) => {
        await this.knowledgeBase?.removeSource(sourcePath)
      },
      search: async (query, topK) => {
        const results = await this.knowledgeBase?.search(query, topK)
        return results ?? []
      },
      reindex: async () => {
        await this.knowledgeBase?.reindex()
      },
    })
  }

  private recoverInterruptedSessions(): void {
    try {
      const sessions = getAllSessions()
      for (const session of sessions) {
        if (session.status === 'recording') {
          updateSession(session.id, {
            status: 'interrupted',
            ended_at: session.started_at,
          })
          saveDatabase()
          console.log(`[SessionOrchestrator] Recovered interrupted session: ${session.id}`)
        }
      }
    } catch (error) {
      console.error('[SessionOrchestrator] Error recovering sessions:', error)
    }
  }
}

// ── Module-level singleton helpers ────────────────────────────────────────────

let _orchestratorInstance: SessionOrchestrator | null = null

export function getOrchestrator(): SessionOrchestrator | null {
  return _orchestratorInstance
}

export function setOrchestratorInstance(orchestrator: SessionOrchestrator): void {
  _orchestratorInstance = orchestrator
}
