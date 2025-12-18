import { ReactNode, useEffect, useState, useRef } from 'react'
import { useLocation, Link } from 'react-router-dom'
import {
  MessageSquare,
  Search,
  Settings,
  Usb,
  Mic,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Users,
  Folder,
  FileText,
  RefreshCw,
  Download,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { getHiDockDeviceService, HiDockDeviceState, ConnectionStatus } from '@/services/hidock-device'
import { OperationController } from '@/components/OperationController'

interface LayoutProps {
  children: ReactNode
}

const navigation = [
  { name: 'Recordings', href: '/calendar', icon: Mic },
  { name: 'Chat', href: '/chat', icon: MessageSquare },
  { name: 'Search', href: '/search', icon: Search },
  { name: 'Device', href: '/device', icon: Usb },
  { name: 'Contacts', href: '/contacts', icon: Users },
  { name: 'Projects', href: '/projects', icon: Folder },
  { name: 'Outputs', href: '/outputs', icon: FileText },
  { name: 'Settings', href: '/settings', icon: Settings }
]

export function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const [isDevMode, setIsDevMode] = useState(false)
  const {
    sidebarOpen,
    toggleSidebar,
    loadConfig,
    loadMeetings,
    loadRecordings,
    syncCalendar,
    lastCalendarSync,
    config,
    deviceSyncing,
    deviceSyncProgress,
    deviceFileDownloading,
    deviceFileProgress,
    downloadQueue
  } = useAppStore()

  // Device connection state
  const [deviceState, setDeviceState] = useState<HiDockDeviceState | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ step: 'idle', message: 'Not connected' })

  // Track previous state for toast notifications
  const prevConnectedRef = useRef<boolean | null>(null)
  const prevStatusStepRef = useRef<string | null>(null)
  const hasShownInitialToast = useRef(false)

  // Check if running in dev mode
  useEffect(() => {
    window.electronAPI.app.info().then((info) => {
      setIsDevMode(!info.isPackaged)
    })
  }, [])

  // Initialize app on mount
  useEffect(() => {
    loadConfig()
    loadMeetings()
    loadRecordings()
  }, [])

  // Subscribe to device state changes
  useEffect(() => {
    const deviceService = getHiDockDeviceService()

    // Get initial state
    const initialState = deviceService.getState()
    const initialStatus = deviceService.getConnectionStatus()
    setDeviceState(initialState)
    setConnectionStatus(initialStatus)

    // Initialize refs with current state (don't show toast on initial load)
    prevConnectedRef.current = initialState.connected
    prevStatusStepRef.current = initialStatus.step

    // Subscribe to state changes
    const unsubState = deviceService.onStateChange((state) => {
      const wasConnected = prevConnectedRef.current
      const isNowConnected = state.connected

      // Show toast on connection state change
      if (wasConnected !== null && wasConnected !== isNowConnected) {
        if (isNowConnected) {
          const modelName = state.model?.replace('hidock-', '').toUpperCase() || 'Device'
          toast({
            title: 'Device Connected',
            description: `${modelName} is ready to use`,
            variant: 'success'
          })
          hasShownInitialToast.current = true
        } else {
          // Only show disconnect toast if we had previously shown a connect toast
          if (hasShownInitialToast.current) {
            toast({
              title: 'Device Disconnected',
              description: 'HiDock has been disconnected',
              variant: 'default'
            })
          }
        }
      }

      prevConnectedRef.current = isNowConnected
      setDeviceState(state)
    })

    const unsubStatus = deviceService.onStatusChange((status) => {
      const prevStep = prevStatusStepRef.current

      // Show toast on error state
      if (status.step === 'error' && prevStep !== 'error') {
        toast({
          title: 'Connection Error',
          description: status.message || 'Failed to connect to device',
          variant: 'error'
        })
      }

      prevStatusStepRef.current = status.step
      setConnectionStatus(status)
    })

    // Subscribe to activity log for important events
    const unsubActivity = deviceService.onActivity((entry) => {
      // Show toast for critical errors that aren't already covered
      if (entry.type === 'error') {
        // Skip certain expected errors that would be noisy
        const skipPatterns = [
          'Cannot list files', // Not connected
          'Failed to get card info', // Already handled in status
          'Failed to get device info', // Already handled in status
          'Failed to get settings' // Already handled in status
          // NOTE: 'Download failed' removed from skip list - users should see download failures
        ]
        const shouldSkip = skipPatterns.some(pattern => entry.message.includes(pattern))

        if (!shouldSkip) {
          toast({
            title: 'Error',
            description: `${entry.message}${entry.details ? `: ${entry.details}` : ''}`,
            variant: 'error'
          })
        }
      }
    })

    // Initialize auto-connect on app startup
    deviceService.initAutoConnect()

    return () => {
      unsubState()
      unsubStatus()
      unsubActivity()
    }
  }, [])

  // Initial calendar sync if URL is configured
  useEffect(() => {
    if (config?.calendar.icsUrl && !lastCalendarSync) {
      syncCalendar()
    }
  }, [config?.calendar.icsUrl])

  // Determine device status display
  const isConnected = deviceState?.connected ?? false
  const isConnecting = connectionStatus.step !== 'idle' && connectionStatus.step !== 'ready' && connectionStatus.step !== 'error'
  const deviceModel = deviceState?.model?.replace('hidock-', '').toUpperCase() || 'Device'

  return (
    <div className="flex h-screen bg-background">
      {/* Background operations controller - never unmounts, handles ALL operations */}
      <OperationController />

      {/* Dark Sidebar */}
      <aside
        className={cn(
          'flex flex-col border-r border-slate-700 bg-slate-900 text-slate-100 transition-all duration-300',
          sidebarOpen ? 'w-56' : 'w-16'
        )}
      >
        {/* Logo/Header - matching page header height (text-2xl + py-4 = ~85px) */}
        <div className="flex h-[85px] items-center justify-between border-b border-slate-700 px-4 titlebar-drag-region">
          {sidebarOpen && (
            <span className="font-bold text-2xl titlebar-no-drag">HiDock Next</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 titlebar-no-drag text-slate-300 hover:text-white hover:bg-slate-800"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>

        {/* Device Connection Status */}
        <Link
          to="/device"
          className={cn(
            'mx-2 mt-2 flex items-center gap-2 rounded-lg px-3 py-2 transition-colors',
            isConnected
              ? 'bg-emerald-900/30 border border-emerald-700/50 hover:bg-emerald-900/50'
              : isConnecting
                ? 'bg-amber-900/30 border border-amber-700/50 hover:bg-amber-900/50'
                : 'bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800'
          )}
        >
          {isConnected ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-400" />
          ) : isConnecting ? (
            <Loader2 className="h-4 w-4 flex-shrink-0 text-amber-400 animate-spin" />
          ) : (
            <XCircle className="h-4 w-4 flex-shrink-0 text-slate-500" />
          )}
          {sidebarOpen && (
            <div className="flex flex-col min-w-0">
              <span className={cn(
                'text-xs font-medium truncate',
                isConnected ? 'text-emerald-300' : isConnecting ? 'text-amber-300' : 'text-slate-400'
              )}>
                {isConnected ? deviceModel : isConnecting ? 'Connecting...' : 'Disconnected'}
              </span>
              {isConnected && deviceState?.recordingCount !== undefined && deviceState.recordingCount > 0 && (
                <span className="text-[10px] text-slate-500">
                  {deviceState.recordingCount} recordings
                </span>
              )}
              {!isConnected && !isConnecting && (
                <span className="text-[10px] text-slate-600">
                  Click to connect
                </span>
              )}
            </div>
          )}
        </Link>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname.startsWith(item.href)
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-slate-700 text-white font-medium'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                )}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {sidebarOpen && <span>{item.name}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Download Queue Indicator */}
        {downloadQueue.size > 0 && (
          <div className="px-3 py-2 border-t border-slate-700">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Download className="h-3 w-3 text-emerald-400 animate-pulse" />
              {sidebarOpen ? (
                <span className="flex-1">
                  Syncing {deviceSyncProgress ? `${deviceSyncProgress.current}/${deviceSyncProgress.total}` : downloadQueue.size} files
                </span>
              ) : (
                <span className="text-[10px] text-emerald-400">{downloadQueue.size}</span>
              )}
            </div>
            {sidebarOpen && (
              <div className="mt-2 space-y-1.5">
                {/* Overall sync progress if available */}
                {deviceSyncProgress && deviceSyncProgress.total > 0 && (
                  <div className="mb-2">
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                      <span>Overall progress</span>
                      <span>{Math.round((deviceSyncProgress.current / deviceSyncProgress.total) * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-200"
                        style={{ width: `${(deviceSyncProgress.current / deviceSyncProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Current file progress */}
                {Array.from(downloadQueue.entries()).slice(0, 2).map(([id, item]) => (
                  <div key={id} className="space-y-0.5">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-400 truncate max-w-[120px]" title={item.filename}>
                        {item.filename.length > 20 ? `...${item.filename.slice(-17)}` : item.filename}
                      </span>
                      <span className="text-slate-500">{item.progress}%</span>
                    </div>
                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-200"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
                {downloadQueue.size > 2 && (
                  <div className="text-[10px] text-slate-500 pt-0.5">+{downloadQueue.size - 2} more in queue</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sync Status Indicator (shown when no download queue but syncing is active) */}
        {(deviceSyncing || deviceFileDownloading) && downloadQueue.size === 0 && (
          <div className="px-3 py-2 border-t border-slate-700">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
              {sidebarOpen && (
                <>
                  {deviceSyncing && deviceSyncProgress ? (
                    <span>Syncing {deviceSyncProgress.current}/{deviceSyncProgress.total}</span>
                  ) : deviceFileDownloading ? (
                    <span className="truncate max-w-[140px]" title={deviceFileDownloading}>{deviceFileDownloading}</span>
                  ) : (
                    <span>Syncing...</span>
                  )}
                </>
              )}
            </div>
            {sidebarOpen && deviceFileProgress > 0 && (
              <div className="mt-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-200"
                  style={{ width: `${deviceFileProgress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Dev Tools */}
        <div className="border-t border-slate-700 p-3 space-y-2">
          {/* Restart button - shown in dev mode or always accessible */}
          {isDevMode && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'w-full gap-2 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white',
                !sidebarOpen && 'px-0 justify-center'
              )}
              onClick={() => window.electronAPI.app.restart()}
              title="Restart App"
            >
              <RotateCcw className="h-4 w-4" />
              {sidebarOpen && <span>Restart</span>}
            </Button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
