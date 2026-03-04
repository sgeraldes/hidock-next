import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFile, existsSync } from 'fs'
import { promisify } from 'util'
import { extname } from 'path'

const readFileAsync = promisify(readFile)
import { getConfig } from './config'
import {
  getRecordingById,
  updateRecordingTranscriptionStatus,
  insertTranscript,
  getQueueItems,
  updateQueueItem,
  updateQueueProgress,
  getMeetingById,
  findCandidateMeetingsForRecording,
  addRecordingMeetingCandidate,
  linkRecordingToMeeting,
  updateKnowledgeCaptureTitle,
  removeFromQueueByRecordingId,
  cancelPendingTranscriptions,
  run,
  queryOne,
  acquireTranscriptionLock,
  releaseTranscriptionLock,
  clearStaleTranscriptionLock,
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

  // Clear any lock left by a previous app instance that crashed or was killed
  // before releasing it. The lock is identified by a unique process+timestamp ID,
  // so any lock present at startup belongs to a dead process.
  clearStaleTranscriptionLock()

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

let cancelRequested = false

export function cancelTranscription(recordingId: string): void {
  removeFromQueueByRecordingId(recordingId)
  updateRecordingTranscriptionStatus(recordingId, 'none')
  notifyRenderer('transcription:cancelled', { recordingId })
}

export function cancelAllTranscriptions(): number {
  cancelRequested = true
  const count = cancelPendingTranscriptions()
  notifyRenderer('transcription:all-cancelled', { count })
  // cancelRequested is reset at the end of processQueue (after the loop breaks)
  // rather than on a timer, to avoid the race where the flag resets before
  // processQueue has a chance to observe it.
  return count
}

const MAX_RETRY_ATTEMPTS = 3 // spec-014: configurable max retry attempts

async function processQueue(): Promise<void> {
  if (isProcessing) return

  // spec-005: Acquire mutex lock to prevent concurrent processing
  const processId = `proc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
  const lockAcquired = acquireTranscriptionLock(processId)
  if (!lockAcquired) {
    console.log('[Transcription] Another process is already processing the queue, skipping')
    return
  }

  const config = getConfig()
  if (!config.transcription.geminiApiKey) {
    console.error('[Transcription] Cannot process queue: Gemini API key not configured')

    // Mark all pending items as failed with clear error message
    const pendingItems = getQueueItems('pending')
    const processingItems = getQueueItems('processing')

    const allStuckItems = [...pendingItems, ...processingItems]
    if (allStuckItems.length > 0) {
      console.log(`[Transcription] Marking ${allStuckItems.length} stuck items as failed (no API key)`)

      for (const item of allStuckItems) {
        updateQueueItem(item.id, 'failed', 'Gemini API key not configured. Please add your API key in Settings.')
        updateRecordingTranscriptionStatus(item.recording_id, 'error')
        notifyRenderer('transcription:failed', {
          queueItemId: item.id,
          recordingId: item.recording_id,
          error: 'Gemini API key not configured. Please add your API key in Settings.'
        })
      }
    }

    releaseTranscriptionLock(processId)
    return
  }

  try {
    // spec-014: Retry failed items with max attempts
    // B-TXN-001: Exponential backoff before retrying failed items
    // C-005: Skip non-retryable errors (missing files, missing API key)
    const NON_RETRYABLE_ERRORS = [
      'Recording not found',
      'Recording file not found',
      'Gemini API key not configured',
      'no local file'
    ]
    const failedItems = getQueueItems('failed')
    const now = Date.now()
    for (const item of failedItems) {
      // B-TXN-003: Use typed property access instead of `as any` cast
      const retryCount = item.retry_count ?? 0

      // C-005: Don't retry items whose error indicates a permanent failure
      const errorMsg = item.error_message || ''
      const isNonRetryable = NON_RETRYABLE_ERRORS.some(pattern => errorMsg.includes(pattern))
      if (isNonRetryable) {
        continue
      }

      if (retryCount < MAX_RETRY_ATTEMPTS) {
        // B-TXN-001: Calculate backoff delay: 30s * 2^retryCount, capped at 120s
        const backoffMs = Math.min(30000 * Math.pow(2, retryCount), 120000)
        const completedAt = item.completed_at ? new Date(item.completed_at).getTime() : 0
        const timeSinceFailure = now - completedAt

        if (timeSinceFailure < backoffMs) {
          // Not enough time has passed; skip this retry cycle
          console.log(`[Transcription] Backoff for ${item.id}: waiting ${Math.round((backoffMs - timeSinceFailure) / 1000)}s more (retry ${retryCount + 1}/${MAX_RETRY_ATTEMPTS})`)
          continue
        }

        // Reset to pending so it gets picked up in the processing loop
        updateQueueItem(item.id, 'pending')
        // Also reset recording status so UI shows it's retrying
        updateRecordingTranscriptionStatus(item.recording_id, 'pending')
        console.log(`Re-queuing failed item ${item.id} (retry ${retryCount + 1}/${MAX_RETRY_ATTEMPTS}, backoff ${backoffMs / 1000}s)`)
      }
    }

    const pendingItems = getQueueItems('pending')
    if (pendingItems.length === 0) {
      return
    }

    isProcessing = true

    for (const item of pendingItems) {
      if (cancelRequested) {
        console.log('Transcription cancelled by user')
        break
      }

      try {
        updateQueueItem(item.id, 'processing')
        updateQueueProgress(item.id, 0) // spec-014: reset progress
        notifyRenderer('transcription:started', { queueItemId: item.id, recordingId: item.recording_id })
        const { emitActivityLog } = await import('./activity-log')
        const recording = getRecordingById(item.recording_id)
        const filename = recording?.filename ?? item.recording_id
        emitActivityLog('info', 'Transcribing recording', filename)

        // B-TXN-002: Progress ticker that increments during long API calls
        // instead of being stuck at a hardcoded value
        let tickerProgress = 0
        const progressTicker = setInterval(() => {
          // Tick progress upward during API calls, capping below 95% (reserved for completion)
          if (tickerProgress < 90) {
            tickerProgress += 2
            updateQueueProgress(item.id, tickerProgress)
            notifyRenderer('transcription:progress', {
              queueItemId: item.id,
              recordingId: item.recording_id,
              stage: 'transcribing',
              progress: tickerProgress
            })
          }
        }, 3000)

        // spec-014: Progress callback for transcription stages
        const progressCallback = (stage: string, progress: number) => {
          tickerProgress = progress // Sync ticker with actual progress
          updateQueueProgress(item.id, progress)
          notifyRenderer('transcription:progress', {
            queueItemId: item.id,
            recordingId: item.recording_id,
            stage,
            progress
          })
        }

        try {
          await transcribeRecording(item.recording_id, progressCallback)
        } finally {
          clearInterval(progressTicker) // Always clean up the ticker
        }

        updateQueueProgress(item.id, 100) // spec-014: mark complete
        updateQueueItem(item.id, 'completed')
        notifyRenderer('transcription:completed', { queueItemId: item.id, recordingId: item.recording_id })
        const { emitActivityLog: emitDone } = await import('./activity-log')
        const recDone = getRecordingById(item.recording_id)
        emitDone('success', 'Transcription complete', recDone?.filename ?? item.recording_id)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error('Transcription failed:', errorMessage)

        updateQueueItem(item.id, 'failed', errorMessage)
        // AI-13: Use standard enum value 'error' (not 'failed')
        updateRecordingTranscriptionStatus(item.recording_id, 'error')
        notifyRenderer('transcription:failed', {
          queueItemId: item.id,
          recordingId: item.recording_id,
          error: errorMessage
        })
        const { emitActivityLog: emitFail } = await import('./activity-log')
        const recFail = getRecordingById(item.recording_id)
        emitFail('error', 'Transcription failed', `${recFail?.filename ?? item.recording_id}: ${errorMessage}`)

        // B-TXN-003: Use typed property access instead of `as any` cast
        const retryCount = item.retry_count ?? 0
        if (retryCount >= MAX_RETRY_ATTEMPTS) {
          console.log(`Recording ${item.recording_id} failed after ${retryCount} retries (max: ${MAX_RETRY_ATTEMPTS})`)
        }
      }
    }

    isProcessing = false
    // AI-11: Reset cancel flag after loop exits, not on a timer
    cancelRequested = false
  } finally {
    // spec-005: Always release mutex lock, even if an error occurred
    releaseTranscriptionLock(processId)
  }
}

/**
 * spec-005: Manually trigger queue processing (exported for IPC handlers).
 * Call after adding items to the queue for immediate processing.
 */
export async function processQueueManually(): Promise<void> {
  return processQueue()
}

interface ActionableDetection {
  type: 'meeting_minutes' | 'interview_feedback' | 'status_report' |
        'decision_log' | 'action_items' | 'research_summary'
  confidence: number // 0.0 to 1.0
  suggestedTitle: string
  reason: string // Why detected
  suggestedTemplate?: string
  suggestedRecipients?: string[]
}

async function detectActionables(
  transcriptText: string,
  knowledgeCaptureId: string,
  metadata: { title?: string; questions?: string[] }
): Promise<ActionableDetection[]> {
  const config = getConfig()
  if (!config.transcription.geminiApiKey) {
    console.log('[Actionable Detection] Gemini API key not configured, skipping')
    return []
  }

  // Skip very short transcripts
  const wordCount = transcriptText.split(/\s+/).filter(w => w.length > 0).length
  if (wordCount < 100) {
    console.log('[Actionable Detection] Transcript too short (<100 words), skipping')
    return []
  }

  // Truncate very long transcripts to last 5000 words
  const words = transcriptText.split(/\s+/)
  const truncatedText = words.length > 5000 ? words.slice(-5000).join(' ') : transcriptText

  const prompt = `Analyze this meeting transcript and detect if the speaker intends to create any outputs or documents.

Transcript:
${truncatedText}

Meeting Title: ${metadata.title || 'Unknown'}
Questions: ${metadata.questions?.join(', ') || 'None'}

Detect if speaker mentions need to:
1. Send meeting minutes/notes
2. Write interview feedback/evaluation
3. Create status report/update
4. Document decisions
5. Share action items
6. Compile research/findings

For each detected intent, return:
- type: The type of actionable (meeting_minutes, interview_feedback, status_report, decision_log, action_items, research_summary)
- confidence: 0.0-1.0 (how confident you are)
- suggestedTitle: Brief title for the actionable (e.g., "Send meeting notes to team")
- reason: Why you detected this (quote from transcript)
- suggestedTemplate: Template name to use (e.g., "meeting_minutes", "interview_feedback")
- suggestedRecipients: Who should receive it (if mentioned)

Return as JSON array. If no actionables detected, return empty array [].
Only include detections with confidence >= 0.6.`

  try {
    const genAI = new GoogleGenerativeAI(config.transcription.geminiApiKey)
    const model = genAI.getGenerativeModel({ model: config.transcription.geminiModel || 'gemini-2.0-flash-exp' })

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    // Extract JSON from response (might be wrapped in markdown code blocks)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.log('[Actionable Detection] No JSON array found in response')
      return []
    }

    const detections = JSON.parse(jsonMatch[0]) as ActionableDetection[]

    // Filter out low-confidence detections
    const filtered = detections.filter(d => d.confidence >= 0.6)
    console.log(`[Actionable Detection] Detected ${filtered.length} actionables for ${knowledgeCaptureId}`)

    return filtered
  } catch (error) {
    console.error('[Actionable Detection] Failed:', error)
    return [] // Fail gracefully
  }
}

async function transcribeRecording(
  recordingId: string,
  progressCallback?: (stage: string, progress: number) => void
): Promise<void> {
  const recording = getRecordingById(recordingId)
  if (!recording || !recording.file_path) {
    throw new Error(`Recording not found or no local file: ${recordingId}`)
  }

  if (!existsSync(recording.file_path)) {
    throw new Error(`Recording file not found: ${recording.file_path}`)
  }

  const config = getConfig()
  if (!config.transcription.geminiApiKey) {
    throw new Error('Gemini API key not configured')
  }

  console.log(`Transcribing: ${recording.filename}`)
  // AI-13: Use standard enum values matching Recording.transcription_status
  updateRecordingTranscriptionStatus(recordingId, 'processing')

  progressCallback?.('reading_file', 5) // spec-014: progress reporting

  // Read the audio file asynchronously to avoid blocking the main process
  const audioBuffer = await readFileAsync(recording.file_path)
  const base64Audio = audioBuffer.toString('base64')

  // Determine MIME type
  const ext = extname(recording.file_path).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mp3',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.hda': 'audio/mp3' // HiDock H1E outputs MPEG MP3 format
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

  progressCallback?.('transcribing', 20) // spec-014: progress reporting

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

  progressCallback?.('analyzing', 50) // spec-014: progress reporting

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
5. A short, descriptive title for this recording (3-8 words that capture the essence)
6. 4-5 specific, context-aware questions that could be asked about this recording
   - Questions should be SPECIFIC to the content (e.g., "What was decided about the Q3 marketing budget?")
   - Avoid generic questions (e.g., "What was discussed?" or "Tell me more")
   - Questions should help users quickly understand key decisions, action items, and outcomes
${meetingSelectionSection}

Transcript:
${fullText}

Respond in JSON format:
{
  "summary": "...",
  "action_items": ["...", "..."],
  "topics": ["...", "..."],
  "key_points": ["...", "..."],
  "title_suggestion": "Brief Descriptive Title (3-8 words)",
  "question_suggestions": ["Specific question about decision 1?", "Specific question about action item 2?", "..."],
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
    title_suggestion?: string
    question_suggestions?: string[]
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
    transcription_model: config.transcription.geminiModel,
    title_suggestion: analysis.title_suggestion,
    question_suggestions: analysis.question_suggestions ? JSON.stringify(analysis.question_suggestions) : undefined
  }

  insertTranscript(transcript)
  // AI-13: Use standard enum value 'complete' (not 'transcribed')
  updateRecordingTranscriptionStatus(recordingId, 'complete')

  // Auto-update recording title if we have a title suggestion
  if (analysis.title_suggestion) {
    updateKnowledgeCaptureTitle(recordingId, analysis.title_suggestion)
  }

  progressCallback?.('detecting_actionables', 75) // spec-014: progress reporting

  // Detect actionables from transcript
  try {
    const knowledgeCapture = queryOne<{ id: string }>(
      'SELECT id FROM knowledge_captures WHERE source_recording_id = ?',
      [recordingId]
    )
    const sourceKnowledgeId = knowledgeCapture?.id || recordingId

    const detections = await detectActionables(fullText, sourceKnowledgeId, {
      title: analysis.title_suggestion,
      questions: analysis.question_suggestions
    })

    // Create actionable entries with TEXT IDs
    const VALID_TEMPLATE_IDS = ['meeting_minutes', 'interview_feedback', 'project_status', 'action_items']

    for (const detection of detections) {
      const actionableId = `act_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      // Sanitize template ID: fall back to 'meeting_minutes' if AI suggests an invalid one
      const sanitizedTemplate = detection.suggestedTemplate && VALID_TEMPLATE_IDS.includes(detection.suggestedTemplate)
        ? detection.suggestedTemplate
        : 'meeting_minutes'

      run(
        `INSERT INTO actionables (
          id, source_knowledge_id, type, title, description, status,
          confidence, suggested_template, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          actionableId,
          sourceKnowledgeId, // source_knowledge_id references knowledge_captures.id
          detection.type,
          detection.suggestedTitle,
          detection.reason,
          'pending',
          detection.confidence,
          sanitizedTemplate,
          new Date().toISOString()
        ]
      )
    }

    if (detections.length > 0) {
      console.log(`[Actionable Detection] Created ${detections.length} actionables for ${recordingId}`)
    }
  } catch (error) {
    console.error('[Actionable Detection] Failed to create actionables:', error)
    // Don't fail the transcription if actionable detection fails
  }

  progressCallback?.('indexing', 85) // spec-014: progress reporting

  // Index transcript into vector store for RAG
  try {
    const vectorStore = getVectorStore()
    // Use the AI-linked meeting ID if available, otherwise fall back to the original
    const meetingId = analysis.selected_meeting_id || recording.meeting_id
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

  progressCallback?.('complete', 100) // spec-014: progress reporting
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
