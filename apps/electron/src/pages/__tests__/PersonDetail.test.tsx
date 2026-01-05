
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PersonDetail } from '../PersonDetail'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Mock Electron API
global.window.electronAPI = {
  contacts: {
    getById: vi.fn().mockResolvedValue({
      success: true,
      data: {
        contact: { id: 'p1', name: 'Mario', type: 'team', interactionCount: 5, lastSeenAt: new Date().toISOString(), tags: ['AI'] },
        meetings: [],
        totalMeetingTimeMinutes: 120
      }
    })
  }
} as any

describe('PersonDetail Page', () => {
  it('should render person details', async () => {
    render(
      <MemoryRouter initialEntries={['/person/p1']}>
        <Routes>
          <Route path="/person/:id" element={<PersonDetail />} />
        </Routes>
      </MemoryRouter>
    )

    const name = await screen.findByText('Mario')
    expect(name).toBeInTheDocument()
    expect(screen.getByText('team')).toBeInTheDocument()
  })
})
