import { describe, it, expect } from 'vitest'
import {
  MicCapture,
  SystemAudioCapture,
  AudioMixer,
  ChunkRecorder,
  SilenceDetector
} from '../src/index.js'

describe('audio-capture exports', () => {
  it('MicCapture instantiates', () => {
    const instance = new MicCapture()
    expect(instance).toBeInstanceOf(MicCapture)
  })

  it('MicCapture throws not implemented on start()', () => {
    const instance = new MicCapture()
    expect(() => instance.start()).toThrow('not implemented')
  })

  it('SystemAudioCapture instantiates', () => {
    const instance = new SystemAudioCapture()
    expect(instance).toBeInstanceOf(SystemAudioCapture)
  })

  it('SystemAudioCapture throws not implemented on start()', () => {
    const instance = new SystemAudioCapture()
    expect(() => instance.start()).toThrow('not implemented')
  })

  it('AudioMixer instantiates', () => {
    const instance = new AudioMixer()
    expect(instance).toBeInstanceOf(AudioMixer)
  })

  it('AudioMixer throws not implemented on mix()', () => {
    const instance = new AudioMixer()
    expect(() => instance.mix()).toThrow('not implemented')
  })

  it('ChunkRecorder instantiates', () => {
    const instance = new ChunkRecorder()
    expect(instance).toBeInstanceOf(ChunkRecorder)
  })

  it('ChunkRecorder throws not implemented on start()', () => {
    const instance = new ChunkRecorder()
    expect(() => instance.start(null)).toThrow('not implemented')
  })

  it('ChunkRecorder has correct defaults', () => {
    expect(ChunkRecorder.DEFAULT_TIMESLICE_MS).toBe(3000)
    expect(ChunkRecorder.DEFAULT_MIME_TYPE).toBe('audio/webm;codecs=opus')
    expect(ChunkRecorder.DEFAULT_BACKPRESSURE_HIGH_WATER_MARK).toBe(15)
    expect(ChunkRecorder.DEFAULT_BACKPRESSURE_LOW_WATER_MARK).toBe(10)
  })

  it('SilenceDetector instantiates', () => {
    const instance = new SilenceDetector()
    expect(instance).toBeInstanceOf(SilenceDetector)
  })

  it('SilenceDetector throws not implemented on analyze()', () => {
    const instance = new SilenceDetector()
    expect(() => instance.analyze(null)).toThrow('not implemented')
  })

  it('SilenceDetector has correct defaults', () => {
    expect(SilenceDetector.DEFAULT_PEAK_THRESHOLD_DB).toBe(-45)
    expect(SilenceDetector.DEFAULT_MEAN_THRESHOLD_DB).toBe(-40)
  })
})
