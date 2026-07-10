import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, CheckCircle2, Loader2, Usb, ChevronDown, LogOut, ArrowRight, AlertTriangle, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDeviceConnection } from '@/hooks/useDeviceConnection'
import { useAppStore } from '@/store'
import { ThemeToggle } from '@/components/ThemeToggle'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

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

// macOS traffic-light inset — reserve the top-left so the toggle box clears the
// window controls. Windows draws its controls top-right (see NATIVE_CONTROLS_WIDTH),
// so on Windows the left cell starts flush at x=0 and the grid is pixel-exact.
const MAC_TRAFFIC_LIGHT_INSET = 72

/**
 * Shared shell grid (documented for the sidebar to mirror):
 *  - The titlebar LEFT CELL width == the sidebar width (w-56 open / w-16 collapsed),
 *    and carries the same `border-r` so the sidebar's vertical divider continues
 *    up through the titlebar (Office-365 unified chrome).
 *  - RAIL_AXIS: the collapsed rail is 64px (w-16) wide, so its centre — and the
 *    centre of every nav icon in BOTH states, and the titlebar toggle icon — sits
 *    at x = 32px from the window's left edge. The sidebar keeps this by using
 *    nav `px-2.5` (10px) + item `px-3` (12px) + half-icon (10px) = 32px expanded,
 *    and `justify-center` in the 64px rail = 32px collapsed.
 */

interface TitleBarProps {
  sidebarOpen: boolean
}

export function TitleBar({ sidebarOpen }: TitleBarProps) {
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
      className="titlebar-drag-region relative z-30 flex h-10 shrink-0 items-center bg-slate-900 text-slate-100 select-none"
      style={{ paddingRight: isMac ? 12 : NATIVE_CONTROLS_WIDTH }}
    >
      {/* LEFT CELL — mirrors the sidebar column (same width + border-r), so the
          sidebar divider continues up through the titlebar. Identity lives here,
          bounded by the column, instead of straddling the sidebar/content seam. */}
      <div
        className={cn(
          'flex h-full shrink-0 items-center border-r border-slate-700 transition-all duration-300',
          sidebarOpen ? 'w-56' : 'w-16'
        )}
        style={{ paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_INSET : undefined }}
      >
        {/* Brand mark box: 64px wide, mark centred on the 32px rail axis so the
            app logo lines up vertically with the collapsed rail + every nav icon
            in the sidebar column below. The sidebar-collapse toggle now lives on
            the sidebar's "KNOWLEDGE" header row (see Layout.tsx), so the mark is
            no longer glued to a toggle. */}
        <div className="flex h-full w-16 shrink-0 items-center justify-center">
          <AppMark />
        </div>

        {/* App identity wordmark — expanded only; hidden with the sidebar labels
            when collapsed. The FULL product wordmark ("Meeting Intelligence" — this
            app is not the device) is sized to fit the ~160px cell (w-56 − 64px mark
            box) so it never truncates or straddles the sidebar/content seam. */}
        {sidebarOpen && (
          <div className="flex min-w-0 items-center pr-2">
            <span className="whitespace-nowrap text-[11px] font-semibold leading-none tracking-tight text-white">
              Meeting Intelligence
            </span>
          </div>
        )}
      </div>

      {/* RIGHT CELL — content column: search (centred) + theme + connection. */}
      <div className="flex h-full min-w-0 flex-1 items-center gap-3 px-3">
        {/* Global search — routes to Explore */}
        <form onSubmit={submitSearch} className="titlebar-no-drag mx-auto w-full max-w-md">
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

        {/* Theme toggle — sun/moon morph, sits just before the connection pill. */}
        <ThemeToggle />

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
      </div>
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
 * Four-state device pill. In EVERY state a "more options" caret opens a dropdown
 * that always exposes "Restart app" (plus the state's primary action) — so the
 * app can be restarted to recover a stuck device even while disconnected,
 * connecting, or failed (previously the menu, and thus Restart, only existed in
 * the connected state):
 *  - disconnected → button labelled "Connect device"; click = one connect attempt.
 *                   Caret menu: Connect device / Restart app.
 *  - connecting   → disabled pill with a spinner. Caret menu: Restart app.
 *  - failed       → amber "Connection failed — retry"; click = one retry. Honest
 *                   after a failed auto/manual connect instead of reverting to the
 *                   neutral "Connect device". Caret menu: Retry connection / Restart app.
 *  - connected    → dropdown trigger (model + connected styling); a bare click
 *                   opens a menu (Go to Sync / Disconnect / Restart app) rather
 *                   than disconnecting, so it can't be hit by accident.
 */
function ConnectionControl({ status, label, failedHint, recording, onConnect, onDisconnect, onGoToSync }: ConnectionControlProps) {
  // Restart confirm dialog is driven by state (rather than nesting an
  // AlertDialogTrigger inside a DropdownMenuItem, which is finicky): the menu item
  // opens it, and the AlertDialog is rendered controlled, outside the menu.
  const [restartOpen, setRestartOpen] = useState(false)

  const restartMenuItem = (
    <DropdownMenuItem onSelect={() => setRestartOpen(true)}>
      <RotateCcw className="mr-2 h-4 w-4" />
      Restart app
    </DropdownMenuItem>
  )

  let control: ReactNode

  if (status === 'connecting') {
    control = (
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled
          title="Connecting to device…"
          className={cn(PILL_BASE, 'cursor-wait border-amber-700/50 bg-amber-900/40 text-amber-300')}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="hidden md:inline">{label}</span>
        </button>
        <MoreMenu>{restartMenuItem}</MoreMenu>
      </div>
    )
  } else if (status === 'disconnected') {
    control = (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onConnect}
          title="Connect device"
          className={cn(PILL_BASE, 'border-slate-700 bg-slate-800/70 text-slate-400 hover:bg-slate-700 hover:text-slate-200')}
        >
          <Usb className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{label}</span>
        </button>
        <MoreMenu>
          <DropdownMenuItem onSelect={onConnect}>
            <Usb className="mr-2 h-4 w-4" />
            Connect device
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {restartMenuItem}
        </MoreMenu>
      </div>
    )
  } else if (status === 'failed') {
    control = (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onConnect}
          title={failedHint ? `${failedHint} — click to retry` : 'Connection failed — click to retry'}
          className={cn(PILL_BASE, 'border-amber-700/50 bg-amber-900/40 text-amber-300 hover:bg-amber-900/60')}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{label}</span>
        </button>
        <MoreMenu>
          <DropdownMenuItem onSelect={onConnect}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Retry connection
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {restartMenuItem}
        </MoreMenu>
      </div>
    )
  } else {
    // Connected — dropdown. DropdownMenuContent renders through a Radix portal, so
    // the menu is never clipped by the titlebar's overflow.
    control = (
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
          <DropdownMenuSeparator />
          {/* Restart lives here now (moved out of the sidebar). onSelect just flips
              the controlled AlertDialog open — see the note on restartOpen. */}
          {restartMenuItem}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <>
      {control}

      <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
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
    </>
  )
}

/**
 * "More options" caret trigger + dropdown, used by the non-connected device-pill
 * states so Restart (and each state's primary action) is always reachable. The
 * menu content is passed as children.
 */
function MoreMenu({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Device options"
          title="Device options"
          className={cn(
            PILL_BASE,
            'px-1.5 border-slate-700 bg-slate-800/70 text-slate-400 hover:bg-slate-700 hover:text-slate-200 data-[state=open]:bg-slate-700'
          )}
        >
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="titlebar-no-drag w-44">
        {children}
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
