/**
 * Feature store (renderer) — Track I, Gate 3 & Gate 4.
 *
 * Holds the effective per-feature state, derived from `config.features` through
 * the SAME pure resolver the main process uses. Nav filtering, route guards and
 * embedded-surface checks (GlobalAssistant, TodayCommits, …) all read from here.
 *
 * Source of truth = the config store: `setFromConfig` recomputes on every config
 * change (subscribed below), so a preset switch made through Settings updates the
 * nav and routes instantly. A main-initiated change arrives as a `features:changed`
 * domain event (carrying the authoritative resolved state + any restart-required
 * features for the banner).
 */

import { create } from 'zustand'
import {
  resolveFeatureState,
  routeFeature,
  FEATURES,
  type FeatureId,
  type FeaturesConfig,
  type PresetId,
  type ResolvedFeatures,
  type ResolvedFeature,
  type DisableReason,
} from '@/shared/feature-registry'
import { useConfigStore } from './domain/useConfigStore'

interface FeatureStoreState {
  resolved: ResolvedFeatures
  preset: PresetId
  /** Features whose ENABLE needs a restart (from the last main broadcast). */
  pendingRestart: FeatureId[]

  isEnabled: (id: FeatureId) => boolean
  reasonFor: (id: FeatureId) => DisableReason | undefined

  /** Recompute resolved state from a features config (config-store driven). */
  setFromConfig: (features?: FeaturesConfig | null) => void
  /** Apply an authoritative resolved map (main `features:changed` broadcast). */
  setResolved: (resolved: ResolvedFeatures) => void
  setPendingRestart: (ids: FeatureId[]) => void
}

export const useFeatureStore = create<FeatureStoreState>((set, get) => ({
  resolved: resolveFeatureState(undefined), // default `full` — everything enabled
  preset: 'full',
  pendingRestart: [],

  isEnabled: (id) => get().resolved[id]?.enabled ?? true,
  reasonFor: (id) => get().resolved[id]?.reason,

  setFromConfig: (features) =>
    set({
      resolved: resolveFeatureState(features),
      preset: (features?.preset as PresetId) ?? 'full',
    }),

  setResolved: (resolved) => set({ resolved }),
  setPendingRestart: (ids) => set({ pendingRestart: ids }),
}))

/**
 * Human-readable label for a disable reason, e.g. `requires:transcription` →
 * "Requires Transcription". Returns null for enabled features.
 */
export function describeDisableReason(reason: DisableReason | undefined): string | null {
  if (!reason) return null
  if (reason === 'user') return 'Turned off in Settings'
  if (reason === 'preset') return 'Not included in the current preset'
  if (reason.startsWith('requires:')) {
    const depId = reason.slice('requires:'.length) as FeatureId
    return `Requires ${FEATURES[depId]?.label ?? depId}`
  }
  return null
}

/** True when a feature is off specifically because a hard dependency is off. */
export function isCascadeDisabled(feature: ResolvedFeature | undefined): boolean {
  return !!feature && !feature.enabled && !!feature.reason?.startsWith('requires:')
}

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------

export const useFeatureEnabled = (id: FeatureId): boolean =>
  useFeatureStore((s) => s.resolved[id]?.enabled ?? true)

export const useFeatureResolved = (id: FeatureId): ResolvedFeature | undefined =>
  useFeatureStore((s) => s.resolved[id])

export const usePendingRestart = (): FeatureId[] => useFeatureStore((s) => s.pendingRestart)

/**
 * Pending-DISABLE (round-3): the feature is desired-off but was active at boot —
 * a restart is pending to fully unload it. Main keeps its teardown/observation
 * IPC open (initiation is blocked), so device/Sync surfaces must stay VISIBLE in
 * this state — hiding them would make the reachable teardown controls
 * (disconnect, cancel download, reset) undiscoverable while USB work may still
 * be in flight.
 */
export const useFeaturePendingDisable = (id: FeatureId): boolean =>
  useFeatureStore((s) => !(s.resolved[id]?.enabled ?? true) && s.pendingRestart.includes(id))

/** Resolve the feature owning a route/nav path (null = floor/unowned → always on). */
export function featureForPath(pathname: string): FeatureId | null {
  return routeFeature(pathname)
}

// ---------------------------------------------------------------------------
// Wiring: keep resolved state in step with config + main broadcasts.
// ---------------------------------------------------------------------------

let wired = false

/**
 * Subscribe the feature store to the config store and to the main-process
 * `features:changed` broadcast. Idempotent; runs once at module load in the app
 * and can be called explicitly from tests.
 */
export function initFeatureStoreWiring(): void {
  if (wired) return
  wired = true

  // Seed from whatever config is already loaded, then track changes.
  const seed = useConfigStore.getState().config?.features
  if (seed) useFeatureStore.getState().setFromConfig(seed)

  useConfigStore.subscribe((state) => {
    useFeatureStore.getState().setFromConfig(state.config?.features)
  })

  // Main-initiated changes (lifecycle reconcile) carry the authoritative state.
  const api = (typeof window !== 'undefined' ? window.electronAPI : undefined) as
    | { onDomainEvent?: (cb: (e: { type?: string; payload?: any }) => void) => () => void }
    | undefined
  if (api?.onDomainEvent) {
    api.onDomainEvent((event) => {
      if (event?.type !== 'features:changed') return
      const payload = event.payload || {}
      if (payload.resolved) useFeatureStore.getState().setResolved(payload.resolved)
      if (Array.isArray(payload.pendingRestart)) {
        useFeatureStore.getState().setPendingRestart(payload.pendingRestart)
      }
      // Refresh config so the preset selector stays in sync with main.
      useConfigStore.getState().loadConfig().catch(() => {})
    })
  }
}

// Auto-wire in the real app (guarded so importing the store in a unit test that
// only needs the resolver/selectors doesn't attach global subscriptions).
if (typeof window !== 'undefined' && window.electronAPI) {
  initFeatureStoreWiring()
}
