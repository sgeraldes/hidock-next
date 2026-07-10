import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StreamRail } from '../components/StreamRail'
import type { PersonToday, SourceMixEntry, ThreadSummary } from '../types'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

function renderRail(props: { threads?: ThreadSummary[]; people?: PersonToday[]; sourceMix?: SourceMixEntry[] } = {}) {
  return render(
    <MemoryRouter>
      <StreamRail threads={props.threads ?? []} people={props.people ?? []} sourceMix={props.sourceMix ?? []} />
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('StreamRail — Ask your knowledge', () => {
  it('routes a typed question to the assistant as initialQuery', () => {
    renderRail()
    fireEvent.change(screen.getByTestId('ask-input'), { target: { value: 'what did we decide on the gateway?' } })
    fireEvent.click(screen.getByLabelText('Ask'))
    expect(navigate).toHaveBeenCalledWith('/assistant', {
      state: { initialQuery: 'what did we decide on the gateway?' }
    })
  })

  it('routes to the assistant with no query when empty', () => {
    renderRail()
    fireEvent.click(screen.getByLabelText('Ask'))
    expect(navigate).toHaveBeenCalledWith('/assistant', undefined)
  })
})

describe('StreamRail — blocks render computed data', () => {
  it('lists threads with counts and opens a meeting thread', () => {
    renderRail({
      threads: [{ key: 'meeting:m1', label: 'Gateway sync', count: 3, sources: ['recording', 'document'] }]
    })
    const row = screen.getByTestId('thread-row')
    expect(within(row).getByText('Gateway sync')).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()
    fireEvent.click(row)
    expect(navigate).toHaveBeenCalledWith('/meeting/m1')
  })

  it('lists people today with rollups and opens a person', () => {
    renderRail({ people: [{ id: 'p1', name: 'Ana Ruiz', momentCount: 2, actionCount: 5 }] })
    const row = screen.getByTestId('person-row')
    expect(within(row).getByText('Ana Ruiz')).toBeInTheDocument()
    expect(within(row).getByText('2 moments · 5 actions')).toBeInTheDocument()
    fireEvent.click(row)
    expect(navigate).toHaveBeenCalledWith('/person/p1')
  })

  it('renders the source mix as bars per type', () => {
    renderRail({
      sourceMix: [
        { source: 'recording', count: 4 },
        { source: 'image', count: 2 }
      ]
    })
    const rows = screen.getAllByTestId('sourcemix-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('REC')).toBeInTheDocument()
    expect(within(rows[0]).getByText('4')).toBeInTheDocument()
    expect(within(rows[1]).getByText('IMG')).toBeInTheDocument()
  })

  it('shows honest empty states', () => {
    renderRail()
    expect(screen.getByText(/No linked threads yet/)).toBeInTheDocument()
    expect(screen.getByText(/No people in today's moments/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing captured in the last 7 days/)).toBeInTheDocument()
  })
})
