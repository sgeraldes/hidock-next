/**
 * spec-006/F17 T6 — permanent-delete outcome copy (D2/D3/D5/AR3-2/AR3-3c).
 * Covers only the T6 additions; the T5 label/scope constants are exercised
 * indirectly via SourceRow/SourceReader/SourceCard/Library tests.
 */

import { describe, it, expect } from 'vitest'
import {
  GRAPH_CLEANUP_RETRY_SAFETY_LINE,
  FAILURE_NOTHING_DELETED_TITLE,
  graphCleanupFailedBody,
  genericPermanentDeleteFailedBody,
  LABEL_DELETE_ANYWAY_SKIP_GRAPH,
  DEVICE_COPY_REMAINS_TITLE,
  deviceCopyRemainsBody,
  FILES_PENDING_TITLE,
  filesPendingBody,
  COMBINED_PARTIAL_TITLE,
  combinedPartialBody,
  VIEW_MAY_BE_STALE_NOTE,
  actualRemovalSummary,
  SUCCESS_MOVED_TO_TRASH_TITLE,
  SUCCESS_REMOVED_FROM_DEVICE_TITLE,
  SUCCESS_DELETED_PERMANENTLY_TITLE,
  SUCCESS_RESTORED_TITLE,
  PARTIAL_DELETE_TITLE,
  GRAPH_CLEANUP_DEFERRED_TITLE,
  GRAPH_CLEANUP_DEFERRED_NOTE,
  graphCleanupDeferredBody,
  selectCompletionToast
} from '../deletionCopy'

describe('GRAPH_CLEANUP_RETRY_SAFETY_LINE (D2, fail-closed honesty)', () => {
  it('documents that nothing is deleted when cleanup cannot complete', () => {
    expect(GRAPH_CLEANUP_RETRY_SAFETY_LINE).toMatch(/nothing is deleted/i)
    expect(GRAPH_CLEANUP_RETRY_SAFETY_LINE).toMatch(/retry/i)
  })
})

describe('failure copy', () => {
  it('graphCleanupFailedBody names the file and states nothing was deleted', () => {
    const body = graphCleanupFailedBody('meeting.wav')
    expect(body).toContain('meeting.wav')
    expect(body).toMatch(/graph cleanup failed/i)
    expect(body).toMatch(/nothing was deleted/i)
  })

  it('genericPermanentDeleteFailedBody names the file for a non-graph failure', () => {
    const body = genericPermanentDeleteFailedBody('meeting.wav')
    expect(body).toContain('meeting.wav')
    expect(body).toMatch(/nothing was deleted/i)
  })

  it('FAILURE_NOTHING_DELETED_TITLE is honest about nothing being removed', () => {
    expect(FAILURE_NOTHING_DELETED_TITLE).toMatch(/nothing was removed/i)
  })

  it('LABEL_DELETE_ANYWAY_SKIP_GRAPH names the escape hatch explicitly', () => {
    expect(LABEL_DELETE_ANYWAY_SKIP_GRAPH).toMatch(/delete anyway/i)
    expect(LABEL_DELETE_ANYWAY_SKIP_GRAPH).toMatch(/skip graph cleanup/i)
  })
})

