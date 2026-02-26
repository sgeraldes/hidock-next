/**
 * Audio Utils Tests
 *
 * BUG-AU-001: AudioContext may be suspended, causing decodeAudioData to hang
 *   OBSERVED: Audio doesn't play - waveform generation blocks playback path
 *   ROOT CAUSE: new AudioContext() without resume() can start in suspended state.
 *   decodeAudioData on a suspended context hangs indefinitely (no throw, no resolve).
 *
 * BUG-AU-002: No timeout on decodeAudioData
 *   If decoding hangs, the entire playback path blocks forever with no recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// We need to mock AudioContext since jsdom doesn't have Web Audio API
const mockDecodeAudioData = vi.fn()
const mockResume = vi.fn().mockResolvedValue(undefined)

class MockAudioContext {
  state = 'suspended'
  decodeAudioData = mockDecodeAudioData
  resume = mockResume
}

// Set up the global mock before importing
vi.stubGlobal('AudioContext', MockAudioContext)

import { decodeAudioData, generateWaveformData, formatTimestamp, formatFileSize, getAudioMimeType } from '../audioUtils'

describe('audioUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('decodeAudioData', () => {
    it('should call AudioContext.resume() before decoding', async () => {
      // BUG-AU-001: If AudioContext is suspended, decodeAudioData will hang
      // The fix should call resume() before decodeAudioData()
      const mockBuffer = {
        duration: 10,
        numberOfChannels: 1,
        sampleRate: 44100,
        length: 441000,
        getChannelData: vi.fn(() => new Float32Array(100))
      }
      mockDecodeAudioData.mockResolvedValue(mockBuffer)

      const base64 = btoa('fake audio data')
      await decodeAudioData(base64, 'audio/wav')

      // CRITICAL: resume() must be called to ensure AudioContext is active
      expect(mockResume).toHaveBeenCalled()
    })

    it('should handle base64 decoding correctly', async () => {
      const mockBuffer = {
        duration: 5,
        numberOfChannels: 1,
        sampleRate: 44100,
        length: 220500,
        getChannelData: vi.fn(() => new Float32Array(50))
      }
      mockDecodeAudioData.mockResolvedValue(mockBuffer)

      const originalData = 'test audio content'
      const base64 = btoa(originalData)
      const result = await decodeAudioData(base64, 'audio/wav')

      expect(result).toBe(mockBuffer)
      expect(mockDecodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer))

      // Verify the ArrayBuffer contains the correct data
      const callArg = mockDecodeAudioData.mock.calls[0][0] as ArrayBuffer
      const decoded = new Uint8Array(callArg)
      const expected = new Uint8Array(originalData.length)
      for (let i = 0; i < originalData.length; i++) {
        expected[i] = originalData.charCodeAt(i)
      }
      expect(decoded).toEqual(expected)
    })
  })

  describe('formatTimestamp', () => {
    it('should format seconds correctly', () => {
      expect(formatTimestamp(0)).toBe('0:00')
      expect(formatTimestamp(65)).toBe('1:05')
      expect(formatTimestamp(3661)).toBe('1:01:01')
    })

    it('should handle NaN and Infinity', () => {
      expect(formatTimestamp(NaN)).toBe('0:00')
      expect(formatTimestamp(Infinity)).toBe('0:00')
    })
  })

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(1024)).toBe('1.0 KB')
      expect(formatFileSize(1048576)).toBe('1.0 MB')
    })
  })

  describe('getAudioMimeType', () => {
    it('should return correct MIME types for known extensions', () => {
      expect(getAudioMimeType('recording.mp3')).toBe('audio/mpeg')
      expect(getAudioMimeType('recording.hda')).toBe('audio/mpeg')
      expect(getAudioMimeType('recording.m4a')).toBe('audio/mp4')
      expect(getAudioMimeType('recording.ogg')).toBe('audio/ogg')
      expect(getAudioMimeType('recording.flac')).toBe('audio/flac')
      expect(getAudioMimeType('recording.webm')).toBe('audio/webm')
      expect(getAudioMimeType('recording.wav')).toBe('audio/wav')
    })

    it('should be case-insensitive', () => {
      expect(getAudioMimeType('recording.MP3')).toBe('audio/mpeg')
      expect(getAudioMimeType('recording.HDA')).toBe('audio/mpeg')
      expect(getAudioMimeType('recording.M4A')).toBe('audio/mp4')
    })

    it('should default to audio/wav for unknown extensions', () => {
      expect(getAudioMimeType('recording.xyz')).toBe('audio/wav')
      expect(getAudioMimeType('recording')).toBe('audio/wav')
    })

    it('should handle full file paths', () => {
      expect(getAudioMimeType('/path/to/recording.mp3')).toBe('audio/mpeg')
      expect(getAudioMimeType('C:\\Users\\data\\recording.hda')).toBe('audio/mpeg')
    })
  })

  describe('generateWaveformData', () => {
    it('should generate correct number of samples', async () => {
      const rawData = new Float32Array(44100) // 1 second at 44.1kHz
      for (let i = 0; i < rawData.length; i++) {
        rawData[i] = Math.sin(i * 0.1) // Simple sine wave
      }

      const mockBuffer = {
        getChannelData: vi.fn(() => rawData),
        numberOfChannels: 1,
        sampleRate: 44100,
        length: rawData.length,
        duration: 1
      } as unknown as AudioBuffer

      const result = await generateWaveformData(mockBuffer, 100)
      expect(result).toHaveLength(100)
      // All values should be between 0 and 1 (we take absolute peaks)
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(0)
        expect(result[i]).toBeLessThanOrEqual(1)
      }
    })
  })
})
