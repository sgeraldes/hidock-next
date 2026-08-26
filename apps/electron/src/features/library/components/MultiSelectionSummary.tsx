import type { UnifiedRecording } from '@/types/unified-recording'
import { formatBytes, formatDuration } from '@/lib/utils'

interface MultiSelectionSummaryProps {
  recordings: UnifiedRecording[]
  mode: 'library' | 'trash'
}

const PREVIEW_LIMIT = 20

const ACTIONS = {
  library: ['Download', 'Transcribe', 'Mark personal', 'Move to Trash', 'Delete permanently'],
  trash: ['Restore', 'Delete permanently']
} as const

export function MultiSelectionSummary({ recordings, mode }: MultiSelectionSummaryProps) {
  const totalBytes = recordings.reduce((total, recording) => total + Math.max(0, recording.size || 0), 0)
  const totalDuration = recordings.reduce((total, recording) => total + Math.max(0, recording.duration || 0), 0)
  const remainingCount = Math.max(0, recordings.length - PREVIEW_LIMIT)

  return (
    <section
      aria-labelledby="multi-selection-heading"
      className="h-full space-y-5 overflow-y-auto p-6"
      data-testid="multi-selection-summary"
    >
      <div>
        <h2 id="multi-selection-heading" className="text-xl font-semibold">
          {recordings.length} sources selected
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {recordings.length} items · {formatBytes(totalBytes)} · {formatDuration(totalDuration)} total
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium">Available bulk actions</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the bulk action bar above to {ACTIONS[mode].join(', ')}.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium">Selected sources</h3>
        <ul className="mt-2 space-y-1.5 text-sm">
          {recordings.slice(0, PREVIEW_LIMIT).map((recording) => (
            <li key={recording.id} className="truncate" title={recording.title || recording.filename}>
              {recording.title || recording.filename}
            </li>
          ))}
          {remainingCount > 0 && (
            <li className="text-muted-foreground">+ {remainingCount} more…</li>
          )}
        </ul>
      </div>
    </section>
  )
}
