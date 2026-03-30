import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Radio,
  FileText,
  BookOpen,
  Settings,
  Moon,
  Sun,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useTheme } from '../../hooks/use-theme'
import { useActiveSession } from '../../hooks/use-active-session'
import { useRecordingTimer } from '../../hooks/use-recording-timer'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sessions', label: 'Sessions', icon: Radio },
  { to: '/notes', label: 'Notes', icon: FileText },
  { to: '/knowledge-base', label: 'Knowledge Base', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function ActiveSessionBadge() {
  const { session, isRecording } = useActiveSession()
  const duration = useRecordingTimer(
    isRecording && session?.startedAt != null ? session.startedAt : null,
  )

  if (!isRecording || !session) return null

  return (
    <div className="px-3 py-2 mx-2 mb-1 rounded-md bg-sidebar-accent/50 flex items-center gap-2 min-w-0">
      {/* Amber pulse dot */}
      <span className="shrink-0 w-2 h-2 rounded-full bg-[hsl(var(--status-warning))] animate-pulse-live" />

      {/* Meeting title */}
      <span className="flex-1 min-w-0 font-sans text-xs text-sidebar-foreground truncate">
        {session.title ?? 'Recording…'}
      </span>

      {/* Duration */}
      <span className="shrink-0 font-mono text-xs text-sidebar-foreground/70 tabular-nums">
        {duration}
      </span>
    </div>
  )
}

export function Sidebar() {
  const { theme, toggleTheme } = useTheme()

  return (
    <nav className="flex flex-col w-[220px] shrink-0 h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Brand area */}
      <div className="flex items-center h-12 px-4 border-b border-sidebar-border shrink-0">
        <h1 className="font-display text-sm font-semibold tracking-tight">
          Meeting Assistant
        </h1>
      </div>

      {/* Nav items */}
      <ul className="flex flex-col gap-0.5 p-2 flex-1">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent nav-active-indicator font-medium text-sidebar-foreground'
                    : 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent',
                )
              }
            >
              <Icon size={18} strokeWidth={1.75} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Active session indicator */}
      <ActiveSessionBadge />

      {/* Dark mode toggle */}
      <div className="p-2 shrink-0">
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className={cn(
            'flex items-center justify-center w-full h-8 rounded-md',
            'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent',
            'transition-colors',
          )}
        >
          {theme === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
        </button>
      </div>
    </nav>
  )
}
