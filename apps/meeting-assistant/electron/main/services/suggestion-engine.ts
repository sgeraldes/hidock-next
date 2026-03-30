import { EventEmitter } from 'node:events'
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'

export interface Suggestion {
  id: string
  text: string
  source: 'knowledge' | 'context'
  createdAt: number
  dismissed: boolean
}

export interface SuggestionEngineOptions {
  triggerIntervalMs?: number      // default 90000 (90s)
  maxSuggestions?: number         // default 3
  contextWindowSeconds?: number   // default 120 (2 min of transcript)
}

export class SuggestionEngine extends EventEmitter {
  private model: LanguageModel | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastProcessedTime: number = 0
  private suggestions: Map<string, Suggestion> = new Map()
  private dismissedTexts: Set<string> = new Set()
  private options: Required<SuggestionEngineOptions>
  private sessionId: string | null = null
  private knowledgeSearchFn: ((query: string, topK?: number) => Promise<Array<{ text: string; score: number }>>) | null = null

  // Callbacks to get transcript and screenshot data (injected)
  private getRecentTranscript: ((sessionId: string, limit: number) => Array<{ speaker: string | null; text: string; start_time: number }>) | null = null
  private getScreenshots: ((sessionId: string) => Array<{ analysis: string | null }>) | null = null
  private getMeetingInfo: (() => { title?: string; attendees?: string; agenda?: string } | null) | null = null

  constructor(options?: SuggestionEngineOptions) {
    super()
    this.options = {
      triggerIntervalMs: 90000,
      maxSuggestions: 3,
      contextWindowSeconds: 120,
      ...options,
    }
  }

  /** Set the LLM model for generating suggestions */
  setModel(model: LanguageModel): void {
    this.model = model
  }

  /** Set the knowledge base search function */
  setKnowledgeSearch(fn: (query: string, topK?: number) => Promise<Array<{ text: string; score: number }>>): void {
    this.knowledgeSearchFn = fn
  }

  /** Set data access functions */
  setDataAccessors(accessors: {
    getRecentTranscript: (sessionId: string, limit: number) => Array<{ speaker: string | null; text: string; start_time: number }>
    getScreenshots: (sessionId: string) => Array<{ analysis: string | null }>
    getMeetingInfo: () => { title?: string; attendees?: string; agenda?: string } | null
  }): void {
    this.getRecentTranscript = accessors.getRecentTranscript
    this.getScreenshots = accessors.getScreenshots
    this.getMeetingInfo = accessors.getMeetingInfo
  }

  /** Start generating suggestions for a session */
  start(sessionId: string): void {
    this.sessionId = sessionId
    this.lastProcessedTime = 0
    this.suggestions.clear()
    this.dismissedTexts.clear()

    this.timer = setInterval(() => this.trigger(), this.options.triggerIntervalMs)
    this.emit('started', sessionId)
  }

  /** Stop suggestion generation */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.sessionId = null
    this.emit('stopped')
  }

  /** Dismiss a suggestion */
  dismiss(suggestionId: string): void {
    const suggestion = this.suggestions.get(suggestionId)
    if (suggestion) {
      suggestion.dismissed = true
      this.dismissedTexts.add(suggestion.text.toLowerCase().trim())
      this.emit('suggestion-dismissed', suggestionId)
    }
  }

  /** Get active (non-dismissed) suggestions */
  getActiveSuggestions(): Suggestion[] {
    return Array.from(this.suggestions.values()).filter(s => !s.dismissed)
  }

  /** Manual trigger */
  async trigger(): Promise<void> {
    if (!this.sessionId || !this.model || !this.getRecentTranscript) return

    try {
      // 1. Get recent transcript (last ~40 segments ≈ 2 min)
      const segments = this.getRecentTranscript(this.sessionId, 40)
      if (segments.length === 0) return

      // 2. Check if there's substantial new content since last trigger
      const latestTime = Math.max(...segments.map(s => s.start_time))
      if (latestTime <= this.lastProcessedTime) return
      this.lastProcessedTime = latestTime

      // 3. Build transcript text
      const transcriptText = segments
        .map(s => `${s.speaker ?? 'Unknown'}: ${s.text}`)
        .join('\n')

      // 4. Get meeting metadata
      const meetingInfo = this.getMeetingInfo?.() ?? null

      // 5. Get screenshot analyses
      const screenshots = this.getScreenshots?.(this.sessionId) ?? []
      const recentAnalyses = screenshots
        .filter(s => s.analysis)
        .slice(-3)
        .map(s => s.analysis!)

      // 6. Query knowledge base
      let kbContext = ''
      if (this.knowledgeSearchFn) {
        const query = transcriptText.slice(-500) // use last portion as query
        const results = await this.knowledgeSearchFn(query, 5)
        if (results.length > 0) {
          kbContext = '\n\nRelevant notes from knowledge base:\n' +
            results.map((r, i) => `${i + 1}. ${r.text}`).join('\n')
        }
      }

      // 7. Build prompt and generate
      let prompt = `You are a meeting assistant. Based on the recent conversation, suggest ${this.options.maxSuggestions} useful talking points or relevant information the user might want to bring up.\n\n`

      if (meetingInfo) {
        prompt += `Meeting: ${meetingInfo.title ?? 'Untitled'}\n`
        if (meetingInfo.attendees) prompt += `Attendees: ${meetingInfo.attendees}\n`
        if (meetingInfo.agenda) prompt += `Agenda: ${meetingInfo.agenda}\n`
        prompt += '\n'
      }

      prompt += `Recent conversation:\n${transcriptText}\n`

      if (recentAnalyses.length > 0) {
        prompt += `\nScreen content being presented:\n${recentAnalyses.join('\n')}\n`
      }

      prompt += kbContext

      prompt += `\n\nProvide exactly ${this.options.maxSuggestions} brief, actionable talking points. Each on its own line, starting with "- ". Do not repeat previously dismissed topics.`

      if (this.dismissedTexts.size > 0) {
        prompt += `\n\nPreviously dismissed topics (do not suggest these again): ${Array.from(this.dismissedTexts).join('; ')}`
      }

      const result = await generateText({ model: this.model, prompt })

      // 8. Parse suggestions
      const lines = result.text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('- '))
        .map(l => l.slice(2).trim())
        .filter(l => l.length > 0)
        .slice(0, this.options.maxSuggestions)

      // 9. Clear old non-dismissed suggestions, add new ones
      for (const [id, s] of this.suggestions) {
        if (!s.dismissed) this.suggestions.delete(id)
      }

      for (const text of lines) {
        if (this.dismissedTexts.has(text.toLowerCase().trim())) continue
        const id = `sug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const suggestion: Suggestion = {
          id,
          text,
          source: kbContext ? 'knowledge' : 'context',
          createdAt: Date.now(),
          dismissed: false,
        }
        this.suggestions.set(id, suggestion)
      }

      this.emit('suggestions-updated', this.getActiveSuggestions())
    } catch (error) {
      this.emit('error', error)
    }
  }
}
