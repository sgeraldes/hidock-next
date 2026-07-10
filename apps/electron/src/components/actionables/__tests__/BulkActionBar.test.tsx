import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkActionBar } from '../BulkActionBar'

describe('BulkActionBar', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = render(
      <BulkActionBar count={0} onDismiss={() => {}} onGenerate={() => {}} onClear={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows the selected count and wires all three actions', () => {
    const onDismiss = vi.fn()
    const onGenerate = vi.fn()
    const onClear = vi.fn()
    render(<BulkActionBar count={3} onDismiss={onDismiss} onGenerate={onGenerate} onClear={onClear} />)

    expect(screen.getByText('3 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))

    expect(onGenerate).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('disables the actions while busy', () => {
    render(
      <BulkActionBar count={2} busy onDismiss={() => {}} onGenerate={() => {}} onClear={() => {}} />
    )
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled()
  })
})
