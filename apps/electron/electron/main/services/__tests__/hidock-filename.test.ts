// @vitest-environment node

/**
 * parseHiDockFilenameDate (services/hidock-filename) — the authoritative
 * recording start from the device filename. Guards the 2026-07-23 incident:
 * four mp3s that arrived by manual copy got the COPY time as date_recorded
 * because only the app's internal YYYY-MM-DD_HHMM format was parsed, which
 * broke meeting overlap + auto-linking for all of them.
 */

import { describe, it, expect } from 'vitest'
import { parseHiDockFilenameDate, parseHiDockFilenameDateIso } from '../hidock-filename'

describe('parseHiDockFilenameDate', () => {
  it('parses the device format regardless of extension (.hda/.wav/.mp3)', () => {
    for (const name of ['2026Jul23-190839-Rec39d.hda', '2026Jul23-190839-Rec39d.wav', '2026Jul23-190839-Rec39d.mp3']) {
      const d = parseHiDockFilenameDate(name)
      expect(d).toBeDefined()
      expect(d!.getFullYear()).toBe(2026)
      expect(d!.getMonth()).toBe(6) // July
      expect(d!.getDate()).toBe(23)
      expect(d!.getHours()).toBe(19)
      expect(d!.getMinutes()).toBe(8)
      expect(d!.getSeconds()).toBe(39)
    }
  })

  it('parses split-suffix device names (Rec39a/b/c/d)', () => {
    const d = parseHiDockFilenameDate('2026Jul23-180128-Rec39a.mp3')
    expect(d).toBeDefined()
    expect(d!.getHours()).toBe(18)
    expect(d!.getMinutes()).toBe(1)
  })

  it('parses the app-internal saved format (YYYY-MM-DD_HHMM)', () => {
    const d = parseHiDockFilenameDate('2026-07-23_1908-my-meeting.wav')
    expect(d).toBeDefined()
    expect(d!.getHours()).toBe(19)
    expect(d!.getMinutes()).toBe(8)
  })

  it('parses the HDA_ numeric format', () => {
    const d = parseHiDockFilenameDate('HDA_20250708_160405.hda')
    expect(d).toBeDefined()
    expect(d!.getMonth()).toBe(6)
    expect(d!.getHours()).toBe(16)
  })

  it('returns undefined for names without a date (mtime fallback path)', () => {
    expect(parseHiDockFilenameDate('external-2026-07-23T23-28-57.mp3')).toBeUndefined()
    expect(parseHiDockFilenameDate('random-voice-note.mp3')).toBeUndefined()
  })

  it('ISO variant produces a UTC string', () => {
    const iso = parseHiDockFilenameDateIso('2026Jul23-190839-Rec39d.mp3')
    expect(iso).toMatch(/^2026-07-2[34]T\d{2}:08:39\.000Z$/)
  })
})
