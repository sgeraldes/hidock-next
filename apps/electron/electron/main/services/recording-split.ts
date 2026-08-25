import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, renameSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import {
  commitRecordingSplit,
  type Recording,
  type RecordingSplitChild,
} from './database'

const SILENCE_THRESHOLD_DB = -40
const MIN_SILENCE_SECONDS = 1.25
const MIN_PART_SECONDS = 1
const MIN_SUGGESTED_PART_SECONDS = 30

export interface RecordingSplitSuggestion {
  timeSec: number
  confidence: number
  reason: 'silence' | 'transcript-gap' | 'silence-and-transcript-gap'
  silenceStartSec?: number
  silenceEndSec?: number
  gapSeconds: number
}

export interface RecordingSplitResult {
  originalRecordingId: string
  children: Array<{
    id: string
    filename: string
    filePath: string
    durationSeconds: number
    dateRecorded: string
  }>
}

interface SilenceInterval {
  startSec: number
  endSec: number
}

interface TranscriptSegmentLike {
  start?: unknown
  end?: unknown
}

type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { windowsHide: boolean; maxBuffer: number },
  callback: (error: Error | null, stdout: string, stderr: string) => void
) => void

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function ffmpegExecutable(): string {
  if (!ffmpegPath) throw new Error('Bundled FFmpeg is unavailable')
  return ffmpegPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

function runFfmpeg(args: string[], executor: ExecFileLike = execFile as unknown as ExecFileLike): Promise<string> {
  return new Promise((resolve, reject) => {
    executor(
      ffmpegExecutable(),
      args,
      { windowsHide: true, maxBuffer: 20 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message))
          return
        }
        resolve(stderr)
      }
    )
  })
}

/** Read FFmpeg's media-header duration without depending on a separate ffprobe binary. */
export function parseMediaDuration(output: string): number | null {
  const match = output.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!match) return null
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return Number.isFinite(duration) && duration > 0 ? round(duration) : null
}

async function probeMediaDuration(filePath: string, executor?: ExecFileLike): Promise<number> {
  const output = await runFfmpeg([
    '-hide_banner', '-nostats',
    '-i', filePath,
    '-map', '0:a:0', '-t', '0', '-f', 'null', '-',
  ], executor)
  const duration = parseMediaDuration(output)
  if (!duration) throw new Error('Could not determine the audio duration')
  return duration
}

/** Parse FFmpeg silencedetect output. Open-ended silence is closed at duration. */
export function parseSilenceIntervals(output: string, durationSeconds: number): SilenceInterval[] {
  const intervals: SilenceInterval[] = []
  let openStart: number | null = null

  for (const line of output.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([\d.]+)/)
    if (start) openStart = Math.max(0, Math.min(durationSeconds, Number(start[1])))

    const end = line.match(/silence_end:\s*([\d.]+)/)
    if (end) {
      const endSec = Math.max(0, Math.min(durationSeconds, Number(end[1])))
      const startSec = openStart ?? 0
      if (Number.isFinite(endSec) && endSec > startSec) intervals.push({ startSec, endSec })
      openStart = null
    }
  }

  if (openStart !== null && durationSeconds > openStart) {
    intervals.push({ startSec: openStart, endSec: durationSeconds })
  }

  return intervals
}

function parseTranscriptGaps(speakersJson?: string | null): Array<{ startSec: number; endSec: number }> {
  if (!speakersJson) return []
  try {
    const parsed = JSON.parse(speakersJson) as TranscriptSegmentLike[]
    if (!Array.isArray(parsed)) return []
    const segments = parsed
      .map((segment) => ({ start: Number(segment.start), end: Number(segment.end) }))
      .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end >= segment.start)
      .sort((a, b) => a.start - b.start)

    const gaps: Array<{ startSec: number; endSec: number }> = []
    for (let index = 1; index < segments.length; index += 1) {
      const startSec = segments[index - 1].end
      const endSec = segments[index].start
      if (endSec - startSec >= MIN_SILENCE_SECONDS) gaps.push({ startSec, endSec })
    }
    return gaps
  } catch {
    return []
  }
}

