import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import { useScreenshotStore } from '../../stores/screenshot-store'
import { Button } from '../ui/button'
import { ScreenshotCard } from './ScreenshotCard'
import { ScreenshotDialog } from './ScreenshotDialog'
import type { Screenshot } from '../../types/models'

interface ScreenshotGalleryProps {
  sessionId: string
}

export function ScreenshotGallery({ sessionId }: ScreenshotGalleryProps) {
  const screenshots = useScreenshotStore((s) => s.screenshots)
  const loading = useScreenshotStore((s) => s.loading)
  const fetchForSession = useScreenshotStore((s) => s.fetchForSession)
  const capture = useScreenshotStore((s) => s.capture)

  const [selected, setSelected] = useState<Screenshot | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    fetchForSession(sessionId)
  }, [sessionId, fetchForSession])

  function handleCapture() {
    capture(sessionId)
  }

  function handleCardClick(screenshot: Screenshot) {
    setSelected(screenshot)
    setDialogOpen(true)
  }

  function handleDialogClose() {
    setDialogOpen(false)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-foreground">Screenshots</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCapture}
          disabled={loading}
        >
          <Camera className="h-3.5 w-3.5" />
          Capture
        </Button>
      </div>

      {/* Grid */}
      {screenshots.length === 0 ? (
        <p className="text-[12px] text-muted-foreground py-4 text-center">
          No screenshots captured
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {screenshots.map((s) => (
            <ScreenshotCard
              key={s.id}
              screenshot={s}
              onClick={() => handleCardClick(s)}
            />
          ))}
        </div>
      )}

      {/* Detail dialog */}
      <ScreenshotDialog
        screenshot={selected}
        open={dialogOpen}
        onClose={handleDialogClose}
      />
    </div>
  )
}
