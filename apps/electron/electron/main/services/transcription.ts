import { GeminiEngine } from '@hidock/transcription'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFile, existsSync } from 'fs'
import { promisify } from 'util'
import { spawn } from 'child_process'
import { join, isAbsolute } from 'path'

const readFileAsync = promisify(readFile)

/**
 * Spawn a long-running CLI and stream its stderr to the parent's console as
 * lines arrive (so the user sees progress live) while collecting stdout into
 * a buffer for the caller. Used for the VibeVoice/local-asr backends, where
 * the Python CLI logs model load, chunk progress, and generation status to
 * stderr over minutes — execFileBuffered would hide all of that until exit.
 *
 * The optional onStderrLine callback lets callers translate recognised log
 * lines into progress events (e.g. "Chunk 2/3" -> setProgress).
 */
function spawnStreaming(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    maxStdoutBytes?: number
    logPrefix?: string
    onStderrLine?: (line: string) => void
  } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const prefix = options.logPrefix ?? `[${command}]`
    const cap = options.maxStdoutBytes ?? 50 * 1024 * 1024

    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBuf = ''
    const stderrLines: string[] = []

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes <= cap) stdoutChunks.push(chunk)
    })

    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk
      // Emit every complete line live so the user sees progress.
      let nl: number
      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, nl).replace(/\r$/, '')
        stderrBuf = stderrBuf.slice(nl + 1)
        if (line) {
          console.log(`${prefix} ${line}`)
          stderrLines.push(line)
          try { options.onStderrLine?.(line) } catch { /* ignore callback errors */ }
        }
      }
    })

    child.on('error', (err) => reject(new Error(`Failed to spawn ${command}: ${err.message}`)))

    child.on('close', (code) => {
      // Flush any trailing stderr without newline.
      if (stderrBuf) {
        console.log(`${prefix} ${stderrBuf}`)
        stderrLines.push(stderrBuf)
        stderrBuf = ''
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      const stderr = stderrLines.join('\n')
      if (code !== 0) {
        const tail = stderr.split('\n').slice(-30).join('\n')
        reject(new Error(`${command} exited with code ${code}\n${tail}`))
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}
import { getConfig } from './config'
import {
  addToQueue,
  getRecordingById,
  resolveRecordingId,
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
  runInTransaction,
  saveDatabase,
  queryOne,
  queryAll,
  acquireTranscriptionLock,
  releaseTranscriptionLock,
  clearStaleTranscriptionLock,
  resetStuckTranscriptions,
  type Transcript
} from './database'
import { BrowserWindow } from 'electron'
import { getVectorStore } from './vector-store'

let mainWindow: BrowserWindow | null = null
let isProcessing = false
let processingInterval: ReturnType<typeof setInterval> | null = null
let lastSkipLogAt = 0 // Throttle "skipping" spam to once per 60s

export function setMainWindowForTranscription(win: BrowserWindow): void {
  mainWindow = win
}

export function startTranscriptionProcessor(): void {
  if (processingInterval) {
    console.log('Transcription processor already running')
    return
  }

  clearStaleTranscriptionLock()
  resetStuckTranscriptions()

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

/**
 * Recency-first transcription ordering.
 *
 * Recording ids the user *explicitly* asked to transcribe — a single
 * "Transcribe" click, a VibeVoice reprocess, or a manual retry — are held here
 * so they jump ahead of the whole date-ordered backlog (rule 1), FIFO among
 * themselves. Auto-transcribe and bulk enqueues are NOT marked, so they fall
 * under the recording-date ordering (rule 2) instead.
 *
 * In-memory (never persisted) by design: a restart drops the "the user wanted
 * this one first" hint, after which the queue is ordered purely by recency,
 * which is the correct fallback. Keyed by recording_id (not queue-row id) so it
 * survives a queue row being deleted and re-added on retry.
 */
const userPriorityIds = new Set<string>()

export function markUserPriority(recordingId: string): void {
  userPriorityIds.add(recordingId)
}

export function clearUserPriority(recordingId: string): void {
  userPriorityIds.delete(recordingId)
}

type OrderableQueueItem = {
  recording_id: string
  created_at: string
  date_recorded?: string | null
}

/**
 * Order pending queue items for processing (recency-first). Pure + deterministic
 * so the picker can re-run it on every dequeue:
 *
 *   1. User-explicit requests first, FIFO among themselves (queue created_at ASC).
 *   2. Everything else by the recording's content date (date_recorded) DESC, so
 *      yesterday's meeting beats last month's regardless of when it was enqueued.
 *      Tiebreak: queue created_at ASC. Undated recordings sort last.
 *
 * Because it re-runs per dequeue, an item enqueued later with a newer
 * date_recorded (e.g. a recording detected mid-backlog) preempts older waiting
 * items automatically.
 */
export function orderPendingForProcessing<T extends OrderableQueueItem>(items: T[]): T[] {
  const cmpCreatedAsc = (a: T, b: T) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)
  // NULL/empty date → '' → smallest → sorts last under DESC.
  const dateVal = (v?: string | null) => v ?? ''
  return [...items].sort((a, b) => {
    const aPri = userPriorityIds.has(a.recording_id) ? 0 : 1
    const bPri = userPriorityIds.has(b.recording_id) ? 0 : 1
    if (aPri !== bPri) return aPri - bPri
    if (aPri === 0) return cmpCreatedAsc(a, b) // both user-explicit → FIFO
    const da = dateVal(a.date_recorded)
    const db = dateVal(b.date_recorded)
    if (da !== db) return da < db ? 1 : -1 // date_recorded DESC
    return cmpCreatedAsc(a, b)
  })
}

export function cancelTranscription(recordingId: string): void {
  removeFromQueueByRecordingId(recordingId)
  clearUserPriority(recordingId)
  updateRecordingTranscriptionStatus(recordingId, 'none')
  notifyRenderer('transcription:cancelled', { recordingId })
}

export function cancelAllTranscriptions(): number {
  cancelRequested = true
  const count = cancelPendingTranscriptions()
  userPriorityIds.clear()
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
  const processId = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const lockAcquired = acquireTranscriptionLock(processId)
  if (!lockAcquired) {
    // Throttle to once per 60s — this fires every 10s during active transcription, which is expected
    const now = Date.now()
    if (now - lastSkipLogAt > 60000) {
      console.log('[Transcription] Another process is already processing the queue, skipping')
      lastSkipLogAt = now
    }
    return
  }

  try {
    const config = getConfig()
    const provider = config.transcription.provider || 'gemini'
    if (provider === 'gemini' && !config.transcription.geminiApiKey) {
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

      return
    } else if (provider === 'local-asr' || provider === 'vibevoice') {
      const asrPath = config.transcription.localAsrPath
      const runnerPath = asrPath ? join(asrPath, 'mcp_runner.py') : ''
      if (!asrPath || !existsSync(runnerPath)) {
        const error = `Local ASR runner not found: ${runnerPath || 'not configured'}`
        console.error(`[Transcription] Cannot process queue: ${error}`)

        const pendingItems = getQueueItems('pending')
        const processingItems = getQueueItems('processing')
        for (const item of [...pendingItems, ...processingItems]) {
          updateQueueItem(item.id, 'failed', error)
          updateRecordingTranscriptionStatus(item.recording_id, 'error')
          notifyRenderer('transcription:failed', {
            queueItemId: item.id,
            recordingId: item.recording_id,
            error
          })
        }

        return
      }
    }
    // spec-014: Retry failed items with max attempts
    // B-TXN-001: Exponential backoff before retrying failed items
    // C-005: Skip non-retryable errors (missing files, missing API key)
    const NON_RETRYABLE_ERRORS = [
      'Recording not found',
      'Recording file not found',
      'Gemini API key not configured',
      'Local ASR runner not found',
      'no local file',
      // Deterministic input-side failures — retrying loads the model again for nothing.
      'Audio too long',
      'No speech detected',
      'AudioLoadError',
      'unsupported language',
      'VibeVoice returned an empty transcript',
      'requires the optional `vibevoice`'
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
        // SQLite CURRENT_TIMESTAMP writes UTC without a `Z` suffix; appending Z
        // forces JS to parse it as UTC instead of local time (which previously
        // produced negative timeSinceFailure and multi-hour fake backoffs).
        const completedAt = item.completed_at
          ? new Date(item.completed_at.endsWith('Z') ? item.completed_at : item.completed_at.replace(' ', 'T') + 'Z').getTime()
          : 0
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

    if (getQueueItems('pending').length === 0) {
      return
    }

    isProcessing = true

    // Re-pick the highest-priority pending item on every iteration (rather than
    // iterating a one-time snapshot) so ordering applies per dequeue: an item
    // enqueued mid-drain with a newer date_recorded — or a user-explicit
    // request — preempts older items still waiting. `processedThisRun` guarantees
    // termination: each queue row is handled at most once per run even if its
    // status write doesn't remove it from the pending set (mocked DB in tests, or
    // a failed write in prod), while a newly-enqueued row (new id) is still
    // eligible to preempt.
    const processedThisRun = new Set<string>()
    while (!cancelRequested) {
      const item = orderPendingForProcessing(getQueueItems('pending')).find(
        (i) => !processedThisRun.has(i.id)
      )
      if (!item) break
      processedThisRun.add(item.id)

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
          await transcribeRecording(item.recording_id, progressCallback, item.provider)
        } finally {
          clearInterval(progressTicker) // Always clean up the ticker
        }

        updateQueueProgress(item.id, 100) // spec-014: mark complete
        updateQueueItem(item.id, 'completed')
        clearUserPriority(item.recording_id) // request satisfied — drop priority hint
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
        // Drop the priority hint: a subsequent auto-retry is background work and
        // should sort by recency. An explicit user retry re-marks it (see the
        // transcription:retry IPC handler).
        clearUserPriority(item.recording_id)
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

    if (cancelRequested) {
      console.log('Transcription cancelled by user')
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

/**
 * Single funnel for "queue this recording for transcription if the user has
 * auto-transcribe enabled". Consolidates the previously duplicated gate from
 * download-service, recording-watcher, and storage:save-recording (ADR-0005
 * category A). Returns true if the recording was queued, false otherwise.
 */
export function queueTranscriptionIfEnabled(recordingId: string): boolean {
  if (getConfig().transcription.autoTranscribe !== true) return false
  addToQueue(recordingId)
  processQueueManually()
  return true
}

interface ActionableDetection {
  type: 'meeting_minutes' | 'interview_feedback' | 'status_report' |
        'decision_log' | 'action_items' | 'research_summary' | 'follow_up_work'
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
7. Do follow-up work after the call (e.g. draft a solution design document after a
   sales-to-delivery handoff, kick off or scaffold a project after a kickoff,
   implement changes discussed in an engineering session, remediate blockers from
   a status call). If the call is a working/business meeting with concrete next
   steps, ALWAYS include one follow_up_work detection with template
   "claude_code_prompt" so the user can hand the work to an AI coding agent.

For each detected intent, return:
- type: The type of actionable (meeting_minutes, interview_feedback, status_report, decision_log, action_items, research_summary, follow_up_work)
- confidence: 0.0-1.0 (how confident you are)
- suggestedTitle: Brief title for the actionable (e.g., "Send meeting notes to team", "Draft SDD for Acme migration")
- reason: Why you detected this (quote from transcript)
- suggestedTemplate: Template name to use ("meeting_minutes", "interview_feedback", "project_status", "action_items", "claude_code_prompt")
- suggestedRecipients: Who should receive it (if mentioned)

Return as JSON array. If no actionables detected, return empty array [].
Only include detections with confidence >= 0.6.`

  try {
    const genAI = new GoogleGenerativeAI(config.transcription.geminiApiKey)
    const model = genAI.getGenerativeModel({ model: config.transcription.geminiModel || 'gemini-3.5-flash' })

    // JSON-forced + no thinking, same hardening as the analysis call
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }
      } as never
    })
    const responseText = result.response.text()

    // Extract JSON from response (might be wrapped in markdown code blocks)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.log('[Actionable Detection] No JSON array found in response')
      return []
    }

    // Repair the same unescaped-inner-quote / raw-control-char malformations
    // Gemini emits here as in the analysis path (this is where the live
    // "Expected ',' or '}' after property value at position 1309" was seen).
    const detections = tryParseJson<ActionableDetection[]>(jsonMatch[0])
    if (!detections) {
      console.warn(`[Actionable Detection] Unparseable JSON: ${describeJsonParseError(responseText)}`)
      return []
    }

    // Filter out low-confidence detections
    const filtered = detections.filter(d => d.confidence >= 0.6)
    console.log(`[Actionable Detection] Detected ${filtered.length} actionables for ${knowledgeCaptureId}`)

    return filtered
  } catch (error) {
    console.error('[Actionable Detection] Failed:', error)
    return [] // Fail gracefully
  }
}

interface LocalAsrSegment {
  speaker?: string
  start?: number
  end?: number
  text: string
}

interface RawTranscriptionResult {
  fullText: string
  provider: 'gemini' | 'local-asr' | 'vibevoice'
  model: string
  language: string
  speakers?: string
}

interface TranscriptAnalysis {
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
  /** People speaking or mentioned in the call (the ICS feed carries no attendees). */
  participants?: Array<{ name: string; role?: string }>
  /** Project this meeting belongs to — matched against existing projects or proposed new. */
  project?: { name: string; is_new?: boolean }
}

async function transcribeWithGemini(
  filePath: string,
  meetingContext: string,
  progressCallback?: (stage: string, progress: number) => void
): Promise<RawTranscriptionResult> {
  const config = getConfig()
  if (!config.transcription.geminiApiKey) {
    throw new Error('Gemini API key not configured')
  }

  progressCallback?.('reading_file', 5)
  const audioBuffer = await readFileAsync(filePath)

  const modelName = config.transcription.geminiModel || 'gemini-3.5-flash'
  const engine = new GeminiEngine({
    apiKey: config.transcription.geminiApiKey,
    model: modelName,
    language: config.transcription.language || 'unknown'
  })

  progressCallback?.('transcribing', 20)

  // Collect the speaker-turn segments yielded by GeminiEngine. Each segment is
  // one turn with an absolute timestamp and (usually) a "Speaker N" label.
  // We pass filePath via the extended options so the engine can detect the MIME
  // type, and meetingContext via options.context for prompt enrichment.
  const segments: Array<{ speaker: string; start: number; end: number; text: string }> = []
  for await (const segment of engine.transcribe(audioBuffer, {
    source: 'mic',
    language: config.transcription.language,
    context: meetingContext || undefined,
    // GeminiEngine reads filePath from options for MIME type detection
    filePath,
    // Real per-chunk progress (long recordings are transcribed in ~10-minute
    // segments) — replaces the fake ticker that sat at 90% for minutes.
    onProgress: (done: number, total: number) => {
      progressCallback?.('transcribing', Math.min(45, 20 + Math.round((done / total) * 25)))
    }
  } as Parameters<typeof engine.transcribe>[1] & { filePath: string })) {
    const text = segment.text?.trim()
    if (text) {
      segments.push({
        speaker: segment.speaker,
        start: segment.startTime,
        end: segment.endTime,
        text
      })
    }
  }

  // An empty transcript is a failure, not a success — persisting it would mark
  // the recording 'complete' with no usable content and block re-transcription.
  if (segments.length === 0) {
    throw new Error('Gemini returned an empty transcript')
  }

  // Each turn's end is the next turn's start (the engine yields start-only).
  for (let i = 0; i < segments.length; i++) {
    segments[i].end = segments[i + 1]?.start ?? segments[i].start
  }

  // full_text stays plain (no timestamps) for search / analysis / embeddings —
  // one readable turn per line with its speaker label. The timestamped segment
  // structure is stored separately in `speakers` for the transcript viewer.
  const fullText = segments.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join('\n')

  return {
    fullText,
    provider: 'gemini',
    model: modelName,
    language: config.transcription.language || 'unknown',
    speakers: JSON.stringify(segments)
  }
}

function pythonCommand(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function transcribeWithLocalAsr(
  filePath: string,
  progressCallback?: (stage: string, progress: number) => void
): Promise<RawTranscriptionResult> {
  const config = getConfig()
  const asrPath = config.transcription.localAsrPath || process.env.ASR_MCP_PATH
  if (!asrPath) {
    throw new Error('Local ASR path not configured')
  }

  const runnerPath = join(asrPath, 'mcp_runner.py')
  if (!existsSync(runnerPath)) {
    throw new Error(`Local ASR runner not found: ${runnerPath}`)
  }

  const language = (config.transcription.language || 'es').slice(0, 2).toLowerCase()
  const vocabularyPath = config.transcription.localAsrVocabularyFile
    ? (isAbsolute(config.transcription.localAsrVocabularyFile)
        ? config.transcription.localAsrVocabularyFile
        : join(asrPath, config.transcription.localAsrVocabularyFile))
    : ''

  const args = [
    runnerPath,
    'asr_mcp.cli',
    filePath,
    '--language',
    language,
    '--format',
    'json',
    '--num-beams',
    String(config.transcription.localAsrNumBeams || 5)
  ]

  if (config.transcription.localAsrDiarize !== false) {
    args.push('--diarize')
  }

  if (vocabularyPath && existsSync(vocabularyPath)) {
    args.push('--vocabulary', vocabularyPath)
  }

  progressCallback?.('local_asr_starting', 5)
  const { stdout } = await spawnStreaming(pythonCommand(), args, {
    cwd: asrPath,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      HF_TOKEN: config.transcription.localAsrHfToken || process.env.HF_TOKEN || '',
      ASR_VOCABULARY_FILE: vocabularyPath || process.env.ASR_VOCABULARY_FILE || ''
    },
    logPrefix: '[Local ASR]',
    onStderrLine: (line) => {
      if (line.includes('Model loaded')) progressCallback?.('local_asr_model_loaded', 20)
      else if (line.includes('Diarization:')) progressCallback?.('local_asr_diarized', 40)
      else if (line.match(/Transcribed (\d+)\/(\d+)/)) {
        const m = line.match(/Transcribed (\d+)\/(\d+)/)!
        const pct = Math.min(85, Math.round(40 + (parseInt(m[1], 10) / parseInt(m[2], 10)) * 45))
        progressCallback?.('local_asr_segments', pct)
      } else if (line.includes('Pipeline complete')) progressCallback?.('local_asr_done', 95)
    }
  })

  let parsed: {
    text?: string
    language?: string
    segments?: LocalAsrSegment[]
    error?: boolean
    message?: string
  }
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`Local ASR returned invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`)
  }

  if (parsed.error) {
    throw new Error(parsed.message || 'Local ASR transcription failed')
  }

  const segments = Array.isArray(parsed.segments) ? parsed.segments : []
  const fullText = segments.length > 0
    ? segments
        .filter((segment) => segment.text?.trim())
        .map((segment) => {
          const speaker = segment.speaker || 'Speaker'
          return `${speaker}: ${segment.text.trim()}`
        })
        .join('\n')
    : (parsed.text || '').trim()

  if (!fullText) {
    throw new Error('Local ASR returned an empty transcript')
  }

  return {
    fullText,
    provider: 'local-asr',
    model: 'CohereLabs/cohere-transcribe-03-2026',
    language: parsed.language || language,
    speakers: segments.length > 0 ? JSON.stringify(segments) : undefined
  }
}

async function transcribeWithVibeVoice(
  filePath: string,
  progressCallback?: (stage: string, progress: number) => void
): Promise<RawTranscriptionResult> {
  const config = getConfig()
  const asrPath = config.transcription.localAsrPath || process.env.ASR_MCP_PATH
  if (!asrPath) {
    throw new Error('Local ASR path not configured')
  }

  const runnerPath = join(asrPath, 'mcp_runner.py')
  if (!existsSync(runnerPath)) {
    throw new Error(`Local ASR runner not found: ${runnerPath}`)
  }

  // VibeVoice auto-detects language and code-switches; "auto" unless overridden.
  const language = (config.transcription.language || 'auto').toLowerCase()
  const vocabularyPath = config.transcription.localAsrVocabularyFile
    ? (isAbsolute(config.transcription.localAsrVocabularyFile)
        ? config.transcription.localAsrVocabularyFile
        : join(asrPath, config.transcription.localAsrVocabularyFile))
    : ''

  const args = [
    runnerPath,
    'asr_mcp.cli',
    filePath,
    '--backend',
    'vibevoice',
    '--language',
    language,
    '--format',
    'json'
  ]

  if (vocabularyPath && existsSync(vocabularyPath)) {
    args.push('--vocabulary', vocabularyPath)
  }

  progressCallback?.('vibevoice_starting', 5)
  const { stdout } = await spawnStreaming(pythonCommand(), args, {
    cwd: asrPath,
    env: {
      ...process.env,
      // Force the child Python (and the Python subprocess mcp_runner.py
      // spawns under .venv) to flush stdout/stderr immediately so the
      // per-token streamer heartbeat actually reaches us.
      PYTHONUNBUFFERED: '1',
      ASR_BACKEND: 'vibevoice',
      HF_TOKEN: config.transcription.localAsrHfToken || process.env.HF_TOKEN || '',
      ASR_VOCABULARY_FILE: vocabularyPath || process.env.ASR_VOCABULARY_FILE || '',
      VIBEVOICE_MODEL_ID: config.transcription.vibevoiceModelId || process.env.VIBEVOICE_MODEL_ID || 'microsoft/VibeVoice-ASR',
      ASR_DEVICE: config.transcription.vibevoiceDevice || process.env.ASR_DEVICE || 'cuda:0',
      VIBEVOICE_ATTN: config.transcription.vibevoiceAttn || process.env.VIBEVOICE_ATTN || 'sdpa'
    },
    logPrefix: '[VibeVoice]',
    onStderrLine: (line) => {
      // Map known log lines from vibevoice_model.py to UI progress events.
      if (line.includes('VibeVoice loaded')) {
        progressCallback?.('vibevoice_model_loaded', 15)
      } else if (line.includes('Long-form:')) {
        progressCallback?.('vibevoice_chunking', 18)
      } else {
        const chunkMatch = line.match(/Chunk (\d+)\/(\d+):/)
        if (chunkMatch) {
          const i = parseInt(chunkMatch[1], 10)
          const n = parseInt(chunkMatch[2], 10)
          // 20% .. 80% allocated to chunks
          const pct = Math.min(80, Math.round(20 + ((i - 1) / n) * 60))
          progressCallback?.(`vibevoice_chunk_${i}_of_${n}`, pct)
        } else if (line.includes('VibeVoice generated')) {
          progressCallback?.('vibevoice_parsing', 85)
        } else if (line.includes('VibeVoice complete')) {
          progressCallback?.('vibevoice_done', 95)
        }
      }
    }
  })

  let parsed: {
    text?: string
    language?: string
    segments?: LocalAsrSegment[]
    error?: boolean
    message?: string
  }
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`VibeVoice returned invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`)
  }

  if (parsed.error) {
    throw new Error(parsed.message || 'VibeVoice transcription failed')
  }

  const segments = Array.isArray(parsed.segments) ? parsed.segments : []
  const fullText = segments.length > 0
    ? segments
        .filter((segment) => segment.text?.trim())
        .map((segment) => {
          const speaker = segment.speaker || 'Speaker'
          return `${speaker}: ${segment.text.trim()}`
        })
        .join('\n')
    : (parsed.text || '').trim()

  if (!fullText) {
    throw new Error('VibeVoice returned an empty transcript')
  }

  return {
    fullText,
    provider: 'vibevoice',
    model: 'microsoft/VibeVoice-ASR',
    language: parsed.language || language,
    speakers: segments.length > 0 ? JSON.stringify(segments) : undefined
  }
}

async function analyzeTranscriptWithGemini(
  fullText: string,
  candidateMeetings: ReturnType<typeof findCandidateMeetingsForRecording>
): Promise<TranscriptAnalysis> {
  const config = getConfig()
  if (!config.transcription.geminiApiKey) {
    return {
      summary: 'Local ASR transcript created. Configure Gemini to generate AI summary, action items, and meeting matching.',
      action_items: [],
      topics: [],
      key_points: [],
      language: config.transcription.language || 'unknown'
    }
  }

  const genAI = new GoogleGenerativeAI(config.transcription.geminiApiKey)
  const model = genAI.getGenerativeModel({ model: config.transcription.geminiModel || 'gemini-3.5-flash' })

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
   "selection_reason": "why you selected the meeting"`
  } else if (candidateMeetings.length === 1) {
    meetingSelectionSection = `
5. Meeting Selection: There is one candidate meeting near this recording's time:
   1. "${candidateMeetings[0].subject}" (ID: ${candidateMeetings[0].id})

   Determine if this recording actually belongs to this meeting based on topics, people, and context.
   If the content does NOT match the meeting subject, set meeting_confidence to 0.0 and selected_meeting_id to "none".

   "selected_meeting_id": "the meeting ID if it matches, or \\"none\\" if it doesn't",
   "meeting_confidence": 0.0 to 1.0,
   "selection_reason": "why you selected or rejected this meeting"`
  }

  // Existing projects so the model links to them instead of inventing variants
  const existingProjects = queryAll<{ name: string }>(
    `SELECT name FROM projects WHERE status = 'active' ORDER BY name LIMIT 50`
  ).map((p) => p.name)

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
7. Participants: people speaking or clearly mentioned as involved (first names are fine).
   For each: name, and role if inferable (e.g. "telecom specialist", "PM", "client").
   Do NOT invent people; only include names actually appearing in the conversation.
8. Project: which project/initiative this meeting belongs to.
   ${existingProjects.length > 0 ? `Existing projects (match one of these EXACTLY if it fits): ${existingProjects.join(' | ')}` : 'No projects exist yet.'}
   If none fits, propose a short new project name (2-5 words, e.g. "DFX5 Gateway" or client name) and set is_new true.
   If the call is personal or clearly not project work, omit the project field.

IMPORTANT: Respond in the SAME LANGUAGE as the transcript. If the transcript is in Spanish, write the summary, action items, topics, key points, title, and questions in Spanish. If English, respond in English.
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
  "language": "es" or "en",
  "participants": [{"name": "...", "role": "..."}],
  "project": {"name": "...", "is_new": false}${candidateMeetings.length > 0 ? `,
  "selected_meeting_id": "...",
  "meeting_confidence": 0.0,
  "selection_reason": "..."` : ''}
}`

  // Two-attempt strategy. Attempt 1 forces JSON output and disables thinking:
  // the thinking model intermittently burns its output budget on reasoning and
  // returns junk (observed: analysis titled "Transcripción no proporcionada"
  // for a complete 7.5k-word transcript). Attempt 2 (only if the first yields
  // unparseable output — seen on large real transcripts where responseMime="json"
  // silently produces an empty/truncated body) drops responseMimeType and parses
  // a fenced or brace-matched block from plain text.
  const attempts: Array<{ label: string; generationConfig: Record<string, unknown> }> = [
    {
      label: 'json-mime',
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }
      }
    },
    {
      label: 'plain-text-fallback',
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 }
      }
    }
  ]

  for (const attempt of attempts) {
    try {
      const analysisResult = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: analysisPrompt }] }],
        generationConfig: attempt.generationConfig as never
      })
      const response = analysisResult.response
      let analysisText = ''
      try {
        analysisText = response.text()
      } catch {
        // .text() throws when the candidate carries no text part (e.g. blocked
        // or MAX_TOKENS with no content) — treat as empty and log diagnostics.
        analysisText = ''
      }

      const parsed = extractAnalysisJson(analysisText)
      if (parsed) return parsed

      // Parse miss — surface why so the failure isn't invisible.
      logAnalysisFailure(attempt.label, response, analysisText)
    } catch (e) {
      console.warn(`[Analysis] Gemini call failed (${attempt.label}):`, e instanceof Error ? e.message : e)
    }
  }

  return { summary: 'Analysis failed', language: 'unknown' }
}

/**
 * Repair the two malformations Gemini's JSON-mode reliably produces on real
 * (especially Spanish) transcripts, neither of which it escapes: unescaped
 * inner double-quotes inside string values (e.g. `dijo "no" y ...`) and raw
 * control characters (newline/tab) inside string values. Also strips trailing
 * commas. Single left-to-right scan tracking string context.
 *
 * Inner-quote heuristic: a `"` seen inside a string is treated as the string's
 * closing quote only when the next non-whitespace char is structural
 * (`, } ] :` or end-of-input); otherwise it is an unescaped inner quote and
 * gets escaped. This is the documented signature of the failures observed live
 * (`SyntaxError: Expected ',' or '}' after property value`).
 *
 * Bracket balancing (last pass): the scan tracks the open `{`/`[` stack. A closer
 * is emitted as the one its opener actually requires, correcting a mismatch such
 * as a top-level array closed with `}` instead of `]` (the live position-699
 * failure); a stray closer with nothing open is dropped; and at end-of-input any
 * still-open brackets are appended in innermost-first order (with a dangling
 * trailing comma stripped first). Once the root value closes, anything after it
 * is discarded — an extra trailing `}`/`]` or text-after-JSON garbage (the live
 * "Unexpected non-whitespace character after JSON" failure). Balanced JSON is
 * left untouched.
 */
export function repairJsonString(input: string): string {
  let out = ''
  let inString = false
  // Expected closer for each still-open `{`/`[`, innermost last.
  const stack: string[] = []
  // Set once the outermost bracket closes; everything after the root value is
  // trailing garbage (stray closer, second object, prose) and is dropped.
  let rootClosed = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    // Ignore anything after the root value has fully closed.
    if (rootClosed) continue

    if (!inString) {
      if (ch === '"') {
        inString = true
        out += ch
        continue
      }
      if (ch === '{' || ch === '[') {
        stack.push(ch === '{' ? '}' : ']')
        out += ch
        continue
      }
      if (ch === '}' || ch === ']') {
        // Drop a stray closer that matches nothing that is open.
        if (stack.length === 0) continue
        // Emit the closer the opener requires (corrects `}`/`]` mismatches).
        out += stack.pop()
        // Root just closed — discard whatever follows.
        if (stack.length === 0) rootClosed = true
        continue
      }
      if (ch === ',') {
        // Drop a trailing comma: `,` followed only by whitespace then `}`/`]`
        // or end-of-input (a closer may still be appended by the EOF balancing).
        let j = i + 1
        while (j < input.length && /\s/.test(input[j])) j++
        if (j >= input.length || input[j] === '}' || input[j] === ']') continue
      }
      out += ch
      continue
    }

    // Inside a string.
    if (ch === '\\') {
      // Preserve an existing escape sequence verbatim (this char + the next).
      out += ch
      if (i + 1 < input.length) {
        out += input[i + 1]
        i++
      }
      continue
    }

    if (ch === '"') {
      // Closing quote only if the next non-whitespace char is structural.
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j++
      const next = input[j]
      if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
        inString = false
        out += ch
      } else {
        out += '\\"'
      }
      continue
    }

    const code = ch.charCodeAt(0)
    if (code < 0x20) {
      // Raw control character inside a string — escape it.
      if (ch === '\n') out += '\\n'
      else if (ch === '\r') out += '\\r'
      else if (ch === '\t') out += '\\t'
      else out += '\\u' + code.toString(16).padStart(4, '0')
      continue
    }

    out += ch
  }

  // EOF balancing: close an unterminated string, drop a dangling trailing comma,
  // then append any brackets left open (innermost first).
  if (inString) out += '"'
  if (stack.length > 0) {
    out = out.replace(/[\s,]+$/, '')
    while (stack.length > 0) out += stack.pop()
  }
  return out
}

/**
 * Parse a JSON candidate, retrying once through repairJsonString() when the
 * strict parse fails. Shared by the analysis and actionable-detection paths so
 * both benefit from the same Gemini-quirk repair. Returns null only when even
 * the repaired text is unparseable.
 */
function tryParseJson<T>(candidate: string): T | null {
  try {
    return JSON.parse(candidate) as T
  } catch {
    try {
      return JSON.parse(repairJsonString(candidate)) as T
    } catch {
      return null
    }
  }
}

/**
 * Extract the analysis object from a Gemini response body. Tolerates a
 * ```json fenced block, any fenced block, or a bare brace-matched object
 * (the plain-text fallback and the JSON-mime path both flow through here),
 * and repairs the unescaped-inner-quote / raw-control-char malformations
 * Gemini's JSON mode emits on real transcripts.
 */
export function extractAnalysisJson(text: string): TranscriptAnalysis | null {
  if (!text) return null
  const fencedInner = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidates = [
    fencedInner,
    fencedInner?.match(/\{[\s\S]*\}/)?.[0],
    text.match(/\{[\s\S]*\}/)?.[0]
  ].filter((c): c is string => Boolean(c))
  for (const candidate of candidates) {
    const parsed = tryParseJson<TranscriptAnalysis>(candidate)
    if (parsed) return parsed
  }
  return null
}

/**
 * Build a one-line diagnostic for an unparseable analysis payload: the strict
 * JSON.parse error and the ±120 chars around the position it reports, so any
 * future failure is debuggable from a single log line. Uses the same candidate
 * extraction as extractAnalysisJson so the reported position lines up.
 */
function describeJsonParseError(text: string): string {
  if (!text) return 'empty response body'
  const fencedInner = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  // Widest brace/bracket span, so object ({…}) and array ([…]) payloads both line up.
  const braceMatch = (s: string) => s.match(/[[{][\s\S]*[}\]]/)?.[0]
  const candidate =
    (fencedInner && braceMatch(fencedInner)) ??
    fencedInner ??
    braceMatch(text) ??
    text
  try {
    JSON.parse(candidate)
    return 'candidate parsed cleanly on retry (transient?)'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const pos = Number(msg.match(/position (\d+)/)?.[1])
    if (Number.isFinite(pos)) {
      const start = Math.max(0, pos - 120)
      const end = Math.min(candidate.length, pos + 120)
      return `${msg} | context[${start}:${end}]=${JSON.stringify(candidate.slice(start, end))}`
    }
    return msg
  }
}

/**
 * Log the diagnostics that make an otherwise-silent analysis failure
 * debuggable: the model's finishReason, token usage, and the head of the
 * response body (the three things missing when a real transcript produced
 * `{ summary: 'Analysis failed' }`).
 */
function logAnalysisFailure(label: string, response: unknown, text: string): void {
  const r = response as {
    candidates?: Array<{ finishReason?: string }>
    usageMetadata?: unknown
  }
  const finishReason = r?.candidates?.[0]?.finishReason ?? 'unknown'
  const usage = r?.usageMetadata ? JSON.stringify(r.usageMetadata) : 'n/a'
  console.warn(
    `[Analysis] Failed to parse Gemini analysis (${label}): finishReason=${finishReason}, ` +
    `usage=${usage}, parseError=${describeJsonParseError(text)}, ` +
    `text[0:300]=${JSON.stringify((text || '').slice(0, 300))}`
  )
}

/**
 * Self-healing backfill: find transcripts whose analysis never completed — the
 * 'Analysis failed' sentinel, or a NULL summary/title from an older build — and
 * re-run the Gemini analysis on the stored full_text. Analysis normally runs
 * only once, at transcription time, so without this a transient Gemini failure
 * leaves a transcript with junk analysis (filename-slug wiki titles, skipped
 * actionables) forever. Bounded to `limit` rows per run to keep API cost
 * predictable. Returns the number of transcripts actually healed.
 */
export async function reanalyzeFailedTranscripts(limit = 3): Promise<number> {
  const config = getConfig()
  if (!config.transcription.geminiApiKey) {
    // No Gemini key → re-analysis can't produce anything better; skip rather
    // than churn the same rows every run.
    return 0
  }

  const rows = queryAll<{ recording_id: string; full_text: string }>(
    `SELECT recording_id, full_text FROM transcripts
     WHERE (summary IS NULL OR summary = 'Analysis failed' OR title_suggestion IS NULL)
       AND full_text IS NOT NULL AND TRIM(full_text) != ''
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  )
  if (rows.length === 0) return 0

  console.log(`[Reanalyze] Re-running analysis for ${rows.length} transcript(s) with failed/missing analysis`)

  let healed = 0
  for (const row of rows) {
    try {
      // Re-run with no candidate meetings — backfill only heals the analysis
      // fields; meeting matching already ran (or will re-run) elsewhere.
      const analysis = await analyzeTranscriptWithGemini(row.full_text, [])

      // Still failing — don't overwrite with the sentinel again.
      if (!analysis.summary || analysis.summary === 'Analysis failed') {
        console.warn(`[Reanalyze] Analysis still failing for ${row.recording_id}, leaving row as-is`)
        continue
      }

      // Batch this transcript's field updates into a single transaction
      // (sql.js discipline — never loop bare run() for multiple writes).
      runInTransaction(() => {
        run(
          `UPDATE transcripts SET
             summary = ?, action_items = ?, topics = ?, key_points = ?,
             title_suggestion = ?, question_suggestions = ?, language = ?
           WHERE recording_id = ?`,
          [
            analysis.summary ?? null,
            analysis.action_items ? JSON.stringify(analysis.action_items) : null,
            analysis.topics ? JSON.stringify(analysis.topics) : null,
            analysis.key_points ? JSON.stringify(analysis.key_points) : null,
            analysis.title_suggestion ?? null,
            analysis.question_suggestions ? JSON.stringify(analysis.question_suggestions) : null,
            analysis.language ?? 'unknown',
            row.recording_id
          ]
        )
      })

      if (analysis.title_suggestion) {
        updateKnowledgeCaptureTitle(row.recording_id, analysis.title_suggestion)
      }

      // Re-export the wiki page from the now-healed row (new file name may
      // differ from any earlier filename-slug page; acceptable). Non-fatal.
      try {
        const { exportMeetingWiki } = await import('./meeting-wiki')
        const wikiPath = exportMeetingWiki(row.recording_id)
        if (wikiPath) console.log(`[Reanalyze] Re-exported wiki ${wikiPath}`)
      } catch (e) {
        console.error('[Reanalyze] Wiki re-export failed:', e)
      }

      healed++
      console.log(`[Reanalyze] Healed transcript ${row.recording_id}: "${analysis.title_suggestion ?? '(no title)'}"`)
    } catch (e) {
      console.error(`[Reanalyze] Failed to reanalyze ${row.recording_id}:`, e instanceof Error ? e.message : e)
    }
  }

  return healed
}

async function transcribeRecording(
  recordingId: string,
  progressCallback?: (stage: string, progress: number) => void,
  providerOverride?: string
): Promise<void> {
  // Resolve stale/foreign IDs (e.g. a synced_files id queued by an older
  // renderer build) to the real recordings row before failing.
  const recording = getRecordingById(recordingId) ?? resolveRecordingId(recordingId)
  if (!recording || !recording.file_path) {
    throw new Error(`Recording not found or no local file: ${recordingId}`)
  }
  // Continue with the canonical id so status updates hit the real row.
  recordingId = recording.id

  if (!existsSync(recording.file_path)) {
    throw new Error(`Recording file not found: ${recording.file_path}`)
  }

  console.log(`Transcribing: ${recording.filename}`)
  // AI-13: Use standard enum values matching Recording.transcription_status
  updateRecordingTranscriptionStatus(recordingId, 'processing')

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

  const config = getConfig()
  const transcriptionProvider = providerOverride || config.transcription.provider || 'gemini'
  const rawTranscript = transcriptionProvider === 'vibevoice'
    ? await transcribeWithVibeVoice(recording.file_path, progressCallback)
    : transcriptionProvider === 'local-asr'
      ? await transcribeWithLocalAsr(recording.file_path, progressCallback)
      : await transcribeWithGemini(recording.file_path, meetingContext, progressCallback)
  const fullText = rawTranscript.fullText

  progressCallback?.('analyzing', 50) // spec-014: progress reporting
  const analysis = await analyzeTranscriptWithGemini(fullText, candidateMeetings)

  // Process AI meeting selection
  if (candidateMeetings.length > 0) {
    // Add all candidates to the database
    for (const meeting of candidateMeetings) {
      const isSelected = analysis.selected_meeting_id === meeting.id
      const confidence = isSelected ? (analysis.meeting_confidence || 0.5) : 0.1
      const reason = isSelected ? (analysis.selection_reason || 'Time overlap') : 'Time overlap only'

      addRecordingMeetingCandidate(recordingId, meeting.id, confidence, reason, isSelected)
    }

    // If AI selected a meeting with sufficient confidence, link it
    const MIN_LINK_CONFIDENCE = 0.4
    if (analysis.selected_meeting_id && analysis.selected_meeting_id !== 'none') {
      const selectedMeeting = candidateMeetings.find(m => m.id === analysis.selected_meeting_id)
      const confidence = analysis.meeting_confidence || 0
      if (selectedMeeting && confidence >= MIN_LINK_CONFIDENCE) {
        linkRecordingToMeeting(
          recordingId,
          selectedMeeting.id,
          confidence,
          'ai_transcript_match'
        )
        console.log(`AI matched recording to meeting: "${selectedMeeting.subject}" (confidence: ${confidence})`)
      } else if (selectedMeeting && confidence < MIN_LINK_CONFIDENCE) {
        console.log(`AI match rejected (low confidence ${confidence}): "${selectedMeeting.subject}"`)
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
    language: analysis.language || rawTranscript.language || 'unknown',
    summary: analysis.summary,
    action_items: analysis.action_items ? JSON.stringify(analysis.action_items) : undefined,
    topics: analysis.topics ? JSON.stringify(analysis.topics) : undefined,
    key_points: analysis.key_points ? JSON.stringify(analysis.key_points) : undefined,
    sentiment: undefined,
    speakers: rawTranscript.speakers,
    word_count: wordCount,
    transcription_provider: rawTranscript.provider,
    transcription_model: rawTranscript.model,
    title_suggestion: analysis.title_suggestion,
    question_suggestions: analysis.question_suggestions ? JSON.stringify(analysis.question_suggestions) : undefined
  }

  insertTranscript(transcript)
  // AI-13: Use standard enum value 'complete' (not 'transcribed')
  updateRecordingTranscriptionStatus(recordingId, 'complete')
  // Durability: a completed transcript is an expensive artifact (API cost + time).
  // The default run() path is debounced/async, so force a synchronous flush here
  // to guarantee it survives a crash. This is infrequent (once per transcription)
  // and does not contribute to the bulk-write freeze.
  saveDatabase()

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
    const VALID_TEMPLATE_IDS = ['meeting_minutes', 'interview_feedback', 'project_status', 'action_items', 'claude_code_prompt']

    for (const detection of detections) {
      const actionableId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`

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

  // Persist people + project the analysis extracted from the conversation
  // (the ICS feed has no attendee data — the transcript is the source).
  try {
    const { applyTranscriptEntities } = await import('./org-reconciler')
    const linkedMeetingId =
      (analysis.selected_meeting_id && analysis.selected_meeting_id !== 'none'
        ? analysis.selected_meeting_id
        : undefined) ?? recording.meeting_id ?? getRecordingById(recordingId)?.meeting_id
    const applied = applyTranscriptEntities({
      meetingId: linkedMeetingId ?? undefined,
      participants: analysis.participants,
      project: analysis.project
    })
    if (applied.contacts > 0 || applied.projectLinked) {
      console.log(
        `[OrgReconciler] Transcript entities: +${applied.contacts} people${applied.projectLinked ? ', project linked' : ''}`
      )
    }
  } catch (e) {
    console.error('[OrgReconciler] Transcript entity extraction failed:', e)
  }

  // Living knowledge graph (v27): announce the finished transcript so graph-sync
  // can debounce-ingest only the new material. Non-fatal.
  try {
    const { getEventBus } = await import('./event-bus')
    getEventBus().emitDomainEvent({
      type: 'entity:transcript-ready',
      timestamp: new Date().toISOString(),
      payload: { transcriptId: `trans_${recordingId}`, recordingId }
    })
  } catch (e) {
    console.warn('[GraphSync] transcript-ready emit failed:', e)
  }

  // Export the per-meeting wiki page (plain markdown knowledge base readable
  // by the user and by external agents like Claude Code). Non-fatal.
  try {
    const { exportMeetingWiki } = await import('./meeting-wiki')
    const wikiPath = exportMeetingWiki(recordingId)
    if (wikiPath) console.log(`[MeetingWiki] Exported ${wikiPath}`)
  } catch (e) {
    console.error('[MeetingWiki] Export failed:', e)
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
