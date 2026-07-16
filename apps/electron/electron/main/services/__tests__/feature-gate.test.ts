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
    await expect(gateInvokeHandler('recordings:getAll', read)({} as never)).resolves.toEqual([])
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

  it('live-DISABLING device-sync blocks INITIATION immediately but keeps TEARDOWN callable (round-3 partition)', () => {
    // Boot with everything on (device-sync enabled at boot).
    featuresConfig = { preset: 'full', flags: {} }
    captureBootEffectiveFeatures()
    expect(gateInvokeHandler('jensen:connect', vi.fn().mockReturnValue('ok'))(event)).toBe('ok')

    // Disable device-sync live. The DESIRED config records the intent…
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }
    expect(getResolvedFeatures()['device-sync'].enabled).toBe(false) // desired says off

    // INITIATION half: no NEW device work may start — the hot-plug auto-connect
    // checker (composes isFeatureEnabled) and every initiating channel reject.
    expect(isFeatureEnabled('device-sync')).toBe(false)
    for (const ch of [
      'jensen:connect',
      'jensen:tryConnect',
      'jensen:listFiles', // file-list scan = new device work
      'jensen:downloadFile',
      'jensen:startBluetoothScan',
      'jensen:startRealtime',
      // Round-4 [HIGH]: reset sends a FULL command sequence to the device — it
      // INITIATES USB traffic (resets during live calls cut audio) and takes
      // the normal initiation gate, not the teardown one.
      'jensen:reset',
      // Round-5 [HIGH]: command-sending "getters" are INITIATION, not passive
      // observation — each issues sendCommand(new JensenMessage(CMD.*)) on the USB
      // bus. A live-disabled renderer must not make the device talk through them.
      'jensen:getDeviceInfo',
      'jensen:getCardInfo',
      'jensen:getFileCount',
      'jensen:getSettings',
      'jensen:getRealtimeSettings',
      'jensen:getRealtimeData',
      'jensen:getBatteryStatus',
      'jensen:getBluetoothStatus',
      'device-pipeline:connect',
      'device-pipeline:sync',
      'download-service:queue-downloads',
      'download-service:start-session',
      'download-service:process-download',
    ]) {
      expect(() => gateInvokeHandler(ch, vi.fn())(event), `initiation: ${ch}`).toThrow(
        FeatureDisabledError
      )
    }

    // TEARDOWN/OBSERVATION half: mock-only regression for disable while
    // (a) connected, (b) scanning, (c) downloading — every cleanup channel and
    // GENUINELY passive (in-memory) read stays callable so boot-active state can
    // be drained. NOTE: only the sync in-memory jensen reads (isConnected /
    // getModel / isP1Device) belong here — NOT the command-sending getters above.
    const TEARDOWN_BY_SCENARIO: Record<string, string[]> = {
      connected: [
        'jensen:disconnect',
        'jensen:isConnected',
        'jensen:getModel',
        'jensen:isP1Device',
        'device-pipeline:disconnect',
        'device-pipeline:get-state',
      ],
      scanning: ['jensen:stopBluetoothScan', 'jensen:pauseRealtime', 'device-pipeline:cancel'],
      downloading: [
        'jensen:cancelDownload',
        'download-service:cancel-active',
        'download-service:cancel-all',
        'download-service:get-state',
        'download-service:update-progress',
      ],
    }
    for (const [scenario, channels] of Object.entries(TEARDOWN_BY_SCENARIO)) {
      for (const ch of channels) {
        const handler = vi.fn().mockReturnValue('done')
        expect(gateInvokeHandler(ch, handler)(event), `${scenario}: ${ch}`).toBe('done')
        expect(handler, `${scenario}: ${ch}`).toHaveBeenCalled()
      }
    }

    // Re-enable live (boot was on): initiation unblocks — the boot-active USB
    // stack was never torn down, so resuming is coherent.
    featuresConfig = { preset: 'full', flags: {} }
    expect(isFeatureEnabled('device-sync')).toBe(true)
    expect(gateInvokeHandler('jensen:connect', vi.fn().mockReturnValue('ok'))(event)).toBe('ok')

    // Next boot with the disable persisted: EVERYTHING closed, teardown included.
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }
    captureBootEffectiveFeatures() // simulate reboot
    expect(isFeatureEnabled('device-sync')).toBe(false)
    expect(() => gateInvokeHandler('jensen:disconnect', vi.fn())(event)).toThrow(
      FeatureDisabledError
    )
  })

  it('enable-from-boot-off stays FULLY closed — teardown channels too', () => {
    featuresConfig = { preset: 'full', flags: { 'device-sync': false, assistant: false } }
    captureBootEffectiveFeatures()
    // Live-enable both: desired flips on, but nothing opens (initiation OR
    // teardown) until the next boot — there is no boot-active state to drain.
    featuresConfig = { preset: 'full', flags: {} }
    expect(isFeatureEnabled('device-sync')).toBe(false)
    expect(isFeatureEnabled('assistant')).toBe(false)
    for (const ch of [
      'jensen:connect', // initiation
      'jensen:disconnect', // teardown
      'jensen:cancelDownload',
      'jensen:reset',
      'device-pipeline:cancel',
      'download-service:cancel-all',
      'assistant:getMessages',
      'rag:cancel', // assistant teardown — same rule
    ]) {
      expect(() => gateInvokeHandler(ch, vi.fn())(event), ch).toThrow(FeatureDisabledError)
    }
  })

  it('teardown never transitions mid-session while boot-enabled; initiation follows desired', () => {
    featuresConfig = { preset: 'full', flags: {} }
    captureBootEffectiveFeatures()
    for (const flags of [{ 'device-sync': false }, {}, { 'device-sync': false }] as const) {
      featuresConfig = { preset: 'full', flags: flags as never }
      // Teardown callable through every flip.
      expect(gateInvokeHandler('jensen:disconnect', vi.fn().mockReturnValue('ok'))(event)).toBe(
        'ok'
      )
      // Initiation tracks the desired flag live (boot is on).
      const desiredOn = getResolvedFeatures()['device-sync'].enabled
      expect(isFeatureEnabled('device-sync')).toBe(desiredOn)
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

  it('behavior (round-4): after live-disable, NO reachable handler can start a transfer (mock service layer)', () => {
    // Wire channels to a mock device-service layer: initiating handlers call
    // startTransfer/sendCommandSequence; teardown handlers call cancel/disconnect;
    // observation handlers only read status. This checks BEHAVIOR, not just list
    // membership: whatever subset of handlers the gate lets through must be
    // incapable of starting USB traffic.
    const svc = {
      startTransfer: vi.fn(),
      sendCommandSequence: vi.fn(), // what jensen:reset does on the wire
      cancel: vi.fn(),
      disconnect: vi.fn(),
      readStatus: vi.fn().mockReturnValue('status'),
    }
    const wire: Array<[string, () => unknown]> = [
      ['jensen:connect', () => svc.startTransfer('connect')],
      ['jensen:listFiles', () => svc.startTransfer('file-list')],
      ['jensen:downloadFile', () => svc.startTransfer('download')],
      ['jensen:reset', () => svc.sendCommandSequence('reset')], // full command sequence = USB traffic
      ['jensen:disconnect', () => svc.disconnect()],
      ['jensen:cancelDownload', () => svc.cancel('download')],
      ['device-pipeline:cancel', () => svc.cancel('pipeline')],
      ['jensen:isConnected', () => svc.readStatus()],
      ['device-pipeline:get-state', () => svc.readStatus()],
    ]

    // Boot on, then live-disable device-sync.
    featuresConfig = { preset: 'full', flags: {} }
    captureBootEffectiveFeatures()
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }

    for (const [ch, handler] of wire) {
      try {
        gateInvokeHandler(ch, handler)(event)
      } catch {
        // gated — expected for the initiating half
      }
    }
    // Nothing reachable can put NEW traffic on the wire…
    expect(svc.startTransfer).not.toHaveBeenCalled()
    expect(svc.sendCommandSequence).not.toHaveBeenCalled() // jensen:reset gated as initiation
    // …while drain/observe operations went through.
    expect(svc.disconnect).toHaveBeenCalledTimes(1)
    expect(svc.cancel).toHaveBeenCalledTimes(2)
    expect(svc.readStatus).toHaveBeenCalledTimes(2)
  })

  it('command-sending getters are INITIATION, not observation (round-5 [HIGH], mocked Jensen device)', () => {
    // Model the real device: sync getters read cached fields (NEVER sendCommand);
    // async getters issue sendCommand(new JensenMessage(CMD.*)) — fresh USB traffic.
    const sendCommand = vi.fn((cmd: string) => `resp:${cmd}`)
    const device = {
      // genuinely passive (jensen-device.ts: isConnected L632, getModel L1077, isP1Device L2630)
      isConnected: vi.fn(() => true),
      getModel: vi.fn(() => 'hidock-h1e'),
      isP1Device: vi.fn(() => false),
      // command-sending "getters" — each round-trips to the device
      getDeviceInfo: vi.fn(() => sendCommand('GET_DEVICE_INFO')),
      getCardInfo: vi.fn(() => sendCommand('GET_CARD_INFO')),
      getFileCount: vi.fn(() => sendCommand('GET_FILE_COUNT')),
      getSettings: vi.fn(() => sendCommand('GET_SETTINGS')),
      getRealtimeSettings: vi.fn(() => sendCommand('GET_RT_SETTINGS')),
      getRealtimeData: vi.fn(() => sendCommand('GET_RT_DATA')),
      getBatteryStatus: vi.fn(() => sendCommand('GET_BATTERY')),
      getBluetoothStatus: vi.fn(() => sendCommand('GET_BT_STATUS')),
    }
    const CHANNEL_TO_METHOD: Record<string, () => unknown> = {
      // KEPT observation (sync, cached)
      'jensen:isConnected': () => device.isConnected(),
      'jensen:getModel': () => device.getModel(),
      'jensen:isP1Device': () => device.isP1Device(),
      // RECLASSIFIED to initiation (async, sendCommand)
      'jensen:getDeviceInfo': () => device.getDeviceInfo(),
      'jensen:getCardInfo': () => device.getCardInfo(),
      'jensen:getFileCount': () => device.getFileCount(),
      'jensen:getSettings': () => device.getSettings(),
      'jensen:getRealtimeSettings': () => device.getRealtimeSettings(),
      'jensen:getRealtimeData': () => device.getRealtimeData(),
      'jensen:getBatteryStatus': () => device.getBatteryStatus(),
      'jensen:getBluetoothStatus': () => device.getBluetoothStatus(),
    }
    const KEPT_OBSERVATION = ['jensen:isConnected', 'jensen:getModel', 'jensen:isP1Device']
    const RECLASSIFIED = Object.keys(CHANNEL_TO_METHOD).filter(
      (c) => !KEPT_OBSERVATION.includes(c)
    )

    // Pending-disable: boot-enabled, desired-disabled.
    featuresConfig = { preset: 'full', flags: {} }
    captureBootEffectiveFeatures()
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }

    // Retained observation channels still resolve — from CACHE, with zero sendCommand.
    for (const ch of KEPT_OBSERVATION) {
      const result = gateInvokeHandler(ch, () => CHANNEL_TO_METHOD[ch]())(event)
      expect(result, ch).toBeDefined()
    }
    expect(sendCommand, 'observation channels must NOT issue USB commands').not.toHaveBeenCalled()

    // Reclassified getters are rejected by the gate — the handler never runs, so
    // no sendCommand can reach the device.
    for (const ch of RECLASSIFIED) {
      expect(() => gateInvokeHandler(ch, () => CHANNEL_TO_METHOD[ch]())(event), ch).toThrow(
        FeatureDisabledError
      )
    }
    expect(sendCommand, 'reclassified getters must be gated before any USB command').not.toHaveBeenCalled()

    // Sanity: while device-sync is fully enabled, the same getters DO go through
    // to the device (proves the wiring actually would call sendCommand).
    featuresConfig = { preset: 'full', flags: {} }
    captureBootEffectiveFeatures()
    gateInvokeHandler('jensen:getDeviceInfo', () => CHANNEL_TO_METHOD['jensen:getDeviceInfo']())(event)
    expect(sendCommand).toHaveBeenCalledWith('GET_DEVICE_INFO')
  })
})

