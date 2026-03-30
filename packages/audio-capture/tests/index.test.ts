import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MicCapture,
  SystemAudioCapture,
  AudioMixer,
  ChunkRecorder,
  SilenceDetector,
} from '../src/index.js'

// ---------------------------------------------------------------------------
// Helpers: mock browser APIs
// ---------------------------------------------------------------------------

function createMockMediaStream(trackKind: 'audio' | 'video' = 'audio'): MediaStream {
  const track = {
    kind: trackKind,
    stop: vi.fn(),
    enabled: true,
    id: `track-${Math.random()}`,
    label: 'Mock Track',
    muted: false,
    readyState: 'live' as MediaStreamTrackState,
    contentHint: '',
  } as any as MediaStreamTrack

  const stream = {
    id: `stream-${Math.random()}`,
    active: true,
    getTracks: vi.fn(() => [track]),
    getAudioTracks: vi.fn(() => (trackKind === 'audio' ? [track] : [])),
    getVideoTracks: vi.fn(() => (trackKind === 'video' ? [track] : [])),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    clone: vi.fn(),
  } as any as MediaStream

  return stream
}

function createMockMediaStreamWithBothTracks(): MediaStream {
  const audioTrack = {
    kind: 'audio',
    stop: vi.fn(),
    id: 'audio-track',
  } as any as MediaStreamTrack

  const videoTrack = {
    kind: 'video',
    stop: vi.fn(),
    id: 'video-track',
  } as any as MediaStreamTrack

  const stream = {
    id: `stream-${Math.random()}`,
    active: true,
    getTracks: vi.fn(() => [audioTrack, videoTrack]),
    getAudioTracks: vi.fn(() => [audioTrack]),
    getVideoTracks: vi.fn(() => [videoTrack]),
  } as any as MediaStream

  return stream
}

// ---------------------------------------------------------------------------
// MicCapture
// ---------------------------------------------------------------------------

