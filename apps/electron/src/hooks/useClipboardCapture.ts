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

/** Result of artifacts:import for pasted files. */
interface ArtifactImportSummary {
  title?: string
  kind?: string
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
      // FILES first (a Ctrl+C on files in Explorer — pdf/image/md/txt…):
      // resolve each pasted File to its disk path and run the artifact import
      // pipeline (extract → capture → embeddings; images also get PixelRAG).
      const files = e.clipboardData?.files ? Array.from(e.clipboardData.files) : []
      if (files.length > 0) {
        const paths = files
          .map((f) => {
            try {
              return api.getPathForFile(f)
            } catch {
              return ''
            }
          })
          .filter((p) => !!p)
        if (paths.length > 0) {
          e.preventDefault()
          void importPastedFiles(paths)
          return
        }
      }
      // Screenshot / copied-image-content paste (no file on disk — the main
      // process reads the bitmap from the clipboard directly).
      if (!pasteHasImage(e)) return
      // We are handling this image paste — stop the browser's default handling.
      e.preventDefault()
      void api.captureImage().then((result) => handleResult(result, 'paste'))
    }

    async function importPastedFiles(paths: string[]): Promise<void> {
      try {
        const res = (await window.electronAPI.artifacts.import(paths)) as { success?: boolean; data?: ArtifactImportSummary[] }
        const items = res?.data ?? []
        const added = items.filter((i) => !i.deduped && !i.error).length
        const dupes = items.filter((i) => i.deduped).length
        const failed = items.filter((i) => i.error).length
        if (added > 0) toast.success(added === 1 ? 'File added to your library' : `${added} files added to your library`)
        if (dupes > 0) toast.info(dupes === 1 ? '1 file was already in your library' : `${dupes} files were already in your library`)
        if (failed > 0) toast.error(failed === 1 ? '1 file could not be added' : `${failed} files could not be added`)
        if (added > 0 || dupes > 0) refreshLibrary()
      } catch (err) {
        toast.error('Could not add pasted files', err instanceof Error ? err.message : String(err))
      }
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
