import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { getWeekDates } from '@/lib/calendar-utils'

// ── Heavy dependencies stubbed to their minimum surface ─────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => vi.fn() }
})

vi.mock('@/hooks/useUnifiedRecordings', () => ({ useUnifiedRecordings: vi.fn() }))
vi.mock('@/hooks/useToday', () => ({ useToday: () => new Date() }))
vi.mock('@/hooks/useOperations', () => ({
  useOperations: () => ({ queueTranscription: vi.fn(), queueDownload: vi.fn(), queueBulkDownloads: vi.fn() })
}))
vi.mock('@/components/OperationController', () => ({
  useAudioControls: () => ({ play: vi.fn(), stop: vi.fn(), pause: vi.fn(), isPlaying: false, currentTime: 0, duration: 0 })
}))
vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: () => ({ isConnected: () => false, deleteRecording: vi.fn() })
}))
vi.mock('@/components/AudioPlayer', () => ({ AudioPlayer: () => null }))
vi.mock('@/components/RecordingLinkDialog', () => ({ RecordingLinkDialog: () => null }))
vi.mock('@/components/ui/toaster', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let meetingsFixture: any[] = []
// Mutable so individual tests can flip UI config (e.g. showListView) before render.
let configFixture: Record<string, any> = {}

const appActions = {
  navigateWeek: vi.fn(),
  navigateMonth: vi.fn(),
  goToToday: vi.fn(),
  setCurrentDate: vi.fn(),
  setCalendarView: vi.fn(),
  loadMeetings: vi.fn().mockResolvedValue(undefined)
}

const currentDate = new Date()

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn((selector?: (s: any) => any) => (selector ? selector(appActions) : appActions)),
  useMeetings: () => meetingsFixture,
  useMeetingsLoading: () => false,
  useCurrentDate: () => currentDate,
  useCalendarView: () => 'week',
  useLastCalendarSync: () => null,
  useCalendarSyncing: () => false,
  useDownloadQueue: () => new Map(),
  useSetLastCalendarSync: () => vi.fn(),
  // Counted acquire/release replaced the raw boolean setter: clear-and-sync can
  // overlap a startup sync, and the setter could drive the shared flag to false
  // while that other sync was still running.
  useAcquireCalendarSync: () => vi.fn(),
  useReleaseCalendarSync: () => vi.fn()
}))

vi.mock('@/store/domain/useConfigStore', () => ({
  useConfigStore: vi.fn((selector: (s: any) => any) =>
    selector({ config: configFixture, loadConfig: vi.fn().mockResolvedValue(undefined), updateConfig: vi.fn().mockResolvedValue(undefined) })
  )
}))

vi.mock('@/store/useUIStore', () => ({
  useUIStore: vi.fn((selector: (s: any) => any) => selector({ currentlyPlayingId: null }))
}))

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import { toast } from '@/components/ui/toaster'
import { Calendar } from '../Calendar'

// The renderer talks to the main process only through window.electronAPI —
// jsdom has none, so provide the recording surface the Calendar page uses.
const electronAPI = {
  recordings: {
    delete: vi.fn().mockResolvedValue(true),
    deleteCascade: vi.fn().mockResolvedValue({ success: true, mode: 'soft' }),
    restore: vi.fn().mockResolvedValue({ success: true })
  }
}
;(window as any).electronAPI = electronAPI

// A viewDate the component will key on; anchoring recording times to it keeps
// the UTC-based day grouping deterministic across timezones.
const week = getWeekDates(currentDate)
const anchor = week[2] // a weekday in the current week (local midnight)
const at = (hoursFromMidnight: number) => new Date(anchor.getTime() + hoursFromMidnight * 3600_000)

function recording(over: Record<string, any>) {
  return {
    id: 'r',
    filename: 'file.wav',
    size: 1000,
    duration: 1800,
    dateRecorded: at(9),
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/x',
    syncStatus: 'synced',
    ...over
  }
}

function renderCalendar(recordings: any[], meetings: any[] = []) {
  meetingsFixture = meetings
  ;(useUnifiedRecordings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    recordings,
    loading: false,
    refresh: vi.fn(),
    deviceConnected: true,
    stats: { total: recordings.length, deviceOnly: 0, localOnly: recordings.length, both: 0 }
  })
  return render(
    <MemoryRouter>
      <Calendar />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  meetingsFixture = []
  configFixture = {}
  window.confirm = vi.fn(() => true)
})

describe('Calendar — design language', () => {
  it('paints a recorded meeting block with its category color (not a generic green)', () => {
    const meeting = {
      id: 'm1',
      subject: 'Daily WTS Standup', // → recurring → sky
      start_time: at(9).toISOString(),
      end_time: at(10).toISOString(),
      location: null,
      organizer_name: null
    }
    renderCalendar([recording({ id: 'r1', filename: 'standup.wav', dateRecorded: at(9) })], [meeting])

    const label = screen.getByText('Daily WTS Standup')
    const block = label.closest('button')
    expect(block?.className).toContain('bg-sky-500/15') // recurring category tint
    // The old design painted every recorded block emerald — assert we've left it behind.
    expect(block?.className).not.toContain('bg-emerald-500')
  })

  it('labels an unlinked recording by its transcript title, keeping the device filename out of the block', () => {
    renderCalendar([
      recording({
        id: 'r2',
        filename: '2026Jul08-140719-Rec46.hda',
        dateRecorded: at(14),
        duration: 720,
        title: 'Cierre de Proyecto y Acciones de Retrospectiva'
      })
    ])

    expect(screen.getByText('Cierre de Proyecto y Acciones de Retrospectiva')).toBeInTheDocument()
    // Never "Unmatched recording", never the raw filename, on the block.
    expect(screen.queryByText('Unmatched recording')).not.toBeInTheDocument()
    expect(screen.queryByText(/Rec46\.hda/)).not.toBeInTheDocument()
  })

  it('falls back to "Recording · <time>" for an untitled unlinked recording (not the filename)', () => {
    renderCalendar([
      recording({ id: 'r2b', filename: '2026Jul08-140719-Rec46.hda', dateRecorded: at(14), duration: 720 })
    ])

    expect(screen.getByText(/^Recording · /)).toBeInTheDocument()
    expect(screen.queryByText(/Rec46\.hda/)).not.toBeInTheDocument()
  })

  it('exposes the legend from the stats bar', () => {
    renderCalendar([recording({ id: 'r3' })])

    fireEvent.click(screen.getByRole('button', { name: /calendar legend/i }))
    expect(screen.getByText('Recurring / team')).toBeInTheDocument()
    expect(screen.getByText('Not linked to a meeting — click to assign')).toBeInTheDocument()
  })
})

