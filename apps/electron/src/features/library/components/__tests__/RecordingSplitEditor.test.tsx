import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordingSplitEditor } from '../RecordingSplitEditor'

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}))
vi.mock('@/components/ui/toaster', () => ({ toast }))
vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, actionLabel, onConfirm }: any) => open ? (
    <div role="dialog" aria-label={title}>
      <button onClick={onConfirm}>{actionLabel}</button>
    </div>
  ) : null,
}))

const detectSplitPoints = vi.fn()
const split = vi.fn()
const play = vi.fn()
const pause = vi.fn()
const seek = vi.fn()

function Harness({ onSplitCompleted = vi.fn() }: { onSplitCompleted?: (id: string) => void }) {
  const [point, setPoint] = useState(2400)
  return (
    <RecordingSplitEditor
      recordingId="rec-1"
      filePath="C:/recordings/session.hda"
      durationSec={4800}
      pointSec={point}
      isPlaying={false}
      onPointChange={setPoint}
      onCancel={vi.fn()}
      onSplitCompleted={onSplitCompleted}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  detectSplitPoints.mockResolvedValue({
    success: true,
    suggestions: [{
      timeSec: 1201,
      confidence: 0.9,
      reason: 'silence-and-transcript-gap',
      gapSeconds: 6,
    }],
  })
  split.mockResolvedValue({
    success: true,
    result: {
      originalRecordingId: 'rec-1',
      children: [{ id: 'child-1' }, { id: 'child-2' }],
    },
  })
  play.mockResolvedValue(undefined)
  Object.defineProperty(window, 'electronAPI', {
    value: { recordings: { detectSplitPoints, split } },
    configurable: true,
  })
  ;(window as any).__audioControls = { play, pause, seek }
})

describe('RecordingSplitEditor', () => {
  it('loads automatic boundaries and applies a suggestion to the shared cut point', async () => {
    render(<Harness />)
    expect(detectSplitPoints).toHaveBeenCalledWith('rec-1')

    const suggestion = await screen.findByRole('button', { name: /20:01\.0.*silence \+ transcript gap/i })
    fireEvent.click(suggestion)

    expect(screen.getByText('20:01.0', { selector: 'output' })).toBeInTheDocument()
    expect(seek).toHaveBeenCalledWith(1201)
  })

  it('supports 0.1-second keyboard adjustment and previews from the selected cut', async () => {
    render(<Harness />)
    await screen.findByRole('button', { name: /20:01\.0.*silence \+ transcript gap/i })
    fireEvent.keyDown(screen.getByRole('slider', { name: /exact split position/i }), { key: 'ArrowRight' })
    expect(screen.getByText('40:00.1', { selector: 'output' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /preview from cut/i }))
    await waitFor(() => expect(play).toHaveBeenCalledWith('rec-1', 'C:/recordings/session.hda', 2400.1))
  })

  it('confirms the operation, calls the split IPC, and selects the first child', async () => {
    const onSplitCompleted = vi.fn()
    render(<Harness onSplitCompleted={onSplitCompleted} />)
    fireEvent.click(screen.getByRole('button', { name: /create two recordings/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /create two recordings/i }).at(-1)!)

    await waitFor(() => expect(split).toHaveBeenCalledWith('rec-1', 2400))
    expect(onSplitCompleted).toHaveBeenCalledWith('child-1')
    expect(toast.success).toHaveBeenCalled()
  })
})
