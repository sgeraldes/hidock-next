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
  isTeardownChannel,
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
 * are enforced against this snapshot through an INITIATION / TEARDOWN partition
 * (adversarial round-3):
 *
 *  - Boot-DISABLED ⇒ EVERYTHING closed until the next boot. Enabling live only
 *    updates the desired config (USB safety: enabling device-sync at runtime
 *    must NOT make jensen / device-pipeline IPC callable — CLAUDE.md USB rules).
 *  - Boot-enabled + desired-enabled ⇒ everything open (normal operation).
 *  - Boot-enabled + desired-DISABLED (live disable, restart pending) ⇒
 *    INITIATION channels (connects, scans, download/pipeline starts — and the
 *    auto-connect checker, via `isFeatureEnabled`) are blocked immediately, so
 *    no NEW device/AI work starts; TEARDOWN/OBSERVATION channels (disconnect,
 *    cancel, reset, pipeline cleanup, passive status reads — `TEARDOWN_CHANNELS`
 *    in the registry) stay callable so in-flight / boot-active state can always
 *    be drained. Closing teardown too (round-1's `live && boot` on every
 *    channel) stranded active USB work behind an unreachable disconnect;
 *    leaving initiation open (round-2's boot-only gate) kept starting new
 *    device work the renderer said was off. The partition is the fix for both.
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

/** Was the feature in force at boot? (The teardown half of the partition.) */
export function isFeatureBootEnabled(id: FeatureId): boolean {
  return getBootEffectiveFeatures()[id].enabled
}

/**
 * Is a single feature enabled for INITIATING new work right now? Defaults to
 * enabled when config is unset (`full`).
 *
 * - Runtime-toggleable features read the LIVE desired state (enabling/disabling
 *   takes effect immediately — this is what makes runtime toggles work).
 * - Restart-gated features (`runtimeToggleable: false`) carry INITIATION
 *   semantics: boot-enabled AND desired-enabled. A live disable blocks new work
 *   immediately (including the USB auto-connect checker and gated boot tasks);
 *   a live enable stays blocked until the next boot. Teardown/observation
 *   channels are gated separately on `isFeatureBootEnabled` (see
 *   gateInvokeHandler and the partition doc above).
 */
export function isFeatureEnabled(id: FeatureId): boolean {
  const live = getResolvedFeatures()[id].enabled
  if (FEATURES[id].runtimeToggleable) return live
  return live && getBootEffectiveFeatures()[id].enabled
}

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any

/**
 * Wrap an IPC invoke handler so it fails closed when the feature that owns
 * `channel` is disabled. Core/shared channels (channelFeature → null) pass
 * through unchanged. Exposed standalone for direct unit testing.
 *
 * Restart-gated owners use the initiation/teardown partition: initiation
 * channels require boot AND desired enabled; teardown/observation channels
 * require boot-enabled only, so draining in-flight state is always possible.
 */
export function gateInvokeHandler(channel: string, handler: InvokeHandler): InvokeHandler {
  const owner = channelFeature(channel)
  if (owner === null) return handler // shared/core channel — never gated
  const teardown = !FEATURES[owner].runtimeToggleable && isTeardownChannel(channel)
  return (event: IpcMainInvokeEvent, ...args: any[]) => {
    const allowed = teardown ? isFeatureBootEnabled(owner) : isFeatureEnabled(owner)
    if (!allowed) {
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
