import { ReactNode, useEffect, useRef } from 'react'
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
  Network,
  Sun,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react'
import { TitleBar } from '@/components/layout/TitleBar'
import { showBrandHorizontalDivider } from '@/components/layout/Brand'
import { cn } from '@/lib/utils'
import {
  useAppStore,
  useLastCalendarSync,
  useDeviceState,
  useConnectionStatus
} from '@/store/useAppStore'
import { useConfigStore } from '@/store/domain/useConfigStore'

type LucideIcon = typeof FileText
import { toast } from '@/components/ui/toaster'
import { OperationController } from '@/components/OperationController'
import { OperationsPanel } from '@/components/layout/OperationsPanel'
import { useUIStore } from '@/store/ui/useUIStore'
import { useActionablesPendingCount, useActionablesStore } from '@/store'

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
  // Exact count (the badge is a rounded pill that widens for more digits); only
  // cap at an absurd width to avoid breaking the layout.
  const display = count > 9999 ? '9999+' : String(count)
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
  // Actionables: exact pending count from the shared store (single source of truth
  // for both this badge and the Actionables page), refreshed on navigation so the
  // badge stays live after bulk triage on the page.
  const pendingActionables = useActionablesPendingCount()
  useEffect(() => {
    useActionablesStore.getState().loadActionables()
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

      {/* Office-365-style unified titlebar (window chrome merged with the app). The
          sidebar-collapse handle lives on the sidebar's right edge (below), not here. */}
      <TitleBar sidebarOpen={sidebarOpen} />

      {/* Divider row under the titlebar. Rendered as its own row BELOW the 40px
          titlebar band so the Windows native-controls overlay can't paint over its
          right end. Split into two segments so the corner-cell "horizontal line
          below the brand" can be dropped ('sidebar' mode) while the line under the
          titlebar CONTENT stays — letting the brand flow straight into the nav rail.
          The left segment tracks the brand-cell width (w-56 / w-16). */}
      {/* The line now runs the FULL width — including under the Windows native
          window controls — so ONE continuous divider separates the whole bar from
          the app below. Safe because the native-controls overlay only covers the
          bar band ABOVE this row (height synced to the h-14 titlebar), so it never
          paints over the line. */}
      <div className="flex h-px w-full shrink-0">
        <div
          className={cn(
            'h-px shrink-0 transition-all duration-300',
            sidebarOpen ? 'w-56' : 'w-16',
            showBrandHorizontalDivider() ? 'bg-slate-700' : 'bg-transparent'
          )}
        />
        <div className="h-px flex-1 bg-slate-700" />
      </div>

      {/* Sidebar + content row (sits below the titlebar) */}
      <div className="flex min-h-0 flex-1">
      {/* Dark Sidebar — `relative` so the collapse edge-handle can anchor to its
          right border at mid-height. */}
      <aside
        className={cn(
          'relative flex flex-col border-r border-slate-700 bg-slate-900 text-slate-100 transition-all duration-300',
          sidebarOpen ? 'w-56' : 'w-16'
        )}
      >
        {/* SIDEBAR-COLLAPSE EDGE-HANDLE — straddles the sidebar's RIGHT border,
            vertically centred at MID-HEIGHT (per owner: "mid-right position, in the
            middle of the sidebar, not the top corner"). z-50 so it sits above the
            main content it overlaps. Toggles collapse in both states. */}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          className="absolute right-0 top-1/2 z-50 flex h-7 w-7 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-slate-300 shadow-md transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
        {/* Navigation — nav px-2.5 (10px) + item px-3 (12px) + half-icon (10px)
            lands every icon centre on the shared 32px rail axis (see TitleBar). */}
        <nav className="flex-1 px-2.5 pt-3 pb-2 space-y-4 overflow-y-auto">
          {/* The sidebar-collapse control now lives as an edge-handle on the
              brand/content divider in the titlebar (see TitleBar), so the nav rail
              starts directly with the KNOWLEDGE section in both states. */}
          {navigationSections.map((section, sectionIdx) => (
            <div key={section.title}>
              {/* Section Header. */}
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

        {/* Activity Log is NOT in the sidebar — it lives ONLY in the titlebar (the
            ⚡ ActivityLogButton owns the single overlay). Removed from here to kill
            the duplicate entry point (owner request). Do NOT re-add it. */}

        {/* Restart moved OUT of the sidebar into the device pill's dropdown menu
            (see TitleBar.tsx) — it lives with the device connection controls now
            and is always available (not dev-mode-gated). */}
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
