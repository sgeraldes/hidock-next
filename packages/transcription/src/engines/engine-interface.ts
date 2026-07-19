export interface TranscriptSegment {
  speaker: string
  text: string
  startTime: number
  endTime: number
  confidence: number
  source: 'mic' | 'system'
}

export interface TranscribeOptions {
  source: 'mic' | 'system'
  language?: string
  timeOffset?: number
  vocabulary?: string[]
  diarize?: boolean
  /** Optional free-text context passed to the engine's prompt (e.g. meeting context for Gemini). */
  context?: string
  /**
   * ADV43-1 (round-45) — FAIL-CLOSED eligibility gate re-evaluated SYNCHRONOUSLY
   * INSIDE the engine immediately before EACH concrete provider call (Files API
   * upload + each processing poll, every per-chunk generation, and every retry
   * attempt), NOT just once at the top. Returns EXACTLY `true` ⇒ the source
   * recording is still eligible; a `false` return OR any thrown error ⇒ treat the
   * source as INELIGIBLE and ABORT the pipeline by throwing
   * TranscriptionCancelledError (no further upload / generateContent). Threaded
   * down from transcription.ts's isRecordingEligible check so an owner exclusion
   * (soft-delete / mark-personal / value-exclude) committed while the file read,
   * an upload, an earlier chunk, or a retry is in flight stops every subsequent
   * provider call. Absent ⇒ no gate configured (legacy behaviour, unchanged).
   */
  shouldGenerate?: () => boolean
}

/**
 * Thrown by an engine when its `shouldGenerate` gate reports the source is no
 * longer eligible mid-pipeline. Distinct from a provider/API error so callers
 * (transcribeRecording) can map it to a `cancelled` outcome — persisting nothing
 * — instead of surfacing it as a transcription failure.
 */
export class TranscriptionCancelledError extends Error {
  constructor(message = 'Transcription cancelled: source is no longer eligible for AI processing') {
    super(message)
    this.name = 'TranscriptionCancelledError'
  }
}

export interface TranscriptionEngine {
  transcribe(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment>
  readonly isStreaming: boolean
  readonly isLocal: boolean
  isAvailable?(): Promise<boolean>
}
