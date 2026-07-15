/**
 * Round-4 finding 2: EVERY Undo flow in useIdentitySuggestions must inspect the
 * unmerge Result through the shared unmergeFailureMessage helper. A rejected
 * unmerge — most importantly MERGE_ORDER_CONFLICT ("undo the newer merge of X
 * first") — must surface the backend's actionable message and must NEVER be
 * followed by a success toast. Covers the three flows: accept-Undo,
 * direct-merge-Undo (mergeInto/swapMerge), and group-merge-Undo (which must
 * stop on the FIRST rejected unmerge and skip the name restore).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useIdentitySuggestions, unmergeFailureMessage } from '../useIdentitySuggestions'
import { toast } from '@/components/ui/toaster'

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const ORDER_CONFLICT = {
  success: false,
  error: {
    code: 'MERGE_ORDER_CONFLICT',
    message: 'Merges must be undone newest-first: undo the newer merge of "Dora Delta" (j-newer) before this one',
    details: { blockingJournalId: 'j-newer', blockingLoserName: 'Dora Delta' }
  }
}

const mockGetSuggestions = vi.fn()
const mockAccept = vi.fn()
const mockReject = vi.fn()
const mockContactUnmerge = vi.fn()
const mockContactUnmergeGroup = vi.fn()
const mockProjectUnmerge = vi.fn()
const mockGetMergeJournal = vi.fn()
const mockSupersedeOrphaned = vi.fn()
const mockContactsMerge = vi.fn()
const mockContactsUpdate = vi.fn()

global.window.electronAPI = {
  identity: {
    getSuggestions: mockGetSuggestions,
    acceptSuggestion: mockAccept,
    rejectSuggestion: mockReject,
    supersedeOrphaned: mockSupersedeOrphaned,
    getMentionSnippets: vi.fn().mockResolvedValue({ success: true, data: { snippets: [], recordingIds: [] } }),
    getMergeImpact: vi.fn().mockResolvedValue({ success: true, data: { keeper: 1, loser: 1 } }),
    getPersonContext: vi.fn().mockResolvedValue({ success: true, data: { people: [], topics: [] } }),
    getMergeJournal: mockGetMergeJournal
  },
  contacts: {
    getById: vi.fn().mockResolvedValue({ success: true, data: { contact: { name: 'Someone' } } }),
    merge: mockContactsMerge,
    update: mockContactsUpdate,
    unmerge: mockContactUnmerge,
    unmergeGroup: mockContactUnmergeGroup
  },
  projects: {
    getById: vi.fn().mockResolvedValue({ success: true, data: { project: { name: 'Proj' } } }),
    unmerge: mockProjectUnmerge
  }
} as any

const personSuggestion = {
  id: 's1',
  kind: 'person' as const,
  candidate_name: 'Sebas',
  target_id: 'c1',
  confidence: 0.72,
  evidence: JSON.stringify({ keeperId: 'c1', loserId: 'l1' }),
  status: 'pending' as const,
  created_at: '2026-07-08T10:00:00Z'
}

/** The Undo onClick captured from the LAST toast.success call's options. */
function lastUndoAction(): (() => Promise<void>) | undefined {
  const calls = vi.mocked(toast.success).mock.calls
  const last = calls[calls.length - 1]
  return (last?.[2] as { action?: { onClick: () => Promise<void> } } | undefined)?.action?.onClick
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSuggestions.mockResolvedValue({ success: true, data: [personSuggestion] })
  mockAccept.mockResolvedValue({ success: true, data: { id: 's1', status: 'accepted', mergeJournalId: 'j1' } })
  mockReject.mockResolvedValue({ success: true })
  mockContactUnmerge.mockResolvedValue({ success: true, data: {} })
  mockContactUnmergeGroup.mockResolvedValue({ success: true, data: [] })
  mockGetMergeJournal.mockResolvedValue({ success: true, data: [{ id: 'j-direct' }] })
  mockSupersedeOrphaned.mockResolvedValue({ success: true, data: { superseded: 0 } })
  mockContactsMerge.mockResolvedValue({ success: true, data: { id: 'c1' } })
  mockContactsUpdate.mockResolvedValue({ success: true, data: { id: 'c1' } })
})

describe('unmergeFailureMessage (shared helper)', () => {
  it('returns null on success, the backend message on rejection, and a fallback otherwise', () => {
    expect(unmergeFailureMessage({ success: true })).toBeNull()
    expect(unmergeFailureMessage(ORDER_CONFLICT)).toMatch(/undo the newer merge of "Dora Delta"/)
    expect(unmergeFailureMessage({ success: false })).toBe('The records could not be separated again.')
    expect(unmergeFailureMessage(undefined)).toBe('The records could not be separated again.')
  })
})

describe('accept-flow Undo', () => {
  it('surfaces the MERGE_ORDER_CONFLICT message and never toasts success', async () => {
    const { result } = renderHook(() => useIdentitySuggestions('person'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.accept('s1')
    })
    const undo = lastUndoAction()
    expect(undo).toBeDefined()

    mockContactUnmerge.mockResolvedValue(ORDER_CONFLICT)
    await act(async () => {
      await undo!()
    })

    expect(toast.error).toHaveBeenCalledWith('Undo failed', expect.stringMatching(/undo the newer merge of "Dora Delta"/))
    expect(toast.info).not.toHaveBeenCalled()
  })
})

