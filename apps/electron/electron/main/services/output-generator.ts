/**
 * Output Generator Service
 *
 * Generates structured outputs from meeting transcripts using LLM.
 */

import { getBrainRouter } from './brains'
import { getTemplate, getTemplates, OutputTemplateId, OutputTemplate } from './output-templates'
import {
  getMeetingById,
  getRecordingsForMeeting,
  getTranscriptByRecordingId,
  getMeetingsForProject,
  getMeetingsForContact,
  getProjectById,
  getContactById,
  queryOne
} from './database'
import { filterEligibleRecordingIds } from './recording-eligibility'

export interface GenerateOutputOptions {
  templateId: OutputTemplateId
  meetingId?: string
  projectId?: string
  contactId?: string
  knowledgeCaptureId?: string
  actionableId?: string
}

export interface GenerateOutputResult {
  content: string
  templateId: OutputTemplateId
  generatedAt: string
}

class OutputGeneratorService {
  /**
   * Get all available output templates
   */
  getTemplates(): OutputTemplate[] {
    return getTemplates()
  }

  /**
   * Get a specific template
   */
  getTemplate(id: OutputTemplateId): OutputTemplate | undefined {
    return getTemplate(id)
  }

  /**
   * Generate output using a template
   */
  async generate(options: GenerateOutputOptions): Promise<GenerateOutputResult> {
    const { templateId, meetingId, projectId, contactId } = options

    const template = getTemplate(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    // Collect transcripts based on context. RE6-2 (round-6): every transcript
    // is tagged with the RECORDING id it came from, so the shared fail-closed
    // eligibility boundary can be applied ONCE, immediately before prompt
    // construction — the resolvers below (getRecordingsForMeeting, etc.) return
    // personal/soft-deleted recordings, and a stale actionable/context id can
    // point at a now-excluded recording.
    const entries: Array<{ recordingId: string; text: string }> = []
    let contextInfo: Record<string, string> = {}

    if (meetingId) {
      // Single meeting
      const meeting = getMeetingById(meetingId)
      if (!meeting) {
        throw new Error(`Meeting not found: ${meetingId}`)
      }

      const recordings = getRecordingsForMeeting(meetingId)
      for (const recording of recordings) {
        const transcript = getTranscriptByRecordingId(recording.id)
        if (transcript?.full_text) {
          entries.push({ recordingId: recording.id, text: transcript.full_text })
        }
      }

      contextInfo = {
        meeting_subject: meeting.subject,
        meeting_date: new Date(meeting.start_time).toLocaleDateString(),
        attendees: meeting.attendees || ''
      }
    } else if (projectId) {
      // All meetings for a project
      const project = getProjectById(projectId)
      if (!project) {
        throw new Error(`Project not found: ${projectId}`)
      }

      const meetings = getMeetingsForProject(projectId)
      for (const meeting of meetings) {
        const recordings = getRecordingsForMeeting(meeting.id)
        for (const recording of recordings) {
          const transcript = getTranscriptByRecordingId(recording.id)
          if (transcript?.full_text) {
            entries.push({ recordingId: recording.id, text: `[Meeting: ${meeting.subject}]\n${transcript.full_text}` })
          }
        }
      }

      contextInfo = {
        project_name: project.name,
        project_description: project.description || '',
        meeting_count: String(meetings.length)
      }
    } else if (contactId) {
      // All meetings for a contact
      const contact = getContactById(contactId)
      if (!contact) {
        throw new Error(`Contact not found: ${contactId}`)
      }

      const meetings = getMeetingsForContact(contactId)
      for (const meeting of meetings) {
        const recordings = getRecordingsForMeeting(meeting.id)
        for (const recording of recordings) {
          const transcript = getTranscriptByRecordingId(recording.id)
          if (transcript?.full_text) {
            entries.push({ recordingId: recording.id, text: `[Meeting: ${meeting.subject}]\n${transcript.full_text}` })
          }
        }
      }

      contextInfo = {
        contact_name: contact.name,
        contact_email: contact.email || '',
        meeting_count: String(meetings.length)
      }
    } else if (options.knowledgeCaptureId) {
      // Single knowledge capture. Actionables store source_knowledge_id as a
      // knowledge_captures id when one exists, but fall back to the recording
      // id when captures are absent — resolve both here.
      const kc = queryOne<any>('SELECT * FROM knowledge_captures WHERE id = ?', [options.knowledgeCaptureId])

      if (kc) {
        const transcript = getTranscriptByRecordingId(kc.source_recording_id)
        if (transcript?.full_text) {
          entries.push({ recordingId: kc.source_recording_id, text: transcript.full_text })
        }

        contextInfo = {
          capture_title: kc.title,
          capture_date: new Date(kc.captured_at).toLocaleDateString(),
          capture_summary: kc.summary || ''
        }
      } else {
        const transcript = getTranscriptByRecordingId(options.knowledgeCaptureId)
        if (!transcript?.full_text) {
          throw new Error(`Knowledge capture not found: ${options.knowledgeCaptureId}`)
        }
        entries.push({ recordingId: options.knowledgeCaptureId, text: transcript.full_text })

        const recording = queryOne<any>('SELECT * FROM recordings WHERE id = ?', [options.knowledgeCaptureId])
        contextInfo = {
          capture_title: recording?.filename || 'Recording',
          capture_date: recording?.date_recorded
            ? new Date(recording.date_recorded).toLocaleDateString()
            : new Date().toLocaleDateString(),
          capture_summary: transcript.summary || ''
        }
      }
    }

    // RE6-2 — apply the shared eligibility boundary immediately before prompt
    // construction. Drop excluded (personal/soft-deleted/value-excluded)
    // recordings; if eligibility can't be established at all, fail closed
    // (refuse) rather than send/persist/export an excluded transcript.
    const { eligible, failClosed } = filterEligibleRecordingIds(entries.map((e) => e.recordingId))
    if (failClosed) {
      throw new Error('Cannot verify recording eligibility — output generation refused (fail closed)')
    }
    const eligibleEntries = entries.filter((e) => eligible.has(e.recordingId))
    const transcripts = eligibleEntries.map((e) => e.text)
    // ADV41-4 (round-43) — retain the source recording ids so eligibility can be
    // REVALIDATED after the awaited BrainRouter.resolve below, immediately before
    // the provider call. The prompt is built from these transcripts now, but an
    // owner exclusion can commit during resolution.
    const sourceRecordingIds = eligibleEntries.map((e) => e.recordingId)

    if (transcripts.length === 0) {
      throw new Error('No transcripts available for the selected context')
    }

    // Build the prompt with substitutions
    let prompt = template.prompt
    prompt = prompt.replace('{transcript}', transcripts.join('\n\n---\n\n'))
    prompt = prompt.replace('{transcripts}', transcripts.join('\n\n---\n\n'))

    // Substitute context variables
    for (const [key, value] of Object.entries(contextInfo)) {
      prompt = prompt.replace(`{${key}}`, value)
    }

    const systemPrompt = `You are a professional document writer. Generate clear, well-structured documents based on meeting transcripts. Be concise but thorough. Use the exact format requested.`

    // Prefer the configured cloud brain (Gemini, same credentials as
    // transcription); fall back to local Ollama when no API key is set. Routing
    // is now shared with chat-llm.ts and embeddings.ts via the brain seam. The
    // Gemini brain defaults to config.transcription.geminiModel and lets any API
    // error propagate — identical to the previous inline behaviour.
    const brain = await getBrainRouter().resolve('outputs', 'generate')
    if (!brain) {
      throw new Error(
        'No output provider available. Configure a Gemini API key in Settings or start Ollama.'
      )
    }

    // ADV41-4 (round-43) — BrainRouter.resolve above is an await (auth /
    // availability); an owner deletion / mark-personal / value-exclusion can
    // commit during that gap. The prompt was assembled from eligibility
    // snapshotted BEFORE the await, so revalidate the source recordings in the
    // SAME synchronous step immediately before the provider call. If ANY source
    // is now ineligible — or eligibility can't be established (fail closed) —
    // refuse rather than send an excluded transcript to the brain (the prompt
    // already embeds every source's text, so partial dropping is not possible).
    const recheck = filterEligibleRecordingIds(sourceRecordingIds)
    if (recheck.failClosed || sourceRecordingIds.some((id) => !recheck.eligible.has(id))) {
      throw new Error(
        'Recording eligibility changed during provider resolution — output generation refused (fail closed)'
      )
    }

    const content = await brain.generate([{ role: 'user', content: prompt }], { systemPrompt })

    if (!content) {
      throw new Error('Failed to generate output. Please try again.')
    }

    return {
      content,
      templateId,
      generatedAt: new Date().toISOString()
    }
  }
}

// Singleton instance
let generatorInstance: OutputGeneratorService | null = null

export function getOutputGeneratorService(): OutputGeneratorService {
  if (!generatorInstance) {
    generatorInstance = new OutputGeneratorService()
  }
  return generatorInstance
}

export { OutputGeneratorService }
