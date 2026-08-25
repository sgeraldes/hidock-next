import { execFile } from 'child_process'
import ffmpegPath from 'ffmpeg-static'

const SILENCE_THRESHOLD_DB = -45
const MINIMUM_SILENCE_SECONDS = 0.25
const MINIMUM_RECORDING_SECONDS_FOR_RATIO_GATE = 30
const MINIMUM_ACTIVITY_SECONDS = 3
const MINIMUM_ACTIVITY_RATIO = 0.03

export interface AudioActivityInterval {
  start: number
  end: number
  duration: number
}

export interface AudioPreflightReport {
  status: 'speech_present' | 'no_speech'
  durationSeconds: number
  silenceSeconds: number
  nonSilentSeconds: number
  nonSilentRatio: number
  meanVolumeDb: number | null
  maxVolumeDb: number | null
  silenceThresholdDb: number
  minimumSilenceSeconds: number
  activityIntervals: AudioActivityInterval[]
  reasonCodes: string[]
}

export class AudioPreflightError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioPreflightError'
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function parseNumber(output: string, pattern: RegExp): number | null {
  const match = output.match(pattern)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function parseDuration(output: string): number | null {
  const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!match) return null
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

/** Parse ffmpeg silencedetect/volumedetect output into a local safety report. */
export function parseAudioPreflightOutput(
  output: string,
  knownDurationSeconds?: number | null
): AudioPreflightReport {
  const duration = knownDurationSeconds && knownDurationSeconds > 0
    ? knownDurationSeconds
    : parseDuration(output)
  if (!duration) throw new AudioPreflightError('Audio preflight could not determine recording duration')

  const silenceIntervals: Array<{ start: number; end: number }> = []
  let openSilenceStart: number | null = null
  for (const line of output.split(/\r?\n/)) {
    const start = parseNumber(line, /silence_start:\s*([\d.]+)/)
    if (start !== null) openSilenceStart = Math.max(0, Math.min(duration, start))

    const end = parseNumber(line, /silence_end:\s*([\d.]+)/)
    if (end !== null) {
      const boundedEnd = Math.max(0, Math.min(duration, end))
      const boundedStart = openSilenceStart ?? 0
      if (boundedEnd > boundedStart) silenceIntervals.push({ start: boundedStart, end: boundedEnd })
      openSilenceStart = null
    }
  }
  if (openSilenceStart !== null && duration > openSilenceStart) {
    silenceIntervals.push({ start: openSilenceStart, end: duration })
  }

  const mergedSilence: Array<{ start: number; end: number }> = []
  for (const interval of silenceIntervals.sort((a, b) => a.start - b.start)) {
    const previous = mergedSilence[mergedSilence.length - 1]
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end)
    else mergedSilence.push({ ...interval })
  }

  const activityIntervals: AudioActivityInterval[] = []
  let cursor = 0
  for (const silence of mergedSilence) {
    if (silence.start > cursor) {
      activityIntervals.push({
        start: round(cursor),
        end: round(silence.start),
        duration: round(silence.start - cursor)
      })
    }
    cursor = Math.max(cursor, silence.end)
  }
  if (cursor < duration) {
    activityIntervals.push({ start: round(cursor), end: round(duration), duration: round(duration - cursor) })
  }

  const silenceSeconds = Math.min(
    duration,
    mergedSilence.reduce((total, interval) => total + interval.end - interval.start, 0)
  )
  const nonSilentSeconds = Math.max(0, duration - silenceSeconds)
  const nonSilentRatio = nonSilentSeconds / duration
  const meanVolumeDb = parseNumber(output, /mean_volume:\s*(-?[\d.]+)\s*dB/)
  const maxVolumeDb = parseNumber(output, /max_volume:\s*(-?[\d.]+)\s*dB/)
  const reasonCodes: string[] = []
  const effectivelySilent = nonSilentSeconds <= 0.25
  const insufficientActivity =
    duration >= MINIMUM_RECORDING_SECONDS_FOR_RATIO_GATE &&
    nonSilentSeconds < MINIMUM_ACTIVITY_SECONDS &&
    nonSilentRatio < MINIMUM_ACTIVITY_RATIO

  if (effectivelySilent) reasonCodes.push('no_audio_activity')
  if (insufficientActivity) reasonCodes.push('insufficient_sustained_audio_activity')

  return {
    status: effectivelySilent || insufficientActivity ? 'no_speech' : 'speech_present',
    durationSeconds: round(duration),
    silenceSeconds: round(silenceSeconds),
    nonSilentSeconds: round(nonSilentSeconds),
    nonSilentRatio: round(nonSilentRatio),
    meanVolumeDb,
    maxVolumeDb,
    silenceThresholdDb: SILENCE_THRESHOLD_DB,
    minimumSilenceSeconds: MINIMUM_SILENCE_SECONDS,
    activityIntervals,
    reasonCodes
  }
}

export async function analyzeAudioPreflight(
  filePath: string,
  knownDurationSeconds?: number | null
): Promise<AudioPreflightReport> {
  if (!ffmpegPath) {
    throw new AudioPreflightError('Bundled ffmpeg is unavailable; automatic transcription was blocked')
  }
  // electron-builder unpacks native executables beside app.asar. Development
  // paths do not contain app.asar, so the replacement is harmless there.
  const executable = ffmpegPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      [
        '-hide_banner', '-nostats', '-i', filePath,
        '-af', `silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=${MINIMUM_SILENCE_SECONDS},volumedetect`,
        '-f', 'null', '-'
      ],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new AudioPreflightError(`Audio preflight failed: ${error.message}`))
          return
        }
        resolve(stderr)
      }
    )
  })

  return parseAudioPreflightOutput(output, knownDurationSeconds)
}
