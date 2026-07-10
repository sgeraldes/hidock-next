import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MomentCard } from '../components/MomentCard'
import type { Moment } from '../types'

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

function renderCard(moment: Moment) {
  return render(
    <MemoryRouter>
      <MomentCard moment={moment} />
    </MemoryRouter>
  )
}

const base = { badges: [], links: [] }

beforeEach(() => vi.clearAllMocks())

describe('MomentCard — renders each source type from a fixture', () => {
  it('REC — recording card with type badge, title and chips', () => {
    renderCard({
      ...base,
      id: 'rec:1',
      source: 'recording',
      timestamp: '2026-07-09T09:00:00Z',
      title: 'Gateway sync',
      summary: 'We aligned on the handoff.',
      badges: [
        { label: '13 min' },
        { label: '7 actions', tone: 'action' }
      ],
      recording: { recordingId: '1', transcribed: true, actionCount: 7 },
      open: { route: '/library', state: { selectedId: '1' } }
    })
    const card = screen.getByTestId('moment-card')
    expect(card).toHaveAttribute('data-source', 'recording')
    expect(screen.getByText('REC')).toBeInTheDocument()
    expect(screen.getByText('Gateway sync')).toBeInTheDocument()
    expect(screen.getByText('7 actions')).toBeInTheDocument()
  })

  it('DOC — document card', () => {
    renderCard({
      ...base,
      id: 'rec:2',
      source: 'document',
      timestamp: '2026-07-09T09:00:00Z',
      title: 'Design spec',
      badges: [{ label: 'PDF' }, { label: 'extracted', tone: 'info' }],
      document: { kind: 'pdf', extracted: true }
    })
    expect(screen.getByTestId('moment-card')).toHaveAttribute('data-source', 'document')
    expect(screen.getByText('DOC')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
  })

  it('IMG — image card shows screenshot + OCR + table chips and a thumbnail', () => {
    renderCard({
      ...base,
      id: 'img:1',
      source: 'image',
      timestamp: '2026-07-09T09:00:00Z',
      title: 'Clipboard grab',
      badges: [{ label: 'screenshot' }],
      image: { thumbnailUrl: 'data:image/png;base64,AAAA', ocr: true, tableExtracted: true }
    })
    expect(screen.getByTestId('moment-card')).toHaveAttribute('data-source', 'image')
    expect(screen.getByText('IMG')).toBeInTheDocument()
    expect(screen.getByText('OCR’d')).toBeInTheDocument()
    expect(screen.getByText('table extracted')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeTruthy()
  })

  it('CODE — code card shows commits, repo and open question', () => {
    renderCard({
      ...base,
      id: 'c:1',
      source: 'code',
      timestamp: '2026-07-09T09:00:00Z',
      title: 'startPoll fix',
      badges: [],
      code: { repo: 'hidock-next', branch: 'feat/stream', commitCount: 3, openQuestion: 'gate the poll loop?' }
    })
    expect(screen.getByTestId('moment-card')).toHaveAttribute('data-source', 'code')
    expect(screen.getByText('CODE')).toBeInTheDocument()
    expect(screen.getByText('3 commits')).toBeInTheDocument()
    expect(screen.getByText('hidock-next')).toBeInTheDocument()
    expect(screen.getByText('feat/stream')).toBeInTheDocument()
    expect(screen.getByText('gate the poll loop?')).toBeInTheDocument()
  })

  it('DGM — diagram card shows tool and component count', () => {
    renderCard({
      ...base,
      id: 'g:1',
      source: 'diagram',
      timestamp: '2026-07-09T09:00:00Z',
      title: 'Sync architecture',
      badges: [],
      diagram: { tool: 'draw.io', componentCount: 8 }
    })
    expect(screen.getByTestId('moment-card')).toHaveAttribute('data-source', 'diagram')
    expect(screen.getByText('DGM')).toBeInTheDocument()
    expect(screen.getByText('draw.io')).toBeInTheDocument()
    expect(screen.getByText('8 components')).toBeInTheDocument()
  })
})

describe('MomentCard — affordances', () => {
  it('title click opens the moment target', () => {
    renderCard({
      ...base,
      id: 'rec:1',
      source: 'recording',
      timestamp: '2026-07-09T09:00:00Z',
      title: 'Gateway sync',
      recording: { recordingId: '1', transcribed: true },
      open: { route: '/library', state: { selectedId: '1' } }
    })
    fireEvent.click(screen.getByTestId('moment-title'))
    expect(navigate).toHaveBeenCalledWith('/library', { state: { selectedId: '1' } })
  })

  it('still-on-device recording exposes a Sync & transcribe action → /sync', () => {
    renderCard({
      ...base,
      id: 'd:1',
      source: 'recording',
      timestamp: '2026-07-09T09:00:00Z',
      title: 'REC001',
      stillOnDevice: true,
      recording: { recordingId: 'd1', transcribed: false }
    })
    const cta = screen.getByTestId('sync-transcribe')
    fireEvent.click(cta)
    expect(navigate).toHaveBeenCalledWith('/sync')
  })

  it('person link is clickable → /person/:id', () => {
    renderCard({
      ...base,
      id: 'rec:1',
      source: 'recording',
      timestamp: '2026-07-09T09:00:00Z',
      title: 'Gateway sync',
      links: [{ kind: 'person', label: 'Ana', id: 'p1', route: '/person/p1' }],
      recording: { recordingId: '1', transcribed: true }
    })
    fireEvent.click(screen.getByText('Ana'))
    expect(navigate).toHaveBeenCalledWith('/person/p1', undefined)
  })
})
