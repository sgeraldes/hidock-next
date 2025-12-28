
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Projects } from '../Projects'
import { MemoryRouter } from 'react-router-dom'

// Mock Electron API
global.window.electronAPI = {
  projects: {
    getAll: vi.fn().mockResolvedValue({
      success: true,
      data: {
        projects: [
          { id: 'pr1', name: 'Project Alpha', status: 'active', createdAt: new Date().toISOString() }
        ],
        total: 1
      }
    })
  }
} as any

describe('Projects Page', () => {
  it('should render list of projects', async () => {
    render(
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    )

    const item = await screen.findByText('Project Alpha')
    expect(item).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
  })
})
