import { Cloud, HardDrive, Check, AlertCircle } from 'lucide-react'
import { UnifiedRecording } from '@/types/unified-recording'

interface StatusIconProps {
  recording: UnifiedRecording
  showError?: boolean
}

export function StatusIcon({ recording, showError = false }: StatusIconProps) {
  // Show error state if applicable
  if (showError) {
    return (
      <div
        className="flex items-center gap-1 text-destructive"
        role="img"
        aria-label="Processing error"
        title="Processing error"
      >
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
      </div>
    )
  }

  switch (recording.location) {
    case 'device-only':
      return (
        <div
          className="flex items-center gap-1 text-orange-600 dark:text-orange-400"
          role="img"
          aria-label="On device only"
          title="On device only"
        >
          <Cloud className="h-4 w-4" aria-hidden="true" />
        </div>
      )
    case 'local-only':
      return (
        <div
          className="flex items-center gap-1 text-blue-600 dark:text-blue-400"
          role="img"
          aria-label="Downloaded"
          title="Downloaded"
        >
          <HardDrive className="h-4 w-4" aria-hidden="true" />
        </div>
      )
    case 'both':
      return (
        <div
          className="flex items-center gap-1 text-green-600 dark:text-green-400"
          role="img"
          aria-label="Synced"
          title="Synced"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
        </div>
      )
    default:
      return null
  }
}
