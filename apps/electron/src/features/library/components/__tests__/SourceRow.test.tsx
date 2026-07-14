import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SourceRow } from '../SourceRow'
import type { UnifiedRecording } from '@/types/unified-recording'
import type { Meeting } from '@/types'

/** Opens the row's overflow menu the same way SourceReader.reader.test.tsx does
 *  (Radix DropdownMenuTrigger reliably opens on Enter keydown in jsdom, where
 *  pointer-only click activation is flaky). */
function openMenu() {
  fireEvent.keyDown(screen.getByLabelText(/more actions/i), { key: 'Enter' })
}

const baseRecording: UnifiedRecording = {
  id: 'r1',
  filename: '2026Jul08-190246-Rec49.hda',
  title: 'Quarterly planning',
  dateRecorded: new Date('2026-07-08T19:02:46'),
  duration: 2680, // 44m 40s
  size: 1000,
  location: 'local-only',
  syncStatus: 'synced',
  localPath: '/tmp/rec.wav',
  transcriptionStatus: 'complete'
}

const defaultProps = {
  recording: baseRecording
}

describe('SourceRow second line', () => {
  it('shows human date + start time + duration, not the machine filename', () => {
    render(<SourceRow {...defaultProps} />)

    // Locate the second line by its distinctive parts: date, a 12h time, duration.
    const line = screen.getByText((content) => /Jul 8/.test(content) && /PM|AM/.test(content) && /44m/.test(content))
    expect(line).toBeInTheDocument()
    expect(line.textContent).not.toContain('.hda')
  })

  it('keeps the raw filename discoverable as the second-line tooltip', () => {
    render(<SourceRow {...defaultProps} />)
    const line = screen.getByText((content) => /44m/.test(content))
    expect(line).toHaveAttribute('title', '2026Jul08-190246-Rec49.hda')
  })

  it('does not attach a filename tooltip when the filename IS the title', () => {
    const rec = { ...baseRecording, title: undefined }
    render(<SourceRow {...defaultProps} recording={rec} />)
    const line = screen.getByText((content) => /44m/.test(content))
    expect(line).not.toHaveAttribute('title')
  })
})

describe('SourceRow meeting provenance chip', () => {
  const meeting: Meeting = {
    id: 'm1',
    subject: 'Quarterly planning',
    start_time: '2026-07-08T18:30:00',
    end_time: '2026-07-08T19:30:00',
    location: null,
    organizer_name: null,
    organizer_email: null,
    attendees: null,
    description: null,
    is_recurring: 0,
    recurrence_rule: null,
    meeting_url: null,
    created_at: '',
    updated_at: ''
  }

  it('renders a calendar chip labelling the linked meeting', () => {
    render(<SourceRow {...defaultProps} meeting={meeting} />)
    expect(screen.getByLabelText(/Linked to calendar meeting: Quarterly planning/i)).toBeInTheDocument()
  })

  it('renders no calendar chip when there is no linked meeting', () => {
    render(<SourceRow {...defaultProps} />)
    expect(screen.queryByLabelText(/Linked to calendar meeting/i)).not.toBeInTheDocument()
  })
})

describe('SourceRow never renders blank (title + dated second line always present)', () => {
  it('shows a human title AND a date carrying the year AND the duration', () => {
    render(<SourceRow {...defaultProps} />)
    // Title is visible (regression guard for the "blank rows" bug).
    expect(screen.getByText('Quarterly planning')).toBeInTheDocument()
    // Second line shows the YEAR (a year-old capture must not read like this week's)
    // + the real duration, not blank / "Unknown".
    const line = screen.getByText((c) => /2026/.test(c) && /Jul 8/.test(c) && /44m/.test(c))
    expect(line).toBeInTheDocument()
    expect(line.textContent).not.toContain('Unknown')
  })

  it('falls back to the filename as the title when nothing better exists', () => {
    const rec = { ...baseRecording, title: undefined, meetingSubject: undefined }
    render(<SourceRow {...defaultProps} recording={rec} />)
    // Title <p> is never empty — the filename is the guaranteed fallback.
    expect(screen.getByText('2026Jul08-190246-Rec49.hda')).toBeInTheDocument()
  })
})

