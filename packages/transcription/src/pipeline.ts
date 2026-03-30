import { EventEmitter } from 'node:events'
import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engines/engine-interface.js'
import { Diarizer } from './diarizer.js'
import { VocabularyCorrector } from './vocabulary.js'

export interface PipelineOptions {
  diarize?: boolean
  vocabulary?: Record<string, string>
}

export interface PipelineEvents {
  segment: [segment: TranscriptSegment]
  error: [error: Error]
  'engine-switch': [from: string, to: string]
  'engine-status': [engine: string, available: boolean]
}

/**
 * TranscriptionPipeline orchestrates one or more TranscriptionEngines with optional
 * diarization and vocabulary correction post-processing.
 *
 * Supports engine fallback: if the first (local) engine fails, switches to next available.
 */
export class TranscriptionPipeline extends EventEmitter {
  private readonly engines: TranscriptionEngine[]
  private readonly diarizer: Diarizer
  private readonly corrector: VocabularyCorrector

  constructor(engines: TranscriptionEngine | TranscriptionEngine[], options: PipelineOptions = {}) {
    super()
    this.engines = Array.isArray(engines) ? engines : [engines]
    this.diarizer = new Diarizer()
    this.corrector = new VocabularyCorrector(options.vocabulary ?? {})
  }

  async selectEngine(): Promise<TranscriptionEngine> {
    // Prefer local engines first
    const sorted = [...this.engines].sort((a, b) => {
      if (a.isLocal && !b.isLocal) return -1
      if (!a.isLocal && b.isLocal) return 1
      return 0
    })

    for (const engine of sorted) {
      if (engine.isAvailable) {
        const available = await engine.isAvailable()
        const name = engine.constructor.name
        this.emit('engine-status', name, available)
        if (available) return engine
      } else {
        // No isAvailable method — assume available
        return engine
      }
    }

    // Fall back to first engine if none reported available
    return this.engines[0]
  }

  async *run(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment> {
    const selectedEngine = await this.selectEngine()
    const engineNames = this.engines.map((e) => e.constructor.name)
    const selectedIndex = this.engines.indexOf(selectedEngine)

    let segments: TranscriptSegment[] | null = null

    try {
      segments = await this.collectFromEngine(selectedEngine, audio, options)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      if (this.listenerCount('error') > 0) {
        this.emit('error', err)
      }

      // Try fallback engines
      for (let i = 0; i < this.engines.length; i++) {
        if (i === selectedIndex) continue
        const fallback = this.engines[i]
        const fromName = engineNames[selectedIndex]
        const toName = engineNames[i]
        this.emit('engine-switch', fromName, toName)

        try {
          segments = await this.collectFromEngine(fallback, audio, options)
          break
        } catch (fallbackError) {
          const fbErr = fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError))
          if (this.listenerCount('error') > 0) {
            this.emit('error', fbErr)
          }
        }
      }

      // All engines failed — rethrow original
      if (segments === null) {
        throw err
      }
    }

    for (const segment of segments) {
      yield segment
    }
  }

  private async collectFromEngine(
    engine: TranscriptionEngine,
    audio: Buffer,
    options: TranscribeOptions,
  ): Promise<TranscriptSegment[]> {
    const results: TranscriptSegment[] = []
    for await (const segment of engine.transcribe(audio, options)) {
      const diarized = options.diarize !== false ? this.diarizer.tag(segment) : segment
      const corrected = this.corrector.correct(diarized)
      this.emit('segment', corrected)
      results.push(corrected)
    }
    return results
  }

  async collect(audio: Buffer, options: TranscribeOptions): Promise<TranscriptSegment[]> {
    const segments: TranscriptSegment[] = []
    for await (const segment of this.run(audio, options)) {
      segments.push(segment)
    }
    return segments
  }
}
