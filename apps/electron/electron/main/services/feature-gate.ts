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

/** Resolve the CURRENT (desired) effective feature state from config. Live, per-call cheap. */
export function getResolvedFeatures(): ResolvedFeatures {
  let features
  try {
    features = getConfig()?.features
  } catch {
    features = undefined
  }
  return resolveFeatureState(features)
}

/**
 * The effective-runtime feature state captured at boot from the DESIRED config,
 * kept SEPARATE from the desired config (Review-2 [CRITICAL]).
 *
 * Restart-gated features (`runtimeToggleable: false` — device-sync, assistant)
 * are pinned to this boot snapshot for the IPC gate SYMMETRICALLY — in BOTH
 * directions (adversarial round-2 [CRITICAL]):
 *
 *  - A feature OFF at boot cannot be opened live by writing the desired config
 *    (USB safety: enabling device-sync at runtime must NOT make jensen /
 *    device-pipeline IPC callable until the next boot — CLAUDE.md USB rules).
 *  - A feature ON at boot stays functional until the next boot even if the user
 *    disables it live. Closing the gate mid-session would strand active USB
 *    work (a connection / download / scan keeps running in the main process)
 *    while making its OWN teardown channels — `jensen:disconnect`,
 *    `jensen:cancelDownload`, `jensen:reset`, pipeline cleanup — unreachable;
 *    a later re-enable could then resume USB state that was never drained
 *    (protocol desync / device-lockup risk). Instead the desired config records
 *    the intent and `derivePendingRestart` surfaces the restart banner.
 *
 * `null` until `captureBootEffectiveFeatures()` runs at boot; the getter then
 * falls back to the live desired state so unit tests (and any path that never
 * boots) behave exactly as before — zero behavior change.
 */
let bootEffectiveFeatures: ResolvedFeatures | null = null

/**
 * Snapshot the effective feature state from the desired config. Called once at
 * boot (after config init, before IPC handlers register) and again to SIMULATE a
 * reboot in tests. Returns the captured snapshot.
 */
export function captureBootEffectiveFeatures(): ResolvedFeatures {
  bootEffectiveFeatures = getResolvedFeatures()
  return bootEffectiveFeatures
}

/**
 * The boot-effective snapshot the gate enforces for restart-gated features. Falls
 * back to the live desired state when not yet captured (uninitialised / tests).
 */
export function getBootEffectiveFeatures(): ResolvedFeatures {
  return bootEffectiveFeatures ?? getResolvedFeatures()
}

/** Test-only: forget the boot snapshot so the next capture starts clean. */
export function __resetBootEffectiveFeaturesForTests(): void {
  bootEffectiveFeatures = null
}

/**
 * Is a single feature enabled for enforcement right now? Defaults to enabled when
 * config is unset (`full`).
 *
 * - Runtime-toggleable features read the LIVE desired state (enabling/disabling
 *   takes effect immediately — this is what makes runtime toggles work).
 * - Restart-gated features (`runtimeToggleable: false`) consult the boot-effective
 *   snapshot ONLY — symmetric in both directions. Live config edits never
 *   transition the gate mid-session: an enable does not open the feature until
 *   the next boot (USB safety), and a disable does not close it (which would
 *   strand active USB work while blocking its teardown channels — see the
 *   bootEffectiveFeatures doc above). Desired-vs-boot differences surface as
 *   pendingRestart, never as a live gate flip.
 */
export function isFeatureEnabled(id: FeatureId): boolean {
  if (FEATURES[id].runtimeToggleable) return getResolvedFeatures()[id].enabled
  return getBootEffectiveFeatures()[id].enabled
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
