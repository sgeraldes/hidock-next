import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StatusLegend } from '../StatusLegend'

describe('StatusLegend', () => {
  it('exposes a discoverable, labelled trigger', () => {
    render(<StatusLegend />)
    expect(screen.getByRole('button', { name: /status icon legend/i })).toBeInTheDocument()
  })

  it('reveals the location and transcription meanings when opened', () => {
    render(<StatusLegend />)
    fireEvent.click(screen.getByRole('button', { name: /status icon legend/i }))

    // Location key
    expect(screen.getByText('On device only')).toBeInTheDocument()
    expect(screen.getByText('Downloaded to computer')).toBeInTheDocument()
    expect(screen.getByText('Synced (device + computer)')).toBeInTheDocument()

    // Transcription key
    expect(screen.getByText('Not transcribed')).toBeInTheDocument()
    expect(screen.getByText('Transcribed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })
})
