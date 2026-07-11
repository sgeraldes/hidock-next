/**
 * Feature lifecycle — runtime start/stop mapping + restart accrual (Track I, I2-b).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveFeatureState, type FeaturesConfig } from '../../../../src/shared/feature-registry'

vi.mock('../config', () => ({
  getConfig: () => ({ features: undefined }),
}))

const startTranscription = vi.fn()
const stopTranscription = vi.fn()
vi.mock('../transcription', () => ({
  startTranscriptionProcessor: (...a: unknown[]) => startTranscription(...a),
  stopTranscriptionProcessor: (...a: unknown[]) => stopTranscription(...a),
}))

const startCalendar = vi.fn()
const stopCalendar = vi.fn()
vi.mock('../../ipc/calendar-handlers', () => ({
  initializeCalendarAutoSync: (...a: unknown[]) => startCalendar(...a),
  stopAutoSync: (...a: unknown[]) => stopCalendar(...a),
}))

const startGraph = vi.fn()
const stopGraph = vi.fn()
vi.mock('../graph-sync', () => ({
  startGraphSync: (...a: unknown[]) => startGraph(...a),
  stopGraphSync: (...a: unknown[]) => stopGraph(...a),
}))

const stopClipboard = vi.fn()
vi.mock('../clipboard-capture', () => ({
  stopClipboardWatch: (...a: unknown[]) => stopClipboard(...a),
}))

import { applyFeatureChanges } from '../feature-lifecycle'

const resolved = (f: FeaturesConfig) => resolveFeatureState(f)
const FULL = resolved({ preset: 'full', flags: {} })
const LIBRARY_ONLY = resolved({ preset: 'library-only', flags: {} })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyFeatureChanges', () => {
  it('full → library-only stops every runtime loop and needs NO restart', async () => {
    const pending = await applyFeatureChanges(FULL, LIBRARY_ONLY)
    expect(stopTranscription).toHaveBeenCalledTimes(1)
    expect(stopCalendar).toHaveBeenCalledTimes(1)
    expect(stopGraph).toHaveBeenCalledTimes(1)
    expect(stopClipboard).toHaveBeenCalledTimes(1)
    // Disables are always live — nothing accrues to pendingRestart.
    expect(pending).toEqual([])
    // No starts fired.
    expect(startTranscription).not.toHaveBeenCalled()
    expect(startCalendar).not.toHaveBeenCalled()
    expect(startGraph).not.toHaveBeenCalled()
  })

  it('library-only → full starts runtime loops and defers assistant to restart', async () => {
    const pending = await applyFeatureChanges(LIBRARY_ONLY, FULL)
    expect(startTranscription).toHaveBeenCalledTimes(1)
    expect(startCalendar).toHaveBeenCalledTimes(1)
    expect(startGraph).toHaveBeenCalledTimes(1)
    // Non-runtime-toggleable enables need a restart (spec §B.3): assistant
    // (boot-blocking vector/RAG init). device-sync is in BOTH presets, so it
    // never transitions here.
    expect(pending).toEqual(['assistant'])
    // Clipboard watch stays user-opt-in — enabling the feature starts nothing.
    expect(stopClipboard).not.toHaveBeenCalled()
  })

  it('enabling device-sync from a preset without it requires a restart (USB safety)', async () => {
    const withoutDevice = resolved({ preset: 'library-only', flags: { 'device-sync': false } })
    const withDevice = resolved({ preset: 'library-only', flags: {} })
    const pending = await applyFeatureChanges(withoutDevice, withDevice)
    expect(pending).toEqual(['device-sync'])
  })

  it('is a no-op when nothing changed', async () => {
    const pending = await applyFeatureChanges(FULL, FULL)
    expect(pending).toEqual([])
    for (const fn of [startTranscription, stopTranscription, startCalendar, stopCalendar, startGraph, stopGraph, stopClipboard]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })

  it('a failing stop never blocks the other actions (best-effort)', async () => {
    stopTranscription.mockImplementation(() => {
      throw new Error('boom')
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending = await applyFeatureChanges(FULL, LIBRARY_ONLY)
    expect(stopCalendar).toHaveBeenCalledTimes(1)
    expect(stopGraph).toHaveBeenCalledTimes(1)
    expect(pending).toEqual([])
    errSpy.mockRestore()
  })
})
