/**
 * spec-005/F17 T5 §D3b — SourceCard (card view) is a THIRD delete surface the
 * base spec originally missed, and its `title` tooltip LIED for non-device rows
 * ("Delete local file"/"Delete local copy") while actually routing through a
 * SOFT delete (Move to Trash). This tests the honest-title fix + AR3-4 gating.
 * Card view intentionally gains no new affordances (no permanent-delete, no
 * synced device-delete) — a documented limitation (the row + reader carry the
 * full set).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourceCard } from '../SourceCard'
import type { UnifiedRecording } from '@/types/unified-recording'

const baseRecording: UnifiedRecording = {
  id: 'r1',
  filename: 'meeting.wav',
  size: 1024,
  duration: 120,
  dateRecorded: new Date('2026-01-15T10:00:00Z'),
  transcriptionStatus: 'complete',
  location: 'local-only',
  localPath: '/data/meeting.wav',
  syncStatus: 'synced'
}

function makeProps(overrides: Partial<React.ComponentProps<typeof SourceCard>> = {}) {
  return {
    recording: baseRecording,
    isPlaying: false,
    isTranscriptExpanded: false,
    isDownloading: false,
    isDeleting: false,
    deviceConnected: false,
    onClick: vi.fn(),
    onPlay: vi.fn(),
    onStop: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    onAskAssistant: vi.fn(),
    onGenerateOutput: vi.fn(),
    onToggleTranscript: vi.fn(),
    onNavigateToMeeting: vi.fn(),
    ...overrides
  }
}

describe('SourceCard delete button — honest title (spec-005/F17 §D3b)', () => {
  it('local-only: title reads "Move to Trash" (never "Delete local file")', () => {
    render(<SourceCard {...makeProps({ recording: { ...baseRecording, location: 'local-only' } })} />)
    expect(screen.getByTitle('Move to Trash')).toBeInTheDocument()
    expect(screen.queryByTitle(/delete local file/i)).not.toBeInTheDocument()
  })

  it('both (synced): title reads "Move to Trash" (never "Delete local copy")', () => {
    render(
      <SourceCard
        {...makeProps({
          recording: { ...baseRecording, location: 'both', deviceFilename: 'x.hda' } as UnifiedRecording
        })}
      />
    )
    expect(screen.getByTitle('Move to Trash')).toBeInTheDocument()
    expect(screen.queryByTitle(/delete local copy/i)).not.toBeInTheDocument()
  })

  it('device-only: title is unchanged — "Delete from device"', () => {
    render(
      <SourceCard
        {...makeProps({
          recording: {
            ...baseRecording,
            location: 'device-only',
            deviceFilename: 'x.hda',
            localPath: undefined,
            syncStatus: 'not-synced'
          } as unknown as UnifiedRecording,
          deviceConnected: true
        })}
      />
    )
    expect(screen.getByTitle('Delete from device')).toBeInTheDocument()
  })

  it('never renders the retired raw strings "Delete local file"/"Delete local copy" in any state', () => {
    for (const location of ['local-only', 'both', 'device-only'] as const) {
      const { unmount } = render(
        <SourceCard
          {...makeProps({
            recording: { ...baseRecording, location, deviceFilename: 'x.hda' } as UnifiedRecording,
            deviceConnected: true
          })}
        />
      )
      expect(screen.queryByTitle(/delete local file/i)).not.toBeInTheDocument()
      expect(screen.queryByTitle(/delete local copy/i)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('clicking the delete button still invokes onDelete (soft delete, unchanged routing)', () => {
    const onDelete = vi.fn()
    render(<SourceCard {...makeProps({ onDelete })} />)
    screen.getByTitle('Move to Trash').click()
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('SourceCard AR3-4 — capture-only rows show no delete affordance', () => {
  it('renders no delete button for a capture-only (non-recording-backed) row', () => {
    const captureOnly: UnifiedRecording = {
      ...baseRecording,
      location: 'local-only',
      localPath: '',
      syncStatus: 'synced',
      sourceKind: 'capture' // the explicit buildRecordingMap capture-only stamp (CX-T5-3)
    }
    render(<SourceCard {...makeProps({ recording: captureOnly })} />)
    expect(screen.queryByTitle('Move to Trash')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Delete from device')).not.toBeInTheDocument()
  })

  it('CX-T5-3: a REAL recording with an empty localPath (nullable file_path) KEEPS its delete button', () => {
    const nullPathRecording: UnifiedRecording = {
      ...baseRecording,
      location: 'local-only',
      localPath: '',
      syncStatus: 'synced',
      sourceKind: 'recording'
    }
    render(<SourceCard {...makeProps({ recording: nullPathRecording })} />)
    expect(screen.getByTitle('Move to Trash')).toBeInTheDocument()
  })
})
