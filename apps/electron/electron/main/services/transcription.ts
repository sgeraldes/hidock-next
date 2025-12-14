import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import { getConfig } from './config'
import {
  getRecordingById,
  updateRecordingStatus,
  insertTranscript,
  getQueueItems,
  updateQueueItem,
  getMeetingById,
  findCandidateMeetingsForRecording,
  addRecordingMeetingCandidate,
  linkRecordingToMeeting,
  type Transcript,
  type Meeting
} from './database'
import { BrowserWindow } from 'electron'
import { getVectorStore } from './vector-store'

let mainWindow: BrowserWindow | null = null
let isProcessing = false
let processingInterval: ReturnType<typeof setInterval> | null = null

export function setMainWindowForTranscription(win: BrowserWindow): void {
  mainWindow = win
}

export function startTranscriptionProcessor(): void {
  if (processingInterval) {
    console.log('Transcription processor already running')
    return
  }

  console.log('Starting transcription processor')

  // Process queue every 10 seconds
  processingInterval = setInterval(() => {
    processQueue()
  }, 10000)

  // Start immediately
  processQueue()
}

export function stopTranscriptionProcessor(): void {
  if (processingInterval) {
    clearInterval(processingInterval)
    processingInterval = null
    console.log('Transcription processor stopped')
  }
}

async function processQueue(): Promise<void> {
  if (isProcessing) return

  const config = getConfig()
  if (!config.transcription.geminiApiKey) {
    return
  }

  const pendingItems = getQueueItems('pending')
  if (pendingItems.length === 0) return

  isProcessing = true

  for (const item of pendingItems) {
    try {
      updateQueueItem(item.id, 'processing')
      notifyRenderer('transcription:started', { queueItemId: item.id, recordingId: item.recording_id })

      await transcribeRecording(item.recording_id)

      updateQueueItem(item.id, 'completed')
      notifyRenderer('transcription:completed', { queueItemId: item.id, recordingId: item.recording_id })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('Transcription failed:', errorMessage)

      updateQueueItem(item.id, 'failed', errorMessage)
      notifyRenderer('transcription:failed', {
        queueItemId: item.id,
        recordingId: item.recording_id,
        error: errorMessage
      })

      // If too many attempts, don't retry
      if (item.attempts >= 3) {
        console.log(`Recording ${item.recording_id} failed after ${item.attempts} attempts`)
      }
    }
  }

  isProcessing = false
}

