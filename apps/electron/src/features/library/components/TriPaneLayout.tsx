/**
 * TriPaneLayout Component
 *
 * Responsive three-column layout for the Library page:
 * - Desktop (≥1024px): Three-column resizable layout
 * - Tablet (<1024px): Two-column layout with toggleable third panel
 * - Mobile (<768px): Single-column with tab navigation
 *
 * Panels:
 * - Left Panel: Recording list with filters
 * - Center Panel: Source content viewer
 * - Right Panel: AI Assistant
 *
 * Panel sizes are persisted across navigation via useLibraryStore.
 */

import { useState, useEffect } from 'react'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useIsMobile, useIsTablet } from '@/hooks/useMediaQuery'

interface TriPaneLayoutProps {
  leftPanel: React.ReactNode
  centerPanel: React.ReactNode
  rightPanel: React.ReactNode
}

export function TriPaneLayout({ leftPanel, centerPanel, rightPanel }: TriPaneLayoutProps) {
  const panelSizes = useLibraryStore((state) => state.panelSizes)
  const setPanelSizes = useLibraryStore((state) => state.setPanelSizes)

  // Responsive breakpoint detection
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()
  // Desktop layout is default when neither mobile nor tablet

  // Mobile: Track active pane
  const [activeMobilePane, setActiveMobilePane] = useState<'left' | 'center' | 'right'>('center')

  // Tablet: Track right panel visibility
  const [showRightPanelTablet, setShowRightPanelTablet] = useState(false)

  // Persist mobile tab selection
  useEffect(() => {
    const saved = localStorage.getItem('mobile-active-pane')
    if (saved && isMobile) {
      setActiveMobilePane(saved as 'left' | 'center' | 'right')
    }
  }, [isMobile])

  useEffect(() => {
    if (isMobile) {
      localStorage.setItem('mobile-active-pane', activeMobilePane)
    }
  }, [activeMobilePane, isMobile])

  // Mobile Layout: Single pane with tab navigation
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 bg-white">
          <button
            onClick={() => setActiveMobilePane('left')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeMobilePane === 'left'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            aria-label="Show recording list"
            aria-pressed={activeMobilePane === 'left'}
          >
            Recordings
          </button>
          <button
            onClick={() => setActiveMobilePane('center')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeMobilePane === 'center'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            aria-label="Show recording content"
            aria-pressed={activeMobilePane === 'center'}
          >
            Content
          </button>
          <button
            onClick={() => setActiveMobilePane('right')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeMobilePane === 'right'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            aria-label="Show AI assistant"
            aria-pressed={activeMobilePane === 'right'}
          >
            Assistant
          </button>
        </div>

        {/* Active Pane Content */}
        <div className="flex-1 overflow-hidden">
          {activeMobilePane === 'left' && (
            <div
              role="region"
              aria-label="Recording list"
              className="h-full overflow-auto"
            >
              {leftPanel}
            </div>
          )}
          {activeMobilePane === 'center' && (
            <div
              role="region"
              aria-label="Recording content viewer"
              className="h-full overflow-hidden"
            >
              {centerPanel}
            </div>
          )}
          {activeMobilePane === 'right' && (
            <div
              role="region"
              aria-label="AI Assistant"
              className="h-full overflow-hidden"
            >
              {rightPanel}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Tablet Layout: Two panes with toggleable third pane
  if (isTablet) {
    return (
      <div className="flex h-full relative">
        {/* Left Panel: Recording List - Fixed width */}
        <div
          role="region"
          aria-label="Recording list"
          className="w-64 border-r border-gray-200 overflow-y-auto flex-shrink-0"
        >
          {leftPanel}
        </div>

        {/* Center Panel: Source Reader - Flexible */}
        <div
          role="region"
          aria-label="Recording content viewer"
          className="flex-1 overflow-hidden"
        >
          {centerPanel}
        </div>

        {/* Right Panel: AI Assistant - Toggleable overlay */}
        {showRightPanelTablet && (
          <div
            role="region"
            aria-label="AI Assistant"
            className="w-80 border-l border-gray-200 overflow-y-auto shadow-lg bg-white flex-shrink-0"
          >
            <div className="flex justify-between items-center p-3 border-b border-gray-200 bg-gray-50">
              <h3 className="font-semibold text-gray-900">AI Assistant</h3>
              <button
                onClick={() => setShowRightPanelTablet(false)}
                className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
                aria-label="Close AI assistant panel"
              >
                <svg
                  className="w-4 h-4 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            {rightPanel}
          </div>
        )}

        {/* Floating button to open right panel */}
        {!showRightPanelTablet && (
          <button
            onClick={() => setShowRightPanelTablet(true)}
            className="fixed bottom-6 right-6 bg-blue-500 text-white px-4 py-3 rounded-full shadow-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
            aria-label="Open AI assistant panel"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm font-medium">Assistant</span>
          </button>
        )}
      </div>
    )
  }

  // Desktop Layout: Three-pane resizable layout (existing behavior)
  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={(sizes) => setPanelSizes(sizes)}
      className="h-full"
    >
      {/* Left Panel: Recording List */}
      <ResizablePanel
        defaultSize={panelSizes[0] ?? 25}
        minSize={20}
        maxSize={35}
        id="left-panel"
      >
        <div
          role="region"
          aria-label="Recording list"
          className="h-full overflow-auto"
        >
          {leftPanel}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Center Panel: Source Reader */}
      <ResizablePanel
        defaultSize={panelSizes[1] ?? 45}
        minSize={30}
        id="center-panel"
      >
        <div
          role="region"
          aria-label="Recording content viewer"
          className="h-full overflow-hidden"
        >
          {centerPanel}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right Panel: AI Assistant */}
      <ResizablePanel
        defaultSize={panelSizes[2] ?? 30}
        minSize={20}
        maxSize={40}
        id="right-panel"
      >
        <div
          role="region"
          aria-label="AI Assistant"
          className="h-full overflow-hidden"
        >
          {rightPanel}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
