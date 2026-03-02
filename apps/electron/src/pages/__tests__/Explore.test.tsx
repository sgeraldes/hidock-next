
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Explore } from '../Explore'
import { MemoryRouter } from 'react-router-dom'

// Mock Electron API
global.window.electronAPI = {
      rag: {
      globalSearch: vi.fn().mockResolvedValue({
        success: true,
        data: {
          knowledge: [{ id: 'k1', title: 'Knowledge 1', summary: 'Summary 1', capturedAt: new Date().toISOString() }],
          people: [{ id: 'p1', name: 'Person 1', type: 'team' }],
          projects: [{ id: 'pr1', name: 'Project 1', status: 'active' }]
        }
      })
    }} as any

describe('Explore Page', () => {
  it('should render search results by category', async () => {
    render(
      <MemoryRouter>
        <Explore />
      </MemoryRouter>
    )

    const input = screen.getByPlaceholderText(/Search anything/i)
    fireEvent.change(input, { target: { value: 'test' } })

    await waitFor(() => {
      expect(screen.getByText('Knowledge 1')).toBeInTheDocument()
      expect(screen.getByText('Person 1')).toBeInTheDocument()
      expect(screen.getByText('Project 1')).toBeInTheDocument()
    }, { timeout: 2000 })
  })
})
