import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
  useSetCalendarSyncing: () => vi.fn()
}))

vi.mock('@/store/domain/useConfigStore', () => ({
  useConfigStore: vi.fn((selector: (s: any) => any) =>
    selector({ config: {}, loadConfig: vi.fn().mockResolvedValue(undefined), updateConfig: vi.fn().mockResolvedValue(undefined) })
  )
}))

vi.mock('@/store/useUIStore', () => ({
  useUIStore: vi.fn((selector: (s: any) => any) => selector({ currentlyPlayingId: null }))
}))

import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'
import { Calendar } from '../Calendar'

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
