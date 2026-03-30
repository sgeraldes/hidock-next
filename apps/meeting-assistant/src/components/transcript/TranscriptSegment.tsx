import type { TranscriptSegment as TranscriptSegmentType } from '../../types/models'
import { cn } from '../../lib/utils'

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType
  sessionStartedAt: number
  searchQuery?: string
}

function speakerColorIndex(speaker: string): number {
  let hash = 0
  for (const char of speaker) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return (Math.abs(hash) % 6) + 1
}

function formatTimestamp(startTimeSecs: number, sessionStartedAt: number): string {
  const offsetMs = startTimeSecs * 1000 - sessionStartedAt
  const totalSecs = Math.max(0, Math.floor(offsetMs / 1000))
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-accent/30 text-foreground rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  )
}

const speakerColorClasses: Record<number, string> = {
  1: 'text-speaker-1',
  2: 'text-speaker-2',
  3: 'text-speaker-3',
  4: 'text-speaker-4',
  5: 'text-speaker-5',
  6: 'text-speaker-6',
}

export function TranscriptSegment({
  segment,
  sessionStartedAt,
  searchQuery = '',
}: TranscriptSegmentProps) {
  const speaker = segment.speaker ?? 'Unknown'
  const colorIndex = speakerColorIndex(speaker)
  const colorClass = speakerColorClasses[colorIndex]
  const timestamp = formatTimestamp(segment.start_time, sessionStartedAt)

  return (
    <div className="flex flex-col gap-0.5 py-1.5 px-2">
      <div className="flex items-baseline gap-1.5">
        <span className={cn('font-sans text-[11px] font-semibold leading-none truncate max-w-[120px]', colorClass)}>
          {speaker}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground leading-none shrink-0">
          {timestamp}
        </span>
      </div>
      <p className="font-sans text-sm text-foreground leading-snug">
        {highlightText(segment.text, searchQuery)}
      </p>
    </div>
  )
}
