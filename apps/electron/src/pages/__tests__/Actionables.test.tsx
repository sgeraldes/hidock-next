
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Actionables } from '../Actionables'
import { MemoryRouter } from 'react-router-dom'

// Mock Electron API
global.window.electronAPI = {
      actionables: {
        getAll: vi.fn().mockResolvedValue([
          { id: 'a1', title: 'Send meeting minutes', type: 'meeting_minutes', status: 'pending', createdAt: new Date().toISOString(), suggestedRecipients: [] }
        ])
      }} as any

describe('Actionables Page', () => {
  it('should render list of actionables', async () => {
    render(
      <MemoryRouter>
        <Actionables />
      </MemoryRouter>
    )

    const item = await screen.findByText('Send meeting minutes')
    expect(item).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
  })
})
