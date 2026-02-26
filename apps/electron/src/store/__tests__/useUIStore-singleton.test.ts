/**
 * UI Store Singleton Tests
 *
 * BUG-UI-001: Two separate useUIStore instances exist at different import paths
 *   OBSERVED: Components importing from '@/store/useUIStore' and '@/store/ui/useUIStore'
 *   operate on different Zustand store instances, causing state desync.
 *
 *   Import map:
 *   - '@/store/useUIStore' -> OperationController, AudioPlayer, Library, Calendar, MeetingDetail
 *   - '@/store/ui/useUIStore' -> Layout, qa-monitor (also re-exported from store/index.ts)
 *
 *   This means OperationController writes playback state to store A,
 *   but Layout reads from store B - they never see each other's updates.
 */

import { describe, it, expect } from 'vitest'

describe('useUIStore singleton', () => {
  it('should be the same store instance regardless of import path', async () => {
    // Import from both paths
    const { useUIStore: storeA } = await import('@/store/useUIStore')
    const { useUIStore: storeB } = await import('@/store/ui/useUIStore')

    // They MUST be the exact same store instance
    // If they are different create() calls, Object.is will return false
    expect(storeA).toBe(storeB)
  })

  it('state changes in one should be visible in the other', async () => {
    const { useUIStore: storeA } = await import('@/store/useUIStore')
    const { useUIStore: storeB } = await import('@/store/ui/useUIStore')

    // Set state via store A
    storeA.getState().setSidebarOpen(false)

    // Should be visible in store B
    expect(storeB.getState().sidebarOpen).toBe(false)

    // Restore
    storeA.getState().setSidebarOpen(true)
  })
})