describe('SourceRow has no per-row Play/Stop button', () => {
  it('renders no Play control (playback lives in the mid-panel player)', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} />)
    expect(screen.queryByLabelText(/Play capture|Download to play|File missing/i)).not.toBeInTheDocument()
  })

  it('renders no Stop control', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} />)
    expect(screen.queryByLabelText(/Stop playback/i)).not.toBeInTheDocument()
  })

  it('still exposes the overflow "More actions" menu', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} />)
    expect(screen.getByLabelText(/More actions/i)).toBeInTheDocument()
  })
})

describe('SourceRow has no per-row selection checkbox', () => {
  // The hover-reveal bulk-selection checkbox was removed entirely (owner request):
  // the row must NEVER render a checkbox, in ANY state. onSelectionChange/anySelected
  // are still accepted as props (caller compat) but no longer surface any UI.
  const queryCheckbox = () => screen.queryByLabelText(/^Select /i)

  it('renders no checkbox when selection is not wired', () => {
    render(<SourceRow {...defaultProps} />)
    expect(queryCheckbox()).not.toBeInTheDocument()
  })

  it('renders no checkbox even when onSelectionChange is wired', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} />)
    expect(queryCheckbox()).not.toBeInTheDocument()
  })

  it('renders no checkbox when the row is selected', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} isSelected />)
    expect(queryCheckbox()).not.toBeInTheDocument()
  })

  it('renders no checkbox while selection mode is active (anySelected)', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} isSelected={false} anySelected />)
    expect(queryCheckbox()).not.toBeInTheDocument()
  })

  it('renders no checkbox when the row is the active/viewed source', () => {
    render(<SourceRow {...defaultProps} onSelectionChange={vi.fn()} isActiveSource isSelected={false} />)
    expect(queryCheckbox()).not.toBeInTheDocument()
  })
})

