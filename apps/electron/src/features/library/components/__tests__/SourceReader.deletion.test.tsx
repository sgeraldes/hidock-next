/**
 * spec-005/F17 T5 — SourceReader's overflow delete/restore menu.
 * Mirrors SourceRow.test.tsx's label-matrix + AR3-4 coverage for the reader's
 * OWN delete block (§D2/§D3/AR3-4), which is a separate implementation that
 * must stay in sync with the row's labels/scopes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SourceReader } from '../SourceReader'
import type { UnifiedRecording } from '@/types/unified-recording'

vi.mock('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/components/RecordingLinkDialog', () => ({
  RecordingLinkDialog: () => null,
}))

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('../WaveformPlayer', () => ({
  WaveformPlayer: () => <div data-testid="waveform-player" />,
}))

vi.mock('../TranscriptViewer', () => ({
  TranscriptViewer: () => <div data-testid="transcript-viewer" />,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
}))

function makeRecording(overrides: Partial<UnifiedRecording> = {}): UnifiedRecording {
  return {
    id: 'rec-1',
    filename: 'meeting.wav',
    size: 1024 * 1024,
    duration: 125,
    dateRecorded: new Date('2024-01-15T10:00:00Z'),
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/recordings/meeting.wav',
    syncStatus: 'synced',
    ...overrides,
  } as UnifiedRecording
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    value: {
      recordings: { reprocessWith: vi.fn(), reDiarize: vi.fn() },
      projects: {
        getForKnowledge: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getAll: vi.fn().mockResolvedValue({ success: true, data: { projects: [], total: 0 } }),
      },
    },
    writable: true,
    configurable: true,
  })
})

function openMenu() {
  fireEvent.keyDown(screen.getByLabelText(/^more actions$/i), { key: 'Enter' })
}

describe('SourceReader delete menu — location label matrix (spec-005/F17 §D2)', () => {
  it('device-only: shows only "Delete from device", disables + relabels when disconnected', async () => {
    render(
      <SourceReader
        recording={makeRecording({ location: 'device-only', deviceFilename: 'x.hda', localPath: undefined } as any)}
        onDelete={vi.fn()}
        deviceConnected={false}
      />
    )
    openMenu()
    const item = await screen.findByRole('menuitem', { name: /delete from device/i })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAccessibleName(/device not connected/i)
    expect(screen.queryByRole('menuitem', { name: /move to trash/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete permanently/i })).not.toBeInTheDocument()
  })

  it('device-only, connected: "Delete from device" is enabled', async () => {
    render(
      <SourceReader
        recording={makeRecording({ location: 'device-only', deviceFilename: 'x.hda', localPath: undefined } as any)}
        onDelete={vi.fn()}
        deviceConnected
      />
    )
    openMenu()
    const item = await screen.findByRole('menuitem', { name: /delete from device/i })
    expect(item).not.toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAccessibleName(/erase the recording from the hidock.*can.t be undone/i)
  })

  it('local-only: shows "Move to Trash" then "Delete permanently…"', async () => {
    render(
      <SourceReader
        recording={makeRecording({ location: 'local-only' })}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
      />
    )
    openMenu()
    const trash = await screen.findByRole('menuitem', { name: /move to trash/i })
    expect(trash).toHaveAccessibleName(/move to trash.*hide it and stop ai processing/i)
    expect(screen.getByRole('menuitem', { name: /delete permanently/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete from device/i })).not.toBeInTheDocument()
  })

  it('both (synced) with onDeleteFromDevice wired: shows all three, device item scoped "keeps the local copy"', async () => {
    render(
      <SourceReader
        recording={makeRecording({ location: 'both', deviceFilename: 'x.hda' })}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
        onDeleteFromDevice={vi.fn()}
        deviceConnected
      />
    )
    openMenu()
    await screen.findByRole('menuitem', { name: /move to trash/i })
    const device = screen.getByRole('menuitem', { name: /delete from device/i })
    expect(device).toHaveAccessibleName(/keeps the local copy/i)
    expect(screen.getByRole('menuitem', { name: /delete permanently/i })).toBeInTheDocument()
  })

  it('both (synced), onDeleteFromDevice NOT wired: no device item appears', async () => {
    render(
      <SourceReader
        recording={makeRecording({ location: 'both', deviceFilename: 'x.hda' })}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
        deviceConnected
      />
    )
    openMenu()
    await screen.findByRole('menuitem', { name: /move to trash/i })
    expect(screen.queryByRole('menuitem', { name: /delete from device/i })).not.toBeInTheDocument()
  })

  it('clicking the synced "Delete from device" item invokes onDeleteFromDevice, never onDelete', async () => {
    const onDelete = vi.fn()
    const onDeleteFromDevice = vi.fn()
    render(
      <SourceReader
        recording={makeRecording({ location: 'both', deviceFilename: 'x.hda' })}
        onDelete={onDelete}
        onDeleteFromDevice={onDeleteFromDevice}
        deviceConnected
      />
    )
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete from device/i }))
    expect(onDeleteFromDevice).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
  })
})

describe('SourceReader AR3-4 — capture-only rows show no delete affordances', () => {
  it('renders no destructive menu items for a capture-only (non-recording-backed) row', async () => {
    render(
      <SourceReader
        recording={makeRecording({ location: 'local-only', localPath: '', sourceKind: 'capture' } as any)}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
        onDeleteFromDevice={vi.fn()}
        deviceConnected
      />
    )
    openMenu()
    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: /move to trash/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete from device/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete permanently/i })).not.toBeInTheDocument()
  })

  it('CX-T5-3: a REAL recording with an empty localPath (nullable file_path) KEEPS its delete menu', async () => {
    render(
      <SourceReader
        recording={makeRecording({ location: 'local-only', localPath: '', sourceKind: 'recording' } as any)}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
      />
    )
    openMenu()
    expect(await screen.findByRole('menuitem', { name: /move to trash/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete permanently/i })).toBeInTheDocument()
  })
})
