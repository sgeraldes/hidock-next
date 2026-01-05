/**
 * TriPaneLayout Component
 *
 * Three-column resizable layout for the Library page:
 * - Left Panel: Recording list with filters
 * - Center Panel: Source content viewer
 * - Right Panel: AI Assistant
 *
 * Panel sizes are persisted across navigation via useLibraryStore.
 */

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useLibraryStore } from '@/store/useLibraryStore'

interface TriPaneLayoutProps {
  leftPanel: React.ReactNode
  centerPanel: React.ReactNode
  rightPanel: React.ReactNode
}

export function TriPaneLayout({ leftPanel, centerPanel, rightPanel }: TriPaneLayoutProps) {
  const panelSizes = useLibraryStore((state) => state.panelSizes)
  const setPanelSizes = useLibraryStore((state) => state.setPanelSizes)

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={(sizes) => setPanelSizes(sizes)}
      className="h-full"
    >
      {/* Left Panel: Recording List */}
      <ResizablePanel
        defaultSize={panelSizes[0] ?? 25}
        minSize={15}
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
          aria-label="Source content viewer"
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
