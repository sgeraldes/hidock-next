import { Badge } from '../ui/badge'
import type { Screenshot } from '../../types/models'
import { safeTimeString } from '../../lib/date-format'

interface ScreenshotCardProps {
  screenshot: Screenshot
  onClick: () => void
}

function formatTimestamp(ts: number): string {
  return safeTimeString(ts, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function ScreenshotCard({ screenshot, onClick }: ScreenshotCardProps) {
  const analyzed = screenshot.analysis != null

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
    >
      {/* Thumbnail */}
      <div className="aspect-video rounded-md overflow-hidden bg-muted relative">
        <img
          src={`file://${screenshot.path}`}
          alt={`Screenshot at ${formatTimestamp(screenshot.captured_at)}`}
          className="w-full h-full object-cover transition-transform duration-standard group-hover:scale-105"
          onError={(e) => {
            // Fallback when file:// is not accessible
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />
      </div>

      {/* Metadata row */}
      <div className="flex items-center justify-between gap-1 px-0.5">
        <span className="font-mono text-[11px] text-muted-foreground truncate">
          {formatTimestamp(screenshot.captured_at)}
        </span>
        <Badge variant={analyzed ? 'success' : 'default'}>
          {analyzed ? 'Analyzed' : 'Pending'}
        </Badge>
      </div>
    </button>
  )
}
