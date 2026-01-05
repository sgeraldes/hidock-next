
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContextPicker } from '../ContextPicker'

// Mock Electron API
global.window.electronAPI = {
  knowledge: {
    getAll: vi.fn().mockResolvedValue([
      { id: 'k1', title: 'Knowledge 1', capturedAt: new Date().toISOString() },
      { id: 'k2', title: 'Knowledge 2', capturedAt: new Date().toISOString() }
    ])
  }
} as any

describe('ContextPicker Component', () => {
  it('should render list of knowledge captures', async () => {
    const onSelect = vi.fn()
    render(<ContextPicker onSelect={onSelect} selectedIds={[]} />)

    const item = await screen.findByText('Knowledge 1')
    expect(item).toBeInTheDocument()
  })

  it('should call onSelect when clicking an item', async () => {
    const onSelect = vi.fn()
    render(<ContextPicker onSelect={onSelect} selectedIds={[]} />)

    const item = await screen.findByText('Knowledge 1')
    fireEvent.click(item)

    expect(onSelect).toHaveBeenCalledWith('k1')
  })
})
