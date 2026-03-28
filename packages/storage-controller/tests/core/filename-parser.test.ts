import { describe, it, expect } from 'vitest'
import { parseFilenameDateTime, calculateDurationSeconds } from '../../src/core/filename-parser.js'

describe('parseFilenameDateTime', () => {
  it('parses YYYYMonDD-HHMMSS format (e.g. 2025May13-160405-Rec59.hda)', () => {
    const result = parseFilenameDateTime('2025May13-160405-Rec59.hda')
    expect(result.date).not.toBeNull()
    expect(result.date!.getFullYear()).toBe(2025)
    expect(result.date!.getMonth()).toBe(4)
    expect(result.date!.getDate()).toBe(13)
    expect(result.date!.getHours()).toBe(16)
    expect(result.date!.getMinutes()).toBe(4)
    expect(result.date!.getSeconds()).toBe(5)
  })

  it('parses YYYYMMDDHHMMSSREC format (e.g. 20250513160405REC001.wav)', () => {
    const result = parseFilenameDateTime('20250513160405REC001.wav')
    expect(result.date).not.toBeNull()
    expect(result.date!.getFullYear()).toBe(2025)
    expect(result.date!.getMonth()).toBe(4)
    expect(result.date!.getDate()).toBe(13)
    expect(result.date!.getHours()).toBe(16)
  })

  it('parses HDA_YYYYMMDD_HHMMSS format', () => {
    const result = parseFilenameDateTime('HDA_20250513_160405.hda')
    expect(result.date).not.toBeNull()
    expect(result.date!.getFullYear()).toBe(2025)
    expect(result.date!.getMonth()).toBe(4)
    expect(result.date!.getDate()).toBe(13)
  })

  it('returns null date for unparseable filenames', () => {
    const result = parseFilenameDateTime('random_file.hda')
    expect(result.date).toBeNull()
  })

  it('handles single-digit day (e.g. 2025Jan3-090000)', () => {
    const result = parseFilenameDateTime('2025Jan3-090000-Rec01.hda')
    expect(result.date).not.toBeNull()
    expect(result.date!.getDate()).toBe(3)
    expect(result.date!.getMonth()).toBe(0)
  })
})

describe('calculateDurationSeconds', () => {
  it('calculates v1 duration: size / 8000', () => {
    expect(calculateDurationSeconds(80000, 1)).toBe(10)
  })

  it('calculates v2 duration (48kHz)', () => {
    const headerSize = 44
    const fileSize = headerSize + 24000
    expect(calculateDurationSeconds(fileSize, 2)).toBe(1)
  })

  it('calculates v3 duration (24kHz)', () => {
    const headerSize = 44
    const fileSize = headerSize + 12000
    expect(calculateDurationSeconds(fileSize, 3)).toBe(1)
  })

  it('calculates v5 duration', () => {
    expect(calculateDurationSeconds(3000, 5)).toBe(1)
  })

  it('calculates default version duration', () => {
    expect(calculateDurationSeconds(8000, 99)).toBe(1)
  })

  it('returns 0 for v2/v3 files smaller than WAV header', () => {
    expect(calculateDurationSeconds(40, 2)).toBe(0)
    expect(calculateDurationSeconds(10, 3)).toBe(0)
  })
})
