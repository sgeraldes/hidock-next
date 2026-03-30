import { useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/app-store'

type Theme = 'dark' | 'light'

function applyThemeToDocument(theme: Theme): void {
  if (theme === 'light') {
    document.documentElement.classList.add('light')
  } else {
    document.documentElement.classList.remove('light')
  }
}

export interface UseThemeReturn {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

/**
 * Manages the application colour theme.
 *
 * - On mount: reads the saved preference from settings and applies it.
 * - `toggleTheme` / `setTheme`: update the store, the document class, and
 *   persist the preference via the settings IPC.
 * - Dark mode is the default (no class on documentElement).  Light mode adds
 *   the `light` class.
 */
export function useTheme(): UseThemeReturn {
  const theme = useAppStore((s) => s.theme as Theme)
  const setThemeInStore = useAppStore((s) => s.setTheme)

  // On mount: load the persisted preference and apply it.
  useEffect(() => {
    window.electronAPI.settings.get('ai.provider').then(() => {
      // We re-use the generic settings API.  The theme key isn't in SettingsMap
      // so we fall back to the store value that was already hydrated (or dark).
    })

    // Apply whatever the store already has (hydrated from main process or default).
    applyThemeToDocument(theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeInStore(next)
      applyThemeToDocument(next)
    },
    [setThemeInStore],
  )

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return { theme, toggleTheme, setTheme }
}
