import { ReactNode, useEffect, useState, useRef } from 'react'
import { useLocation, Link } from 'react-router-dom'
import {
  FileText,
  Users,
  Folder,
  Calendar,
  CloudDownload,
  BookOpen,
  Bot,
  Compass,
  ListTodo,
  Settings,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Loader2,
  XCircle,
  RotateCcw,
  Terminal,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useAppStore,
  useLastCalendarSync,
  useDeviceState,
  useConnectionStatus,
  useActivityLog
} from '@/store/useAppStore'
import { useConfigStore } from '@/store/domain/useConfigStore'

type LucideIcon = typeof FileText
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { OperationController } from '@/components/OperationController'
import { OperationsPanel } from '@/components/layout/OperationsPanel'
import { useUIStore } from '@/store/ui/useUIStore'
import { Switch } from '@/components/ui/switch'

interface LayoutProps {
  children: ReactNode
}

// Navigation structure with sections
type NavigationSection = {
  title: string
  items: Array<{ name: string; href: string; icon: LucideIcon }>
}

const navigationSections: NavigationSection[] = [
  {
    title: 'KNOWLEDGE',
    items: [
      { name: 'Library', href: '/library', icon: BookOpen },
      { name: 'Assistant', href: '/assistant', icon: Bot },
      { name: 'Explore', href: '/explore', icon: Compass }
    ]
  },
  {
    title: 'ORGANIZATION',
    items: [
      { name: 'People', href: '/people', icon: Users },
      { name: 'Projects', href: '/projects', icon: Folder },
      { name: 'Calendar', href: '/calendar', icon: Calendar }
    ]
  },
  {
    title: 'ACTIONS',
    items: [
      { name: 'Actionables', href: '/actionables', icon: ListTodo }
    ]
  },
  {
    title: 'DEVICE',
    items: [
      { name: 'Sync', href: '/sync', icon: CloudDownload }
    ]
  }
]

