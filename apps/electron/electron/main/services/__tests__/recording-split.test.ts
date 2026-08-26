/**
 * Recording split service — pure boundary ranking plus mocked FFmpeg execution.
 * No real audio, USB device, or external process is touched by these tests.
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const { commitRecordingSplit } = vi.hoisted(() => ({ commitRecordingSplit: vi.fn() }))
vi.mock('../database', () => ({ commitRecordingSplit }))

import {
  parseMediaDuration,
  parseSilenceIntervals,
  rankSplitSuggestions,
  splitRecording,
} from '../recording-split'

describe('recording split boundary detection', () => {
  it('parses the authoritative duration from an FFmpeg media header', () => {
    expect(parseMediaDuration('  Duration: 01:20:00.25, start: 0.000000')).toBe(4800.25)
    expect(parseMediaDuration('Duration: N/A')).toBeNull()
  })

  it('parses complete and open-ended FFmpeg silence intervals', () => {
    const output = [
      '[silencedetect] silence_start: 12.5',
      '[silencedetect] silence_end: 17.75 | silence_duration: 5.25',
      '[silencedetect] silence_start: 50',
    ].join('\n')

    expect(parseSilenceIntervals(output, 60)).toEqual([
      { startSec: 12.5, endSec: 17.75 },
      { startSec: 50, endSec: 60 },
    ])
  })

  it('raises confidence when audio silence agrees with a transcript gap', () => {
    const speakers = JSON.stringify([
      { start: 0, end: 1195, text: 'meeting' },
      { start: 1205, end: 2000, text: 'interview' },
    ])
    const suggestions = rankSplitSuggestions([{ startSec: 1198, endSec: 1204 }], 4800, speakers)

    expect(suggestions[0]).toMatchObject({
      timeSec: 1201,
      reason: 'silence-and-transcript-gap',
      gapSeconds: 6,
    })
    expect(suggestions[0].confidence).toBeGreaterThan(0.8)
  })

  it('can suggest a transcript-only boundary when silence analysis misses it', () => {
    const speakers = JSON.stringify([
      { start: 0, end: 30, text: 'first' },
      { start: 35, end: 90, text: 'second' },
    ])

    expect(rankSplitSuggestions([], 120, speakers)).toEqual([
      expect.objectContaining({ timeSec: 32.5, reason: 'transcript-gap', gapSeconds: 5 }),
    ])
  })
})

describe('recording split file transaction', () => {
  let folder: string
  let sourcePath: string

  beforeEach(() => {
    commitRecordingSplit.mockReset()
    folder = mkdtempSync(join(tmpdir(), 'hidock-split-test-'))
    sourcePath = join(folder, 'session.hda')
    writeFileSync(sourcePath, 'source-audio')
  })

  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  it('probes a missing source duration, creates two verified lossless outputs, then registers them', async () => {
    const executor = vi.fn((_file, args: readonly string[], _options, callback) => {
      if (args.includes('-t') && args[args.indexOf('-t') + 1] === '0') {
        const inputPath = args[args.indexOf('-i') + 1]
        const seconds = inputPath.includes('Part 1') ? 1200 : inputPath.includes('Part 2') ? 3600 : 4800
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const secs = seconds % 60
        callback(null, '', `Duration: ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.00`)
        return
      }
      const outputPath = args.at(-1)!
      writeFileSync(outputPath, 'mock-flac-audio')
      callback(null, '', '')
    })

    const result = await splitRecording({
      id: 'parent',
      filename: 'session.hda',
      original_filename: 'session.hda',
      file_path: sourcePath,
      file_size: 100,
      duration_seconds: null,
      date_recorded: '2026-08-18T14:25:05.000Z',
      status: 'ready',
      created_at: '2026-08-18T14:30:00.000Z',
      location: 'both',
      transcription_status: 'complete',
      on_device: 1,
      on_local: 1,
      source: 'hidock',
      is_imported: 0,
    }, 1200, executor)

    expect(executor).toHaveBeenCalledTimes(5)
    expect(result.children.map((child) => child.durationSeconds)).toEqual([1200, 3600])
    expect(result.children[1].dateRecorded).toBe('2026-08-18T14:45:05.000Z')
    expect(result.children.every((child) => existsSync(child.filePath))).toBe(true)
    expect(existsSync(sourcePath)).toBe(true)
    expect(commitRecordingSplit).toHaveBeenCalledWith('parent', expect.arrayContaining([
      expect.objectContaining({ filename: 'session - Part 1.flac', transcription_status: 'none' }),
      expect.objectContaining({ filename: 'session - Part 2.flac', transcription_status: 'none' }),
    ]))
  })

  it('rejects a cut too close to either edge before invoking FFmpeg', async () => {
    const executor = vi.fn()
    await expect(splitRecording({
      id: 'parent',
      filename: 'session.hda',
      file_path: sourcePath,
      duration_seconds: 10,
      date_recorded: '2026-08-18T14:25:05.000Z',
      status: 'ready',
      created_at: '2026-08-18T14:30:00.000Z',
      location: 'local-only',
      transcription_status: 'none',
      on_device: 0,
      on_local: 1,
      source: 'external',
      is_imported: 1,
    }, 0.5, executor)).rejects.toThrow('at least 1 second')
    expect(executor).not.toHaveBeenCalled()
  })
})
