import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CalendarLegend } from '../CalendarLegend'

describe('CalendarLegend', () => {
  it('opens on click and explains the calendar visual language', () => {
    render(<CalendarLegend />)

    // Closed by default — the content is not mounted.
    expect(screen.queryByText('Unmatched recording — click to review')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /calendar legend/i }))

    // Category colors (from the shared meeting-category palette).
    expect(screen.getByText('Recurring / team')).toBeInTheDocument()
    expect(screen.getByText('1:1')).toBeInTheDocument()
    expect(screen.getByText('Client / external')).toBeInTheDocument()

    // Recording states: recorded badge, the unmatched block, the ghost/dashed state.
    expect(screen.getByText('Recorded (badge on the block)')).toBeInTheDocument()
    expect(screen.getByText('Unmatched recording — click to review')).toBeInTheDocument()
    expect(screen.getByText('Scheduled — not recorded')).toBeInTheDocument()

    // Location glyph meanings.
    expect(screen.getByText('On device only')).toBeInTheDocument()
    expect(screen.getByText('Synced (device + computer)')).toBeInTheDocument()
  })
})
