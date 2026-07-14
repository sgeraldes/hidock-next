/**
 * UserMenu — the titlebar avatar → app menu.
 *
 * There is no real account in this app, so this is a sensible APP menu (not a
 * login): it gathers the personal/app-level controls that used to be scattered
 * across the titlebar —
 *   • Appearance: Light / Dark / System (reuses the theme logic via useTheme —
 *     the same source of truth the old standalone ThemeToggle used).
 *   • QA logs: the developer/QA-monitor toggle (useUIStore.qaLogsEnabled).
 *   • About: app name + version (from the main process via app.info()).
 *
 * Rendered through a Radix portal so the menu is never clipped by the titlebar.
 */

import { useEffect, useState } from 'react'
import { User, Check, Sun, Moon, Monitor, Bug } from 'lucide-react'
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

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor }
]

export function UserMenu() {
  const { theme, setTheme } = useTheme()
  const qaLogsEnabled = useUIStore((s) => s.qaLogsEnabled)
  const setQaLogsEnabled = useUIStore((s) => s.setQaLogsEnabled)
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.app
      ?.info()
      .then((info) => {
        if (!cancelled) setVersion(info?.version ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
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

        <DropdownMenuLabel className="flex flex-col gap-0.5 py-1.5 font-normal">
          <span className="text-xs font-semibold text-foreground">HiDock Next</span>
          <span className="text-[10px] text-muted-foreground">
            Meeting Intelligence{version ? ` · v${version}` : ''}
          </span>
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default UserMenu