export function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const [isDevMode, setIsDevMode] = useState(false)
  // SM-02 fix: Use granular selectors instead of destructuring entire store
  const loadMeetings = useAppStore((s) => s.loadMeetings)
  const syncCalendar = useAppStore((s) => s.syncCalendar)
  const lastCalendarSync = useLastCalendarSync()
  const deviceState = useDeviceState()
  const connectionStatus = useConnectionStatus()
  const { config, loadConfig } = useConfigStore()
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const qaLogsEnabled = useUIStore((s) => s.qaLogsEnabled)
  const setQaLogsEnabled = useUIStore((s) => s.setQaLogsEnabled)

  // AL-001: Global activity log — visible from all pages
  const activityLog = useActivityLog()
  const [logExpanded, setLogExpanded] = useState(false)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const hasErrors = activityLog.some(e => e.type === 'error' || e.type === 'warning')

  // AL-004: Auto-scroll when expanded or new entries arrive
  useEffect(() => {
    if (logExpanded && activityLog.length > 0 && logContainerRef.current) {
      requestAnimationFrame(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
        }
      })
    }
  }, [activityLog.length, logExpanded])

  // Track previous state for toast notifications
  const prevConnectedRef = useRef<boolean | null>(null)
  const prevStatusStepRef = useRef<string | null>(null)
  const hasShownInitialToast = useRef(false)

  // Check if running in dev mode
  useEffect(() => {
    if (window.electronAPI?.app) {
      window.electronAPI.app.info().then((info) => {
        setIsDevMode(!info.isPackaged)
      })
    } else {
      // Not in Electron, assume dev mode
      setIsDevMode(true)
    }
  }, [])

  // Initialize app on mount
  useEffect(() => {
    loadConfig()
    loadMeetings()
    // loadRecordings() // Redundant: Pages load their own data via useUnifiedRecordings
  }, [])

  // Toast notifications for device state changes (read from store)
  useEffect(() => {
    // Initialize refs with current state (don't show toast on initial load)
    if (prevConnectedRef.current === null) {
      prevConnectedRef.current = deviceState.connected
      prevStatusStepRef.current = connectionStatus.step
      return
    }

    const wasConnected = prevConnectedRef.current
    const isNowConnected = deviceState.connected

    // Show toast on connection state change
    if (wasConnected !== isNowConnected) {
      if (isNowConnected) {
        const modelName = deviceState.model?.replace('hidock-', '').toUpperCase() || 'Device'
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
  }, [deviceState.connected, deviceState.model])

  // Toast notifications for connection errors (read from store)
  useEffect(() => {
    // Initialize ref with current state
    if (prevStatusStepRef.current === null) {
      prevStatusStepRef.current = connectionStatus.step
      return
    }

    const prevStep = prevStatusStepRef.current

    // Show toast on error state
    if (connectionStatus.step === 'error' && prevStep !== 'error') {
      toast({
        title: 'Connection Error',
        description: connectionStatus.message || 'Failed to connect to device',
        variant: 'error'
      })
    }

    prevStatusStepRef.current = connectionStatus.step
  }, [connectionStatus.step, connectionStatus.message])

  // Initial calendar sync if URL is configured
  useEffect(() => {
    if (config?.calendar.icsUrl && !lastCalendarSync) {
      syncCalendar()
    }
  }, [config?.calendar.icsUrl])

  // Determine device status display
  const isConnected = deviceState.connected
  const isConnecting = connectionStatus.step !== 'idle' && connectionStatus.step !== 'ready' && connectionStatus.step !== 'error'
  const deviceModel = deviceState.model?.replace('hidock-', '').toUpperCase() || 'Device'

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
          to="/sync"
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
              {isConnected && deviceState.recordingCount > 0 && (
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
        <nav className="flex-1 p-2 space-y-4 overflow-y-auto">
          {navigationSections.map((section, sectionIdx) => (
            <div key={section.title}>
              {/* Section Header */}
              {sidebarOpen && (
                <div className="px-3 mb-2 text-[10px] font-semibold text-slate-500 tracking-wider">
                  {section.title}
                </div>
              )}
              {/* Section Items */}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = location.pathname.startsWith(item.href)
                  return (
                    <Link
                      key={item.href}
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
              </div>
              {/* Section Divider (except for last section) */}
              {sectionIdx < navigationSections.length - 1 && (
                <div className="mt-3 border-t border-slate-800" />
              )}
            </div>
          ))}

          {/* Settings at bottom - separate from sections */}
          <div className="pt-2 border-t border-slate-800">
            <Link
              to="/settings"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                location.pathname.startsWith('/settings')
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              )}
            >
              <Settings className="h-5 w-5 flex-shrink-0" />
              {sidebarOpen && <span>Settings</span>}
            </Link>
          </div>
        </nav>

        {/* Operations Panel - Downloads + Transcriptions */}
        <OperationsPanel sidebarOpen={sidebarOpen} />

        {/* AL-001: Global Activity Log — accessible from all pages */}
        <div className="border-t border-slate-700">
          {sidebarOpen ? (
            <div>
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                onClick={() => setLogExpanded(p => !p)}
              >
                <span className="flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5" />
                  Activity Log
                  {activityLog.length > 0 && (
                    <span className={cn(
                      'text-[10px] px-1 rounded',
                      hasErrors ? 'bg-red-900/50 text-red-400' : 'bg-slate-700 text-slate-400'
                    )}>
                      {activityLog.length}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="text-[10px] hover:text-slate-300"
                    onClick={(e) => {
                      e.stopPropagation()
                      useAppStore.getState().clearActivityLog?.()
                    }}
                    title="Clear log"
                  >Clear</span>
                  {logExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                </span>
              </button>
              {logExpanded && (
                <div
                  ref={logContainerRef}
                  className="max-h-40 overflow-y-auto bg-slate-950 px-2 py-1 font-mono"
                >
                  {activityLog.length === 0 ? (
                    <p className="text-[10px] text-slate-600 py-1">No activity</p>
                  ) : (
                    activityLog.map((entry, i) => (
                      <div key={`${entry.timestamp.getTime()}-${i}`}
                        className={cn(
                          'text-[10px] leading-4 py-0.5',
                          entry.type === 'error' ? 'text-red-400'
                          : entry.type === 'success' ? 'text-green-400'
                          : entry.type === 'warning' ? 'text-amber-400'
                          : entry.type === 'usb-out' ? 'text-blue-400'
                          : entry.type === 'usb-in' ? 'text-purple-400'
                          : 'text-slate-400'
                        )}>
                        <span className="text-slate-600 mr-1">
                          {entry.timestamp.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        {entry.message}
                        {entry.details && <span className="text-slate-600 ml-1">— {entry.details}</span>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : hasErrors ? (
            <div className="flex justify-center py-2" title="Activity log has errors or warnings">
              <Terminal className="h-4 w-4 text-amber-400" />
            </div>
          ) : null}
        </div>

        {/* Dev Tools */}
        {isDevMode && (
          <div className="border-t border-slate-700 p-3 space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'w-full gap-2 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white',
                !sidebarOpen && 'px-0 justify-center'
              )}
              onClick={() => window.electronAPI?.app?.restart()}
              title="Restart App"
            >
              <RotateCcw className="h-4 w-4" />
              {sidebarOpen && <span>Restart</span>}
            </Button>
            {sidebarOpen && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">QA Logs</span>
                <Switch
                  checked={qaLogsEnabled}
                  onCheckedChange={setQaLogsEnabled}
                  className="scale-75"
                />
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