describe('partial-outcome copy (D3/AR3-2/AR3-6a)', () => {
  it('deviceCopyRemainsBody explains the local purge succeeded but the device copy remains', () => {
    const body = deviceCopyRemainsBody('meeting.wav')
    expect(body).toContain('meeting.wav')
    expect(body).toMatch(/device copy is still there/i)
    expect(body).toMatch(/next device scan/i)
  })

  it('DEVICE_COPY_REMAINS_TITLE never implies plain success', () => {
    expect(DEVICE_COPY_REMAINS_TITLE).toMatch(/removed locally/i)
    expect(DEVICE_COPY_REMAINS_TITLE).toMatch(/device copy remains/i)
  })

  it('filesPendingBody names the file and enumerates a single pending kind', () => {
    const body = filesPendingBody('meeting.wav', ['audio'])
    expect(body).toContain('meeting.wav')
    expect(body).toMatch(/the audio file/i)
    expect(body).toMatch(/retry automatically/i)
  })

  it('filesPendingBody joins multiple kinds with a serial "and"', () => {
    const body = filesPendingBody('meeting.wav', ['wiki', 'vector'])
    expect(body).toMatch(/a wiki page and a search index entry/i)
  })

  it('filesPendingBody de-duplicates repeated kinds', () => {
    const body = filesPendingBody('meeting.wav', ['audio', 'audio'])
    // Only one occurrence of "the audio file" in the enumerated list part.
    const occurrences = body.match(/the audio file/gi) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('filesPendingBody falls back gracefully for an unknown kind', () => {
    const body = filesPendingBody('meeting.wav', ['mystery' as any])
    expect(body).toContain('a mystery file')
  })

  it('FILES_PENDING_TITLE never implies plain success', () => {
    expect(FILES_PENDING_TITLE).not.toMatch(/^deleted permanently$/i)
  })
})

// CX-T6-3 (T6 fix round) — the both-partial outcome: device copy remains AND
// local file cleanup is still pending. One toast enumerating BOTH; never a
// body claiming full local removal while the ledger is non-empty.
describe('combined-partial copy (CX-T6-3)', () => {
  it('combinedPartialBody enumerates BOTH the pending kinds and the remaining device copy', () => {
    const body = combinedPartialBody('meeting.wav', ['audio'])
    expect(body).toContain('meeting.wav')
    expect(body).toMatch(/the audio file/i)
    expect(body).toMatch(/retry automatically/i)
    expect(body).toMatch(/device copy is still there/i)
    expect(body).toMatch(/next device scan/i)
  })

  it('never claims full local removal — the device-only body\'s "and its data from this computer" phrasing is absent', () => {
    const body = combinedPartialBody('meeting.wav', ['audio', 'wiki'])
    expect(body).not.toMatch(/and its data from this computer/i)
  })

  it('joins and de-duplicates multiple pending kinds like filesPendingBody', () => {
    const body = combinedPartialBody('meeting.wav', ['wiki', 'vector', 'wiki'])
    expect(body).toMatch(/a wiki page and a search index entry/i)
    const occurrences = body.match(/a wiki page/gi) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('COMBINED_PARTIAL_TITLE says partial and that the device copy remains', () => {
    expect(COMBINED_PARTIAL_TITLE).toMatch(/partially removed/i)
    expect(COMBINED_PARTIAL_TITLE).toMatch(/device copy remains/i)
    expect(COMBINED_PARTIAL_TITLE).not.toMatch(/^deleted permanently$/i)
  })
})

// CX-T6-5 (fix round 2) — the stale-view note appended when the device copy
// WAS removed but the view-bookkeeping reconciliation failed.
describe('VIEW_MAY_BE_STALE_NOTE (CX-T6-5)', () => {
  it('says the list may lag and names the next device scan as the corrector', () => {
    expect(VIEW_MAY_BE_STALE_NOTE).toMatch(/may still show the device copy/i)
    expect(VIEW_MAY_BE_STALE_NOTE).toMatch(/next device scan/i)
  })

  it('never claims the device copy itself survived — only the VIEW may lag', () => {
    expect(VIEW_MAY_BE_STALE_NOTE).not.toMatch(/copy is still there/i)
    expect(VIEW_MAY_BE_STALE_NOTE).not.toMatch(/couldn't be deleted/i)
  })
})

describe('actualRemovalSummary (D5 — actual counts, not the dialog estimate)', () => {
  it('falls back to "its data" when every count is zero/undefined', () => {
    expect(actualRemovalSummary(undefined, false)).toBe('Removed its data.')
    expect(actualRemovalSummary({}, false)).toBe('Removed its data.')
  })

  it('singularizes a count of 1 and pluralizes others', () => {
    const text = actualRemovalSummary({ transcripts: 1, actionItems: 2 }, false)
    expect(text).toContain('1 transcript')
    expect(text).not.toContain('1 transcripts')
    expect(text).toContain('2 action items')
  })

  it('includes the ACTUAL edgesRemoved count under the label "graph link(s)"', () => {
    const text = actualRemovalSummary({ edgesRemoved: 5 }, false)
    expect(text).toContain('5 graph links')
  })

  it('singularizes "1 graph link"', () => {
    const text = actualRemovalSummary({ edgesRemoved: 1 }, false)
    expect(text).toContain('1 graph link')
    expect(text).not.toContain('1 graph links')
  })

  it('joins multiple parts with a serial "and"', () => {
    const text = actualRemovalSummary({ transcripts: 1, actionItems: 2, embeddings: 3, edgesRemoved: 4 }, false)
    expect(text).toBe('Removed 1 transcript, 2 action items, 3 embeddings and 4 graph links.')
  })

  it('appends "and the device copy" only when alsoDeviceRemoved is true', () => {
    const withDevice = actualRemovalSummary({ transcripts: 1 }, true)
    const withoutDevice = actualRemovalSummary({ transcripts: 1 }, false)
    expect(withDevice).toContain('and the device copy')
    expect(withoutDevice).not.toContain('device copy')
  })

  it('appends the device suffix even on the "its data" fallback', () => {
    expect(actualRemovalSummary(undefined, true)).toBe('Removed its data and the device copy.')
  })
})

// spec-005/F17 T5 success/partial toast TITLES (phase-3 integration-review
// S1) — Library.tsx's menu-triggered actions (soft delete, device-only
// delete, restore, bulk delete) source their titles from here instead of
// inline literals.
describe('T5 success/partial toast titles (S1)', () => {
  it('SUCCESS_MOVED_TO_TRASH_TITLE', () => {
    expect(SUCCESS_MOVED_TO_TRASH_TITLE).toBe('Moved to Trash')
  })

  it('SUCCESS_REMOVED_FROM_DEVICE_TITLE', () => {
    expect(SUCCESS_REMOVED_FROM_DEVICE_TITLE).toBe('Removed from device')
  })

  it('SUCCESS_DELETED_PERMANENTLY_TITLE', () => {
    expect(SUCCESS_DELETED_PERMANENTLY_TITLE).toBe('Deleted permanently')
  })

  it('SUCCESS_RESTORED_TITLE', () => {
    expect(SUCCESS_RESTORED_TITLE).toBe('Restored')
  })

  it('PARTIAL_DELETE_TITLE', () => {
    expect(PARTIAL_DELETE_TITLE).toBe('Partial Delete')
  })
})

// The executeDeletePermanent outcome ladder (T6 fix rounds CX-T6-1..6),
// extracted to a pure function (phase-3 integration-review `/simplify`
// candidate #2). Library.deletePermanent.test.tsx keeps exercising the same
// matrix end-to-end through the rendered component (unchanged); these tests
// cover the decision function directly.
describe('selectCompletionToast — outcome ladder (T6 fix rounds CX-T6-1..6)', () => {
  const baseInputs = {
    filename: 'meeting.wav',
    deviceOutcome: 'not-requested' as const,
    filesPending: false,
    pendingKinds: [] as string[],
    viewMayBeStale: false,
    removed: { transcripts: 2 }
  }

  it('plain success: device not requested, nothing pending, view not stale', () => {
    const result = selectCompletionToast(baseInputs)
    expect(result).toEqual({
      variant: 'success',
      title: SUCCESS_DELETED_PERMANENTLY_TITLE,
      body: actualRemovalSummary({ transcripts: 2 }, false)
    })
  })

  it('plain success WITH a confirmed device removal appends "and the device copy"', () => {
    const result = selectCompletionToast({ ...baseInputs, deviceOutcome: 'success' })
    expect(result.variant).toBe('success')
    expect(result.title).toBe(SUCCESS_DELETED_PERMANENTLY_TITLE)
    expect(result.body).toBe(actualRemovalSummary({ transcripts: 2 }, true))
  })

  it('device-partial alone: warning, DEVICE_COPY_REMAINS_TITLE', () => {
    const result = selectCompletionToast({ ...baseInputs, deviceOutcome: 'partial' })
    expect(result).toEqual({
      variant: 'warning',
      title: DEVICE_COPY_REMAINS_TITLE,
      body: deviceCopyRemainsBody('meeting.wav')
    })
  })

  it('files-pending alone: warning, FILES_PENDING_TITLE, no stale note', () => {
    const result = selectCompletionToast({
      ...baseInputs,
      filesPending: true,
      pendingKinds: ['wiki']
    })
    expect(result).toEqual({
      variant: 'warning',
      title: FILES_PENDING_TITLE,
      body: filesPendingBody('meeting.wav', ['wiki'])
    })
  })

  // CX-T6-3 — BOTH partial outcomes at once take priority over the
  // files-pending-only branch: one combined toast, never two stacked ones.
  it('device-partial + files-pending: warning, COMBINED_PARTIAL_TITLE (priority over device-partial-only and files-pending-only)', () => {
    const result = selectCompletionToast({
      ...baseInputs,
      deviceOutcome: 'partial',
      filesPending: true,
      pendingKinds: ['audio']
    })
    expect(result).toEqual({
      variant: 'warning',
      title: COMBINED_PARTIAL_TITLE,
      body: combinedPartialBody('meeting.wav', ['audio'])
    })
  })

  // CX-T6-5/CX-T6-6 — the device copy WAS removed but the view-bookkeeping
  // reconciliation or local rebuild failed: warning variant with the
  // stale-view note, never plain success.
  it('view-may-be-stale alone (device succeeded, nothing pending): warning, stale note appended', () => {
    const result = selectCompletionToast({
      ...baseInputs,
      deviceOutcome: 'success',
      viewMayBeStale: true
    })
    expect(result).toEqual({
      variant: 'warning',
      title: SUCCESS_DELETED_PERMANENTLY_TITLE,
      body: `${actualRemovalSummary({ transcripts: 2 }, true)} ${VIEW_MAY_BE_STALE_NOTE}`
    })
  })

  // Priority ordering: files-pending outranks the stale-view note when both
  // are true at once (device succeeded, reconciliation/rebuild ALSO failed,
  // AND the purge's own file cleanup is pending) — the stale note is still
  // appended, but under the FILES_PENDING_TITLE, not the success title.
  it('files-pending + view-may-be-stale: warning, FILES_PENDING_TITLE, stale note appended to the pending body', () => {
    const result = selectCompletionToast({
      ...baseInputs,
      deviceOutcome: 'success',
      filesPending: true,
      pendingKinds: ['vector'],
      viewMayBeStale: true
    })
    expect(result).toEqual({
      variant: 'warning',
      title: FILES_PENDING_TITLE,
      body: `${filesPendingBody('meeting.wav', ['vector'])} ${VIEW_MAY_BE_STALE_NOTE}`
    })
  })

  it('falls back to "its data" body when removed is undefined', () => {
    const result = selectCompletionToast({ ...baseInputs, removed: undefined })
    expect(result.body).toBe('Removed its data.')
  })

  // ARF-4 — the skipGraphCleanup escape hatch defers graph cleanup to the retry
  // sweep; it must NEVER surface the plain success toast.
  describe('ARF-4 — graph-cleanup deferred', () => {
    it('deferred alone: warning, GRAPH_CLEANUP_DEFERRED_TITLE, never plain success', () => {
      const result = selectCompletionToast({ ...baseInputs, graphCleanupDeferred: true })
      expect(result.variant).toBe('warning')
      expect(result.title).toBe(GRAPH_CLEANUP_DEFERRED_TITLE)
      expect(result.title).not.toBe(SUCCESS_DELETED_PERMANENTLY_TITLE)
      expect(result.body).toBe(graphCleanupDeferredBody('meeting.wav', false))
    })

    it('deferred + confirmed device removal folds "and the device copy" into the body', () => {
      const result = selectCompletionToast({
        ...baseInputs,
        deviceOutcome: 'success',
        graphCleanupDeferred: true
      })
      expect(result.variant).toBe('warning')
      expect(result.title).toBe(GRAPH_CLEANUP_DEFERRED_TITLE)
      expect(result.body).toBe(graphCleanupDeferredBody('meeting.wav', true))
    })

    it('deferred note is appended to the files-pending body too (no branch overclaims)', () => {
      const result = selectCompletionToast({
        ...baseInputs,
        filesPending: true,
        pendingKinds: ['wiki'],
        graphCleanupDeferred: true
      })
      expect(result.variant).toBe('warning')
      expect(result.title).toBe(FILES_PENDING_TITLE)
      expect(result.body).toBe(filesPendingBody('meeting.wav', ['wiki']) + GRAPH_CLEANUP_DEFERRED_NOTE)
    })

    it('deferred note is appended to the device-partial body', () => {
      const result = selectCompletionToast({
        ...baseInputs,
        deviceOutcome: 'partial',
        graphCleanupDeferred: true
      })
      expect(result.variant).toBe('warning')
      expect(result.title).toBe(DEVICE_COPY_REMAINS_TITLE)
      expect(result.body).toBe(deviceCopyRemainsBody('meeting.wav') + GRAPH_CLEANUP_DEFERRED_NOTE)
    })

    it('deferred note is appended to the combined-partial body', () => {
      const result = selectCompletionToast({
        ...baseInputs,
        deviceOutcome: 'partial',
        filesPending: true,
        pendingKinds: ['audio'],
        graphCleanupDeferred: true
      })
      expect(result.variant).toBe('warning')
      expect(result.title).toBe(COMBINED_PARTIAL_TITLE)
      expect(result.body).toBe(combinedPartialBody('meeting.wav', ['audio']) + GRAPH_CLEANUP_DEFERRED_NOTE)
    })
  })
})
