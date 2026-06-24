/**
 * TranscriptViewer Component
 *
 * A reusable component for displaying transcripts with interactive timestamps.
 * Parses timestamps, renders TimeAnchor components, highlights the current segment,
 * and auto-scrolls during playback.
 */

import { useEffect, useRef, useMemo, useState } from 'react'
import { TimeAnchor } from './TimeAnchor'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface TranscriptViewerProps {
  transcript: string
  currentTimeMs?: number
  onSeek: (startMs: number, endMs?: number) => void
  showSummary?: boolean
  showActionItems?: boolean
  summary?: string
  actionItems?: string[]
}

interface TranscriptSegment {
  startMs: number
  endMs?: number
  text: string
  speaker?: string
}

/**
 * Parse speaker name from text.
 * Supports formats: "Speaker Name:" or "[Speaker Name]" at the start of text
 */
function parseSpeaker(text: string): { speaker: string | undefined; remainingText: string } {
  // Try "Speaker Name:" format
  const colonMatch = text.match(/^([A-Z][^:]*?):\s*(.*)/)
  if (colonMatch) {
    return { speaker: colonMatch[1].trim(), remainingText: colonMatch[2].trim() }
  }

  // Try "[Speaker Name]" format
  const bracketMatch = text.match(/^\[([^\]]+)\]\s*(.*)/)
  if (bracketMatch) {
    return { speaker: bracketMatch[1].trim(), remainingText: bracketMatch[2].trim() }
  }

  return { speaker: undefined, remainingText: text }
}

/**
 * Parse timestamps from transcript text.
 * Supports formats: [MM:SS], [HH:MM:SS], MM:SS, HH:MM:SS
 */
function parseTimestamp(timestampStr: string): number | null {
  // Remove brackets if present
  const cleaned = timestampStr.replace(/[\[\]]/g, '').trim()

  // Split by colons
  const parts = cleaned.split(':').map(part => parseInt(part, 10))

  if (parts.some(isNaN)) {
    return null
  }

  let totalSeconds = 0

  if (parts.length === 2) {
    // MM:SS format
    const [minutes, seconds] = parts
    totalSeconds = minutes * 60 + seconds
  } else if (parts.length === 3) {
    // HH:MM:SS format
    const [hours, minutes, seconds] = parts
    totalSeconds = hours * 3600 + minutes * 60 + seconds
  } else {
    return null
  }

  return totalSeconds * 1000 // Convert to milliseconds
}

/**
 * Parse transcript into segments with timestamps.
 * Detects timestamps in formats: [MM:SS], [HH:MM:SS], bare MM:SS, HH:MM:SS at line start
 */
function parseTranscriptSegments(transcript: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []

  // Regex to match timestamps at the start of a line (with optional brackets)
  // Matches: [00:15], [00:15:30], 00:15, 00:15:30 at line start
  const timestampRegex = /^(\[?\d{1,2}:\d{2}(?::\d{2})?\]?)\s+(.*)$/gm

  let match: RegExpExecArray | null

  while ((match = timestampRegex.exec(transcript)) !== null) {
    const [, timestampStr, text] = match
    const startMs = parseTimestamp(timestampStr)

    if (startMs !== null) {
      // Set endMs of previous segment
      if (segments.length > 0) {
        segments[segments.length - 1].endMs = startMs
      }

      // Parse speaker name from text
      const { speaker, remainingText } = parseSpeaker(text.trim())

      segments.push({
        startMs,
        text: remainingText,
        speaker
      })
    }
  }

  // If no timestamps found, return entire transcript as single segment
  if (segments.length === 0) {
    return [{
      startMs: 0,
      text: transcript.trim()
    }]
  }

  return segments
}

export function TranscriptViewer({
  transcript,
  currentTimeMs,
  onSeek,
  showSummary = true,
  showActionItems = true,
  summary,
  actionItems
}: TranscriptViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeSegmentRef = useRef<HTMLDivElement>(null)

  const [summaryExpanded, setSummaryExpanded] = useState(true)
  const [actionItemsExpanded, setActionItemsExpanded] = useState(true)
  const [transcriptExpanded, setTranscriptExpanded] = useState(true)

  // Parse transcript into segments
  const segments = useMemo(() => parseTranscriptSegments(transcript), [transcript])

  // Find current segment index based on currentTimeMs
  const currentSegmentIndex = useMemo(() => {
    if (currentTimeMs === undefined) return -1

    return segments.findIndex((seg, i) => {
      const isAfterStart = currentTimeMs >= seg.startMs
      const isBeforeEnd = i === segments.length - 1 || (seg.endMs && currentTimeMs < seg.endMs)
      return isAfterStart && isBeforeEnd
    })
  }, [segments, currentTimeMs])

  // Auto-scroll to current segment during playback
  useEffect(() => {
    if (currentSegmentIndex >= 0 && activeSegmentRef.current) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }
  }, [currentSegmentIndex])

  // If transcript has no timestamps, render as plain text
  const hasTimestamps = segments.length > 1 || (segments.length === 1 && segments[0].startMs > 0)

  return (
    <div className="divide-y divide-border">
      {/* Summary Section */}
      {showSummary && summary && (
        <section className="py-3 first:pt-0">
          <button
            onClick={() => setSummaryExpanded(!summaryExpanded)}
            className="flex items-center justify-between w-full text-left hover:text-foreground/70 transition-colors"
            aria-expanded={summaryExpanded}
          >
            <span className="text-sm font-semibold">Summary</span>
            {summaryExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {summaryExpanded && (
            <p className="text-sm whitespace-pre-wrap leading-relaxed mt-2">{summary}</p>
          )}
        </section>
      )}

      {/* Action Items Section */}
      {showActionItems && actionItems && actionItems.length > 0 && (
        <section className="py-3 first:pt-0">
          <button
            onClick={() => setActionItemsExpanded(!actionItemsExpanded)}
            className="flex items-center justify-between w-full text-left hover:text-foreground/70 transition-colors"
            aria-expanded={actionItemsExpanded}
          >
            <span className="text-sm font-semibold">Action Items</span>
            {actionItemsExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {actionItemsExpanded && (
            <ul className="list-disc list-inside text-sm space-y-1 mt-2">
              {actionItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Full Transcript Section */}
      <section className="py-3 first:pt-0 last:pb-0">
        <button
          onClick={() => setTranscriptExpanded(!transcriptExpanded)}
          className="flex items-center justify-between w-full text-left hover:text-foreground/70 transition-colors"
          aria-expanded={transcriptExpanded}
        >
          <span className="text-sm font-semibold">Full Transcript</span>
          {transcriptExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {transcriptExpanded && (
          <div ref={containerRef} className="mt-2 max-h-[60vh] overflow-y-auto pr-1">
            {hasTimestamps ? (
              <div className="space-y-1">
                {segments.map((segment, i) => (
                  <div
                    key={i}
                    ref={i === currentSegmentIndex ? activeSegmentRef : null}
                    className={`text-sm p-2 rounded-md transition-colors ${
                      i === currentSegmentIndex ? 'bg-primary/10' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <TimeAnchor
                        startMs={segment.startMs}
                        endMs={segment.endMs}
                        isActive={i === currentSegmentIndex}
                        onSeek={onSeek}
                      >
                        {null}
                      </TimeAnchor>
                      {segment.speaker && (
                        <span className="font-semibold text-foreground">
                          {segment.speaker}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{segment.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{transcript}</p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
