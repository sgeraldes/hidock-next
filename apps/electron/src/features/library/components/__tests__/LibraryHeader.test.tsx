import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LibraryHeader } from '../LibraryHeader'

function renderHeader(overrides: Partial<React.ComponentProps<typeof LibraryHeader>> = {}) {
  const handlers = {
    onAddRecording: vi.fn(),
    onImportFile: vi.fn(),
    onOpenFolder: vi.fn(),
    onBulkDownload: vi.fn(),
    onBulkProcess: vi.fn(),
    onRefresh: vi.fn(),
    onShowDeviceOnly: vi.fn(),
    onSetCompactView: vi.fn(),
    onToggleTrash: vi.fn()
  }

  render(
    <LibraryHeader
      stats={{ total: 2023, deviceOnly: 1, localOnly: 2, unsynced: 1 }}
      deviceConnected
      deviceOnlyActive={false}
      loading={false}
      compactView
      pendingDownloadCount={0}
      activeDownloadCount={0}
      bulkCounts={{ deviceOnly: 1, needsTranscription: 0 }}
      bulkProcessing={false}
      bulkProgress={{ current: 0, total: 0 }}
      showTrash={false}
      trashCount={2}
      {...handlers}
      {...overrides}
    />
  )

  return handlers
}

describe('LibraryHeader — responsive action hierarchy', () => {
  it('presents device-only state as a compact status filter rather than a text link', () => {
    const handlers = renderHeader({ deviceOnlyActive: true })
    const filter = screen.getByRole('button', { name: /Show 1 source that need download/i })
    expect(filter).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(filter)
    expect(handlers.onShowDeviceOnly).toHaveBeenCalledOnce()
  })

  it('groups source-import actions under one stable control', () => {
    const handlers = renderHeader()
    fireEvent.pointerDown(screen.getByRole('button', { name: /Add source/i }), { button: 0 })
    fireEvent.click(screen.getByRole('menuitem', { name: /Import document or image/i }))
    expect(handlers.onImportFile).toHaveBeenCalledOnce()
  })

  it('uses universal source language and keeps compact utility controls accessible', () => {
    renderHeader()
    expect(screen.getByText('2,023 sources')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upgrade transcripts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh Library' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /View Trash, 2 items/i })).toBeInTheDocument()
  })

  it('does not duplicate global device connection state in the universal Library summary', () => {
    renderHeader({
      deviceConnected: false,
      stats: { total: 2024, deviceOnly: 0, localOnly: 2024, unsynced: 0 },
      bulkCounts: { deviceOnly: 0, needsTranscription: 0 }
    })

    expect(screen.getByText('2,024 sources')).toBeInTheDocument()
    expect(screen.queryByText('Device disconnected')).not.toBeInTheDocument()
  })

  it('lets a connected user restart a restored pending download without claiming it is active', () => {
    const handlers = renderHeader({ pendingDownloadCount: 1 })
    const start = screen.getByRole('button', { name: /Start download 1 source/i })
    expect(start).toBeEnabled()
    fireEvent.click(start)
    expect(handlers.onBulkDownload).toHaveBeenCalledOnce()
  })
})
