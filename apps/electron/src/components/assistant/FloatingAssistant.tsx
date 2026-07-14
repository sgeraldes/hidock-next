/**
 * FloatingAssistant
 *
 * The floating chat-bubble experience for the AI assistant. When the assistant's
 * placement is `floating` (the default), a rounded pill button floats over the
 * app. Clicking it opens a floating chat overlay that is anchored near the button
 * and does NOT push page content. The overlay is dismissible via click-away, Esc,
 * or the close control, and can be "pinned" to become the embedded docked pane.
 *
 * This is a pure CONTAINER — it hosts the existing assistant chat content passed
 * as `children` (the same component used by the embedded pane). It never rebuilds
 * the chat.
 *
 * Placement/position/open state all live in useUIStore so Settings can control it,
 * it persists across restart, and it is honored on load.
 */

import { useEffect, type ReactNode } from 'react'
import { Sparkles, Pin, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore, useChatOpen, useChatPosition } from '@/store/ui/useUIStore'

interface FloatingAssistantProps {
  /** The assistant chat content to host inside the overlay. */
  children: ReactNode
  /** Overlay/title label. */
  title?: string
}

export function FloatingAssistant({ children, title = 'Assistant' }: FloatingAssistantProps) {
  const position = useChatPosition()
  const open = useChatOpen()
  const setChatOpen = useUIStore((s) => s.setChatOpen)
  const setChatPlacement = useUIStore((s) => s.setChatPlacement)

  // Esc closes the overlay (only while open, to avoid a global listener).
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChatOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setChatOpen])

  // Position picks the corner: bottom-right (default) or bottom-left.
  const sideClass = position === 'left' ? 'left-4' : 'right-4'

  return (
    <>
      {/* Floating chat-bubble button — the default entry point. Responsive label:
          full "AI Assistant" → "AI" → icon-only as the window narrows. */}
      {!open && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Open AI assistant"
          aria-expanded={false}
          data-testid="floating-assistant-button"
          className={cn(
            'fixed bottom-4 z-40 flex items-center gap-2 rounded-full bg-primary py-3 pl-4 pr-4 text-primary-foreground shadow-lg',
            'transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            sideClass
          )}
        >
          <Sparkles className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="hidden whitespace-nowrap text-sm font-medium sm:inline">
            AI<span className="hidden xl:inline"> Assistant</span>
          </span>
        </button>
      )}

      {/* Floating chat overlay — anchored near the button, does not push content. */}
      {open && (
        <>
          {/* Transparent click-away scrim. */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            data-testid="floating-assistant-scrim"
            onClick={() => setChatOpen(false)}
          />
          <div
            role="dialog"
            aria-label="AI Assistant"
            aria-modal="false"
            data-testid="floating-assistant-overlay"
            className={cn(
              'fixed bottom-4 z-50 flex h-[32rem] max-h-[calc(100vh-6rem)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl',
              sideClass
            )}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setChatPlacement('embedded')}
                  aria-label="Pin assistant (embed as a docked pane)"
                  title="Pin — embed the assistant as a docked pane"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pin className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  aria-label="Close assistant"
                  title="Close the assistant"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
          </div>
        </>
      )}
    </>
  )
}
