import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog'
import type { Screenshot } from '../../types/models'

interface ScreenshotDialogProps {
  screenshot: Screenshot | null
  open: boolean
  onClose: () => void
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function ScreenshotDialog({ screenshot, open, onClose }: ScreenshotDialogProps) {
  if (!screenshot) return null

  const captureMode = screenshot.is_manual ? 'Manual capture' : 'Auto capture'

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl w-full p-4">
        <DialogHeader>
          <DialogTitle>Screenshot</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{formatTimestamp(screenshot.captured_at)}</span>
            {' · '}
            <span>{captureMode}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Full-size image */}
        <div className="rounded-md overflow-hidden bg-muted">
          <img
            src={`file://${screenshot.path}`}
            alt={`Screenshot at ${formatTimestamp(screenshot.captured_at)}`}
            className="w-full h-auto object-contain"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>

        {/* Analysis text */}
        {screenshot.analysis && (
          <p className="mt-3 text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {screenshot.analysis}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
