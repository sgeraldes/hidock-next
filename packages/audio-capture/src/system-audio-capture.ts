export interface SystemAudioCaptureOptions {
  sampleRate?: number
  channelCount?: number
}

export class SystemAudioCapture {
  constructor(private readonly options: SystemAudioCaptureOptions = {}) {}

  start(): Promise<void> {
    throw new Error('not implemented')
  }

  stop(): Promise<void> {
    throw new Error('not implemented')
  }

  isSupported(): boolean {
    throw new Error('not implemented')
  }
}