// ── Honest deletion (spec-005/F17 T5 §D3b + AR3-4) ──────────────────────────
// Calendar is a FOURTH delete surface (card grid + compact list), found outside
// the base spec's enumeration. Its non-device delete buttons must say what they
// do — soft "Move to Trash" via recordings.deleteCascade(id, false) — and must
// never route to the legacy permanent recordings.delete IPC (unlinkSync under
// the hood). AR3-4 (binding): capture-only synthetic rows (localPath === '')
// render no delete affordance at all.

/** Renders the recordings list page (showListView) instead of the week grid. */
function renderListView(recordings: any[]) {
  configFixture = { ui: { showListView: true } }
  return renderCalendar(recordings)
}

describe('Calendar — honest deletion (spec-005/F17 T5 §D3b + AR3-4)', () => {
  it('labels a local-only row "Move to Trash" in the compact list, never "Delete local file"', () => {
    renderListView([recording({ id: 'r-local', location: 'local-only', localPath: '/x' })])

    expect(screen.getByTitle('Move to Trash')).toBeInTheDocument()
    expect(screen.queryByTitle('Delete local file')).not.toBeInTheDocument()
  })

  it('labels a synced (both) row "Move to Trash" in the compact list, never "Delete local copy (keeps on device)"', () => {
    renderListView([recording({ id: 'r-both', location: 'both', localPath: '/x', deviceFilename: 'rec.hda' })])

    expect(screen.getByTitle('Move to Trash')).toBeInTheDocument()
    expect(screen.queryByTitle(/Delete local copy/)).not.toBeInTheDocument()
  })

  it('labels local-only and synced rows "Move to Trash" in the card view too', () => {
    renderListView([
      recording({ id: 'r-local', location: 'local-only', localPath: '/x' }),
      recording({ id: 'r-both', location: 'both', localPath: '/y', deviceFilename: 'rec.hda', dateRecorded: at(11) })
    ])
    fireEvent.click(screen.getByTitle('Card view'))

    expect(screen.getAllByTitle('Move to Trash')).toHaveLength(2)
    expect(screen.queryByTitle('Delete local file')).not.toBeInTheDocument()
    expect(screen.queryByTitle(/Delete local copy/)).not.toBeInTheDocument()
  })

  it('keeps the accurate "Delete from device" label for device-only rows', () => {
    renderListView([recording({ id: 'r-dev', location: 'device-only', localPath: undefined, deviceFilename: 'rec.hda' })])

    expect(screen.getByTitle('Delete from device')).toBeInTheDocument()
    expect(screen.queryByTitle('Move to Trash')).not.toBeInTheDocument()
  })

  it('AR3-4: a capture-only synthetic row (no source recording) renders no delete affordance', () => {
    renderListView([
      recording({
        id: 'cap-1',
        location: 'local-only',
        localPath: '', // the capture-only marker (see buildRecordingMap)
        knowledgeCaptureId: 'cap-1',
        isImported: true,
        title: 'Imported PDF'
      })
    ])

    expect(screen.queryByTitle('Move to Trash')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Delete local file')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Card view'))
    expect(screen.queryByTitle('Move to Trash')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Delete local file')).not.toBeInTheDocument()
  })

  it('routes "Move to Trash" through the soft deleteCascade IPC — never the legacy permanent recordings.delete', async () => {
    renderListView([recording({ id: 'r-local', location: 'local-only', localPath: '/x' })])

    fireEvent.click(screen.getByTitle('Move to Trash'))

    await waitFor(() => expect(electronAPI.recordings.deleteCascade).toHaveBeenCalledWith('r-local', false))
    expect(electronAPI.recordings.delete).not.toHaveBeenCalled()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('to Trash?'))
  })

  it('shows a "Moved to Trash" toast whose Undo action restores the recording', async () => {
    renderListView([recording({ id: 'r-undo', location: 'local-only', localPath: '/x' })])

    fireEvent.click(screen.getByTitle('Move to Trash'))

    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const [title, , opts] = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(title).toBe('Moved to Trash')

    await act(async () => {
      await opts.action.onClick()
    })
    expect(electronAPI.recordings.restore).toHaveBeenCalledWith('r-undo')
  })

  it('does nothing when the Trash confirm is declined', async () => {
    ;(window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    renderListView([recording({ id: 'r-keep', location: 'local-only', localPath: '/x' })])

    fireEvent.click(screen.getByTitle('Move to Trash'))

    await act(async () => {}) // flush any pending microtasks
    expect(electronAPI.recordings.deleteCascade).not.toHaveBeenCalled()
    expect(electronAPI.recordings.delete).not.toHaveBeenCalled()
  })
})
