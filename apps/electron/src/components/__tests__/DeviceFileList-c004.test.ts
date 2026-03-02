/**
 * DeviceFileList C-004 Tests
 *
 * Tests for the isFilenameSynced helper that accounts for
 * .hda->.mp3 and .hda->.wav filename normalization.
 */
import { describe, it, expect } from 'vitest'
import { isFilenameSynced } from '../DeviceFileList'

describe('isFilenameSynced (C-004)', () => {
  it('returns true when exact filename is in synced set', () => {
    const synced = new Set(['recording.hda'])
    expect(isFilenameSynced('recording.hda', synced)).toBe(true)
  })

  it('returns true when .mp3 normalized name is in synced set', () => {
    const synced = new Set(['recording.mp3'])
    expect(isFilenameSynced('recording.hda', synced)).toBe(true)
  })

  it('returns true when .wav normalized name is in synced set', () => {
    const synced = new Set(['recording.wav'])
    expect(isFilenameSynced('recording.hda', synced)).toBe(true)
  })

  it('returns false when no variant is in synced set', () => {
    const synced = new Set(['other.mp3'])
    expect(isFilenameSynced('recording.hda', synced)).toBe(false)
  })

  it('handles non-.hda files correctly', () => {
    const synced = new Set(['recording.mp3'])
    expect(isFilenameSynced('recording.mp3', synced)).toBe(true)
  })

  it('handles case-insensitive .HDA extension', () => {
    const synced = new Set(['recording.mp3'])
    expect(isFilenameSynced('recording.HDA', synced)).toBe(true)
  })

  it('returns false for empty synced set', () => {
    const synced = new Set<string>()
    expect(isFilenameSynced('recording.hda', synced)).toBe(false)
  })

  it('handles filenames with multiple dots', () => {
    const synced = new Set(['my.recording.2024.mp3'])
    expect(isFilenameSynced('my.recording.2024.hda', synced)).toBe(true)
  })

  it('does not match partial filenames', () => {
    const synced = new Set(['other-recording.mp3'])
    expect(isFilenameSynced('recording.hda', synced)).toBe(false)
  })
})
