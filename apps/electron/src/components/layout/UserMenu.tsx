/**
 * UserMenu — the titlebar avatar → app menu.
 *
 * There is no real account in this app, so this is a sensible APP menu (not a
 * login): it gathers the personal/app-level controls that used to be scattered
 * across the titlebar —
 *   • Appearance: Light / Dark / System (reuses the theme logic via useTheme —
 *     the same source of truth the old standalone ThemeToggle used).
 *   • QA logs: the developer/QA-monitor toggle (useUIStore.qaLogsEnabled).
 *   • About: opens a small dialog with the app name, version, platform and a repo
 *     link (version/platform via window.electronAPI.app.info(), graceful if null).
 *
 * Rendered through a Radix portal so the menu is never clipped by the titlebar.
 */

import { useEffect, useState } from 'react'
import { User, Check, Sun, Moon, Monitor, Bug, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { useUIStore } from '@/store/ui/useUIStore'
import type { ThemePreference } from '@/lib/theme'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AppMark } from '@/components/layout/Brand'

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor }
]

const REPO_URL = 'https://github.com/sgeraldes/hidock-next'

interface AppInfo {
  version: string
  name: string
  isPackaged: boolean
  platform: string
}

export function UserMenu() {
  const { theme, setTheme } = useTheme()
  const qaLogsEnabled = useUIStore((s) => s.qaLogsEnabled)
  const setQaLogsEnabled = useUIStore((s) => s.setQaLogsEnabled)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.app
      ?.info()
      .then((result) => {
        if (!cancelled) setInfo(result ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const version = info?.version ?? null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="App menu"
            title="App menu"
            className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-slate-100 ring-1 ring-slate-500/50 transition-colors hover:from-slate-500 hover:to-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 data-[state=open]:ring-sky-400"
          >
            <User className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="titlebar-no-drag w-52">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Appearance
          </DropdownMenuLabel>
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.value
            return (
              <DropdownMenuItem
                key={opt.value}
                onSelect={() => setTheme(opt.value)}
                aria-checked={active}
                role="menuitemradio"
              >
                <opt.icon className="mr-2 h-4 w-4" />
                {opt.label}
                {active && <Check className="ml-auto h-4 w-4 text-sky-500" />}
              </DropdownMenuItem>
            )
          })}

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Developer
          </DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(e) => {
              // Keep the menu open so the toggle reads as an in-place switch.
              e.preventDefault()
              setQaLogsEnabled(!qaLogsEnabled)
            }}
            aria-checked={qaLogsEnabled}
            role="menuitemcheckbox"
          >
            <Bug className="mr-2 h-4 w-4" />
            QA logs
            <span
              className={cn(
                'ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                qaLogsEnabled ? 'bg-green-500/20 text-green-600 dark:text-green-400' : 'bg-muted text-muted-foreground'
              )}
            >
              {qaLogsEnabled ? 'On' : 'Off'}
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* About → opens the dialog. onSelect just flips the controlled Dialog
              open (rendering an AlertDialog/Dialog inside a menu item is finicky,
              so it lives outside the menu — same pattern as the device Restart). */}
          <DropdownMenuItem onSelect={() => setAboutOpen(true)}>
            <Info className="mr-2 h-4 w-4" />
            About
            {version && <span className="ml-auto text-[10px] text-muted-foreground">v{version}</span>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <AppMark />
              <div className="flex flex-col">
                <DialogTitle>Meeting Intelligence</DialogTitle>
                <DialogDescription>Your universal knowledge hub</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-medium tabular-nums">{version ? `v${version}` : 'Unknown'}</dd>
            </div>
            {info?.platform && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Platform</dt>
                <dd className="font-medium">{info.platform}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Repository</dt>
              <dd className="min-w-0">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sky-600 hover:underline dark:text-sky-400"
                >
                  github.com/sgeraldes/hidock-next
                </a>
              </dd>
            </div>
          </dl>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default UserMenu
