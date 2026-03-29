import type { AudioStreamHandle } from './mic-capture.js'

export interface SystemAudioCaptureOptions {
  sampleRate?: number
  channelCount?: number
}

let handleCounter = 0

export class SystemAudioCapture {
  private currentHandle: AudioStreamHandle | null = null

  constructor(private readonly options: SystemAudioCaptureOptions = {}) {}

  async start(): Promise<AudioStreamHandle> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mediaDevices = navigator.mediaDevices as any

    const displayStream: MediaStream = await mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1 },
    })

    // Stop video tracks immediately — we only need audio
    for (const track of displayStream.getVideoTracks()) {
      track.stop()
    }

    if (displayStream.getAudioTracks().length === 0) {
      // Clean up remaining tracks before throwing
      for (const track of displayStream.getTracks()) {
        track.stop()
      }
      throw new Error('No audio track available from system audio capture')
    }

    // Create a new stream with only audio tracks
    const audioStream = new MediaStream(displayStream.getAudioTracks())

    const handle: AudioStreamHandle = {
      id: `system-${++handleCounter}`,
      stream: audioStream,
      stop() {
        for (const track of audioStream.getTracks()) {
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

  isSupported(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof navigator !== 'undefined'
      && typeof navigator.mediaDevices !== 'undefined'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      && typeof (navigator.mediaDevices as any).getDisplayMedia === 'function'
  }
}