/**
 * Rank likely session boundaries. Long audio silence is the primary signal;
 * agreement with a timestamped transcript gap raises confidence. Candidates near
 * either edge are intentionally excluded because they cannot separate sessions.
 */
export function rankSplitSuggestions(
  silences: SilenceInterval[],
  durationSeconds: number,
  speakersJson?: string | null
): RecordingSplitSuggestion[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= MIN_PART_SECONDS * 2) return []
  const transcriptGaps = parseTranscriptGaps(speakersJson)
  const raw: RecordingSplitSuggestion[] = []

  for (const silence of silences) {
    const gapSeconds = silence.endSec - silence.startSec
    const timeSec = (silence.startSec + silence.endSec) / 2
    if (gapSeconds < MIN_SILENCE_SECONDS || timeSec < MIN_SUGGESTED_PART_SECONDS || durationSeconds - timeSec < MIN_SUGGESTED_PART_SECONDS) continue
    const transcriptMatch = transcriptGaps.some((gap) => gap.startSec <= silence.endSec && gap.endSec >= silence.startSec)
    raw.push({
      timeSec: round(timeSec),
      confidence: round(Math.min(0.98, 0.58 + Math.min(gapSeconds, 12) * 0.025 + (transcriptMatch ? 0.12 : 0)), 2),
      reason: transcriptMatch ? 'silence-and-transcript-gap' : 'silence',
      silenceStartSec: round(silence.startSec),
      silenceEndSec: round(silence.endSec),
      gapSeconds: round(gapSeconds),
    })
  }

  for (const gap of transcriptGaps) {
    const timeSec = (gap.startSec + gap.endSec) / 2
    if (timeSec < MIN_SUGGESTED_PART_SECONDS || durationSeconds - timeSec < MIN_SUGGESTED_PART_SECONDS) continue
    if (raw.some((candidate) => Math.abs(candidate.timeSec - timeSec) <= 2)) continue
    const gapSeconds = gap.endSec - gap.startSec
    raw.push({
      timeSec: round(timeSec),
      confidence: round(Math.min(0.82, 0.48 + Math.min(gapSeconds, 10) * 0.025), 2),
      reason: 'transcript-gap',
      gapSeconds: round(gapSeconds),
    })
  }

  return raw
    .sort((a, b) => b.confidence - a.confidence || b.gapSeconds - a.gapSeconds || a.timeSec - b.timeSec)
    .slice(0, 6)
}

export async function detectRecordingSplitSuggestions(
  recording: Recording,
  speakersJson?: string | null,
  executor?: ExecFileLike
): Promise<RecordingSplitSuggestion[]> {
  if (!recording.file_path || !existsSync(recording.file_path)) throw new Error('The local audio file is unavailable')

  const output = await runFfmpeg([
    '-hide_banner',
    '-nostats',
    '-i', recording.file_path,
    '-af', `silencedetect=noise=${SILENCE_THRESHOLD_DB}dB:d=${MIN_SILENCE_SECONDS}`,
    '-f', 'null',
    '-',
  ], executor)

  // The media header is authoritative. A decoded duration may exist even when
  // the database row was imported without duration_seconds.
  const durationSeconds = parseMediaDuration(output) ?? recording.duration_seconds ?? 0
  if (durationSeconds <= MIN_PART_SECONDS * 2) return []

  return rankSplitSuggestions(parseSilenceIntervals(output, durationSeconds), durationSeconds, speakersJson)
}

function uniqueOutputPath(parentPath: string, part: 1 | 2): string {
  const folder = dirname(parentPath)
  const sourceBase = basename(parentPath, extname(parentPath)).replace(/\s+-\s+Part\s+[12]$/i, '')
  const stem = `${sourceBase} - Part ${part}`
  let candidate = join(folder, `${stem}.flac`)
  let suffix = 2
  while (existsSync(candidate)) {
    candidate = join(folder, `${stem} (${suffix}).flac`)
    suffix += 1
  }
  return candidate
}

function safeUnlink(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {
    // Best-effort rollback cleanup. The original recording is never modified.
  }
}

