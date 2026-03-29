export interface MixedAudioOutput {
  readonly id: string
  readonly sampleRate: number
  readonly channelCount: number
  readonly stream: MediaStream
}

export interface AudioMixerOptions {
  sampleRate?: number
  channelCount?: number
}

interface SourceEntry {
  sourceNode: MediaStreamAudioSourceNode
  gainNode: GainNode
}

let mixerCounter = 0

export class AudioMixer {
  private context: AudioContext | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private sources: Map<string, SourceEntry> = new Map()
  private readonly id: string

  constructor(private readonly options: AudioMixerOptions = {}) {
    this.id = `mixer-${++mixerCounter}`
  }

  addSource(id: string, stream: MediaStream): void {
    this.ensureContext()

    if (this.sources.has(id)) {
      throw new Error(`Source with id "${id}" already exists`)
    }

    const ctx = this.context!
    const sourceNode = ctx.createMediaStreamSource(stream)
    const gainNode = ctx.createGain()

    sourceNode.connect(gainNode)
    gainNode.connect(this.destination!)

    this.sources.set(id, { sourceNode, gainNode })
  }

  removeSource(id: string): void {
    const entry = this.sources.get(id)
    if (!entry) {
      return
    }

    entry.sourceNode.disconnect()
    entry.gainNode.disconnect()
    this.sources.delete(id)
  }

  getOutputStream(): MediaStream {
    this.ensureContext()
    return this.destination!.stream
  }

  getMixedOutput(): MixedAudioOutput {
    this.ensureContext()
    const ctx = this.context!
    return {
      id: this.id,
      sampleRate: ctx.sampleRate,
      channelCount: this.options.channelCount ?? ctx.destination.channelCount,
      stream: this.destination!.stream,
    }
  }

  setGain(sourceId: string, gainDb: number): void {
    const entry = this.sources.get(sourceId)
    if (!entry) {
      throw new Error(`Source "${sourceId}" not found`)
    }

    const linear = Math.pow(10, gainDb / 20)
    entry.gainNode.gain.value = linear
  }

  async stop(): Promise<void> {
    for (const [, entry] of this.sources) {
      entry.sourceNode.disconnect()
      entry.gainNode.disconnect()
    }
    this.sources.clear()

    if (this.context) {
      await this.context.close()
      this.context = null
      this.destination = null
    }
  }

  private ensureContext(): void {
    if (!this.context) {
      const contextOptions: AudioContextOptions = {}
      if (this.options.sampleRate) {
        contextOptions.sampleRate = this.options.sampleRate
      }
      this.context = new AudioContext(contextOptions)
      this.destination = this.context.createMediaStreamDestination()
    }
  }
}
