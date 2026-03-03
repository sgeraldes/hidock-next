import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AudioRecorder, AudioRecorderState } from '../services/audio-recorder'

const mockStart = vi.fn()
const mockStop = vi.fn()
const mockPause = vi.fn()
const mockResume = vi.fn()
let mockOnDataAvailable: ((event: { data: Blob }) => void) | null = null

class MockMediaRecorder {
  state: string = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: { error: Error }) => void) | null = null

  start(timeslice?: number) {
    this.state = 'recording'
    mockStart(timeslice)
    mockOnDataAvailable = this.ondataavailable
  }

  stop() {
    this.state = 'inactive'
    mockStop()
    this.onstop?.()
  }

  pause() {
    this.state = 'paused'
    mockPause()
  }

  resume() {
    this.state = 'recording'
    mockResume()
  }

  static isTypeSupported(mimeType: string): boolean {
    return mimeType === 'audio/ogg;codecs=opus' || mimeType === 'audio/webm;codecs=opus'
  }
}

const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
})

Object.defineProperty(global.navigator, 'mediaDevices', {
  value: { getUserMedia: mockGetUserMedia },
  writable: true,
})

// @ts-expect-error - global mock
global.MediaRecorder = MockMediaRecorder

describe('AudioRecorder', () => {
  let recorder: AudioRecorder

  beforeEach(() => {
    recorder = new AudioRecorder()
    vi.clearAllMocks()
    mockOnDataAvailable = null
  })

  describe('startRecording', () => {
    it('requests microphone access via getUserMedia', async () => {
      await recorder.startRecording()
      expect(mockGetUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: expect.any(Object),
        }),
      )
    })

    it('starts MediaRecorder with 3s timeslice', async () => {
      await recorder.startRecording()
      expect(mockStart).toHaveBeenCalledWith(3000)
    })

    it('sets state to recording', async () => {
      await recorder.startRecording()
      expect(recorder.getState()).toBe(AudioRecorderState.Recording)
    })

    it('throws if already recording', async () => {
      await recorder.startRecording()
      await expect(recorder.startRecording()).rejects.toThrow()
    })
  })

  describe('stopRecording', () => {
    it('stops MediaRecorder', async () => {
      await recorder.startRecording()
      recorder.stopRecording()
      expect(mockStop).toHaveBeenCalled()
    })

    it('sets state to idle', async () => {
      await recorder.startRecording()
      recorder.stopRecording()
      expect(recorder.getState()).toBe(AudioRecorderState.Idle)
    })
  })

  describe('chunk handling', () => {
    it('calls onChunk callback when data is available', async () => {
      const onChunk = vi.fn()
      recorder = new AudioRecorder({ onChunk })
      await recorder.startRecording()

      const blob = new Blob(['audio data'], { type: 'audio/ogg' })
      mockOnDataAvailable?.({ data: blob })

      expect(onChunk).toHaveBeenCalledWith(blob, 0)
    })

    it('increments chunk index on each data event', async () => {
      const onChunk = vi.fn()
      recorder = new AudioRecorder({ onChunk })
      await recorder.startRecording()

      const blob1 = new Blob(['chunk1'], { type: 'audio/ogg' })
      const blob2 = new Blob(['chunk2'], { type: 'audio/ogg' })
      mockOnDataAvailable?.({ data: blob1 })
      mockOnDataAvailable?.({ data: blob2 })

      expect(onChunk).toHaveBeenCalledTimes(2)
      expect(onChunk).toHaveBeenNthCalledWith(1, blob1, 0)
      expect(onChunk).toHaveBeenNthCalledWith(2, blob2, 1)
    })

    it('skips empty blobs', async () => {
      const onChunk = vi.fn()
      recorder = new AudioRecorder({ onChunk })
      await recorder.startRecording()

      const emptyBlob = new Blob([], { type: 'audio/ogg' })
      mockOnDataAvailable?.({ data: emptyBlob })

      expect(onChunk).not.toHaveBeenCalled()
    })
  })

  describe('backpressure', () => {
    it('tracks pending chunk count', async () => {
      recorder = new AudioRecorder({ maxQueueSize: 20 })
      await recorder.startRecording()
      expect(recorder.getPendingChunkCount()).toBe(0)
    })

    it('increments pending count when chunk is sent', async () => {
      const onChunk = vi.fn()
      recorder = new AudioRecorder({ onChunk, maxQueueSize: 20 })
      await recorder.startRecording()

      const blob = new Blob(['data'], { type: 'audio/ogg' })
      mockOnDataAvailable?.({ data: blob })

      expect(recorder.getPendingChunkCount()).toBe(1)
    })

    it('acknowledgeChunk decrements pending count', async () => {
      const onChunk = vi.fn()
      recorder = new AudioRecorder({ onChunk, maxQueueSize: 20 })
      await recorder.startRecording()

      const blob = new Blob(['data'], { type: 'audio/ogg' })
      mockOnDataAvailable?.({ data: blob })
      recorder.acknowledgeChunk()

      expect(recorder.getPendingChunkCount()).toBe(0)
    })

    it('pauses MediaRecorder when pending chunks reach pause threshold', async () => {
      const onChunk = vi.fn()
      recorder = new AudioRecorder({ onChunk, maxQueueSize: 20 })
      await recorder.startRecording()

      const blob = new Blob(['data'], { type: 'audio/ogg' })
      for (let i = 0; i < 15; i++) {
        mockOnDataAvailable?.({ data: blob })
      }

      expect(mockPause).toHaveBeenCalled()
      expect(recorder.getState()).toBe(AudioRecorderState.Paused)
    })

    it('resumes MediaRecorder when pending chunks drop to resume threshold', async () => {
      const onChunk = vi.fn()
      recorder = new AudioRecorder({ onChunk, maxQueueSize: 20 })
      await recorder.startRecording()

      const blob = new Blob(['data'], { type: 'audio/ogg' })
      for (let i = 0; i < 15; i++) {
        mockOnDataAvailable?.({ data: blob })
      }
      expect(recorder.getState()).toBe(AudioRecorderState.Paused)

      for (let i = 0; i < 5; i++) {
        recorder.acknowledgeChunk()
      }

      expect(mockResume).toHaveBeenCalled()
      expect(recorder.getState()).toBe(AudioRecorderState.Recording)
    })
  })

  describe('getState', () => {
    it('returns idle when not recording', () => {
      expect(recorder.getState()).toBe(AudioRecorderState.Idle)
    })
  })

  describe('getMimeType', () => {
    it('returns the selected mime type', async () => {
      await recorder.startRecording()
      const mime = recorder.getMimeType()
      expect(mime).toMatch(/^audio\/(ogg|webm)/)
    })
  })
})
