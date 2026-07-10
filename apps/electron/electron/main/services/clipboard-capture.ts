/**
 * Clipboard Screenshot Capture (knowledge-hub input path)
 *
 * Turns an image sitting on the OS clipboard into an IMAGE knowledge capture,
 * reusing the artifact pipeline (`importArtifact`): the PNG is written to a temp
 * file, imported (sha256 dedup → copy into the artifacts store → image
 * text-extraction/OCR via the registered `image` artifact type → knowledge_capture
 * row), then the temp file is removed.
 *
 * Two entry points share one dedup signature so a paste never gets re-added by
 * the auto-watch poll and vice-versa:
 *   - captureClipboardImage()  — explicit (Ctrl/Cmd+V paste in the renderer)
 *   - startClipboardWatch()    — optional background poll (Settings toggle)
 *
 * The capture's title is `Screenshot YYYY-MM-DD HH-MM-SS.png`; the `.png`
 * extension is what the Library's source-type derivation (features/library/utils/
 * sourceType.ts → getSourceType) reads to classify the row as `image`, so it
 * lands in Library › Images and the Today/Stream timeline.
 */

import { clipboard } from 'electron'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { importArtifact } from './artifact-service'

/** Source-type value the Library/Today stream will derive for these captures. */
export const CLIPBOARD_CAPTURE_SOURCE_TYPE = 'image' as const

export type ClipboardCaptureReason = 'no-image' | 'duplicate' | 'error'

export interface ClipboardCaptureResult {
  ok: boolean
  reason?: ClipboardCaptureReason
  captureId?: string
  artifactId?: string
  title?: string
  /** Always 'image' when ok — matches getSourceType() for the created row. */
  sourceType?: typeof CLIPBOARD_CAPTURE_SOURCE_TYPE
  deduped?: boolean
  error?: string
}

export interface StartWatchOptions {
  intervalMs?: number
  /** Invoked after each auto-added capture so the caller can push a renderer event. */
  onCapture?: (result: ClipboardCaptureResult) => void
}

// Module-level dedup signature shared by paste + watch. sha256 of the last
// PNG we processed; prevents the same image being added twice.
let lastSignature: string | null = null
let watchTimer: ReturnType<typeof setInterval> | null = null

const DEFAULT_WATCH_INTERVAL_MS = 1500

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Human, filesystem-safe capture title. The `.png` suffix drives source-type. */
export function buildScreenshotTitle(now: Date = new Date()): string {
  const y = now.getFullYear()
  const mo = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const h = pad(now.getHours())
  const mi = pad(now.getMinutes())
  const s = pad(now.getSeconds())
  return `Screenshot ${y}-${mo}-${d} ${h}-${mi}-${s}.png`
}

/** Read the clipboard image as PNG bytes, or null when the clipboard holds no image. */
export function readClipboardPng(): Buffer | null {
  const img = clipboard.readImage()
  if (!img || img.isEmpty()) return null
  const png = img.toPNG()
  if (!png || png.length === 0) return null
  return png
}

/**
 * Capture the current clipboard image as an image knowledge capture.
 *
 * Returns `{ ok: false, reason: 'no-image' }` when there is nothing to capture
 * (callers should let the paste event fall through in that case), and
 * `{ ok: false, reason: 'duplicate' }` when the identical image was already
 * processed (dedup by content hash).
 */
export async function captureClipboardImage(opts?: { force?: boolean; now?: Date }): Promise<ClipboardCaptureResult> {
  try {
    const png = readClipboardPng()
    if (!png) return { ok: false, reason: 'no-image' }

    const signature = createHash('sha256').update(png).digest('hex')
    if (!opts?.force && signature === lastSignature) {
      return { ok: false, reason: 'duplicate' }
    }
    // Record the signature up-front so a concurrent watch tick sees it as a
    // duplicate and does not double-add while importArtifact is awaited.
    lastSignature = signature

    const title = buildScreenshotTitle(opts?.now)
    const dir = join(tmpdir(), 'hidock-clipboard')
    mkdirSync(dir, { recursive: true })
    const tempPath = join(dir, `${signature.slice(0, 16)}.png`)
    writeFileSync(tempPath, png)

    try {
      const result = await importArtifact(tempPath, { title })
      return {
        ok: true,
        captureId: result.knowledgeCaptureId,
        artifactId: result.artifact.id,
        title,
        sourceType: CLIPBOARD_CAPTURE_SOURCE_TYPE,
        deduped: result.deduped
      }
    } finally {
      try {
        unlinkSync(tempPath)
      } catch {
        /* best-effort temp cleanup */
      }
    }
  } catch (e) {
    return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Begin polling the clipboard for NEW images and auto-adding them. Idempotent —
 * a second call while active is a no-op. Priming `lastSignature` with whatever
 * is already on the clipboard means enabling the watch does NOT grab a
 * pre-existing image; only images copied afterwards are captured.
 */
export function startClipboardWatch(opts: StartWatchOptions = {}): void {
  if (watchTimer) return

  const png = readClipboardPng()
  if (png) lastSignature = createHash('sha256').update(png).digest('hex')

  const intervalMs = opts.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS
  watchTimer = setInterval(() => {
    void captureClipboardImage().then((result) => {
      if (result.ok) opts.onCapture?.(result)
    })
  }, intervalMs)
}

/** Stop the background clipboard watch. Idempotent. */
export function stopClipboardWatch(): void {
  if (watchTimer) {
    clearInterval(watchTimer)
    watchTimer = null
  }
}

export function isClipboardWatchActive(): boolean {
  return watchTimer !== null
}

/** Test-only: reset module state between cases. */
export function __resetClipboardCaptureState(): void {
  stopClipboardWatch()
  lastSignature = null
}
