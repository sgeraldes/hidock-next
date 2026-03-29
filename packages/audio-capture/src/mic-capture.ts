export interface MicCaptureOptions {
  deviceId?: string
  sampleRate?: number
  channelCount?: number
}

export interface AudioStreamHandle {
  readonly id: string
  stop(): void
}

export class MicCapture {
  constructor(private readonly options: MicCaptureOptions = {}) {}

  start(): Promise<AudioStreamHandle> {
    throw new Error('not implemented')
  }

  stop(): Promise<void> {
    throw new Error('not implemented')
  }

  listDevices(): Promise<{ deviceId: string; label: string; kind: string }[]> {
    throw new Error('not implemented')
  }
}
