import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engines/engine-interface.js'
import { Diarizer } from './diarizer.js'
import { VocabularyCorrector } from './vocabulary.js'

export interface PipelineOptions {
  diarize?: boolean
  vocabulary?: Record<string, string>
}

/**
 * TranscriptionPipeline orchestrates a TranscriptionEngine with optional
 * diarization and vocabulary correction post-processing.
 */
export class TranscriptionPipeline {
  private readonly engine: TranscriptionEngine
  private readonly diarizer: Diarizer
  private readonly corrector: VocabularyCorrector

  constructor(engine: TranscriptionEngine, options: PipelineOptions = {}) {
    this.engine = engine
    this.diarizer = new Diarizer()
    this.corrector = new VocabularyCorrector(options.vocabulary ?? {})
  }

  async *run(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment> {
    for await (const segment of this.engine.transcribe(audio, options)) {
      const diarized = options.diarize !== false ? this.diarizer.tag(segment) : segment
      yield this.corrector.correct(diarized)
    }
  }

  async collect(audio: Buffer, options: TranscribeOptions): Promise<TranscriptSegment[]> {
    const segments: TranscriptSegment[] = []
    for await (const segment of this.run(audio, options)) {
      segments.push(segment)
    }
    return segments
  }
}
