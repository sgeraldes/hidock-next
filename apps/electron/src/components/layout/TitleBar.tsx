import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PanelLeft, Search, CheckCircle2, Loader2, Usb, ChevronDown, LogOut, ArrowRight, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDeviceConnection } from '@/hooks/useDeviceConnection'
import { useAppStore } from '@/store'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'

/**
 * Office-365-style unified titlebar.
 *
 * Rendered as the top strip of the app shell (above the sidebar + content row).
 * The whole bar is a drag region (`titlebar-drag-region`); every interactive
 * child opts out with `titlebar-no-drag` so clicks/typing work. Native window
 * controls (min/max/close) are drawn by Electron's `titleBarOverlay` in the
 * top-right on Windows, so we reserve NATIVE_CONTROLS_WIDTH there. On macOS the
 * traffic lights sit top-left, so we reserve a smaller left inset instead.
 *
 * Height MUST stay in sync with the `titleBarOverlay.height` set in
 * electron/main/index.ts (40px).
 */

const isMac =
  typeof navigator !== 'undefined' &&
  /mac/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      ''
  )

// Windows native-controls overlay is ~138px wide; reserve it so nothing hides under it.
const NATIVE_CONTROLS_WIDTH = 138

interface TitleBarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function TitleBar({ sidebarOpen, onToggleSidebar }: TitleBarProps) {
  const navigate = useNavigate()
  // Shared with the Device Sync page — same status source, same connect action.
  const { status, label: connectionLabel, failedHint, connect, disconnect } = useDeviceConnection()
  // Live device-recording flag (see useAppStore.deviceRecording TODO). Stays false
  // until a device-status read path sets it, so the red dot only shows when recording.
  const deviceRecording = useAppStore((s) => s.deviceRecording)
  const [search, setSearch] = useState('')

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = search.trim()
    if (!q) return
    navigate('/explore', { state: { query: q } })
    setSearch('')
  }

  return (
    <header
      className="titlebar-drag-region relative z-30 flex h-10 shrink-0 items-center gap-3 border-b border-slate-700 bg-slate-900 pl-3 text-slate-100 select-none"
      style={{ paddingRight: isMac ? 12 : NATIVE_CONTROLS_WIDTH, paddingLeft: isMac ? 78 : undefined }}
    >
      {/* Sidebar toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-pressed={sidebarOpen}
        className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <PanelLeft className="h-4 w-4" />
      </button>

      {/* App identity */}
      <div className="titlebar-no-drag flex items-center gap-2">
        <AppMark />
        <span className="text-sm font-semibold tracking-tight text-white">HiDock</span>
        <span className="hidden text-sm text-slate-400 sm:inline">Meeting Intelligence</span>
      </div>

      {/* Global search — routes to Explore */}
      <form onSubmit={submitSearch} className="titlebar-no-drag mx-auto w-full max-w-md px-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search knowledge, people, projects…"
            aria-label="Search knowledge, people and projects"
            className="h-7 w-full select-text rounded-md border border-slate-700 bg-slate-800/80 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus-visible:border-sky-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
          />
        </div>
      </form>

      {/* Device connection control — same status + connect/disconnect action as
          the Device Sync page (via useDeviceConnection). */}
      <ConnectionControl
        status={status}
        label={connectionLabel}
        failedHint={failedHint}
        recording={deviceRecording}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
        onGoToSync={() => navigate('/sync')}
      />
    </header>
  )
}

const PILL_BASE =
  'titlebar-no-drag flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'

interface ConnectionControlProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'failed'
  label: string
  /** Extra hint for the failed state (e.g. "Device may be busy (recording?)"). */
  failedHint?: string | null
  /** Device is actively capturing a recording — shows a red pulsing dot on the pill. */
  recording: boolean
  onConnect: () => void
  onDisconnect: () => void
  onGoToSync: () => void
}

/**
 * Four-state device pill:
 *  - disconnected → button labelled "Connect device"; click = one connect attempt.
 *  - connecting   → disabled pill with a spinner (no click).
 *  - failed       → amber "Connection failed — retry"; click = one retry. Honest
 *                   after a failed auto/manual connect instead of reverting to the
 *                   neutral "Connect device".
 *  - connected    → dropdown trigger (model + connected styling); a bare click
 *                   opens a menu (Go to Sync / Disconnect) rather than
 *                   disconnecting, so it can't be hit by accident.
 */
function ConnectionControl({ status, label, failedHint, recording, onConnect, onDisconnect, onGoToSync }: ConnectionControlProps) {
  if (status === 'connecting') {
    return (
      <button
        type="button"
        disabled
        title="Connecting to device…"
        className={cn(PILL_BASE, 'cursor-wait border-amber-700/50 bg-amber-900/40 text-amber-300')}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden md:inline">{label}</span>
      </button>
    )
  }

  if (status === 'disconnected') {
    return (
      <button
        type="button"
        onClick={onConnect}
        title="Connect device"
        className={cn(PILL_BASE, 'border-slate-700 bg-slate-800/70 text-slate-400 hover:bg-slate-700 hover:text-slate-200')}
      >
        <Usb className="h-3.5 w-3.5" />
        <span className="hidden md:inline">{label}</span>
      </button>
    )
  }

  if (status === 'failed') {
    return (
      <button
        type="button"
        onClick={onConnect}
        title={failedHint ? `${failedHint} — click to retry` : 'Connection failed — click to retry'}
        className={cn(PILL_BASE, 'border-amber-700/50 bg-amber-900/40 text-amber-300 hover:bg-amber-900/60')}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="hidden md:inline">{label}</span>
      </button>
    )
  }

  // Connected — dropdown. DropdownMenuContent renders through a Radix portal, so
  // the menu is never clipped by the titlebar's overflow.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={recording ? `Recording — ${label}` : `Device connected: ${label}`}
          className={cn(
            PILL_BASE,
            recording
              ? 'border-red-700/50 bg-red-950/40 text-red-300 hover:bg-red-950/60 data-[state=open]:bg-red-950/70'
              : 'border-emerald-700/50 bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60 data-[state=open]:bg-emerald-900/70'
          )}
        >
          {recording ? (
            <span
              className="h-2 w-2 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none"
              aria-label="Recording in progress"
            />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          <span className="hidden md:inline">{recording ? 'Recording' : label}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="titlebar-no-drag w-44">
        <DropdownMenuItem onSelect={onGoToSync}>
          <ArrowRight className="mr-2 h-4 w-4" />
          Go to Sync
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDisconnect}
          className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Inline "knowledge nexus" mark — a central node with orbiting sources (per branding). */
function AppMark() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" fill="white" />
        <circle cx="4.5" cy="6" r="1.6" fill="white" fillOpacity="0.85" />
        <circle cx="19.5" cy="7.5" r="1.6" fill="white" fillOpacity="0.85" />
        <circle cx="18" cy="18.5" r="1.6" fill="white" fillOpacity="0.85" />
        <g stroke="white" strokeOpacity="0.6" strokeWidth="1.1">
          <line x1="10" y1="10.5" x2="5.5" y2="7" />
          <line x1="14" y1="10.3" x2="18.7" y2="8.4" />
          <line x1="13.6" y1="14" x2="17.3" y2="17.6" />
        </g>
      </svg>
    </span>
  )
}
