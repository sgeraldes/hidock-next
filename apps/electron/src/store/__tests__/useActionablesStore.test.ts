import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useActionablesStore,
  useActionablesCounts,
  useActionablesPendingCount
} from '../features/useActionablesStore'
import type { Actionable, ActionableStatus } from '@/types/knowledge'

function makeActionable(status: ActionableStatus, id = Math.random().toString(36).slice(2)): Actionable {
  return {
    id,
    type: 'meeting_minutes',
    title: 't',
    description: null,
    sourceKnowledgeId: 'k1',
    sourceActionItemId: null,
    suggestedTemplate: 'meeting_minutes',
    suggestedRecipients: [],
    status,
    confidence: 0.5,
    artifactId: null,
    generatedAt: null,
    sharedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

beforeEach(() => {
  useActionablesStore.setState({ actionables: [], loading: false, loaded: false })
})

describe('useActionablesStore counts', () => {
  it('computes EXACT counts by status with no cap', () => {
    // 150 pending — proves there is no "99+" cap on the exact count.
    const many = Array.from({ length: 150 }, () => makeActionable('pending'))
    const mixed = [
      ...many,
      makeActionable('generated'),
      makeActionable('generated'),
      makeActionable('dismissed'),
      makeActionable('in_progress'),
      makeActionable('shared')
    ]
    act(() => useActionablesStore.getState().setActionables(mixed))

    const { result } = renderHook(() => useActionablesCounts())
    expect(result.current.pending).toBe(150)
    expect(result.current.generated).toBe(2)
    expect(result.current.dismissed).toBe(1)
    expect(result.current.in_progress).toBe(1)
    expect(result.current.shared).toBe(1)
    expect(result.current.all).toBe(155)
  })

  it('exposes an exact scalar pending count for the nav badge', () => {
    const items = [makeActionable('pending'), makeActionable('pending'), makeActionable('generated')]
    act(() => useActionablesStore.getState().setActionables(items))

    const { result } = renderHook(() => useActionablesPendingCount())
    expect(result.current).toBe(2)
  })
})

describe('useActionablesStore.loadActionables', () => {
  it('loads from the actionables IPC channel and marks loaded', async () => {
    const items = [makeActionable('pending')]
    const getAll = vi.fn().mockResolvedValue(items)
    ;(globalThis as any).window = { electronAPI: { actionables: { getAll } } }

    await act(async () => {
      await useActionablesStore.getState().loadActionables()
    })

    expect(getAll).toHaveBeenCalledOnce()
    expect(useActionablesStore.getState().actionables).toHaveLength(1)
    expect(useActionablesStore.getState().loaded).toBe(true)
    expect(useActionablesStore.getState().loading).toBe(false)
  })

  it('ensureLoaded skips loading once already loaded', async () => {
    const getAll = vi.fn().mockResolvedValue([])
    ;(globalThis as any).window = { electronAPI: { actionables: { getAll } } }

    await act(async () => {
      await useActionablesStore.getState().loadActionables() // loaded = true
    })
    expect(getAll).toHaveBeenCalledTimes(1)

    act(() => {
      useActionablesStore.getState().ensureLoaded() // already loaded → no-op
    })
    expect(getAll).toHaveBeenCalledTimes(1)
  })
})
