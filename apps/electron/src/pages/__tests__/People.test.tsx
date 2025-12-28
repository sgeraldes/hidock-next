
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { People } from '../People'
import { MemoryRouter } from 'react-router-dom'

// Mock Electron API
global.window.electronAPI = {
  contacts: {
    getAll: vi.fn().mockResolvedValue({
      success: true,
      data: {
        contacts: [
          { id: 'p1', name: 'Mario', type: 'team', interactionCount: 5, lastSeenAt: new Date().toISOString(), tags: [] }
        ],
        total: 1
      }
    })
  }
} as any

describe('People Page', () => {
  it('should render list of people', async () => {
    render(
      <MemoryRouter>
        <People />
      </MemoryRouter>
    )

    const item = await screen.findByText('Mario')
    expect(item).toBeInTheDocument()
    expect(screen.getByText('team')).toBeInTheDocument()
  })
})
