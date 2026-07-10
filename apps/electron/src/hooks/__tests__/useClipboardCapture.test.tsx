import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { ClipboardCapture } from '@/hooks/useClipboardCapture'
import { useUIStore } from '@/store/ui/useUIStore'
import { getSourceType } from '@/features/library/utils/sourceType'

// Toast is a global emitter; calling it is harmless in tests. Silence it anyway.
vi.mock('@/components/ui/toaster', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  })
}))

function setupApi() {
  const captureImage = vi.fn().mockResolvedValue({
    ok: true,
    title: 'Screenshot 2026-07-10 14-05-09.png',
    sourceType: 'image'
  })
  const setAutoWatch = vi.fn().mockResolvedValue({ active: false })
  const isWatchActive = vi.fn().mockResolvedValue({ active: false })
  const onClipboardCaptured = vi.fn(() => () => {})
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    clipboardCapture: { captureImage, setAutoWatch, isWatchActive },
    onClipboardCaptured
  }
  return { captureImage, setAutoWatch, isWatchActive, onClipboardCaptured }
}

function dispatchPaste(payload: { files?: File[]; items?: Array<{ kind: string; type: string }> }): Event {
  const evt = new Event('paste', { cancelable: true }) as Event & { clipboardData: unknown }
  evt.clipboardData = { files: payload.files ?? [], items: payload.items ?? [] }
  document.dispatchEvent(evt)
  return evt
}

describe('useClipboardCapture', () => {
  beforeEach(() => {
    act(() => useUIStore.getState().setAutoCaptureScreenshots(false))
  })

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
    vi.clearAllMocks()
  })

  it('captures on a paste that carries an image', async () => {
    const { captureImage } = setupApi()
    render(<ClipboardCapture />)

    const img = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
    const evt = dispatchPaste({ files: [img] })

    expect(evt.defaultPrevented).toBe(true)
    await waitFor(() => expect(captureImage).toHaveBeenCalledTimes(1))
  })

  it('ignores a text-only paste (does not hijack it)', async () => {
    const { captureImage } = setupApi()
    render(<ClipboardCapture />)

    const evt = dispatchPaste({ items: [{ kind: 'string', type: 'text/plain' }] })

    expect(evt.defaultPrevented).toBe(false)
    // Give any stray microtask a chance, then assert no capture happened.
    await Promise.resolve()
    expect(captureImage).not.toHaveBeenCalled()
  })

  it('the screenshot title classifies as an image source type in the Library', () => {
    // The capture surfaces as a UnifiedRecording whose filename is the title;
    // getSourceType reads the .png extension → Library › Images + Today stream.
    expect(getSourceType({ filename: 'Screenshot 2026-07-10 14-05-09.png', location: 'local-only' })).toBe('image')
  })

  it('gates the auto-watch on the Settings toggle', async () => {
    const { setAutoWatch } = setupApi()
    render(<ClipboardCapture />)

    // Mounts OFF → tells main to stop/not-watch.
    await waitFor(() => expect(setAutoWatch).toHaveBeenCalledWith(false))
    setAutoWatch.mockClear()

    // Turning the toggle on drives the background poll on.
    act(() => useUIStore.getState().setAutoCaptureScreenshots(true))
    await waitFor(() => expect(setAutoWatch).toHaveBeenCalledWith(true))
  })
})
