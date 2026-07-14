import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeletePermanentDialog, buildRemovesText, type DeletePermanentDialogImpact } from '../DeletePermanentDialog'

const baseImpact: DeletePermanentDialogImpact = {
  transcripts: 1,
  actionItems: 2,
  embeddings: 3,
  captures: 1,
  artifacts: 0,
  hasAudioFile: true
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof DeletePermanentDialog>> = {}) {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()
  render(
    <DeletePermanentDialog
      open
      onOpenChange={onOpenChange}
      filename="meeting.wav"
      impact={baseImpact}
      deviceConnected={false}
      onConfirm={onConfirm}
      {...overrides}
    />
  )
  return { onOpenChange, onConfirm }
}

describe('buildRemovesText', () => {
  it('falls back to the generic wording when impact is undefined', () => {
    expect(buildRemovesText(undefined)).toBe('the audio file and any transcript')
  })

  it('joins a single part with no comma', () => {
    expect(buildRemovesText({ transcripts: 0, actionItems: 0, embeddings: 0, captures: 0, artifacts: 0, hasAudioFile: true }))
      .toBe('the audio file')
  })

  it('pluralizes counts > 1 and singularizes count === 1', () => {
    const text = buildRemovesText({ transcripts: 1, actionItems: 2, embeddings: 0, captures: 0, artifacts: 0, hasAudioFile: false })
    expect(text).toContain('1 transcript')
    expect(text).not.toContain('1 transcripts')
    expect(text).toContain('2 action items')
  })

  it('joins multiple parts with a serial "and"', () => {
    const text = buildRemovesText(baseImpact)
    expect(text).toBe('1 transcript, 2 action items, 3 embeddings, and the audio file')
  })

  it('folds a numeric graphEstimate in as "~N graph links"', () => {
    const text = buildRemovesText({ ...baseImpact, graphEstimate: 5 })
    expect(text).toContain('~5 graph links')
  })

  it('singularizes "~1 graph link"', () => {
    const text = buildRemovesText({ ...baseImpact, graphEstimate: 1 })
    expect(text).toContain('~1 graph link')
    expect(text).not.toContain('~1 graph links')
  })

  it('omits any graph mention when graphEstimate is null or undefined', () => {
    expect(buildRemovesText({ ...baseImpact, graphEstimate: null })).not.toMatch(/graph link/)
    expect(buildRemovesText({ ...baseImpact, graphEstimate: undefined })).not.toMatch(/graph link/)
  })

  it('falls back to the generic wording when every count is zero/false', () => {
    expect(buildRemovesText({ transcripts: 0, actionItems: 0, embeddings: 0, captures: 0, artifacts: 0, hasAudioFile: false }))
      .toBe('the audio file and any transcript')
  })
})

describe('DeletePermanentDialog', () => {
  it('renders the title and the point-in-time impact sentence (AR3-8)', () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: /delete permanently/i })).toBeInTheDocument()
    expect(screen.getByText(/delete "meeting\.wav" permanently\?/i)).toBeInTheDocument()
    expect(screen.getByText(/as of now, this removes/i)).toBeInTheDocument()
    expect(screen.getByText(/this cannot be undone\./i)).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByRole('heading', { name: /delete permanently/i })).not.toBeInTheDocument()
  })

  describe('graph-impact honesty (AR3-8)', () => {
    it('renders no graph line when graphEstimate is undefined (not provided yet)', () => {
      renderDialog({ impact: baseImpact })
      expect(screen.queryByText(/graph link/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/graph impact: unknown/i)).not.toBeInTheDocument()
    })

    it('renders the count inline when graphEstimate is a number', () => {
      renderDialog({ impact: { ...baseImpact, graphEstimate: 7 } })
      expect(screen.getByText(/~7 graph links/i)).toBeInTheDocument()
    })

    it('renders an explicit "Graph impact: unknown" warning row when graphEstimate is null — never a silent omission', () => {
      renderDialog({ impact: { ...baseImpact, graphEstimate: null } })
      expect(screen.getByText(/graph impact: unknown/i)).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent(/graph cleanup may not be ready/i)
    })
  })

  describe('device checkbox (§D6/§D7)', () => {
    it('does not render when impact.onDevice is not true', () => {
      renderDialog({ impact: { ...baseImpact, onDevice: false } })
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      renderDialog({ impact: baseImpact }) // onDevice absent entirely
    })

    it('renders, unchecked by default, when impact.onDevice is true', () => {
      renderDialog({ impact: { ...baseImpact, onDevice: true }, deviceConnected: true })
      const checkbox = screen.getByRole('checkbox', { name: /also delete from device/i })
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toHaveAttribute('aria-checked', 'false')
    })

    it('is disabled when the device is not connected, with an explanatory hint', () => {
      renderDialog({ impact: { ...baseImpact, onDevice: true }, deviceConnected: false })
      const checkbox = screen.getByRole('checkbox', { name: /also delete from device/i })
      expect(checkbox).toBeDisabled()
      expect(screen.getByText(/connect the device to remove its copy too/i)).toBeInTheDocument()
    })

    it('is enabled (not disabled) when the device is connected', () => {
      renderDialog({ impact: { ...baseImpact, onDevice: true }, deviceConnected: true })
      const checkbox = screen.getByRole('checkbox', { name: /also delete from device/i })
      expect(checkbox).not.toBeDisabled()
    })
  })

  describe('onConfirm emits the correct alsoDeleteFromDevice', () => {
    it('emits false by default (checkbox never touched)', () => {
      const { onConfirm } = renderDialog({ impact: { ...baseImpact, onDevice: true }, deviceConnected: true })
      fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))
      expect(onConfirm).toHaveBeenCalledWith({ alsoDeleteFromDevice: false })
    })

    it('emits true after checking the box', () => {
      const { onConfirm } = renderDialog({ impact: { ...baseImpact, onDevice: true }, deviceConnected: true })
      fireEvent.click(screen.getByRole('checkbox', { name: /also delete from device/i }))
      fireEvent.click(screen.getByRole('button', { name: /^delete permanently$/i }))
      expect(onConfirm).toHaveBeenCalledWith({ alsoDeleteFromDevice: true })
    })

    it('cancel never calls onConfirm', () => {
      const { onConfirm } = renderDialog()
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(onConfirm).not.toHaveBeenCalled()
    })
  })
})
