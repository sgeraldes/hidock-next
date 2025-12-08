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
  type Transcript
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

  // First, transcribe the audio
  const transcriptionPrompt = `Transcribe this audio recording.
The audio may be in Spanish or English - transcribe in the original language.
Provide a clean, accurate transcription of all speech.
If there are multiple speakers, try to indicate speaker changes with "Speaker 1:", "Speaker 2:", etc.
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

  // Now analyze the transcription for summary, action items, etc.
  const analysisPrompt = `Analyze this meeting transcript and provide:
1. A brief summary (2-3 sentences)
2. A list of action items mentioned (as a JSON array of strings)
3. Key topics discussed (as a JSON array of strings)
4. Key points or decisions made (as a JSON array of strings)

Transcript:
${fullText}

Respond in JSON format:
{
  "summary": "...",
  "action_items": ["...", "..."],
  "topics": ["...", "..."],
  "key_points": ["...", "..."],
  "language": "es" or "en"
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