export async function splitRecording(
  recording: Recording,
  splitTimeSec: number,
  executor?: ExecFileLike
): Promise<RecordingSplitResult> {
  if (!recording.file_path || !existsSync(recording.file_path)) throw new Error('The local audio file is unavailable')
  const storedDuration = recording.duration_seconds ?? 0
  if (!Number.isFinite(splitTimeSec) || splitTimeSec < MIN_PART_SECONDS
    || (storedDuration > 0 && storedDuration - splitTimeSec < MIN_PART_SECONDS)) {
    throw new Error(`Choose a cut point at least ${MIN_PART_SECONDS} second from either end`)
  }

  const durationSeconds = await probeMediaDuration(recording.file_path, executor)
  if (durationSeconds - splitTimeSec < MIN_PART_SECONDS) {
    throw new Error(`Choose a cut point at least ${MIN_PART_SECONDS} second from either end`)
  }

  const firstPath = uniqueOutputPath(recording.file_path, 1)
  const secondPath = uniqueOutputPath(recording.file_path, 2)
  // Keep staging extensions outside the watcher's supported-audio list; only
  // the verified final rename should be visible as a new Library source.
  const firstTemp = `${firstPath}.${randomUUID()}.part`
  const secondTemp = `${secondPath}.${randomUUID()}.part`

  try {
    // Decode and re-encode losslessly so the boundary is sample-accurate even
    // when the source is a compressed HDA/M4A stream with coarse packet frames.
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', recording.file_path,
      '-t', splitTimeSec.toFixed(3),
      '-map', '0:a:0', '-vn', '-c:a', 'flac', '-f', 'flac', firstTemp,
    ], executor)
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', recording.file_path,
      '-ss', splitTimeSec.toFixed(3),
      '-map', '0:a:0', '-vn', '-c:a', 'flac', '-f', 'flac', secondTemp,
    ], executor)

    if (statSync(firstTemp).size <= 0 || statSync(secondTemp).size <= 0) {
      throw new Error('FFmpeg produced an empty split file')
    }

    const firstDuration = await probeMediaDuration(firstTemp, executor)
    const secondDuration = await probeMediaDuration(secondTemp, executor)
    const durationToleranceSeconds = 0.2
    if (Math.abs(firstDuration - splitTimeSec) > durationToleranceSeconds
      || Math.abs(secondDuration - (durationSeconds - splitTimeSec)) > durationToleranceSeconds) {
      throw new Error('The split output durations did not match the requested boundary')
    }
    renameSync(firstTemp, firstPath)
    renameSync(secondTemp, secondPath)

    const parentStart = new Date(recording.date_recorded)
    const startMs = Number.isNaN(parentStart.getTime()) ? Date.now() : parentStart.getTime()
    const children: RecordingSplitChild[] = [
      {
        id: randomUUID(),
        filename: basename(firstPath),
        original_filename: recording.original_filename ?? recording.filename,
        file_path: firstPath,
        file_size: statSync(firstPath).size,
        duration_seconds: firstDuration,
        date_recorded: new Date(startMs).toISOString(),
        status: 'ready',
        location: 'local-only',
        transcription_status: 'none',
        on_device: 0,
        on_local: 1,
        source: recording.source,
        is_imported: recording.is_imported,
      },
      {
        id: randomUUID(),
        filename: basename(secondPath),
        original_filename: recording.original_filename ?? recording.filename,
        file_path: secondPath,
        file_size: statSync(secondPath).size,
        duration_seconds: secondDuration,
        date_recorded: new Date(startMs + splitTimeSec * 1000).toISOString(),
        status: 'ready',
        location: 'local-only',
        transcription_status: 'none',
        on_device: 0,
        on_local: 1,
        source: recording.source,
        is_imported: recording.is_imported,
      },
    ]

    commitRecordingSplit(recording.id, children)
    return {
      originalRecordingId: recording.id,
      children: children.map((child) => ({
        id: child.id,
        filename: child.filename,
        filePath: child.file_path,
        durationSeconds: child.duration_seconds,
        dateRecorded: child.date_recorded,
      })),
    }
  } catch (error) {
    safeUnlink(firstTemp)
    safeUnlink(secondTemp)
    safeUnlink(firstPath)
    safeUnlink(secondPath)
    throw error
  }
}
