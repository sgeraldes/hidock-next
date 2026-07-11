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
} from '../feature-gate'

beforeEach(() => {
  featuresConfig = undefined // default `full`
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
