/**
 * Tests for TranscriptViewer transcript parsing/rendering.
 *
 * Focus: speaker-label handling for transcripts WITHOUT timestamps, especially
 * markdown-bold labels (**Name:**) produced by the transcription pipeline, which
 * previously rendered with literal asterisks.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranscriptViewer } from '../TranscriptViewer'

const noop = () => {}

describe('TranscriptViewer speaker parsing', () => {
  it('renders markdown-bold **Name:** labels as speaker names without asterisks', () => {
    const transcript = [
      '**Vanessa:** Hola a todos, ¿cómo están?',
      '',
      '**Jorge:** Bien, gracias. Empecemos.',
    ].join('\n')

    render(<TranscriptViewer transcript={transcript} onSeek={noop} />)

    // Speaker names appear as their own elements (no surrounding ** markers)
    expect(screen.getByText('Vanessa')).toBeInTheDocument()
    expect(screen.getByText('Jorge')).toBeInTheDocument()

    // The literal markdown markers must not survive into the rendered output
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()

    // Spoken text is preserved
    expect(screen.getByText(/Hola a todos/)).toBeInTheDocument()
    expect(screen.getByText(/Empecemos/)).toBeInTheDocument()
  })

  it('handles **Name**: (colon outside the bold) too', () => {
    render(<TranscriptViewer transcript={'**Kevin**: Listo, gracias.'} onSeek={noop} />)
    expect(screen.getByText('Kevin')).toBeInTheDocument()
    expect(screen.getByText(/Listo, gracias\./)).toBeInTheDocument()
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument()
  })

  it('still renders plain "Name:" speaker labels', () => {
    render(<TranscriptViewer transcript={'Sebastián: Perfecto, quedamos así.'} onSeek={noop} />)
    expect(screen.getByText('Sebastián')).toBeInTheDocument()
    expect(screen.getByText(/quedamos así/)).toBeInTheDocument()
  })

  it('renders a transcript with no speaker labels as plain text', () => {
    render(<TranscriptViewer transcript={'Just some narration without any speaker labels.'} onSeek={noop} />)
    expect(screen.getByText(/Just some narration/)).toBeInTheDocument()
  })
})
