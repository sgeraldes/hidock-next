import { useRef, useState, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranscriptStore } from '../../stores/transcript-store'
import { TranscriptSegment } from './TranscriptSegment'
import { TranscriptSearch } from './TranscriptSearch'

interface TranscriptViewerProps {
  sessionId: string
  sessionStartedAt: number
}

export function TranscriptViewer({ sessionId: _sessionId, sessionStartedAt }: TranscriptViewerProps) {
  const { segments, interimText } = useTranscriptStore()
  const parentRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isNearBottom, setIsNearBottom] = useState(true)

  const filteredSegments = searchQuery
    ? segments.filter((s) => s.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : segments

  const virtualizer = useVirtualizer({
    count: filteredSegments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  })

  // Auto-scroll to bottom when new segments arrive and user is near the bottom
  useEffect(() => {
    if (isNearBottom && filteredSegments.length > 0) {
      virtualizer.scrollToIndex(filteredSegments.length - 1, { align: 'end' })
    }
  }, [segments.length, isNearBottom, filteredSegments.length, virtualizer])

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    setIsNearBottom(nearBottom)
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2 py-1.5 border-b border-border/50 shrink-0">
        <TranscriptSearch value={searchQuery} onChange={setSearchQuery} />
      </div>

      {filteredSegments.length === 0 && !interimText ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="font-sans text-sm text-muted-foreground">
            {searchQuery ? 'No matching segments' : 'No transcript yet'}
          </p>
        </div>
      ) : (
        <div
          ref={parentRef}
          className="flex-1 overflow-y-auto min-h-0"
          onScroll={handleScroll}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const segment = filteredSegments[virtualItem.index]
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <TranscriptSegment
                    segment={segment}
                    sessionStartedAt={sessionStartedAt}
                    searchQuery={searchQuery}
                  />
                </div>
              )
            })}
          </div>

          {interimText && (
            <div className="px-2 py-1.5 border-t border-border/30">
              <p className="font-sans text-sm text-muted-foreground italic">{interimText}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