describe('direct-merge Undo (mergeInto / swapMerge)', () => {
  it('surfaces the MERGE_ORDER_CONFLICT message and never toasts success', async () => {
    const { result } = renderHook(() => useIdentitySuggestions('person'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.mergeInto('s1', 'c-other', 'l1', 'Someone Else')
    })
    const undo = lastUndoAction()
    expect(undo).toBeDefined()

    mockContactUnmerge.mockResolvedValue(ORDER_CONFLICT)
    await act(async () => {
      await undo!()
    })

    expect(mockContactUnmerge).toHaveBeenCalledWith('j-direct')
    expect(toast.error).toHaveBeenCalledWith('Undo failed', expect.stringMatching(/undo the newer merge of "Dora Delta"/))
    expect(toast.info).not.toHaveBeenCalled()
  })
})

describe('group-merge Undo (single atomic backend call)', () => {
  it('a rejected group unmerge surfaces its message, skips the name restore, and never claims success', async () => {
    mockAccept
      .mockResolvedValueOnce({ success: true, data: { id: 'g1', status: 'accepted', mergeJournalId: 'j1' } })
      .mockResolvedValueOnce({ success: true, data: { id: 'g2', status: 'accepted', mergeJournalId: 'j2' } })

    const { result } = renderHook(() => useIdentitySuggestions('person'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.mergeGroup({
        keeperId: 'c1',
        keeperName: 'Old Name',
        suggestionIds: ['g1', 'g2'],
        finalName: 'Canonical Name'
      })
    })
    const undo = lastUndoAction()
    expect(undo).toBeDefined()
    mockContactsUpdate.mockClear() // forget the rename performed by the merge itself

    // The atomic backend call rejects — the WHOLE group rolled back server-side.
    mockContactUnmergeGroup.mockResolvedValue(ORDER_CONFLICT)
    await act(async () => {
      await undo!()
    })

    // ONE call carrying every journal id — no per-journal looping in the UI,
    // so a mid-sequence failure can never leave the group half-unwound.
    expect(mockContactUnmergeGroup).toHaveBeenCalledTimes(1)
    expect(mockContactUnmergeGroup).toHaveBeenCalledWith(['j1', 'j2'])
    expect(mockContactUnmerge).not.toHaveBeenCalled()
    // Its message surfaced; no success toast; the old name was NOT restored
    // (the backend rolled back — the keeper still holds merged data).
    expect(toast.error).toHaveBeenCalledWith('Undo failed', expect.stringMatching(/undo the newer merge of "Dora Delta"/))
    expect(toast.info).not.toHaveBeenCalled()
    expect(mockContactsUpdate).not.toHaveBeenCalled()
  })

  it('a failed group Undo is fully re-attemptable: retrying the SAME action succeeds after the cause is fixed', async () => {
    mockAccept
      .mockResolvedValueOnce({ success: true, data: { id: 'g1', status: 'accepted', mergeJournalId: 'j1' } })
      .mockResolvedValueOnce({ success: true, data: { id: 'g2', status: 'accepted', mergeJournalId: 'j2' } })

    const { result } = renderHook(() => useIdentitySuggestions('person'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.mergeGroup({
        keeperId: 'c1',
        keeperName: 'Old Name',
        suggestionIds: ['g1', 'g2'],
        finalName: 'Canonical Name'
      })
    })
    const undo = lastUndoAction()
    mockContactsUpdate.mockClear()

    // First click fails (backend rolled the group back)…
    mockContactUnmergeGroup.mockResolvedValueOnce(ORDER_CONFLICT)
    await act(async () => {
      await undo!()
    })
    expect(toast.info).not.toHaveBeenCalled()

    // …second click retries the SAME id list and now succeeds fully.
    mockContactUnmergeGroup.mockResolvedValueOnce({ success: true, data: [] })
    await act(async () => {
      await undo!()
    })
    expect(mockContactUnmergeGroup).toHaveBeenCalledTimes(2)
    expect(vi.mocked(mockContactUnmergeGroup).mock.calls.map((c) => c[0])).toEqual([
      ['j1', 'j2'],
      ['j1', 'j2']
    ])
    expect(mockContactsUpdate).toHaveBeenCalledWith({ id: 'c1', name: 'Old Name' })
    expect(toast.info).toHaveBeenCalledWith('Group merge undone', expect.any(String))
  })

  it('reports success and restores the name when the atomic call succeeds', async () => {
    mockAccept
      .mockResolvedValueOnce({ success: true, data: { id: 'g1', status: 'accepted', mergeJournalId: 'j1' } })
      .mockResolvedValueOnce({ success: true, data: { id: 'g2', status: 'accepted', mergeJournalId: 'j2' } })

    const { result } = renderHook(() => useIdentitySuggestions('person'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.mergeGroup({
        keeperId: 'c1',
        keeperName: 'Old Name',
        suggestionIds: ['g1', 'g2'],
        finalName: 'Canonical Name'
      })
    })
    const undo = lastUndoAction()
    mockContactsUpdate.mockClear()

    await act(async () => {
      await undo!()
    })

    expect(mockContactUnmergeGroup).toHaveBeenCalledTimes(1)
    expect(mockContactUnmergeGroup).toHaveBeenCalledWith(['j1', 'j2'])
    expect(mockContactsUpdate).toHaveBeenCalledWith({ id: 'c1', name: 'Old Name' })
    expect(toast.info).toHaveBeenCalledWith('Group merge undone', expect.any(String))
    expect(toast.error).not.toHaveBeenCalled()
  })
})
