/**
 * Feature lifecycle (main process) — Track I, Gate 1 runtime side.
 *
 * Maps each runtime-toggleable feature to its start/stop actions and applies the
 * difference between two resolved feature states when the user changes the preset
 * or a flag at runtime. Features WITHOUT a `start` action here can only be enabled
 * by a restart (surfaced to the renderer as `pendingRestart` so it can show a
 * restart banner). Disabling always takes effect immediately (the IPC gate + the
 * renderer store react live), and a `stop` action, where present, halts the
 * feature's background work.
 *
 * All start/stop bodies use dynamic import so this module stays light and free of
 * circular imports (it is loaded from config-handlers).
 */

import { getEventBus } from './event-bus'
import { getResolvedFeatures } from './feature-gate'
import {
  ALL_FEATURE_IDS,
  FEATURES,
  type FeatureId,
  type ResolvedFeatures,
} from '../../../src/shared/feature-registry'

interface Lifecycle {
  /** Start the feature's background work live. Absent ⇒ enabling needs a restart. */
  start?: () => void | Promise<void>
  /** Stop the feature's background work live. Absent ⇒ nothing to stop (IPC/UI gate live). */
  stop?: () => void | Promise<void>
}

/**
 * Runtime start/stop actions. Only features with actual background loops need
 * entries; on-demand features (meeting-intelligence, explore, today,
 * people-projects) toggle purely through the IPC gate + renderer state. Per spec
 * §B.3, assistant (enable=restart: boot-blocking vector/RAG init) and device-sync
 * (USB safety: never yank the device live) are NOT runtime-enableable — that is
 * encoded as `runtimeToggleable: false` in the registry, not here.
 */
const lifecycles: Partial<Record<FeatureId, Lifecycle>> = {
  transcription: {
    start: () => import('./transcription').then((m) => m.startTranscriptionProcessor()),
    stop: () => import('./transcription').then((m) => m.stopTranscriptionProcessor()),
  },
  calendar: {
    start: () => import('../ipc/calendar-handlers').then((m) => m.initializeCalendarAutoSync()),
    stop: () => import('../ipc/calendar-handlers').then((m) => m.stopAutoSync()),
  },
  'context-graph': {
    start: () => import('./graph-sync').then((m) => m.startGraphSync()),
    stop: () => import('./graph-sync').then((m) => m.stopGraphSync()),
  },
  // Clipboard watch is user-opt-in (its own toggle), so we do NOT auto-start it
  // when the feature is enabled — but we DO stop it when the feature is disabled.
  'clipboard-capture': {
    stop: () => import('./clipboard-capture').then((m) => m.stopClipboardWatch()),
  },
}

/**
 * Apply the transition prev → next:
 *  - ENABLE of a runtime-toggleable feature → run its `start` (if any; on-demand
 *    features need none).
 *  - ENABLE of a non-runtime-toggleable feature (assistant, device-sync) → added
 *    to `pendingRestart` (the renderer shows a restart banner).
 *  - DISABLE → always effective live (IPC gate + renderer react immediately);
 *    a `stop` action, where present, also halts the background loop now.
 * Best-effort: one failing action never blocks the others.
 */
export async function applyFeatureChanges(
  prev: ResolvedFeatures,
  next: ResolvedFeatures
): Promise<FeatureId[]> {
  const pendingRestart: FeatureId[] = []
  for (const id of ALL_FEATURE_IDS) {
    const was = prev[id].enabled
    const now = next[id].enabled
    if (now === was) continue
    const lc = lifecycles[id]
    if (now && !was) {
      if (!FEATURES[id].runtimeToggleable) {
        pendingRestart.push(id)
      } else if (lc?.start) {
        try {
          await lc.start()
        } catch (e) {
          console.error(`[FeatureLifecycle] start(${id}) failed:`, e)
        }
      }
    } else if (!now && was) {
      if (lc?.stop) {
        try {
          await lc.stop()
        } catch (e) {
          console.error(`[FeatureLifecycle] stop(${id}) failed:`, e)
        }
      }
    }
  }
  return pendingRestart
}

/**
 * Broadcast the current resolved feature state (+ any restart-required features)
 * to the renderer as a domain event. The renderer's feature store listens for
 * `features:changed` and updates nav/routes live (spec Gate 4 / risk #7).
 */
export function broadcastFeaturesChanged(resolved: ResolvedFeatures, pendingRestart: FeatureId[]): void {
  try {
    getEventBus().emitDomainEvent({
      type: 'features:changed',
      timestamp: new Date().toISOString(),
      payload: { resolved, pendingRestart },
    })
  } catch (e) {
    console.warn('[FeatureLifecycle] features:changed broadcast failed:', e)
  }
}

/**
 * Reconcile lifecycle actions for a features-config change and broadcast the new
 * state. Call AFTER config has been persisted. `prev` is the resolved state
 * captured BEFORE the config write.
 */
export async function reconcileFeatures(prev: ResolvedFeatures): Promise<FeatureId[]> {
  const next = getResolvedFeatures()
  const pendingRestart = await applyFeatureChanges(prev, next)
  broadcastFeaturesChanged(next, pendingRestart)
  return pendingRestart
}
