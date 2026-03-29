export interface MixedAudioOutput {
  readonly id: string
  readonly sampleRate: number
  readonly channelCount: number
}

export interface AudioMixerOptions {
  sampleRate?: number
  channelCount?: number
}

export class AudioMixer {
  constructor(private readonly options: AudioMixerOptions = {}) {}

  mix(..._sources: unknown[]): Promise<MixedAudioOutput> {
    throw new Error('not implemented')
  }

  setGain(_sourceId: string, _gainDb: number): void {
    throw new Error('not implemented')
  }

  stop(): Promise<void> {
    throw new Error('not implemented')
  }
}
