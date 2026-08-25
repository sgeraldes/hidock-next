import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UnifiedRecording } from '@/types/unified-recording'
import { MultiSelectionSummary } from '../MultiSelectionSummary'

function makeRecording(index: number, overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: `recording-${index}`,
    filename: `recording-${index}.wav`,
    title: `Recording ${index}`,
    size: 1024 * 1024,
    duration: 90,
    dateRecorded: new Date(2026, 0, index + 1),
    location: 'local-only',
    localPath: `C:/recordings/recording-${index}.wav`,
    syncStatus: 'synced',
    transcriptionStatus: 'none',
    ...overrides
  } as UnifiedRecording
}

describe('MultiSelectionSummary', () => {
  it('shows the selected count, aggregate size and duration, preview, and library actions', () => {
    render(
      <MultiSelectionSummary
        mode="library"
        recordings={[
          makeRecording(1, { size: 1024 * 1024, duration: 90 }),
          makeRecording(2, { size: 2 * 1024 * 1024, duration: 120 })
        ]}
      />
    )

    const summary = screen.getByTestId('multi-selection-summary')
    expect(within(summary).getByRole('heading', { name: '2 sources selected' })).toBeInTheDocument()
    expect(within(summary).getByText('2 items · 3 MB · 3m 30s total')).toBeInTheDocument()
    expect(within(summary).getByText('Recording 1')).toBeInTheDocument()
    expect(within(summary).getByText('Recording 2')).toBeInTheDocument()
    expect(within(summary).getByText(/Download, Transcribe, Mark personal, Move to Trash, Delete permanently/)).toBeInTheDocument()
  })

  it('limits the preview to 20 sources and reports the remainder', () => {
    render(
      <MultiSelectionSummary
        mode="library"
        recordings={Array.from({ length: 23 }, (_, index) => makeRecording(index + 1))}
      />
    )

    expect(screen.getByText('Recording 20')).toBeInTheDocument()
    expect(screen.queryByText('Recording 21')).not.toBeInTheDocument()
    expect(screen.getByText('+ 3 more…')).toBeInTheDocument()
  })

  it('only advertises actions available in Trash', () => {
    render(<MultiSelectionSummary mode="trash" recordings={[makeRecording(1), makeRecording(2)]} />)

    expect(screen.getByText('Use the bulk action bar above to Restore, Delete permanently.')).toBeInTheDocument()
    expect(screen.queryByText(/Download/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Move to Trash/)).not.toBeInTheDocument()
  })
})
