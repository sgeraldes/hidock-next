import { Mic, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface EmptyStateProps {
  hasRecordings: boolean
  onNavigateToDevice: () => void
  onAddRecording: () => void
}

export function EmptyState({ hasRecordings, onNavigateToDevice, onAddRecording }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <Mic className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        {!hasRecordings ? (
          <>
            <h3 className="text-lg font-medium mb-2">No Knowledge Captured Yet</h3>
            <p className="text-muted-foreground mb-4">
              Connect your HiDock device to sync your captured conversations, or import audio files from your computer.
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={onNavigateToDevice}>Go to Device</Button>
              <Button variant="outline" onClick={onAddRecording}>
                <Plus className="h-4 w-4 mr-2" />
                Import File
              </Button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-medium mb-2">No Matching Captures</h3>
            <p className="text-muted-foreground">Try changing your filter or search query.</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
