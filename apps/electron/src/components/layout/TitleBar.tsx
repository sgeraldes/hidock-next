import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  CheckCircle2,
  Loader2,
  Usb,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ArrowRight,
  AlertTriangle,
  RotateCcw,
  Settings as SettingsIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDeviceConnection } from '@/hooks/useDeviceConnection'
import { useAppStore } from '@/store'
import { Brand, BRAND_DIVIDER_MODE, showBrandVerticalDivider, type BrandDividerMode } from '@/components/layout/Brand'
import { NotificationsButton } from '@/components/layout/NotificationsButton'
import { ActivityLogButton } from '@/components/layout/ActivityLogButton'
import { UserMenu } from '@/components/layout/UserMenu'
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
 * Office-365-style unified titlebar — ONE integrated frameless bar that carries
 * the whole app chrome (brand, sidebar-collapse handle, global search, the right
 * cluster of controls) with the native window controls drawn INSIDE its right
 * edge by Electron's `titleBarOverlay`.
 *
 * Layout (left → right):
 *  1. Brand cell — width == the sidebar width, so the app mark sits directly
 *     above the nav rail (see <Brand>). Swappable placement via the Brand prop.
 *  2. Edge-handle collapse — a chevron ON the divider between the brand cell and
 *     the content area; toggles the sidebar (replaces the old KNOWLEDGE-header
 *     toggle). Works in both expanded and collapsed (rail) states.
 *  3. Centred global search (⌘K-style) — routes to Explore.
 *  4. Right cluster — 🔔 notifications, ⚡ activity, ⚙ settings, the device
 *     status pill (all-states, incl. Restart), then the avatar → app menu.
 *  5. Native window controls (— ▢ ✕) — drawn by Electron in the reserved
 *     NATIVE_CONTROLS_WIDTH gutter at the far right (inside this bar).
 *
 * The whole bar is a drag region (`titlebar-drag-region`); every interactive
 * child opts out with `titlebar-no-drag`. Height MUST stay in sync with the
 * `titleBarOverlay.height` set in electron/main/index.ts (40px).
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

// macOS traffic-light inset — reserve the top-left so the brand clears the window
// controls. Windows draws its controls top-right (see NATIVE_CONTROLS_WIDTH), so on
// Windows the brand cell starts flush at x=0 and the grid is pixel-exact.
const MAC_TRAFFIC_LIGHT_INSET = 72

// Brand-cell width == sidebar width (w-56 open / w-16 collapsed). The edge-handle
// collapse control is centred on the divider at this x, so it animates with the cell.
const CELL_WIDTH_OPEN = 224 // w-56
const CELL_WIDTH_COLLAPSED = 64 // w-16

interface TitleBarProps {
  sidebarOpen: boolean
  /** Toggles the sidebar — driven by the edge-handle on the brand/content divider. */
  onToggleSidebar?: () => void
  /** Corner-cell divider treatment (owner preview). Defaults to BRAND_DIVIDER_MODE. */
  dividerMode?: BrandDividerMode
}

export function TitleBar({ sidebarOpen, onToggleSidebar, dividerMode = BRAND_DIVIDER_MODE }: TitleBarProps) {
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

  const cellWidth = sidebarOpen ? CELL_WIDTH_OPEN : CELL_WIDTH_COLLAPSED

  return (
    <header
      className="titlebar-drag-region relative z-30 flex h-10 shrink-0 items-center bg-slate-900 text-slate-100 select-none"
      style={{ paddingRight: isMac ? 12 : NATIVE_CONTROLS_WIDTH }}
    >
      {/* BRAND CELL — mirrors the sidebar column (same width + border-r) so the
          sidebar divider continues up through the titlebar. The app identity is
          bounded by the column; the mark aligns with the nav-icon rail below. */}
      <div
        className={cn(
          'flex h-full shrink-0 items-center transition-all duration-300',
          // Vertical divider (brand cell right border) — dropped in 'titlebar' mode
          // so the brand flows into the bar as one continuous strip.
          showBrandVerticalDivider(dividerMode) && 'border-r border-slate-700',
          sidebarOpen ? 'w-56' : 'w-16'
        )}
        style={{ paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_INSET : undefined }}
      >
        <Brand placement="titlebar" collapsed={!sidebarOpen} />
      </div>

      {/* EDGE-HANDLE COLLAPSE — a small chevron sitting ON the brand/content
          divider (concept 04). Toggles the sidebar in BOTH states; replaces the
          old collapse toggle on the KNOWLEDGE header. Centred on the divider x
          (translateX -50%) and vertically centred; animates with the cell width. */}
      {onToggleSidebar && (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          className="titlebar-no-drag absolute top-1/2 z-40 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-slate-300 shadow-sm transition-colors duration-300 hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          style={{ left: cellWidth }}
        >
          {sidebarOpen ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      )}

      {/* CONTENT COLUMN — centred search + right cluster. */}
      <div className="flex h-full min-w-0 flex-1 items-center gap-2 pl-4 pr-3">
        {/* Global search — routes to Explore. Shrinks first at narrow widths. */}
        <form onSubmit={submitSearch} className="titlebar-no-drag mx-auto w-full max-w-md min-w-0">
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

        {/* RIGHT CLUSTER — notifications, activity, settings, device pill, user menu. */}
        <div className="flex shrink-0 items-center gap-1">
          <NotificationsButton />
          <ActivityLogButton />
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            title="Settings"
            className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>

          {/* Device connection control — same status + connect/disconnect action as
              the Device Sync page (via useDeviceConnection). Keeps its all-states
              dropdown, including Restart. */}
          <ConnectionControl
            status={status}
            label={connectionLabel}
            failedHint={failedHint}
            recording={deviceRecording}
            onConnect={() => void connect()}
            onDisconnect={() => void disconnect()}
            onGoToSync={() => navigate('/sync')}
          />

          <UserMenu />
        </div>
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
