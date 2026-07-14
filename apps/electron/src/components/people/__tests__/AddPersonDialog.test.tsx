import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddPersonDialog } from '../AddPersonDialog'
import { toast } from '@/components/ui/toaster'

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const mockCreate = vi.fn()

global.window.electronAPI = {
  contacts: { create: mockCreate }
} as any

function renderDialog(overrides: Partial<Parameters<typeof AddPersonDialog>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    onCreated: vi.fn(),
    onOpenExisting: vi.fn(),
    ...overrides
  }
  render(<AddPersonDialog {...props} />)
  return props
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AddPersonDialog', () => {
  it('blocks submission and shows an inline error when the name is empty', async () => {
    renderDialog()

    // The submit button is disabled while the name is empty.
    const submit = screen.getByRole('button', { name: /Add person/i })
    expect(submit).toBeDisabled()

    // Typing whitespace only still fails validation on submit.
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: '   ' } })
    fireEvent.submit(screen.getByLabelText(/Name/).closest('form')!)

    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects an invalid email before calling the backend', async () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Jane' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: /Add person/i }))

    expect(await screen.findByText('Please enter a valid email address.')).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a contact and reports success', async () => {
    mockCreate.mockResolvedValueOnce({ success: true, data: { id: 'new-1', name: 'Jane Doe' } })
    const { onCreated } = renderDialog()

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: /Add person/i }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Doe', type: 'unknown' }))
    )
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'new-1', name: 'Jane Doe' }))
    expect(toast.success).toHaveBeenCalled()
  })

  it('surfaces a duplicate-name guard and can open the existing contact instead', async () => {
    mockCreate.mockResolvedValueOnce({
      success: false,
      error: { code: 'DUPLICATE_ENTRY', message: 'exists', details: { existingId: 'dup-1', existingName: 'Jane Doe' } }
    })
    const { onOpenExisting, onCreated } = renderDialog()

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: /Add person/i }))

    // Inline warning appears (not a silent twin), with an "open it instead" action.
    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(onCreated).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Open it instead/i }))
    expect(onOpenExisting).toHaveBeenCalledWith('dup-1')
  })
})
