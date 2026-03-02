
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PersonDetail } from '../PersonDetail'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mockGetById = vi.fn().mockResolvedValue({
  success: true,
  data: {
    contact: {
      id: 'p1',
      name: 'Mario',
      type: 'team',
      interactionCount: 5,
      lastSeenAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(),
      tags: ['AI'],
      email: 'mario@example.com',
      role: 'Engineer',
      company: 'Nintendo',
      notes: 'Great teammate'
    },
    meetings: [
      { id: 'm1', subject: 'Sprint Planning', start_time: '2026-02-20T10:00:00Z', end_time: '2026-02-20T11:00:00Z' }
    ],
    totalMeetingTimeMinutes: 120
  }
})

const mockUpdate = vi.fn().mockResolvedValue({ success: true })

// Mock Electron API
global.window.electronAPI = {
  contacts: {
    getById: mockGetById,
    update: mockUpdate,
    delete: vi.fn().mockResolvedValue({ success: true })
  }
} as any

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPersonDetail() {
  return render(
    <MemoryRouter initialEntries={['/person/p1']}>
      <Routes>
        <Route path="/person/:id" element={<PersonDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('PersonDetail Page', () => {
  it('should render person details', async () => {
    renderPersonDetail()

    const name = await screen.findByText('Mario')
    expect(name).toBeInTheDocument()
    expect(screen.getByText('team')).toBeInTheDocument()
  })

  it('should render person initials avatar', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    // Should show 'M' initial in the avatar area
    expect(screen.getByText('M')).toBeInTheDocument()
  })

  it('should render contact info fields', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    expect(screen.getByText('mario@example.com')).toBeInTheDocument()
    expect(screen.getByText('Engineer')).toBeInTheDocument()
    expect(screen.getByText('Nintendo')).toBeInTheDocument()
  })

  it('should render meeting timeline', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    expect(screen.getByText('Sprint Planning')).toBeInTheDocument()
  })

  it('should render tags', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    expect(screen.getByText('AI')).toBeInTheDocument()
  })

  it('should show loading state initially', () => {
    renderPersonDetail()

    // Loading spinner should be visible before data loads
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeTruthy()
  })

  it('should enter edit mode and show form fields', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    // Click Edit button
    fireEvent.click(screen.getByText('Edit'))

    // Should show Save and Cancel buttons
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('should validate empty name on save', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    // Enter edit mode
    fireEvent.click(screen.getByText('Edit'))

    // Clear the name field
    const nameInput = screen.getByPlaceholderText('Name...')
    fireEvent.change(nameInput, { target: { value: '' } })

    // Try to save
    fireEvent.click(screen.getByText('Save'))

    // Should NOT have called update API (name is required)
    await waitFor(() => {
      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })

  it('should validate email format on save', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    // Enter edit mode
    fireEvent.click(screen.getByText('Edit'))

    // Set an invalid email
    const emailInput = screen.getByPlaceholderText('Enter email...')
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } })

    // Try to save
    fireEvent.click(screen.getByText('Save'))

    // Should NOT have called update API (invalid email)
    await waitFor(() => {
      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })

  it('should cancel editing and restore original values', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    // Enter edit mode
    fireEvent.click(screen.getByText('Edit'))

    // Modify the name
    const nameInput = screen.getByPlaceholderText('Name...')
    fireEvent.change(nameInput, { target: { value: 'Luigi' } })

    // Cancel
    fireEvent.click(screen.getByText('Cancel'))

    // Should still show Mario (not Luigi)
    expect(screen.getByText('Mario')).toBeInTheDocument()
  })

  it('should show notes in view mode', async () => {
    renderPersonDetail()
    await screen.findByText('Mario')

    expect(screen.getByText('Great teammate')).toBeInTheDocument()
  })
})
