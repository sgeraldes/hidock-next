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
}

export interface TranscriptionEngine {
  transcribe(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment>
  readonly isStreaming: boolean
  readonly isLocal: boolean
  isAvailable?(): Promise<boolean>
}
