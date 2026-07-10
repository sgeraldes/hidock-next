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
  RotateCcw,
  Network,
  Sun
} from 'lucide-react'
import { TitleBar } from '@/components/layout/TitleBar'
import { cn } from '@/lib/utils'
import {
  useAppStore,
  useLastCalendarSync,
  useDeviceState,
  useConnectionStatus
} from '@/store/useAppStore'
import { useConfigStore } from '@/store/domain/useConfigStore'

type LucideIcon = typeof FileText
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/toaster'
import { OperationController } from '@/components/OperationController'
import { OperationsPanel } from '@/components/layout/OperationsPanel'
import { ActivityLogPanel } from '@/components/layout/ActivityLogPanel'
import { useUIStore } from '@/store/ui/useUIStore'

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
      { name: 'Today', href: '/today', icon: Sun },
      { name: 'Library', href: '/library', icon: BookOpen },
      { name: 'Assistant', href: '/assistant', icon: Bot },
      { name: 'Explore', href: '/explore', icon: Compass },
      { name: 'Context Graph', href: '/context-graph', icon: Network }
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

// Accessible label templates for the nav count badges — states what the number means.
const navCountAriaLabel: Record<string, (n: number) => string> = {
  '/today': (n) => `${n} ${n === 1 ? 'event' : 'events'} today`,
  '/actionables': (n) => `${n} pending actionable${n === 1 ? '' : 's'}`,
  '/sync': (n) => `${n} file${n === 1 ? '' : 's'} to sync`
}

/**
 * Small count badge for a nav item. Shown only when count > 0. Styled to match
 * the Activity-Log count badge. When the sidebar is collapsed it sits on the
 * icon's top-right corner; when expanded it trails the label.
 */
export function NavCountBadge({ href, count, collapsed, active }: { href: string; count: number; collapsed: boolean; active: boolean }) {
  if (count <= 0) return null
  const label = (navCountAriaLabel[href] ?? ((n: number) => `${n} items`))(count)
  const display = count > 99 ? '99+' : String(count)
  if (collapsed) {
    return (
      <span
        aria-label={label}
        className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-[9px] font-semibold leading-none text-white ring-2 ring-slate-900"
      >
        {display}
      </span>
    )
  }
  return (
    <span
      aria-label={label}
      className={cn(
        'ml-auto flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
        active ? 'bg-white/25 text-white' : 'bg-slate-700 text-slate-200'
      )}
    >
      {display}
    </span>
  )
}

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

  // Nav count badges — derived from EXISTING renderer stores (no new IPC channels).
  // Today: meetings whose start is today (useAppStore.meetings, loaded on mount below).
  const todayCount = useAppStore((s) => {
    const today = new Date().toDateString()
    return s.meetings.filter((m) => {
      const start = m.start_time ? new Date(m.start_time) : null
      return start != null && !Number.isNaN(start.getTime()) && start.toDateString() === today
    }).length
  })
  // Sync: device-only recordings not yet downloaded (useAppStore.unifiedRecordings).
  const unsyncedCount = useAppStore((s) => s.unifiedRecordings.filter((r) => r.location === 'device-only').length)
  // Actionables have no renderer store (page holds them in component state), so we
  // read the count from the EXISTING actionables IPC method — no new channel added.
  const [pendingActionables, setPendingActionables] = useState(0)
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI?.actionables
    if (!api?.getAll) return
    api.getAll()
      .then((items) => {
        if (cancelled || !Array.isArray(items)) return
        setPendingActionables(items.filter((a: { status?: string }) => a.status === 'pending').length)
      })
      .catch(() => {})
    return () => { cancelled = true }
    // Re-read when navigating (cheap single call; keeps the badge fresh after triage).
  }, [location.pathname])

  const navCounts: Record<string, number> = {
    '/today': todayCount,
    '/actionables': pendingActionables,
    '/sync': unsyncedCount
  }

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

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Background operations controller - never unmounts, handles ALL operations */}
      <OperationController />

      {/* Office-365-style unified titlebar (window chrome merged with the app) */}
      <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />

      {/* A1: full-window-width divider under the titlebar. Rendered as its own row
          BELOW the 40px titlebar band so the Windows native-controls overlay (which
          occupies the top-right of the titlebar) can't paint over its right end —
          it now spans edge to edge. */}
      <div className="h-px w-full shrink-0 bg-slate-700" />

      {/* Sidebar + content row (sits below the titlebar) */}
      <div className="flex min-h-0 flex-1">
      {/* Dark Sidebar */}
      <aside
        className={cn(
          'flex flex-col border-r border-slate-700 bg-slate-900 text-slate-100 transition-all duration-300',
          sidebarOpen ? 'w-56' : 'w-16'
        )}
      >
        {/* Navigation — nav px-2.5 (10px) + item px-3 (12px) + half-icon (10px)
            lands every icon centre on the shared 32px rail axis (see TitleBar). */}
        <nav className="flex-1 px-2.5 pt-3 pb-2 space-y-4 overflow-y-auto">
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
                        'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
                        !sidebarOpen && 'justify-center',
                        isActive
                          ? 'bg-sky-600 text-white font-medium shadow-sm'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                      )}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <item.icon className="h-5 w-5 flex-shrink-0" />
                      {sidebarOpen && <span>{item.name}</span>}
                      <NavCountBadge
                        href={item.href}
                        count={navCounts[item.href] ?? 0}
                        collapsed={!sidebarOpen}
                        active={isActive}
                      />
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
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
                !sidebarOpen && 'justify-center',
                location.pathname.startsWith('/settings')
                  ? 'bg-sky-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              )}
              aria-current={location.pathname.startsWith('/settings') ? 'page' : undefined}
            >
              <Settings className="h-5 w-5 flex-shrink-0" />
              {sidebarOpen && <span>Settings</span>}
            </Link>
          </div>
        </nav>

        {/* Operations Panel - Downloads + Transcriptions */}
        <OperationsPanel sidebarOpen={sidebarOpen} />

        {/* Activity Log — sidebar shows only a compact badge; the full log opens
            in a dedicated overlay (see ActivityLogPanel), never inline here. */}
        <ActivityLogPanel sidebarOpen={sidebarOpen} />

        {/* Dev Tools — Restart is gated behind a confirm dialog because it does a
            raw app restart that reconnects the USB device. QA Logs moved to
            Settings → Developer (no longer in the always-visible sidebar). */}
        {isDevMode && (
          <div className="border-t border-slate-700 p-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'w-full gap-2 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white',
                    !sidebarOpen && 'px-0 justify-center'
                  )}
                  title="Restart App"
                  aria-label="Restart app"
                >
                  <RotateCcw className="h-4 w-4" />
                  {sidebarOpen && <span>Restart</span>}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Restart the app?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This fully restarts the app and reconnects the device. Any in-progress
                    downloads or transcriptions will be interrupted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => window.electronAPI?.app?.restart()}>
                    Restart
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
