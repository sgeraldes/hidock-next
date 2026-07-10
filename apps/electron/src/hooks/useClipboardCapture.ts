import { useEffect } from 'react'
import { toast } from '@/components/ui/toaster'
import { useAutoCaptureScreenshots } from '@/store/ui/useUIStore'

/**
 * Clipboard screenshot capture (renderer side).
 *
 * - Paste-to-add: a document-level `paste` listener detects an image on the
 *   clipboard (Ctrl/Cmd+V) and turns it into an IMAGE knowledge capture via the
 *   main process, without hijacking ordinary text pastes.
 * - Auto-watch: mirrors the Settings "Auto-capture screenshots from clipboard"
 *   toggle to the main-process background poll, and listens for its push events.
 *
 * Both paths converge on {@link handleResult}: a toast + a Library refresh so the
 * new capture appears in Library › Images and the Today/Stream timeline.
 *
 * Mounted from App (via <ClipboardCapture/>), NOT from Layout.
 */

interface ClipboardCaptureResult {
  ok: boolean
  reason?: 'no-image' | 'duplicate' | 'error'
  captureId?: string
  title?: string
  sourceType?: 'image'
  deduped?: boolean
  error?: string
}

/** Trigger the same Library refresh path downloads use, so the new row shows up. */
function refreshLibrary(): void {
  window.dispatchEvent(new Event('hidock:downloads-completed'))
}

function handleResult(result: ClipboardCaptureResult, source: 'paste' | 'watch'): void {
  if (result.ok) {
    toast.success('Screenshot added', result.title)
    refreshLibrary()
    return
  }
  // Only surface a message for an explicit paste; watch pushes only fire on success.
  if (source === 'paste') {
    if (result.reason === 'duplicate') {
      toast.info('Screenshot already in your library')
    } else if (result.reason === 'error') {
      toast.error('Could not add screenshot', result.error)
    }
    // 'no-image' is silent — the paste is left to fall through to the default handler.
  }
}

/** True when a paste event carries an image (so we should capture, not hijack text). */
function pasteHasImage(e: ClipboardEvent): boolean {
  const data = e.clipboardData
  if (!data) return false
  if (data.files && Array.from(data.files).some((f) => f.type.startsWith('image/'))) return true
  if (data.items && Array.from(data.items).some((it) => it.kind === 'file' && it.type.startsWith('image/'))) return true
  return false
}

export function useClipboardCapture(): void {
  const autoCapture = useAutoCaptureScreenshots()

  // Paste-to-add + auto-watch push listener.
  useEffect(() => {
    const api = window.electronAPI?.clipboardCapture
    if (!api) return

    const onPaste = (e: ClipboardEvent): void => {
      if (!pasteHasImage(e)) return
      // We are handling this image paste — stop the browser's default handling.
      e.preventDefault()
      void api.captureImage().then((result) => handleResult(result, 'paste'))
    }

    document.addEventListener('paste', onPaste)

    const unsubscribe = window.electronAPI?.onClipboardCaptured
      ? window.electronAPI.onClipboardCaptured((result) => handleResult(result, 'watch'))
      : undefined

    return () => {
      document.removeEventListener('paste', onPaste)
      unsubscribe?.()
    }
  }, [])

  // Mirror the Settings toggle to the main-process background poll.
  useEffect(() => {
    const api = window.electronAPI?.clipboardCapture
    if (!api) return
    void api.setAutoWatch(autoCapture)
    return () => {
      // On unmount, stop the poll to avoid a leaked background timer.
      void api.setAutoWatch(false)
    }
  }, [autoCapture])
}

/** Zero-DOM mount point for {@link useClipboardCapture}; render inside App. */
export function ClipboardCapture(): null {
  useClipboardCapture()
  return null
}