describe('lifetime gate — dynamic registrations (round-4 [HIGH])', () => {
  const event = {} as never
  function fakeIpcMain() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handlers,
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      },
    }
    return ipc
  }

  it('a device channel registered AFTER startup fails closed under boot-disabled AND pending-disable', () => {
    const ipc = fakeIpcMain()
    installFeatureGate(ipc as never) // production mode: installed for the process lifetime

    // …startup bulk registration happens here, time passes…

    // Case 1: boot-disabled — a lazy service registers an UNLISTED device channel later.
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }
    captureBootEffectiveFeatures()
    ipc.handle('jensen:someFutureCommand', vi.fn())
    expect(() => ipc.handlers.get('jensen:someFutureCommand')!(event)).toThrow(
      FeatureDisabledError
    )

    // Case 2: pending-disable (boot-on, desired-off) — unlisted defaults to
    // INITIATION, so it fails closed too.
    featuresConfig = { preset: 'full', flags: {} }
    captureBootEffectiveFeatures()
    featuresConfig = { preset: 'full', flags: { 'device-sync': false } }
    ipc.handle('jensen:anotherFutureCommand', vi.fn())
    expect(() => ipc.handlers.get('jensen:anotherFutureCommand')!(event)).toThrow(
      FeatureDisabledError
    )
    // A listed teardown channel registered late still works (boot-enabled).
    const teardown = vi.fn().mockReturnValue('ok')
    ipc.handle('jensen:cancelDownload', teardown)
    expect(ipc.handlers.get('jensen:cancelDownload')!(event)).toBe('ok')
    // Core channels registered late are untouched.
    const core = vi.fn().mockReturnValue('cfg')
    ipc.handle('config:get', core)
    expect(ipc.handlers.get('config:get')!(event)).toBe('cfg')
  })

  it('repeated install is idempotent — never double-wraps the registrar', () => {
    const ipc = fakeIpcMain()
    const restore1 = installFeatureGate(ipc as never)
    const restore2 = installFeatureGate(ipc as never) // registrar re-run (tests) — no-op
    const fn = vi.fn().mockReturnValue(42)
    ipc.handle('assistant:getMessages', fn)
    expect(ipc.handlers.get('assistant:getMessages')!(event)).toBe(42)
    expect(fn).toHaveBeenCalledTimes(1)
    restore2() // no-op
    restore1()
    // After the real restore, registrations are raw again (unit-test escape hatch).
    featuresConfig = { preset: 'library-only', flags: {} }
    const raw = vi.fn().mockReturnValue('raw')
    ipc.handle('assistant:getConversations', raw)
    expect(ipc.handlers.get('assistant:getConversations')!(event)).toBe('raw')
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
