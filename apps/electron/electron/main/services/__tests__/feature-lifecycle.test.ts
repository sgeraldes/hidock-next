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

import { applyFeatureChanges, derivePendingRestart } from '../feature-lifecycle'

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

describe('derivePendingRestart (Review-2 [MEDIUM]: derived from desired vs boot-effective)', () => {
  // Boot with device-sync OFF (assistant stays ON in the full baseline).
  const BOOT = resolved({ preset: 'full', flags: { 'device-sync': false } })

  it('is empty when the desired state matches boot', () => {
    expect(derivePendingRestart(BOOT, BOOT)).toEqual([])
  })

  it('flags a live-ENABLED restart-gated feature (device-sync on after booting off)', () => {
    const desired = resolved({ preset: 'full', flags: {} }) // device-sync now on
    expect(derivePendingRestart(desired, BOOT)).toEqual(['device-sync'])
  })

  it('an UNRELATED runtime toggle never clears an existing pending restart', () => {
    // device-sync live-enabled AND calendar (runtime) turned off in the same edit.
    const desired = resolved({ preset: 'full', flags: { calendar: false } })
    // calendar is runtime-toggleable, so it never accrues; device-sync stays pending.
    expect(derivePendingRestart(desired, BOOT)).toEqual(['device-sync'])
  })

  it('reverting a feature back to its boot state removes it from the set (no stored flag)', () => {
    // Revert: device-sync desired OFF again == boot OFF ⇒ nothing pending.
    const reverted = resolved({ preset: 'full', flags: { 'device-sync': false } })
    expect(derivePendingRestart(reverted, BOOT)).toEqual([])
  })

  it('unions ALL live-enabled restart-gated features (device-sync + assistant), in registry order', () => {
    // Boot with BOTH restart-gated features off; desire both on ⇒ both pending.
    const bootOff = resolved({ preset: 'full', flags: { 'device-sync': false, assistant: false } })
    const desired = resolved({ preset: 'full', flags: {} }) // both on
    expect(derivePendingRestart(desired, bootOff)).toEqual(['device-sync', 'assistant'])
  })

  it('a live-DISABLE of a restart-gated feature IS a pending restart (symmetric boot gate)', () => {
    // The gate is pinned to boot in BOTH directions: a live disable leaves the
    // feature functional until restart (never strand active USB work), so the
    // banner must honestly flag it as pending.
    const bootFull = resolved({ preset: 'full', flags: {} })
    const desiredDisable = resolved({ preset: 'full', flags: { assistant: false } })
    expect(derivePendingRestart(desiredDisable, bootFull)).toEqual(['assistant'])
    // Same via a cascade disable (transcription off ⇒ assistant cascade-off).
    const cascade = resolved({ preset: 'full', flags: { transcription: false } })
    expect(derivePendingRestart(cascade, bootFull)).toEqual(['assistant'])
    // Disabling both restart-gated features unions them, in registry order.
    const bothOff = resolved({ preset: 'full', flags: { 'device-sync': false, assistant: false } })
    expect(derivePendingRestart(bothOff, bootFull)).toEqual(['device-sync', 'assistant'])
  })

  it('is symmetric: lone disable and lone enable both flag pendingRestart relative to boot', () => {
    const bootOn = resolved({ preset: 'full', flags: {} })
    const bootOffDevice = resolved({ preset: 'full', flags: { 'device-sync': false } })
    const desiredOffDevice = resolved({ preset: 'full', flags: { 'device-sync': false } })
    const desiredOn = resolved({ preset: 'full', flags: {} })
    // Lone disable relative to boot-on ⇒ pending.
    expect(derivePendingRestart(desiredOffDevice, bootOn)).toEqual(['device-sync'])
    // Lone enable relative to boot-off ⇒ pending.
    expect(derivePendingRestart(desiredOn, bootOffDevice)).toEqual(['device-sync'])
  })

  it('never flags a runtime-toggleable feature even when it differs from boot', () => {
    // transcription (runtime) enabled vs boot off ⇒ still not a restart.
    const bootOff = resolved({ preset: 'library-only', flags: {} }) // transcription off
    const desired = resolved({ preset: 'library-only', flags: { transcription: true } })
    expect(derivePendingRestart(desired, bootOff)).toEqual([])
    // And the disable direction: calendar (runtime) off vs boot on ⇒ not a restart.
    const bootOn = resolved({ preset: 'full', flags: {} })
    const desiredOff = resolved({ preset: 'full', flags: { calendar: false } })
    expect(derivePendingRestart(desiredOff, bootOn)).toEqual([])
  })
})
