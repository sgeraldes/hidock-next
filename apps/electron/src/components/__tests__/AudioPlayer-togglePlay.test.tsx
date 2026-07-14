/**
 * Reader waveform Play button — initial load+play on fresh open
 *
 * BUG: The Play button UNDER the waveform ("Press Play to load the waveform"
 * panel) did nothing on a fresh open. togglePlay only did pause/resume, so when
 * nothing was loaded in the shared audio engine, resume() no-oped. The file-list
 * Play button worked because it calls audioControls.play(id, path).
 *
 * FIX: AudioPlayer now takes a filePath prop and, when THIS recording isn't the
 * one currently loaded (currentlyPlayingId !== recordingId), the Play button does
 * the initial load+play via audioControls.play(recordingId, filePath).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { AudioPlayer } from '@/components/AudioPlayer'
import { useUIStore } from '@/store/useUIStore'

// The toggle Play/Pause button is the icon button sized h-10 w-10.
function getPlayButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector('button.h-10.w-10')
  if (!btn) throw new Error('Play/Pause toggle button not found')
  return btn as HTMLButtonElement
}

describe('AudioPlayer reader Play button — initial load+play', () => {
  beforeEach(() => {
    // Fresh, nothing loaded/playing.
    useUIStore.setState({ currentlyPlayingId: null, isPlaying: false })
    ;(window as any).__audioControls = {
      play: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      setPlaybackRate: vi.fn(),
      loadWaveformOnly: vi.fn()
    }
  })

  afterEach(() => {
    delete (window as any).__audioControls
    vi.restoreAllMocks()
  })

  it('not loaded → Play calls play(recordingId, filePath) for the initial load', () => {
    const { container } = render(
      <AudioPlayer recordingId="rec-1" filePath="/audio/rec-1.wav" filename="rec-1.wav" />
    )
    const btn = getPlayButton(container)
    expect(btn.disabled).toBe(false)

    fireEvent.click(btn)

    expect((window as any).__audioControls.play).toHaveBeenCalledWith('rec-1', '/audio/rec-1.wav')
    expect((window as any).__audioControls.resume).not.toHaveBeenCalled()
  })

  it('loaded + paused → Play calls resume (not a fresh play)', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', isPlaying: false })
    const { container } = render(
      <AudioPlayer recordingId="rec-1" filePath="/audio/rec-1.wav" filename="rec-1.wav" />
    )

    fireEvent.click(getPlayButton(container))

    expect((window as any).__audioControls.resume).toHaveBeenCalledTimes(1)
    expect((window as any).__audioControls.play).not.toHaveBeenCalled()
  })

  it('loaded + playing → button pauses', () => {
    useUIStore.setState({ currentlyPlayingId: 'rec-1', isPlaying: true })
    const { container } = render(
      <AudioPlayer recordingId="rec-1" filePath="/audio/rec-1.wav" filename="rec-1.wav" />
    )

    fireEvent.click(getPlayButton(container))

    expect((window as any).__audioControls.pause).toHaveBeenCalledTimes(1)
    expect((window as any).__audioControls.play).not.toHaveBeenCalled()
  })

  it('device-only / no filePath and not loaded → Play disabled and does nothing', () => {
    const { container } = render(
      <AudioPlayer recordingId="rec-1" filename="rec-1.wav" />
    )
    const btn = getPlayButton(container)

    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('title')).toBe('Download to play')

    fireEvent.click(btn)

    expect((window as any).__audioControls.play).not.toHaveBeenCalled()
    expect((window as any).__audioControls.resume).not.toHaveBeenCalled()
  })
})
