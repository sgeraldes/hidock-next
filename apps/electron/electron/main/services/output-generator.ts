/**
 * Output Generator Service
 *
 * Generates structured outputs from meeting transcripts using LLM.
 */

import { getOllamaService } from './ollama'
import { getTemplate, getTemplates, OutputTemplateId, OutputTemplate } from './output-templates'
import {
  getMeetingById,
  getRecordingsForMeeting,
  getTranscriptByRecordingId,
  getMeetingsForProject,
  getMeetingsForContact,
  getProjectById,
  getContactById
} from './database'

export interface GenerateOutputOptions {
  templateId: OutputTemplateId
  meetingId?: string
  projectId?: string
  contactId?: string
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

    // Collect transcripts based on context
    let transcripts: string[] = []
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
          transcripts.push(transcript.full_text)
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
            transcripts.push(`[Meeting: ${meeting.subject}]\n${transcript.full_text}`)
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
            transcripts.push(`[Meeting: ${meeting.subject}]\n${transcript.full_text}`)
          }
        }
      }

      contextInfo = {
        contact_name: contact.name,
        contact_email: contact.email || '',
        meeting_count: String(meetings.length)
      }
    }

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

    // Generate using Ollama
    const ollama = getOllamaService()
    const isAvailable = await ollama.isAvailable()

    if (!isAvailable) {
      throw new Error('Ollama is not available. Please start Ollama to generate outputs.')
    }

    const systemPrompt = `You are a professional document writer. Generate clear, well-structured documents based on meeting transcripts. Be concise but thorough. Use the exact format requested.`

    const content = await ollama.generate(prompt, systemPrompt)

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
