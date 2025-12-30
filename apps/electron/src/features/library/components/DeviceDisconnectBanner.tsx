import { AlertCircle, RefreshCw, Usb } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DeviceDisconnectBannerProps {
  show: boolean
  isReconnecting: boolean
  onNavigateToDevice: () => void
  onRetry?: () => void
}

export function DeviceDisconnectBanner({
  show,
  isReconnecting,
  onNavigateToDevice,
  onRetry
}: DeviceDisconnectBannerProps) {
  if (!show) return null

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3 bg-orange-50 dark:bg-orange-950/30 border-b border-orange-200 dark:border-orange-800">
      <div className="flex items-center gap-3">
        {isReconnecting ? (
          <RefreshCw className="h-4 w-4 text-orange-600 dark:text-orange-400 animate-spin" />
        ) : (
          <AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
        )}
        <div>
          <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
            {isReconnecting ? 'Reconnecting to device...' : 'Device disconnected'}
          </p>
          <p className="text-xs text-orange-600 dark:text-orange-400">
            {isReconnecting
              ? 'Please wait while we reconnect to your HiDock.'
              : 'Downloads have been paused. Reconnect to continue.'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onRetry && !isReconnecting && (
          <Button variant="outline" size="sm" onClick={onRetry} className="border-orange-300 dark:border-orange-700">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onNavigateToDevice}
          className="border-orange-300 dark:border-orange-700"
        >
          <Usb className="h-4 w-4 mr-2" />
          Go to Device
        </Button>
      </div>
    </div>
  )
}
