/**
 * Actionables Store (Feature)
 *
 * Single source of truth for the list of actionables in the renderer. Both the
 * Actionables page AND the sidebar nav badge (Layout) read from here, so:
 *   1. Counts are EXACT (no "99+" cap) and shared, and
 *   2. When the page mutates state (dismiss / bulk-dismiss / generate), the nav
 *      badge updates live because it subscribes to the same store.
 *
 * The list is server-owned data, so nothing here is persisted — it is loaded
 * from the `actionables:getAll` IPC channel and refreshed after mutations.
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Actionable, ActionableStatus } from '@/types/knowledge'

export interface ActionablesStore {
  /** Full, unfiltered list as loaded from the main process. */
  actionables: Actionable[]
  /** True while a load is in flight. */
  loading: boolean
  /** True once at least one successful load has completed. */
  loaded: boolean
  /** Replace the list directly (used by tests and optimistic paths). */
  setActionables: (items: Actionable[]) => void
  /** Load (or reload) the full list from the main process. */
  loadActionables: () => Promise<void>
  /** Load once if it hasn't been loaded yet — safe to call from many mounts. */
  ensureLoaded: () => void
}

export const useActionablesStore = create<ActionablesStore>((set, get) => ({
  actionables: [],
  loading: false,
  loaded: false,

  setActionables: (items) => set({ actionables: Array.isArray(items) ? items : [], loaded: true }),

  loadActionables: async () => {
    set({ loading: true })
    try {
      const api = window.electronAPI?.actionables
      const data = api?.getAll ? await api.getAll() : []
      set({ actionables: Array.isArray(data) ? data : [], loaded: true })
    } catch (error) {
      console.error('Failed to load actionables:', error)
    } finally {
      set({ loading: false })
    }
  },

  ensureLoaded: () => {
    const s = get()
    if (!s.loaded && !s.loading) void s.loadActionables()
  }
}))

/** Every status the counts object tracks, plus the `all` total. */
export type ActionableCounts = Record<'all' | ActionableStatus, number>

/**
 * EXACT counts by status (never capped). Non-scalar return → `useShallow` so a
 * fresh object with identical numbers does not retrigger renders.
 * Used by the page's filter tabs (All / Pending / In Progress / …).
 */
export const useActionablesCounts = (): ActionableCounts =>
  useActionablesStore(
    useShallow((s) => {
      const counts: ActionableCounts = {
        all: s.actionables.length,
        pending: 0,
        in_progress: 0,
        generated: 0,
        shared: 0,
        dismissed: 0
      }
      for (const a of s.actionables) {
        if (a.status in counts) counts[a.status] += 1
      }
      return counts
    })
  )

/**
 * EXACT pending count as a scalar (no "99+" cap). This is the value the Layout
 * nav badge should render. Scalar → `Object.is` equality is correct, no
 * `useShallow` needed.
 */
export const useActionablesPendingCount = (): number =>
  useActionablesStore((s) => {
    let n = 0
    for (const a of s.actionables) if (a.status === 'pending') n += 1
    return n
  })
