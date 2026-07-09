import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RecordingTooltipContent } from '../CalendarTooltips'
import type { CalendarRecording } from '@/lib/calendar-utils'

const base: CalendarRecording = {
  id: 'r1',
  filename: '2026Jul08-140719-Rec46.hda',
  startTime: new Date(2026, 6, 8, 14, 7, 0),
  endTime: new Date(2026, 6, 8, 14, 19, 0),
  durationSeconds: 720,
  location: 'local-only',
  transcriptionStatus: 'complete'
}

describe('RecordingTooltipContent', () => {
  it('leads with the recording title and summary when known', () => {
    render(
      <RecordingTooltipContent
        recording={{
          ...base,
          title: 'Cierre de Proyecto y Acciones de Retrospectiva',
          summary: 'Revisión de cierre y próximos pasos del equipo.'
        }}
      />
    )
    expect(screen.getByText('Cierre de Proyecto y Acciones de Retrospectiva')).toBeInTheDocument()
    expect(screen.getByText('Revisión de cierre y próximos pasos del equipo.')).toBeInTheDocument()
  })

  it('names the unlinked state honestly instead of "no matching meeting"', () => {
    render(<RecordingTooltipContent recording={base} />)
    expect(screen.getByText('Not linked to a meeting')).toBeInTheDocument()
    expect(screen.queryByText(/No matching meeting/i)).not.toBeInTheDocument()
    // The action hint reflects what the click does (open the assignment surface).
    expect(screen.getByText(/Click to review · assign to a meeting/i)).toBeInTheDocument()
  })
})