// spec-005/F17 T5 §D2 — the menu label/scope matrix per location. "Delete
// everywhere"/"Delete from computer" are retired everywhere (AC#1).
describe('SourceRow delete/restore menu — location label matrix (spec-005/F17 §D2)', () => {
  it('never renders the retired raw strings, in any state exercised below', async () => {
    const configs: Array<Partial<UnifiedRecording> & { deviceConnected?: boolean }> = [
      { location: 'device-only', deviceFilename: 'x.hda', syncStatus: 'not-synced' },
      { location: 'local-only' },
      { location: 'both', deviceFilename: 'x.hda' }
    ]
    for (const cfg of configs) {
      const { unmount } = render(
        <SourceRow
          recording={{ ...baseRecording, ...cfg } as UnifiedRecording}
          onDelete={vi.fn()}
          onDeletePermanent={vi.fn()}
          onDeleteFromDevice={vi.fn()}
          deviceConnected
        />
      )
      openMenu()
      expect(await screen.findByRole('menu')).toBeInTheDocument()
      expect(screen.queryByText(/delete everywhere/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/delete from computer/i)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('device-only: shows only "Delete from device", enabled when connected', async () => {
    render(
      <SourceRow
        recording={{ ...baseRecording, location: 'device-only', deviceFilename: 'x.hda', syncStatus: 'not-synced' }}
        onDelete={vi.fn()}
        deviceConnected
      />
    )
    openMenu()
    const item = await screen.findByRole('menuitem', { name: /delete from device/i })
    expect(item).toBeInTheDocument()
    expect(item).not.toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAccessibleName(/delete from device.*erase the recording from the hidock.*can.t be undone/i)
    expect(screen.queryByRole('menuitem', { name: /move to trash/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete permanently/i })).not.toBeInTheDocument()
  })

  it('device-only: "Delete from device" is disabled with "Device not connected" scope when disconnected', async () => {
    render(
      <SourceRow
        recording={{ ...baseRecording, location: 'device-only', deviceFilename: 'x.hda', syncStatus: 'not-synced' }}
        onDelete={vi.fn()}
        deviceConnected={false}
      />
    )
    openMenu()
    const item = await screen.findByRole('menuitem', { name: /delete from device/i })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAccessibleName(/device not connected/i)
  })

  it('local-only: shows "Move to Trash" then "Delete permanently…", no device item', async () => {
    render(
      <SourceRow
        recording={{ ...baseRecording, location: 'local-only' }}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
      />
    )
    openMenu()
    const trash = await screen.findByRole('menuitem', { name: /move to trash/i })
    const permanent = screen.getByRole('menuitem', { name: /delete permanently/i })
    expect(trash).toHaveAccessibleName(/move to trash.*hide it and stop ai processing.*restorable/i)
    expect(permanent).toHaveAccessibleName(/delete permanently.*erase the file and all derived data.*can.t be undone/i)
    expect(screen.queryByRole('menuitem', { name: /delete from device/i })).not.toBeInTheDocument()
    // Order: Move to Trash before Delete permanently.
    const menu = screen.getByRole('menu')
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)
    expect(items.findIndex((t) => /move to trash/i.test(t || ''))).toBeLessThan(
      items.findIndex((t) => /delete permanently/i.test(t || ''))
    )
  })

  it('both (synced), onDeleteFromDevice NOT wired: shows Move to Trash + Delete permanently only', async () => {
    render(
      <SourceRow
        recording={{ ...baseRecording, location: 'both', deviceFilename: 'x.hda' }}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
        deviceConnected
      />
    )
    openMenu()
    await screen.findByRole('menuitem', { name: /move to trash/i })
    expect(screen.getByRole('menuitem', { name: /delete permanently/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete from device/i })).not.toBeInTheDocument()
  })

  it('both (synced), onDeleteFromDevice wired: shows all three in order, device item scoped "keeps the local copy"', async () => {
    render(
      <SourceRow
        recording={{ ...baseRecording, location: 'both', deviceFilename: 'x.hda' }}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
        onDeleteFromDevice={vi.fn()}
        deviceConnected
      />
    )
    openMenu()
    const device = await screen.findByRole('menuitem', { name: /delete from device/i })
    expect(device).toHaveAccessibleName(/delete from device.*keeps the local copy/i)
    expect(device).not.toHaveAttribute('aria-disabled', 'true')

    const menu = screen.getByRole('menu')
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent || '')
    const trashIdx = items.findIndex((t) => /move to trash/i.test(t))
    const deviceIdx = items.findIndex((t) => /delete from device/i.test(t))
    const permIdx = items.findIndex((t) => /delete permanently/i.test(t))
    expect(trashIdx).toBeGreaterThanOrEqual(0)
    expect(trashIdx).toBeLessThan(deviceIdx)
    expect(deviceIdx).toBeLessThan(permIdx)
  })

  it('both (synced): the synced device-delete item disables + relabels when disconnected', async () => {
    render(
      <SourceRow
        recording={{ ...baseRecording, location: 'both', deviceFilename: 'x.hda' }}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
        onDeleteFromDevice={vi.fn()}
        deviceConnected={false}
      />
    )
    openMenu()
    const device = await screen.findByRole('menuitem', { name: /delete from device/i })
    expect(device).toHaveAttribute('aria-disabled', 'true')
    expect(device).toHaveAccessibleName(/device not connected/i)
  })

  it('clicking "Delete from device" (synced) invokes onDeleteFromDevice, never onDelete', async () => {
    const onDelete = vi.fn()
    const onDeleteFromDevice = vi.fn()
    render(
      <SourceRow
        recording={{ ...baseRecording, location: 'both', deviceFilename: 'x.hda' }}
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

// AR3-4 (binding adversarial amendment) — capture-only synthetic rows (no
// source recording) must show NO deletion affordances on any surface.
describe('SourceRow AR3-4 — capture-only rows show no delete affordances', () => {
  const captureOnlyRecording: UnifiedRecording = {
    ...baseRecording,
    id: 'capture-1',
    location: 'local-only',
    localPath: '',
    syncStatus: 'synced',
    sourceKind: 'capture' // the explicit buildRecordingMap capture-only stamp (CX-T5-3)
  }

  it('renders no destructive menu items even when every delete handler is wired', async () => {
    render(
      <SourceRow
        recording={captureOnlyRecording}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
        onRestore={vi.fn()}
        onDeleteFromDevice={vi.fn()}
        deviceConnected
      />
    )
    openMenu()
    // The menu still opens (other non-deletion items may render); assert no
    // deletion-shaped item is present anywhere in it.
    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: /move to trash/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete from device/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete permanently/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^restore/i })).not.toBeInTheDocument()
  })

  it('CX-T5-3: a REAL recording with an empty localPath (nullable file_path) KEEPS its delete affordances', async () => {
    render(
      <SourceRow
        recording={{
          ...baseRecording,
          id: 'null-path-rec',
          location: 'local-only',
          localPath: '',
          syncStatus: 'synced',
          sourceKind: 'recording'
        }}
        onDelete={vi.fn()}
        onDeletePermanent={vi.fn()}
      />
    )
    openMenu()
    expect(await screen.findByRole('menuitem', { name: /move to trash/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete permanently/i })).toBeInTheDocument()
  })
})

// spec-005/F17 T5 §D1 — Trash-mode reuse: Library passes ONLY onRestore +
// onDeletePermanent for trashed rows, and every other item is onX &&-guarded.
describe('SourceRow Trash-mode menu (spec-005/F17 §D1)', () => {
  // Mirrors trashRowToUnified's output shape (incl. the CX-T5-3 stamp).
  const trashedRecording: UnifiedRecording = {
    ...baseRecording,
    location: 'local-only',
    localPath: '/data/trashed.wav',
    syncStatus: 'synced',
    sourceKind: 'recording'
  }

  it('renders exactly Restore + Delete permanently…, nothing else destructive', async () => {
    render(
      <SourceRow
        recording={trashedRecording}
        onRestore={vi.fn()}
        onDeletePermanent={vi.fn()}
      />
    )
    openMenu()
    const restore = await screen.findByRole('menuitem', { name: /^restore/i })
    const permanent = screen.getByRole('menuitem', { name: /delete permanently/i })
    expect(restore).toHaveAccessibleName(/restore.*un-hide and resume ai processing/i)
    expect(permanent).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /move to trash/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete from device/i })).not.toBeInTheDocument()

    // Order: Restore before Delete permanently.
    const menu = screen.getByRole('menu')
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent || '')
    expect(items.findIndex((t) => /^restore/i.test(t))).toBeLessThan(items.findIndex((t) => /delete permanently/i.test(t)))
  })

  it('clicking Restore invokes onRestore', async () => {
    const onRestore = vi.fn()
    render(<SourceRow recording={trashedRecording} onRestore={onRestore} onDeletePermanent={vi.fn()} />)
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: /^restore/i }))
    expect(onRestore).toHaveBeenCalledTimes(1)
  })

  it('clicking Delete permanently invokes onDeletePermanent', async () => {
    const onDeletePermanent = vi.fn()
    render(<SourceRow recording={trashedRecording} onRestore={vi.fn()} onDeletePermanent={onDeletePermanent} />)
    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: /delete permanently/i }))
    expect(onDeletePermanent).toHaveBeenCalledTimes(1)
  })

  it('renders no menu items at all (not even the separator-gated block) with no handlers wired', async () => {
    render(<SourceRow recording={trashedRecording} />)
    openMenu()
    await screen.findByRole('menu')
    expect(screen.queryByRole('menuitem', { name: /^restore/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete permanently/i })).not.toBeInTheDocument()
  })

  it('CX-T5-3: a trash row with an EMPTY localPath (null file_path) still shows Restore + Delete permanently', async () => {
    // The stranded-in-Trash vector: a real recording with a nullable/empty
    // file_path, bulk-soft-deleted, then mapped by trashRowToUnified. Its
    // sourceKind stamp — not its path — must keep the restore/purge menu alive.
    render(
      <SourceRow
        recording={{ ...trashedRecording, localPath: '' }}
        onRestore={vi.fn()}
        onDeletePermanent={vi.fn()}
      />
    )
    openMenu()
    expect(await screen.findByRole('menuitem', { name: /^restore/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete permanently/i })).toBeInTheDocument()
  })
})
