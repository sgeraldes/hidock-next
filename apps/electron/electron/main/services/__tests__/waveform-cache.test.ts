import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Point the cache at a throwaway temp dir (real fs, isolated).
let tmpRoot: string
vi.mock('../file-storage', () => ({
  getCachePath: () => tmpRoot
}))

// Import AFTER the mock is registered.
import {
  getWaveformCache,
  setWaveformCache,
  clearWaveformCache,
  CACHE_VERSION
} from '../waveform-cache'

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'wf-cache-'))
})

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('waveform-cache service', () => {
  it('returns null on a cache miss', () => {
    expect(getWaveformCache('does-not-exist')).toBeNull()
  })

  it('persists peaks and loads them back (round-trip)', () => {
    const peaks = [0.1, 0.2, 0.3, 0.9]
    const ok = setWaveformCache('rec-1', peaks, 12.5, 4096)
    expect(ok).toBe(true)

    const entry = getWaveformCache('rec-1')
    expect(entry).not.toBeNull()
    expect(entry!.peaks).toEqual(peaks)
    expect(entry!.duration).toBe(12.5)
    expect(entry!.fileSize).toBe(4096)
    expect(entry!.version).toBe(CACHE_VERSION)
    expect(entry!.sampleCount).toBe(4)
  })

  it('refuses to write empty peaks', () => {
    expect(setWaveformCache('rec-empty', [])).toBe(false)
    expect(getWaveformCache('rec-empty')).toBeNull()
  })

  it('treats an entry as stale when the file size differs (change detection)', () => {
    setWaveformCache('rec-2', [0.5], 5, 1000)
    expect(getWaveformCache('rec-2', 1000)).not.toBeNull() // same size → hit
    expect(getWaveformCache('rec-2', 2000)).toBeNull() // different size → stale miss
  })

  it('clears a single entry', () => {
    setWaveformCache('rec-3', [0.4, 0.6])
    expect(getWaveformCache('rec-3')).not.toBeNull()
    expect(clearWaveformCache('rec-3')).toBe(true)
    expect(getWaveformCache('rec-3')).toBeNull()
  })

  it('sanitises unsafe recording ids (no path traversal outside the cache dir)', () => {
    const ok = setWaveformCache('../../evil/../id', [0.1])
    expect(ok).toBe(true)
    expect(existsSync(join(tmpRoot, 'waveform'))).toBe(true)
    expect(getWaveformCache('../../evil/../id')).not.toBeNull()
  })
})
