import { EventEmitter } from 'node:events'
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import {
  getTranscriptBySession,
  getSession,
  getMeeting,
  getScreenshotsBySession,
  getNotesBySession,
  createNote,
  updateNote,
  getAllNoteTemplates,
} from './database-queries'
import { saveDatabase } from './database'

export interface NotesGeneratorOptions {
  defaultLanguage?: string // 'auto' | ISO code
}

export interface CategorizeResult {
  category: string // "standup" | "1:1" | "client call" | "brainstorm" | etc.
  summary: string // 3-5 line executive summary
  suggestedTemplate: string | null // template name that fits best
  topics: string[] // main topics discussed
  decisions: string[] // detected decisions
  actionItems: string[] // preliminary action items
}

export class NotesGenerator extends EventEmitter {
  private model: LanguageModel | null = null
  private options: Required<NotesGeneratorOptions>

  constructor(options?: NotesGeneratorOptions) {
    super()
    this.options = {
      defaultLanguage: 'auto',
      ...options,
    }
  }

  setModel(model: LanguageModel): void {
    this.model = model
  }

  /** Step 1: Categorize a session — analyze transcript to determine meeting type */
  async categorize(sessionId: string): Promise<CategorizeResult> {
    if (!this.model) throw new Error('No LLM model set for notes generation')

    const session = getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const segments = getTranscriptBySession(sessionId)
    const screenshots = getScreenshotsBySession(sessionId)
    const meeting = session.meeting_id ? getMeeting(session.meeting_id) : null

    // Build context
    const transcriptText = segments
      .map(s => `${s.speaker ?? 'Unknown'}: ${s.text}`)
      .join('\n')

    const screenshotAnalyses = screenshots
      .filter(s => s.analysis)
      .map(s => s.analysis!)

    let prompt = `Analyze this meeting transcript and provide a structured categorization.\n\n`

    if (meeting) {
      prompt += `Meeting title: ${meeting.title ?? 'Untitled'}\n`
      if (meeting.attendees) prompt += `Attendees: ${meeting.attendees}\n`
      if (meeting.agenda) prompt += `Agenda: ${meeting.agenda}\n\n`
    }

    const lastSegment = segments[segments.length - 1]
    prompt += `Duration: ${Math.round((lastSegment?.end_time ?? 0) / 60)} minutes\n`
    prompt += `Participants: ${new Set(segments.map(s => s.speaker).filter(Boolean)).size}\n\n`

    prompt += `Transcript:\n${transcriptText.slice(0, 8000)}\n\n` // limit for token budget

    if (screenshotAnalyses.length > 0) {
      prompt += `Visual content presented:\n${screenshotAnalyses.slice(0, 3).join('\n')}\n\n`
    }

    prompt += `Respond in JSON format:
{
  "category": "standup" | "1:1" | "client call" | "brainstorm" | "interview" | "planning" | "review" | "general",
  "summary": "3-5 line executive summary",
  "suggestedTemplate": "template name that fits best, or null",
  "topics": ["topic1", "topic2"],
  "decisions": ["decision1", "decision2"],
  "actionItems": ["action1", "action2"]
}`

    this.emit('progress', { stage: 'categorizing', progress: 0.1 })

    const result = await generateText({ model: this.model, prompt })

    try {
      const parsed = JSON.parse(result.text) as CategorizeResult
      this.emit('progress', { stage: 'categorized', progress: 0.3 })
      return parsed
    } catch {
      // If JSON parse fails, return a basic result
      return {
        category: 'general',
        summary: result.text.slice(0, 500),
        suggestedTemplate: null,
        topics: [],
        decisions: [],
        actionItems: [],
      }
    }
  }

  /** Step 2: Generate notes using a template */
  async generate(sessionId: string, templateId?: string): Promise<string> {
    if (!this.model) throw new Error('No LLM model set for notes generation')

    const session = getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const segments = getTranscriptBySession(sessionId)
    const screenshots = getScreenshotsBySession(sessionId)
    const meeting = session.meeting_id ? getMeeting(session.meeting_id) : null
    const templates = getAllNoteTemplates()
    const template = templateId ? templates.find(t => t.id === templateId) : templates[0]

    this.emit('progress', { stage: 'generating', progress: 0.4 })

    // Build transcript
    const transcriptText = segments
      .map(s => `${s.speaker ?? 'Unknown'}: ${s.text}`)
      .join('\n')

    const screenshotAnalyses = screenshots
      .filter(s => s.analysis)
      .map(s => s.analysis!)

    let prompt = `Generate structured meeting notes from this transcript.\n\n`

    if (template) {
      prompt += `Instructions: ${template.prompt}\n`
      if (template.structure) {
        prompt += `Use this structure:\n${template.structure}\n\n`
      }
    }

    if (meeting) {
      prompt += `Meeting: ${meeting.title ?? 'Untitled'}\n`
      if (meeting.attendees) prompt += `Attendees: ${meeting.attendees}\n`
      if (meeting.agenda) prompt += `Agenda: ${meeting.agenda}\n`
      prompt += '\n'
    }

    const language = this.options.defaultLanguage
    if (language !== 'auto') {
      prompt += `Write the notes in ${language}.\n\n`
    }

    prompt += `Transcript:\n${transcriptText}\n\n`

    if (screenshotAnalyses.length > 0) {
      prompt += `Visual content presented during the meeting:\n${screenshotAnalyses.join('\n')}\n\n`
    }

    prompt += `Generate comprehensive meeting notes in Markdown format. Be thorough but concise.`

    const result = await generateText({ model: this.model, prompt })

    this.emit('progress', { stage: 'saving', progress: 0.9 })

    // Save to database
    const existingNotes = getNotesBySession(sessionId)
    if (existingNotes.length > 0) {
      updateNote(existingNotes[0].id, result.text)
    } else {
      createNote({
        session_id: sessionId,
        template_id: templateId,
        content: result.text,
      })
    }
    saveDatabase()

    this.emit('progress', { stage: 'complete', progress: 1.0 })
    this.emit('generated', { sessionId, content: result.text })

    return result.text
  }

  /** Generate a custom template for a specific meeting */
  async generateCustomTemplate(
    sessionId: string,
  ): Promise<{ name: string; prompt: string; structure: string }> {
    if (!this.model) throw new Error('No LLM model set')

    const categorization = await this.categorize(sessionId)

    const prompt = `Based on a "${categorization.category}" meeting about these topics: ${categorization.topics.join(', ')},
create a custom note template. Respond in JSON:
{
  "name": "Template Name",
  "prompt": "Instructions for generating notes",
  "structure": "## Section 1\\n\\n## Section 2\\n\\n..."
}`

    const result = await generateText({ model: this.model, prompt })

    try {
      return JSON.parse(result.text) as { name: string; prompt: string; structure: string }
    } catch {
      return {
        name: `${categorization.category} Notes`,
        prompt: `Generate notes for a ${categorization.category} meeting.`,
        structure: `## Summary\n\n## Key Points\n\n## Action Items\n\n## Next Steps`,
      }
    }
  }
}
