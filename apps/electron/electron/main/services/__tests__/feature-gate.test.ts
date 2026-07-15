/**
 * Feature gate (Gate 2) — fail-closed IPC enforcement tests (Track I, I2-b).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FeaturesConfig } from '../../../../src/shared/feature-registry'

// Controllable config: tests flip `featuresConfig` to simulate preset changes.
let featuresConfig: FeaturesConfig | undefined
vi.mock('../config', () => ({
  getConfig: () => ({ features: featuresConfig }),
}))

import {
  FeatureDisabledError,
  gateInvokeHandler,
  gatedHandle,
  installFeatureGate,
  isFeatureEnabled,
  getResolvedFeatures,
  captureBootEffectiveFeatures,
  __resetBootEffectiveFeaturesForTests,
} from '../feature-gate'

beforeEach(() => {
  featuresConfig = undefined // default `full`
  // Forget any boot snapshot so the gate falls back to the live desired state —
  // the behavior every pre-existing test below relies on.
  __resetBootEffectiveFeaturesForTests()
})

describe('isFeatureEnabled / getResolvedFeatures', () => {
  it('defaults to enabled (full) when config.features is unset', () => {
    expect(isFeatureEnabled('transcription')).toBe(true)
    expect(isFeatureEnabled('assistant')).toBe(true)
    expect(getResolvedFeatures().calendar.enabled).toBe(true)
  })

  it('reflects the active preset live', () => {
    featuresConfig = { preset: 'library-only', flags: {} }
    expect(isFeatureEnabled('transcription')).toBe(false)
    expect(isFeatureEnabled('device-sync')).toBe(true)
    featuresConfig = { preset: 'full', flags: {} }
    expect(isFeatureEnabled('transcription')).toBe(true)
  })
})

describe('gateInvokeHandler', () => {
  const event = {} as never

  it('passes gated channels through when the feature is enabled (full preset)', async () => {
    const handler = vi.fn().mockResolvedValue('ok')
    const gated = gateInvokeHandler('transcription:cancel', handler)
    await expect(gated(event, 'rec-1')).resolves.toBe('ok')
    expect(handler).toHaveBeenCalledWith(event, 'rec-1')
  })

  it('fails CLOSED with FeatureDisabledError when the owning feature is disabled', () => {
    featuresConfig = { preset: 'library-only', flags: {} }
    const handler = vi.fn()
    const gated = gateInvokeHandler('assistant:getConversations', handler)
    let thrown: unknown
    try {
      gated(event)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(FeatureDisabledError)
    const err = thrown as FeatureDisabledError
    expect(err.featureId).toBe('assistant')
    expect(err.channel).toBe('assistant:getConversations')
    // Clear message: names the feature and how to enable it.
    expect(err.message).toContain('Assistant')
    expect(err.message).toContain('disabled')
    expect(err.message).toContain('Settings')
    expect(handler).not.toHaveBeenCalled()
  })

  it('gates cascade-disabled features too (assistant off via requires:transcription)', () => {
    featuresConfig = { preset: 'full', flags: { transcription: false } }
    const gated = gateInvokeHandler('rag:chat', vi.fn())
    expect(() => gated(event)).toThrow(FeatureDisabledError)
  })

  it('never gates shared/core channels, even under library-only', async () => {
    featuresConfig = { preset: 'library-only', flags: {} }
    for (const channel of ['config:get', 'db:get-recordings', 'knowledge:getAll', 'app:info']) {
      const handler = vi.fn().mockResolvedValue('data')
      const gated = gateInvokeHandler(channel, handler)
      await expect(gated(event)).resolves.toBe('data')
    }
  })

  it('gates exact channels on the shared recordings: namespace without gating its siblings', async () => {
    featuresConfig = { preset: 'library-only', flags: {} }
    // meeting-intelligence-owned exact channel → gated
    expect(() => gateInvokeHandler('recordings:analyzeTimeline', vi.fn())({} as never)).toThrow(
      FeatureDisabledError
    )
    // library read on the same prefix → open
    const read = vi.fn().mockResolvedValue([])
    await expect(gateInvokeHandler('recordings:delete', read)({} as never)).resolves.toEqual([])
  })

  it('reads the flag LIVE — re-enabling a feature unblocks the SAME wrapped handler', async () => {
    const handler = vi.fn().mockResolvedValue('ok')
    const gated = gateInvokeHandler('calendar:sync', handler)
    featuresConfig = { preset: 'library-only', flags: {} }
    expect(() => gated(event)).toThrow(FeatureDisabledError)
    featuresConfig = { preset: 'library-only', flags: { calendar: true } }
    await expect(gated(event)).resolves.toBe('ok')
  })
})

describe('gatedHandle + installFeatureGate (registrar interception)', () => {
  function fakeIpcMain() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    return {
      handlers,
      handle: vi.fn(function (this: unknown, channel: string, fn: (...args: unknown[]) => unknown) {
        handlers.set(channel, fn)
      }),
    }
  }

  it('gatedHandle registers a gated wrapper on the given ipcMain', () => {
    featuresConfig = { preset: 'library-only', flags: {} }
    const ipc = fakeIpcMain()
    gatedHandle(ipc as never, 'transcription:getQueue', vi.fn())
    expect(() => ipc.handlers.get('transcription:getQueue')!({} as never)).toThrow(
      FeatureDisabledError
    )
  })

  it('installFeatureGate wraps every handle() in scope and restore() undoes it', () => {
    featuresConfig = { preset: 'library-only', flags: {} }
    const ipc = fakeIpcMain()
    const restore = installFeatureGate(ipc as never)

    const gatedFn = vi.fn().mockReturnValue('gated-result')
    const coreFn = vi.fn().mockReturnValue('core-result')
    ipc.handle('assistant:getMessages', gatedFn)
    ipc.handle('config:get', coreFn)
    restore()
    // Registered AFTER restore → raw, ungated (even for an owned channel).
    const postFn = vi.fn().mockReturnValue('post-result')
    ipc.handle('assistant:getConversations', postFn)

    // Disabled feature's channel fails closed…
    expect(() => ipc.handlers.get('assistant:getMessages')!({} as never)).toThrow(
      FeatureDisabledError
    )
    expect(gatedFn).not.toHaveBeenCalled()
    // …core channel passes…
    expect(ipc.handlers.get('config:get')!({} as never)).toBe('core-result')
    // …and post-restore registration is untouched.
    expect(ipc.handlers.get('assistant:getConversations')!({} as never)).toBe('post-result')
  })

  it('under the default full preset the installed gate changes nothing', () => {
    const ipc = fakeIpcMain()
    const restore = installFeatureGate(ipc as never)
    const fn = vi.fn().mockReturnValue(42)
    ipc.handle('assistant:getMessages', fn)
    restore()
    expect(ipc.handlers.get('assistant:getMessages')!({} as never, 'conv')).toBe(42)
    expect(fn).toHaveBeenCalled()
  })
})

describe('boot-effective gate for restart-gated features (Review-2 [CRITICAL], USB safety)', () => {
  const event = {} as never

  it('live-ENABLING device-sync does NOT open jensen/device-pipeline IPC until the next boot', () => {
    // Boot with device-sync OFF.
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }
    captureBootEffectiveFeatures()
    expect(isFeatureEnabled('device-sync')).toBe(false)
    for (const ch of ['jensen:connect', 'device-pipeline:connect', 'deviceCache:getAll']) {
      expect(() => gateInvokeHandler(ch, vi.fn())(event), ch).toThrow(FeatureDisabledError)
    }

    // User live-enables device-sync — the DESIRED config now has it on…
    featuresConfig = { preset: 'full', flags: {} }
    expect(getResolvedFeatures()['device-sync'].enabled).toBe(true) // desired says on
    // …but the gate keeps rejecting because it was OFF at boot (never yank USB live).
    expect(isFeatureEnabled('device-sync')).toBe(false)
    expect(() => gateInvokeHandler('jensen:connect', vi.fn())(event)).toThrow(FeatureDisabledError)

    // Simulate the next boot: re-capture the snapshot from the current desired config.
    captureBootEffectiveFeatures()
    expect(isFeatureEnabled('device-sync')).toBe(true)
    const handler = vi.fn().mockReturnValue('ok')
    expect(gateInvokeHandler('jensen:connect', handler)(event)).toBe('ok')
    expect(handler).toHaveBeenCalled()
  })

  it('live-DISABLING device-sync leaves it functional until restart (SYMMETRIC boot gate — never strand USB work)', () => {
    // Boot with everything on (device-sync enabled at boot).
    featuresConfig = { preset: 'full', flags: {} }
    captureBootEffectiveFeatures()
    expect(gateInvokeHandler('jensen:connect', vi.fn().mockReturnValue('ok'))(event)).toBe('ok')

    // Disable device-sync live. The DESIRED config records the intent…
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }
    expect(getResolvedFeatures()['device-sync'].enabled).toBe(false) // desired says off
    // …but the gate consults boot-effective ONLY: the feature stays functional
    // (status quo ante). Closing it live would strand an active connection /
    // download / scan while making its own teardown channels unreachable.
    expect(isFeatureEnabled('device-sync')).toBe(true)

    // Mock-only regression: disable while (a) connected, (b) scanning,
    // (c) downloading — every cleanup/teardown channel remains callable, and no
    // channel is gated off prematurely.
    const CLEANUP_CHANNELS: Record<string, string[]> = {
      connected: ['jensen:disconnect', 'jensen:reset', 'device-pipeline:disconnect'],
      scanning: ['jensen:stopBluetoothScan', 'jensen:listFiles', 'device-pipeline:cancel'],
      downloading: [
        'jensen:cancelDownload',
        'download-service:cancel-active',
        'download-service:cancel-all',
      ],
    }
    for (const [scenario, channels] of Object.entries(CLEANUP_CHANNELS)) {
      for (const ch of channels) {
        const handler = vi.fn().mockReturnValue('done')
        expect(gateInvokeHandler(ch, handler)(event), `${scenario}: ${ch}`).toBe('done')
        expect(handler, `${scenario}: ${ch}`).toHaveBeenCalled()
      }
    }

    // Disable-then-reenable within one session never transitions the gate at all.
    featuresConfig = { preset: 'full', flags: {} } // re-enable
    expect(isFeatureEnabled('device-sync')).toBe(true) // same gate state throughout

    // Only the NEXT BOOT applies a pending disable.
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }
    captureBootEffectiveFeatures() // simulate reboot with the disable persisted
    expect(isFeatureEnabled('device-sync')).toBe(false)
    expect(() => gateInvokeHandler('jensen:disconnect', vi.fn())(event)).toThrow(
      FeatureDisabledError
    )
  })

  it('the gate never transitions mid-session for restart-gated features, in EITHER direction', () => {
    // Boot ON: stays on through any number of live flips.
    featuresConfig = { preset: 'full', flags: {} }
    captureBootEffectiveFeatures()
    for (const flags of [{ 'device-sync': false }, {}, { 'device-sync': false }, {}]) {
      featuresConfig = { preset: 'full', flags }
      expect(isFeatureEnabled('device-sync')).toBe(true)
      expect(isFeatureEnabled('assistant')).toBe(true)
    }
    // Boot OFF: stays off through any number of live flips.
    featuresConfig = { preset: 'full', flags: { 'device-sync': false, assistant: false } }
    captureBootEffectiveFeatures()
    for (const flags of [{}, { 'device-sync': true, assistant: true }] as const) {
      featuresConfig = { preset: 'full', flags: flags as never }
      expect(isFeatureEnabled('device-sync')).toBe(false)
      expect(isFeatureEnabled('assistant')).toBe(false)
    }
  })

  it('runtime-toggleable features still read the flag LIVE (no boot pinning)', () => {
    // Boot with transcription OFF.
    featuresConfig = { preset: 'library-only', flags: {} }
    captureBootEffectiveFeatures()
    expect(isFeatureEnabled('transcription')).toBe(false)
    // Live-enable transcription → available immediately (it is runtime-toggleable).
    featuresConfig = { preset: 'library-only', flags: { transcription: true } }
    expect(isFeatureEnabled('transcription')).toBe(true)
    expect(gateInvokeHandler('transcription:getQueue', vi.fn().mockReturnValue([]))(event)).toEqual(
      []
    )
  })
})

describe('transcription-owned recordings:* channels (Review-2 [HIGH])', () => {
  const event = {} as never
  // The trigger/control channels that previously slipped through unclassified.
  const TRIGGERS = [
    'recordings:transcribe',
    'recordings:addToQueue',
    'recordings:processQueue',
    'recordings:reprocessWith',
    'recordings:startTranscriptionProcessor',
    'recordings:stopTranscriptionProcessor',
    'recordings:reDiarize',
  ]

  it('rejects every transcription trigger when transcription is disabled', () => {
    featuresConfig = { preset: 'library-only', flags: {} } // transcription off
    for (const ch of TRIGGERS) {
      let thrown: unknown
      try {
        gateInvokeHandler(ch, vi.fn())(event)
      } catch (e) {
        thrown = e
      }
      expect(thrown, ch).toBeInstanceOf(FeatureDisabledError)
      expect((thrown as FeatureDisabledError).featureId, ch).toBe('transcription')
    }
  })

  it('allows every transcription trigger when transcription is enabled', async () => {
    featuresConfig = { preset: 'library-transcription', flags: {} } // transcription on
    for (const ch of TRIGGERS) {
      const handler = vi.fn().mockResolvedValue('ok')
      await expect(gateInvokeHandler(ch, handler)(event), ch).resolves.toBe('ok')
    }
  })

  it('keeps Library reads/ops on the shared recordings: namespace OPEN when transcription is off', async () => {
    featuresConfig = { preset: 'library-only', flags: {} }
    for (const ch of [
      'recordings:getAll',
      'recordings:delete',
      'recordings:getTranscript',
      'recordings:updateStatus',
      'recordings:getTranscriptionStatus',
    ]) {
      const handler = vi.fn().mockResolvedValue('data')
      await expect(gateInvokeHandler(ch, handler)(event), ch).resolves.toBe('data')
    }
  })
})
