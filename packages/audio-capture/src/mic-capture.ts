export interface MicCaptureOptions {
  deviceId?: string
  sampleRate?: number
  channelCount?: number
}

export interface AudioStreamHandle {
  readonly id: string
  readonly stream: MediaStream
  stop(): void
}

let handleCounter = 0

export class MicCapture {
  private currentHandle: AudioStreamHandle | null = null

  constructor(private readonly options: MicCaptureOptions = {}) {}

  async start(): Promise<AudioStreamHandle> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(this.options.deviceId ? { deviceId: { exact: this.options.deviceId } } : {}),
        ...(this.options.sampleRate ? { sampleRate: this.options.sampleRate } : {}),
        ...(this.options.channelCount ? { channelCount: this.options.channelCount } : {}),
      },
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)

    const handle: AudioStreamHandle = {
      id: `mic-${++handleCounter}`,
      stream,
      stop() {
        for (const track of stream.getTracks()) {
          track.stop()
        }
      },
    }

    this.currentHandle = handle
    return handle
  }

  async stop(): Promise<void> {
    if (this.currentHandle) {
      this.currentHandle.stop()
      this.currentHandle = null
    }
  }

  async listDevices(): Promise<{ deviceId: string; label: string; kind: string }[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label,
        kind: d.kind,
      }))
  }
}