describe('MicCapture', () => {
  let getUserMediaMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getUserMediaMock = vi.fn()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: getUserMediaMock,
        enumerateDevices: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('instantiates with default options', () => {
    const mic = new MicCapture()
    expect(mic).toBeInstanceOf(MicCapture)
  })

  it('start() calls getUserMedia with raw audio constraints', async () => {
    const mockStream = createMockMediaStream('audio')
    getUserMediaMock.mockResolvedValue(mockStream)

    const mic = new MicCapture()
    const handle = await mic.start()

    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    expect(handle.id).toMatch(/^mic-/)
    expect(handle.stream).toBe(mockStream)
  })

  it('start() passes deviceId when provided', async () => {
    const mockStream = createMockMediaStream('audio')
    getUserMediaMock.mockResolvedValue(mockStream)

    const mic = new MicCapture({ deviceId: 'test-device' })
    await mic.start()

    const call = getUserMediaMock.mock.calls[0][0]
    expect(call.audio.deviceId).toEqual({ exact: 'test-device' })
  })

  it('start() passes sampleRate and channelCount', async () => {
    const mockStream = createMockMediaStream('audio')
    getUserMediaMock.mockResolvedValue(mockStream)

    const mic = new MicCapture({ sampleRate: 44100, channelCount: 2 })
    await mic.start()

    const call = getUserMediaMock.mock.calls[0][0]
    expect(call.audio.sampleRate).toBe(44100)
    expect(call.audio.channelCount).toBe(2)
  })

  it('stop() stops all tracks', async () => {
    const mockStream = createMockMediaStream('audio')
    getUserMediaMock.mockResolvedValue(mockStream)

    const mic = new MicCapture()
    await mic.start()
    await mic.stop()

    const tracks = mockStream.getTracks()
    for (const track of tracks) {
      expect(track.stop).toHaveBeenCalled()
    }
  })

  it('stop() is safe to call when not started', async () => {
    const mic = new MicCapture()
    await expect(mic.stop()).resolves.toBeUndefined()
  })

  it('handle.stop() stops tracks', async () => {
    const mockStream = createMockMediaStream('audio')
    getUserMediaMock.mockResolvedValue(mockStream)

    const mic = new MicCapture()
    const handle = await mic.start()
    handle.stop()

    for (const track of mockStream.getTracks()) {
      expect(track.stop).toHaveBeenCalled()
    }
  })

  it('listDevices() filters audioinput devices', async () => {
    const enumerateMock = vi.fn().mockResolvedValue([
      { deviceId: '1', label: 'Mic 1', kind: 'audioinput' },
      { deviceId: '2', label: 'Speaker', kind: 'audiooutput' },
      { deviceId: '3', label: 'Mic 2', kind: 'audioinput' },
    ])
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: getUserMediaMock,
        enumerateDevices: enumerateMock,
      },
    })

    const mic = new MicCapture()
    const devices = await mic.listDevices()

    expect(devices).toHaveLength(2)
    expect(devices[0].deviceId).toBe('1')
    expect(devices[1].deviceId).toBe('3')
    expect(devices.every((d) => d.kind === 'audioinput')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SystemAudioCapture
// ---------------------------------------------------------------------------

describe('SystemAudioCapture', () => {
  let getDisplayMediaMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getDisplayMediaMock = vi.fn()
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getDisplayMedia: getDisplayMediaMock,
      },
    })
    vi.stubGlobal('MediaStream', vi.fn().mockImplementation(function (this: any, tracks: MediaStreamTrack[]) {
      this.id = 'audio-only-stream'
      this.active = true
      this.getTracks = () => tracks
      this.getAudioTracks = () => tracks.filter((t) => t.kind === 'audio')
      this.getVideoTracks = () => []
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('instantiates', () => {
    const sac = new SystemAudioCapture()
    expect(sac).toBeInstanceOf(SystemAudioCapture)
  })

  it('start() calls getDisplayMedia and stops video tracks', async () => {
    const mockStream = createMockMediaStreamWithBothTracks()
    getDisplayMediaMock.mockResolvedValue(mockStream)

    const sac = new SystemAudioCapture()
    const handle = await sac.start()

    expect(getDisplayMediaMock).toHaveBeenCalledWith({
      audio: true,
      video: { width: 1, height: 1 },
    })
    const videoTracks = mockStream.getVideoTracks()
    expect(videoTracks[0].stop).toHaveBeenCalled()
    expect(handle.id).toMatch(/^system-/)
    expect(handle.stream).toBeDefined()
  })

  it('start() throws when no audio tracks available', async () => {
    const mockStream = createMockMediaStream('video')
    ;(mockStream as { getAudioTracks: () => MediaStreamTrack[] }).getAudioTracks = vi.fn(() => [])
    getDisplayMediaMock.mockResolvedValue(mockStream)

    const sac = new SystemAudioCapture()
    await expect(sac.start()).rejects.toThrow('No audio track available')
  })

  it('isSupported() returns true when getDisplayMedia exists', () => {
    const sac = new SystemAudioCapture()
    expect(sac.isSupported()).toBe(true)
  })

  it('isSupported() returns false when navigator is undefined', () => {
    vi.stubGlobal('navigator', undefined)
    const sac = new SystemAudioCapture()
    expect(sac.isSupported()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AudioMixer
// ---------------------------------------------------------------------------

describe('AudioMixer', () => {
  let mockGainNode: { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }
  let mockSourceNode: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }
  let mockDestination: { stream: MediaStream }
  let mockContext: any

  beforeEach(() => {
    mockGainNode = {
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    mockSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    mockDestination = {
      stream: createMockMediaStream('audio'),
    }
    mockContext = {
      createMediaStreamSource: vi.fn(() => mockSourceNode),
      createGain: vi.fn(() => mockGainNode),
      createMediaStreamDestination: vi.fn(() => mockDestination),
      close: vi.fn().mockResolvedValue(undefined),
      sampleRate: 48000,
      destination: { channelCount: 2 },
    }

    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function (this: any) {
      Object.assign(this, mockContext)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('instantiates', () => {
    const mixer = new AudioMixer()
    expect(mixer).toBeInstanceOf(AudioMixer)
  })

  it('addSource() creates source and gain nodes', () => {
    const mixer = new AudioMixer()
    const stream = createMockMediaStream('audio')
    mixer.addSource('mic', stream)

    expect(mockContext.createMediaStreamSource).toHaveBeenCalledWith(stream)
    expect(mockContext.createGain).toHaveBeenCalled()
    expect(mockSourceNode.connect).toHaveBeenCalledWith(mockGainNode)
    expect(mockGainNode.connect).toHaveBeenCalledWith(mockDestination)
  })

  it('addSource() throws for duplicate ids', () => {
    const mixer = new AudioMixer()
    const stream = createMockMediaStream('audio')
    mixer.addSource('mic', stream)
    expect(() => mixer.addSource('mic', stream)).toThrow('already exists')
  })

  it('removeSource() disconnects nodes', () => {
    const mixer = new AudioMixer()
    const stream = createMockMediaStream('audio')
    mixer.addSource('mic', stream)
    mixer.removeSource('mic')

    expect(mockSourceNode.disconnect).toHaveBeenCalled()
    expect(mockGainNode.disconnect).toHaveBeenCalled()
  })

  it('removeSource() is safe for unknown ids', () => {
    const mixer = new AudioMixer()
    expect(() => mixer.removeSource('nonexistent')).not.toThrow()
  })

  it('getOutputStream() returns destination stream', () => {
    const mixer = new AudioMixer()
    const out = mixer.getOutputStream()
    expect(out).toBe(mockDestination.stream)
  })

  it('setGain() converts dB to linear', () => {
    const mixer = new AudioMixer()
    const stream = createMockMediaStream('audio')
    mixer.addSource('mic', stream)

    mixer.setGain('mic', -6)
    expect(mockGainNode.gain.value).toBeCloseTo(0.501, 2)

    mixer.setGain('mic', 0)
    expect(mockGainNode.gain.value).toBeCloseTo(1, 5)

    mixer.setGain('mic', -20)
    expect(mockGainNode.gain.value).toBeCloseTo(0.1, 5)
  })

  it('setGain() throws for unknown source', () => {
    const mixer = new AudioMixer()
    expect(() => mixer.setGain('unknown', 0)).toThrow('not found')
  })

  it('getMixedOutput() returns output with metadata', () => {
    const mixer = new AudioMixer()
    const output = mixer.getMixedOutput()
    expect(output.sampleRate).toBe(48000)
    expect(output.stream).toBe(mockDestination.stream)
    expect(output.id).toMatch(/^mixer-/)
  })

  it('stop() disconnects all and closes context', async () => {
    const mixer = new AudioMixer()
    const stream = createMockMediaStream('audio')
    mixer.addSource('mic', stream)

    await mixer.stop()
    expect(mockSourceNode.disconnect).toHaveBeenCalled()
    expect(mockGainNode.disconnect).toHaveBeenCalled()
    expect(mockContext.close).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ChunkRecorder
// ---------------------------------------------------------------------------

describe('ChunkRecorder', () => {
  let mockRecorder: any

  beforeEach(() => {
    mockRecorder = {
      start: vi.fn(),
      stop: vi.fn().mockImplementation(function (this: any) {
        this.state = 'inactive'
        if (this.onstop) this.onstop()
      }),
      pause: vi.fn().mockImplementation(function (this: any) {
        this.state = 'paused'
      }),
      resume: vi.fn().mockImplementation(function (this: any) {
        this.state = 'recording'
      }),
      ondataavailable: null,
      onerror: null,
      onstop: null,
      state: 'inactive',
    }

    vi.stubGlobal('MediaRecorder', vi.fn().mockImplementation(function () {
      mockRecorder.state = 'recording'
      return mockRecorder
    }))
    ;(MediaRecorder as unknown as { isTypeSupported: (t: string) => boolean }).isTypeSupported = vi.fn(() => true)

    vi.stubGlobal('Blob', globalThis.Blob ?? vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has correct static defaults', () => {
    expect(ChunkRecorder.DEFAULT_TIMESLICE_MS).toBe(3000)
    expect(ChunkRecorder.DEFAULT_MIME_TYPE).toBe('audio/webm;codecs=opus')
    expect(ChunkRecorder.DEFAULT_BACKPRESSURE_HIGH_WATER_MARK).toBe(15)
    expect(ChunkRecorder.DEFAULT_BACKPRESSURE_LOW_WATER_MARK).toBe(10)
  })

  it('start() creates MediaRecorder and calls start with timeslice', async () => {
    const recorder = new ChunkRecorder({ timesliceMs: 5000 })
    const stream = createMockMediaStream('audio')
    await recorder.start(stream)

    expect(MediaRecorder).toHaveBeenCalled()
    expect(mockRecorder.start).toHaveBeenCalledWith(5000)
  })

  it('start() throws when already recording', async () => {
    const recorder = new ChunkRecorder()
    const stream = createMockMediaStream('audio')
    await recorder.start(stream)
    await expect(recorder.start(stream)).rejects.toThrow('already recording')
  })

  it('emits chunk events on dataavailable', async () => {
    const recorder = new ChunkRecorder()
    const stream = createMockMediaStream('audio')
    const chunks: unknown[] = []

    recorder.on('chunk', (chunk) => chunks.push(chunk))
    await recorder.start(stream, 'mic')

    const blob = new Blob(['test'], { type: 'audio/webm' })
    mockRecorder.ondataavailable!({ data: blob })

    expect(chunks).toHaveLength(1)
    const chunk = chunks[0] as { index: number; data: Blob; source: string }
    expect(chunk.index).toBe(0)
    expect(chunk.data).toBe(blob)
    expect(chunk.source).toBe('mic')
  })

  it('ignores zero-size data', async () => {
    const recorder = new ChunkRecorder()
    const stream = createMockMediaStream('audio')
    const chunks: unknown[] = []

    recorder.on('chunk', (chunk) => chunks.push(chunk))
    await recorder.start(stream)

    mockRecorder.ondataavailable!({ data: new Blob([], { type: 'audio/webm' }) })
    expect(chunks).toHaveLength(0)
  })

  it('stop() returns promise that resolves on onstop', async () => {
    const recorder = new ChunkRecorder()
    const stream = createMockMediaStream('audio')
    await recorder.start(stream)

    const stopPromise = recorder.stop()
    await expect(stopPromise).resolves.toBeUndefined()
  })

  it('off() removes listener', async () => {
    const recorder = new ChunkRecorder()
    const stream = createMockMediaStream('audio')
    const chunks: unknown[] = []
    const listener = (chunk: unknown) => chunks.push(chunk)

    recorder.on('chunk', listener)
    recorder.off('chunk', listener)
    await recorder.start(stream)

    const blob = new Blob(['test'], { type: 'audio/webm' })
    mockRecorder.ondataavailable!({ data: blob })

    expect(chunks).toHaveLength(0)
  })

  it('backpressure: pauses at high water mark', async () => {
    const recorder = new ChunkRecorder({
      backpressureHighWaterMark: 2,
      backpressureLowWaterMark: 1,
    })
    const stream = createMockMediaStream('audio')

    recorder.on('chunk', () => {})
    await recorder.start(stream)

    const blob = new Blob(['test'], { type: 'audio/webm' })
    mockRecorder.ondataavailable!({ data: blob })
    expect(mockRecorder.pause).not.toHaveBeenCalled()

    mockRecorder.ondataavailable!({ data: blob })
    expect(mockRecorder.pause).toHaveBeenCalled()
  })

  it('backpressure: resumes at low water mark via acknowledgeChunk', async () => {
    const recorder = new ChunkRecorder({
      backpressureHighWaterMark: 2,
      backpressureLowWaterMark: 1,
    })
    const stream = createMockMediaStream('audio')

    recorder.on('chunk', () => {})
    await recorder.start(stream)

    const blob = new Blob(['test'], { type: 'audio/webm' })
    mockRecorder.ondataavailable!({ data: blob })
    mockRecorder.ondataavailable!({ data: blob })
    expect(mockRecorder.pause).toHaveBeenCalled()

    recorder.acknowledgeChunk()
    expect(mockRecorder.resume).toHaveBeenCalled()
  })

  it('dispose() stops recorder and clears listeners', async () => {
    const recorder = new ChunkRecorder()
    const stream = createMockMediaStream('audio')
    await recorder.start(stream)

    recorder.dispose()
    expect(mockRecorder.stop).toHaveBeenCalled()

    await expect(recorder.start(stream)).rejects.toThrow('disposed')
  })

  it('emits error events', async () => {
    const recorder = new ChunkRecorder()
    const stream = createMockMediaStream('audio')
    const errors: Error[] = []

    recorder.on('error', (err) => errors.push(err))
    await recorder.start(stream)

    const errorEvent = { error: new Error('test error') }
    mockRecorder.onerror!(errorEvent as unknown as Event)

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('test error')
  })
})

// ---------------------------------------------------------------------------
// SilenceDetector
// ---------------------------------------------------------------------------

describe('SilenceDetector', () => {
  it('instantiates with defaults', () => {
    const detector = new SilenceDetector()
    expect(detector).toBeInstanceOf(SilenceDetector)
  })

  it('has correct static defaults', () => {
    expect(SilenceDetector.DEFAULT_PEAK_THRESHOLD_DB).toBe(-45)
    expect(SilenceDetector.DEFAULT_MEAN_THRESHOLD_DB).toBe(-40)
  })

  it('reset() does not throw', () => {
    const detector = new SilenceDetector()
    expect(() => detector.reset()).not.toThrow()
  })

  it('analyze() returns fail-open result when ffmpeg is not available', async () => {
    const detector = new SilenceDetector({ ffmpegPath: '/nonexistent/ffmpeg' })
    const buffer = Buffer.alloc(1000)

    const result = await detector.analyze(buffer)
    expect(result.isSilent).toBe(false)
    expect(result.peakDb).toBe(0)
    expect(result.meanDb).toBe(0)
  })

  it('analyze() accepts a tempDir parameter', async () => {
    const detector = new SilenceDetector({ ffmpegPath: '/nonexistent/ffmpeg' })
    const buffer = Buffer.alloc(100)
    const { tmpdir } = await import('node:os')

    const result = await detector.analyze(buffer, tmpdir())
    expect(result.isSilent).toBe(false)
  })
})
