/**
 * Feature gate (main process) — Track I, Gate 1 & Gate 2.
 *
 * Reads the effective feature state from `config.features` through the pure
 * `resolveFeatureState()` resolver and enforces it:
 *
 *  - `isFeatureEnabled(id)` — background tasks + persistent loops consult this
 *    before starting (Gate 1).
 *  - `gatedHandle()` / `installFeatureGate()` — IPC channels owned by a disabled
 *    feature fail closed with a clear `FeatureDisabledError` (Gate 2).
 *
 * Fail-OPEN when features are unset (`config.features` missing): the default is
 * the `full` preset, so an uninitialised/mocked config behaves exactly as before
 * modular features existed (zero behavior change; existing tests keep passing).
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getConfig } from './config'
import {
  channelFeature,
  resolveFeatureState,
  FEATURES,
  type FeatureId,
  type ResolvedFeatures,
} from '../../../src/shared/feature-registry'

/** Thrown by a gated IPC handler when its owning feature is disabled. */
export class FeatureDisabledError extends Error {
  readonly featureId: FeatureId
  readonly channel: string
  constructor(featureId: FeatureId, channel: string) {
    const label = FEATURES[featureId]?.label ?? featureId
    super(
      `Feature "${label}" is disabled (channel ${channel}). ` +
        `Enable it in Settings → Features to use this.`
    )
    this.name = 'FeatureDisabledError'
    this.featureId = featureId
    this.channel = channel
  }
}

/** Resolve the CURRENT effective feature state from config (live, per-call cheap). */
export function getResolvedFeatures(): ResolvedFeatures {
  let features
  try {
    features = getConfig()?.features
  } catch {
    features = undefined
  }
  return resolveFeatureState(features)
}

/** Is a single feature enabled right now? Defaults to enabled when config is unset. */
export function isFeatureEnabled(id: FeatureId): boolean {
  return getResolvedFeatures()[id].enabled
}

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any

/**
 * Wrap an IPC invoke handler so it fails closed when the feature that owns
 * `channel` is disabled. Core/shared channels (channelFeature → null) pass
 * through unchanged. Exposed standalone for direct unit testing.
 */
export function gateInvokeHandler(channel: string, handler: InvokeHandler): InvokeHandler {
  const owner = channelFeature(channel)
  if (owner === null) return handler // shared/core channel — never gated
  return (event: IpcMainInvokeEvent, ...args: any[]) => {
    if (!isFeatureEnabled(owner)) {
      throw new FeatureDisabledError(owner, channel)
    }
    return handler(event, ...args)
  }
}

/**
 * Register a gated `ipcMain.handle`. Thin helper for handler files that opt in
 * directly. Equivalent to `ipcMain.handle(channel, gateInvokeHandler(channel, fn))`.
 */
export function gatedHandle(ipcMain: IpcMain, channel: string, handler: InvokeHandler): void {
  ipcMain.handle(channel, gateInvokeHandler(channel, handler))
}

/**
 * Install the gate across ALL `ipcMain.handle` registrations that happen inside
 * the returned scope. Replaces `ipcMain.handle` with a wrapper that auto-gates
 * feature-owned channels, and returns a restore function to undo the patch.
 *
 * Why interception here rather than migrating 38 handler files: it is a single,
 * contained wrapping at the ONE registrar choke point, it gates LIVE (re-enabling
 * a feature makes its IPC work immediately, without restart), and under the
 * default `full` preset every channel passes straight through — so there is zero
 * behavior change. Only `handle` (request/response) is wrapped; `on`/`once`
 * fire-and-forget channels are left untouched.
 */
export function installFeatureGate(ipcMain: IpcMain): () => void {
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel: string, handler: InvokeHandler) => {
    return originalHandle(channel, gateInvokeHandler(channel, handler))
  }) as IpcMain['handle']
  return () => {
    ipcMain.handle = originalHandle
  }
}
