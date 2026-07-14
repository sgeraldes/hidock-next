import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TodayCaptures } from '../TodayCaptures'
import { useAppStore } from '@/store/useAppStore'
import type { UnifiedRecording } from '@/types/unified-recording'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

function rec(overrides: Partial<UnifiedRecording> & { id: string; filename: string; dateRecorded: Date }): UnifiedRecording {
  return {
    size: 0,
    duration: 0,
    transcriptionStatus: 'none',
    location: 'local-only',
    localPath: '/x',
    syncStatus: 'synced',
    ...overrides
  } as UnifiedRecording
}

function today(hours: number, minutes = 0): Date {
  const d = new Date()
  d.setHours(hours, minutes, 0, 0)
  return d
}

function renderCaptures() {
  return render(
    <MemoryRouter>
      <TodayCaptures />
    </MemoryRouter>
  )
}

describe('TodayCaptures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ unifiedRecordings: [] })
  })

  it('renders nothing when nothing non-recording was captured today', () => {
    useAppStore.setState({ unifiedRecordings: [rec({ id: 'a', filename: 'x.wav', dateRecorded: today(10) })] })
    const { container } = renderCaptures()
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('today-captures')).not.toBeInTheDocument()
  })

  it('lists today\'s captures with a type tag and count', () => {
    useAppStore.setState({
      unifiedRecordings: [
        rec({ id: 'img', filename: 'Shot.png', title: 'Shot.png', dateRecorded: today(14) }),
        rec({ id: 'pdf', filename: 'plan.pdf', title: 'Quarter plan', dateRecorded: today(9) })
      ]
    })
    renderCaptures()

    expect(screen.getByTestId('today-captures')).toBeInTheDocument()
    expect(screen.getByText('Also captured today')).toBeInTheDocument()
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByText('Shot.png')).toBeInTheDocument()
    expect(screen.getByText('Quarter plan')).toBeInTheDocument()
    expect(screen.getByText('Image')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.getAllByTestId('today-capture-row')).toHaveLength(2)
  })

  it('deep-links a capture into the Library on click', () => {
    useAppStore.setState({
      unifiedRecordings: [rec({ id: 'cap-42', filename: 'notes.md', dateRecorded: today(11) })]
    })
    renderCaptures()

    fireEvent.click(screen.getByTestId('today-capture-row'))
    expect(navigate).toHaveBeenCalledWith('/library', { state: { selectedId: 'cap-42' } })
  })
})
