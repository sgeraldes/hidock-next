import { ReactNode, useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import {
  Calendar,
  MessageSquare,
  Search,
  Settings,
  Usb,
  Mic,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  RotateCcw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { Button } from '@/components/ui/button'

interface LayoutProps {
  children: ReactNode
}

const navigation = [
  { name: 'Calendar', href: '/calendar', icon: Calendar },
  { name: 'Chat', href: '/chat', icon: MessageSquare },
  { name: 'Search', href: '/search', icon: Search },
  { name: 'Device', href: '/device', icon: Usb },
  { name: 'Recordings', href: '/recordings', icon: Mic },
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
    calendarSyncing,
    lastCalendarSync,
    config
  } = useAppStore()

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

  // Initial calendar sync if URL is configured
  useEffect(() => {
    if (config?.calendar.icsUrl && !lastCalendarSync) {
      syncCalendar()
    }
  }, [config?.calendar.icsUrl])

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col border-r bg-card transition-all duration-300',
          sidebarOpen ? 'w-56' : 'w-16'
        )}
      >
        {/* Logo/Header */}
        <div className="flex h-14 items-center justify-between border-b px-4 titlebar-drag-region">
          {sidebarOpen && (
            <span className="font-semibold text-sm titlebar-no-drag">HiDock</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 titlebar-no-drag"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>

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
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {sidebarOpen && <span>{item.name}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Sync Status & Dev Tools */}
        <div className="border-t p-3 space-y-2">
          {sidebarOpen && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {lastCalendarSync
                  ? `Synced ${new Date(lastCalendarSync).toLocaleTimeString()}`
                  : 'Not synced'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => syncCalendar()}
                disabled={calendarSyncing}
              >
                <RefreshCw className={cn('h-3 w-3', calendarSyncing && 'animate-spin')} />
              </Button>
            </div>
          )}
          {/* Restart button - shown in dev mode or always accessible */}
          {isDevMode && (
            <Button
              variant="outline"
              size="sm"
              className={cn('w-full gap-2', !sidebarOpen && 'px-0')}
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
