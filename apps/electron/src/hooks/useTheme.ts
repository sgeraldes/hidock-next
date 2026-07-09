/**
 * useTheme — reconciles the persisted theme preference with the DOM.
 *
 * Responsibilities:
 *  - apply the resolved theme (`dark` class + color-scheme) whenever the
 *    preference changes;
 *  - while the preference is 'system', follow live OS changes;
 *  - mirror the preference into the app config (config.ui.theme) best-effort, so
 *    the choice is durable beyond localStorage.
 *
 * The pre-paint bootstrap in main.tsx has already applied the correct theme from
 * localStorage before React mounts, so this hook only keeps things in sync — it
 * never causes a flash.
 */

import { useCallback, useEffect } from 'react'
import { useUIStore } from '@/store/ui/useUIStore'
import { useConfigStore } from '@/store/domain/useConfigStore'
import { applyTheme, resolveTheme, systemTheme, type ResolvedTheme, type ThemePreference } from '@/lib/theme'

export interface UseThemeResult {
  /** The user's preference: 'light' | 'dark' | 'system'. */
  theme: ThemePreference
  /** The concrete theme currently applied. */
  resolvedTheme: ResolvedTheme
  /** Set the preference (persists + applies + mirrors to config). */
  setTheme: (theme: ThemePreference) => void
  /** Convenience: flip between light and dark (pins an explicit preference). */
  toggleTheme: () => void
}

export function useTheme(): UseThemeResult {
  const theme = useUIStore((s) => s.theme)
  const setThemePref = useUIStore((s) => s.setTheme)
  const configReady = useConfigStore((s) => s.configReady)
  const configTheme = useConfigStore((s) => s.config?.ui?.theme)

  // Apply on preference change.
  useEffect(() => {
    applyTheme(resolveTheme(theme))
  }, [theme])

  // Follow OS changes while on 'system'.
  useEffect(() => {
    if (theme !== 'system') return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(systemTheme())
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme])

  // One-time adoption: if the user has never picked a theme in THIS renderer
  // (localStorage still 'system') but config.json carries an explicit choice
  // from a prior session, adopt it. Avoids clobbering a fresh localStorage pick.
  useEffect(() => {
    if (!configReady) return
    if (theme !== 'system') return
    if (configTheme === 'light' || configTheme === 'dark') {
      setThemePref(configTheme)
    }
    // Only react to config readiness; `theme` intentionally omitted so a later
    // manual switch back to 'system' isn't immediately overridden by config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configReady, configTheme])

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemePref(next)
      applyTheme(resolveTheme(next))
      // Mirror to config, best-effort — a failure just leaves localStorage as
      // the source of truth. updateConfig already restores on error internally.
      void useConfigStore
        .getState()
        .updateConfig('ui', { theme: next })
        .catch(() => {})
    },
    [setThemePref]
  )

  const toggleTheme = useCallback(() => {
    setTheme(resolveTheme(theme) === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return { theme, resolvedTheme: resolveTheme(theme), setTheme, toggleTheme }
}
