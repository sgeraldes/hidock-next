import { Mic, Plus, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface EmptyStateProps {
  hasRecordings: boolean
  onNavigateToDevice: () => void
  onAddRecording: () => void
}

export function EmptyState({ hasRecordings, onNavigateToDevice, onAddRecording }: EmptyStateProps) {
  return (
    <Card className="animate-rise-in border-border/70 shadow-sm">
      <CardContent className="flex flex-col items-center py-16 text-center">
        {/* Soft haloed icon — carries the same elevation language as the rest of the app. */}
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
          {hasRecordings ? <SearchX className="h-8 w-8" aria-hidden="true" /> : <Mic className="h-8 w-8" aria-hidden="true" />}
        </div>
        {!hasRecordings ? (
          <>
            <h3 className="text-lg font-semibold mb-2 text-foreground">No knowledge captured yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground mb-5 leading-relaxed">
              Connect your HiDock device to sync your captured conversations, or import an audio file from your computer.
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={onNavigateToDevice}>Go to Device</Button>
              <Button variant="outline" onClick={onAddRecording}>
                <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                Import File
              </Button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold mb-2 text-foreground">No matching captures</h3>
            <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">
              Nothing matches your current filter or search. Try clearing the search box or widening your filters.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
