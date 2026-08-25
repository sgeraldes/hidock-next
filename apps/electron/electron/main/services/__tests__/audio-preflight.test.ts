import { describe, expect, it } from 'vitest'
import { AudioPreflightError, parseAudioPreflightOutput } from '../audio-preflight'

describe('audio transcription preflight', () => {
  it('classifies a long lobby recording containing only brief cough/noise as no_speech', () => {
    const output = `
Duration: 00:02:54.85, start: 0.000000, bitrate: 64 kb/s
[silencedetect] silence_start: 0
[silencedetect] silence_end: 0.700 | silence_duration: 0.700
[silencedetect] silence_start: 1.500
[silencedetect] silence_end: 100.000 | silence_duration: 98.500
[silencedetect] silence_start: 100.670
[silencedetect] silence_end: 174.8535 | silence_duration: 74.1835
[Parsed_volumedetect] mean_volume: -44.6 dB
[Parsed_volumedetect] max_volume: -5.7 dB
`

    const report = parseAudioPreflightOutput(output, 174.8535)

    expect(report.status).toBe('no_speech')
    expect(report.nonSilentSeconds).toBe(1.47)
    expect(report.nonSilentRatio).toBeLessThan(0.01)
    expect(report.maxVolumeDb).toBe(-5.7)
    expect(report.reasonCodes).toContain('insufficient_sustained_audio_activity')
  })

  it('allows a recording with sustained audio activity to reach ASR', () => {
    const output = `
Duration: 00:01:00.00, start: 0.000000, bitrate: 64 kb/s
[silencedetect] silence_start: 0
[silencedetect] silence_end: 5.000 | silence_duration: 5.000
[silencedetect] silence_start: 55.000
[silencedetect] silence_end: 60.000 | silence_duration: 5.000
[Parsed_volumedetect] mean_volume: -24.0 dB
[Parsed_volumedetect] max_volume: -3.0 dB
`

    const report = parseAudioPreflightOutput(output)

    expect(report.status).toBe('speech_present')
    expect(report.nonSilentSeconds).toBe(50)
    expect(report.activityIntervals).toEqual([{ start: 5, end: 55, duration: 50 }])
  })

  it('fails closed when duration cannot be established', () => {
    expect(() => parseAudioPreflightOutput('invalid ffmpeg output')).toThrow(AudioPreflightError)
  })
})
