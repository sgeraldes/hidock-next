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
  actualRemovalSummary
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
