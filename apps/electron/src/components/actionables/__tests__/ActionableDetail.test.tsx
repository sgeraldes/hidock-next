import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { ActionableDetail } from '../ActionableDetail'
import type { Actionable } from '@/types/knowledge'

/** Probe that surfaces the current pathname so navigation can be asserted. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

const mockKnowledgeGetById = vi.fn()
const mockRecordingsGetById = vi.fn()

/** Minimal actionable fixture — source resolution is what these tests exercise. */
function makeActionable(sourceKnowledgeId: string): Actionable {
  return {
    id: 'a1',
    type: 'meeting_minutes',
    title: 'Send meeting minutes',
    description: 'Follow up with the team.',
    sourceKnowledgeId,
    sourceActionItemId: null,
    suggestedTemplate: 'meeting_minutes',
    suggestedRecipients: [],
    status: 'pending',
    artifactId: null,
    generatedAt: null,
    sharedAt: null,
    createdAt: new Date('2026-06-01T10:00:00Z').toISOString(),
    updatedAt: new Date('2026-06-01T10:00:00Z').toISOString()
  }
}

function renderDetail(sourceKnowledgeId: string) {
  return render(
    <MemoryRouter initialEntries={['/actionables']}>
      <Routes>
        <Route
          path="/actionables"
          element={<ActionableDetail actionable={makeActionable(sourceKnowledgeId)} resolveRecipient={() => undefined} />}
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  global.window.electronAPI = {
    knowledge: { getById: mockKnowledgeGetById },
    recordings: { getById: mockRecordingsGetById }
  } as any
})

describe('ActionableDetail source resolution', () => {
  // (a) source_knowledge_id resolves to a knowledge capture → meeting mention.
  it('renders a meeting link when the id resolves to a knowledge capture', async () => {
    mockKnowledgeGetById.mockResolvedValue({
      id: 'kc-1',
      title: 'Weekly sync',
      meetingId: 'm-1',
      sourceRecordingId: 'r-1',
      capturedAt: new Date('2026-06-01T10:00:00Z').toISOString()
    })

    renderDetail('kc-1')

    const link = await screen.findByRole('button', { name: /open meeting weekly sync/i })
    expect(link).toBeInTheDocument()
    expect(mockKnowledgeGetById).toHaveBeenCalledWith('kc-1')
    // Capture path short-circuits — no recording lookup needed.
    expect(mockRecordingsGetById).not.toHaveBeenCalled()
  })

  // (b) capture lookup misses; the id is a RAW RECORDING id → Library link.
  it('falls back to a Library link when the id is a raw recording id', async () => {
    mockKnowledgeGetById.mockResolvedValue(null)
    mockRecordingsGetById.mockResolvedValue({
      id: 'r-42',
      filename: 'rec_2026-06-01.wav',
      original_filename: 'Standup.wav',
      date_recorded: new Date('2026-06-01T09:00:00Z').toISOString(),
      meeting_id: null
    })

    renderDetail('r-42')

    // Uses the recording's friendly name and links into the Library.
    const link = await screen.findByRole('button', { name: /standup\.wav/i })
    expect(link).toBeInTheDocument()
    expect(mockRecordingsGetById).toHaveBeenCalledWith('r-42')

    fireEvent.click(link)
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/library')
    })
  })

  // (b') a recording that itself links to a meeting → prefer the meeting mention.
  it('prefers a meeting mention when the fallback recording links to a meeting', async () => {
    mockKnowledgeGetById.mockResolvedValue(null)
    mockRecordingsGetById.mockResolvedValue({
      id: 'r-7',
      filename: 'rec.wav',
      original_filename: 'Kickoff.wav',
      date_recorded: new Date('2026-06-02T09:00:00Z').toISOString(),
      meeting_id: 'm-99'
    })

    renderDetail('r-7')

    const link = await screen.findByRole('button', { name: /open meeting kickoff\.wav/i })
    expect(link).toBeInTheDocument()
  })

  // (c) neither lookup resolves → honest "Source unavailable", never a fake label.
  it('renders "Source unavailable" when neither lookup resolves', async () => {
    mockKnowledgeGetById.mockResolvedValue(null)
    mockRecordingsGetById.mockResolvedValue(null)

    renderDetail('missing-id')

    expect(await screen.findByText('Source unavailable')).toBeInTheDocument()
    // Never renders the old dead "Source recording" label.
    expect(screen.queryByText('Source recording')).not.toBeInTheDocument()
    expect(mockRecordingsGetById).toHaveBeenCalledWith('missing-id')
  })
})