async function transcribeRecording(recordingId: string): Promise<void> {
  const recording = getRecordingById(recordingId)
  if (!recording) {
    throw new Error(`Recording not found: ${recordingId}`)
  }

  if (!existsSync(recording.file_path)) {
    throw new Error(`Recording file not found: ${recording.file_path}`)
  }

  const config = getConfig()
  if (!config.transcription.geminiApiKey) {
    throw new Error('Gemini API key not configured')
  }

  console.log(`Transcribing: ${recording.filename}`)
  updateRecordingStatus(recordingId, 'transcribing')

  // Read the audio file
  const audioBuffer = readFileSync(recording.file_path)
  const base64Audio = audioBuffer.toString('base64')

  // Determine MIME type
  const ext = extname(recording.file_path).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mp3',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.hda': 'audio/wav' // HiDock Audio format - treat as WAV
  }
  const mimeType = mimeTypes[ext] || 'audio/wav'

  // Initialize Gemini
  const genAI = new GoogleGenerativeAI(config.transcription.geminiApiKey)
  const model = genAI.getGenerativeModel({ model: config.transcription.geminiModel || 'gemini-2.0-flash-exp' })

  // Find candidate meetings for this recording's time window
  const candidateMeetings = findCandidateMeetingsForRecording(recordingId)
  console.log(`Found ${candidateMeetings.length} candidate meetings for recording ${recordingId}`)

  // Build meeting context for better transcription
  let meetingContext = ''
  if (candidateMeetings.length > 0) {
    meetingContext = `\n\nPOSSIBLE MEETING CONTEXT (use this to improve transcription accuracy):
${candidateMeetings.map((m, i) => `
Meeting ${i + 1}: "${m.subject}"
  Time: ${new Date(m.start_time).toLocaleString()} - ${new Date(m.end_time).toLocaleString()}
  ${m.organizer_name ? `Organizer: ${m.organizer_name}` : ''}
  ${m.location ? `Location: ${m.location}` : ''}
  ${m.description ? `Description: ${m.description.slice(0, 200)}...` : ''}
`).join('\n')}`
  }

  // First, transcribe the audio with meeting context
  const transcriptionPrompt = `Transcribe this audio recording.
The audio may be in Spanish or English - transcribe in the original language.
Provide a clean, accurate transcription of all speech.
If there are multiple speakers, try to indicate speaker changes with "Speaker 1:", "Speaker 2:", etc.
${meetingContext}
Return ONLY the transcription, no additional commentary.`

  const transcriptionResult = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Audio
      }
    },
    { text: transcriptionPrompt }
  ])

  const fullText = transcriptionResult.response.text()

  // Build meeting selection prompt if there are multiple candidates
  let meetingSelectionSection = ''
  if (candidateMeetings.length > 1) {
    meetingSelectionSection = `
5. IMPORTANT - Meeting Selection: Based on the transcript content, determine which meeting this recording most likely belongs to.
   Analyze mentions of topics, people, projects, or context clues to select the best match.

   Available meetings:
${candidateMeetings.map((m, i) => `   ${i + 1}. "${m.subject}" (ID: ${m.id})`).join('\n')}

   Include in your response:
   "selected_meeting_id": "the meeting ID that best matches",
   "meeting_confidence": 0.0 to 1.0 (how confident you are),
   "selection_reason": "why you selected this meeting"`
  } else if (candidateMeetings.length === 1) {
    meetingSelectionSection = `
5. Meeting Match: This recording appears to be from the meeting "${candidateMeetings[0].subject}".
   Verify this makes sense based on the content.
   "selected_meeting_id": "${candidateMeetings[0].id}",
   "meeting_confidence": 0.0 to 1.0,
   "selection_reason": "your reasoning"`
  }

  // Now analyze the transcription for summary, action items, etc.
  const analysisPrompt = `Analyze this meeting transcript and provide:
1. A brief summary (2-3 sentences)
2. A list of action items mentioned (as a JSON array of strings)
3. Key topics discussed (as a JSON array of strings)
4. Key points or decisions made (as a JSON array of strings)
${meetingSelectionSection}

Transcript:
${fullText}

Respond in JSON format:
{
  "summary": "...",
  "action_items": ["...", "..."],
  "topics": ["...", "..."],
  "key_points": ["...", "..."],
  "language": "es" or "en"${candidateMeetings.length > 0 ? `,
  "selected_meeting_id": "...",
  "meeting_confidence": 0.0,
  "selection_reason": "..."` : ''}
}`

  const analysisResult = await model.generateContent(analysisPrompt)
  const analysisText = analysisResult.response.text()

  // Parse the analysis JSON
  let analysis: {
    summary?: string
    action_items?: string[]
    topics?: string[]
    key_points?: string[]
    language?: string
    selected_meeting_id?: string
    meeting_confidence?: number
    selection_reason?: string
  } = {}

  try {
    // Extract JSON from the response (might be wrapped in markdown code blocks)
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      analysis = JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.warn('Failed to parse analysis JSON:', e)
    analysis = { summary: 'Analysis failed', language: 'unknown' }
  }

  // Process AI meeting selection
  if (candidateMeetings.length > 0) {
    // Add all candidates to the database
    for (const meeting of candidateMeetings) {
      const isSelected = analysis.selected_meeting_id === meeting.id
      const confidence = isSelected ? (analysis.meeting_confidence || 0.5) : 0.1
      const reason = isSelected ? (analysis.selection_reason || 'Time overlap') : 'Time overlap only'

      addRecordingMeetingCandidate(recordingId, meeting.id, confidence, reason, isSelected)
    }

    // If AI selected a meeting, link it
    if (analysis.selected_meeting_id) {
      const selectedMeeting = candidateMeetings.find(m => m.id === analysis.selected_meeting_id)
      if (selectedMeeting) {
        linkRecordingToMeeting(
          recordingId,
          selectedMeeting.id,
          analysis.meeting_confidence || 0.5,
          'ai_transcript_match'
        )
        console.log(`AI matched recording to meeting: "${selectedMeeting.subject}" (confidence: ${analysis.meeting_confidence})`)
      }
    }
  }

  // Count words
  const wordCount = fullText.split(/\s+/).filter((w) => w.length > 0).length

  // Create transcript record
  const transcript: Omit<Transcript, 'created_at'> = {
    id: `trans_${recordingId}`,
    recording_id: recordingId,
    full_text: fullText,
    language: analysis.language || 'unknown',
    summary: analysis.summary,
    action_items: analysis.action_items ? JSON.stringify(analysis.action_items) : undefined,
    topics: analysis.topics ? JSON.stringify(analysis.topics) : undefined,
    key_points: analysis.key_points ? JSON.stringify(analysis.key_points) : undefined,
    sentiment: undefined,
    speakers: undefined,
    word_count: wordCount,
    transcription_provider: 'gemini',
    transcription_model: 'gemini-2.0-flash-exp'
  }

  insertTranscript(transcript)
  updateRecordingStatus(recordingId, 'transcribed')

  // Index transcript into vector store for RAG
  try {
    const vectorStore = getVectorStore()
    const meetingId = recording.meeting_id
    let meetingSubject: string | undefined

    if (meetingId) {
      const meeting = getMeetingById(meetingId)
      meetingSubject = meeting?.subject
    }

    const indexedCount = await vectorStore.indexTranscript(fullText, {
      meetingId: meetingId || undefined,
      recordingId,
      timestamp: recording.created_at,
      subject: meetingSubject
    })

    console.log(`Indexed ${indexedCount} chunks into vector store`)
  } catch (e) {
    console.warn('Failed to index transcript into vector store:', e)
  }

  console.log(`Transcription complete: ${recording.filename} (${wordCount} words)`)
}

export async function transcribeManually(recordingId: string): Promise<void> {
  try {
    notifyRenderer('transcription:started', { recordingId })
    await transcribeRecording(recordingId)
    notifyRenderer('transcription:completed', { recordingId })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    notifyRenderer('transcription:failed', { recordingId, error: errorMessage })
    throw error
  }
}

export function getTranscriptionStatus(): {
  isProcessing: boolean
  pendingCount: number
  processingCount: number
} {
  const pending = getQueueItems('pending')
  const processing = getQueueItems('processing')

  return {
    isProcessing,
    pendingCount: pending.length,
    processingCount: processing.length
  }
}

function notifyRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}
