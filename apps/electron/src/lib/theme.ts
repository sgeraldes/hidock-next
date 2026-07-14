/**
 * Theme resolution — the small, framework-free core shared between the
 * pre-paint bootstrap (main.tsx, runs before React) and the React reconciler
 * (useTheme). Keeping it here means "what does 'system' resolve to" and "how do
 * we stamp the document" are defined exactly once.
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** localStorage key Zustand's `persist` writes the UI store under. */
export const UI_STORE_KEY = 'hidock-ui-store'

/** The OS preference, or 'light' where matchMedia is unavailable (SSR/tests). */
export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Collapse a preference to the concrete theme to render. */
export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref
}

/** Toggle the `dark` class + `color-scheme` on <html>. The single write path. */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  // Lets the UA style form controls, scrollbars and the canvas correctly, and
  // avoids a white flash on the native window background.
  root.style.colorScheme = resolved
}

/**
 * Best-effort read of the persisted theme preference straight from
 * localStorage — used pre-paint, before the Zustand store has hydrated.
 * Returns 'system' when absent or unparseable.
 */
export function readPersistedThemePreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'system'
  try {
    const raw = localStorage.getItem(UI_STORE_KEY)
    if (!raw) return 'system'
    const parsed = JSON.parse(raw)
    const pref = parsed?.state?.theme
    return pref === 'light' || pref === 'dark' || pref === 'system' ? pref : 'system'
  } catch {
    return 'system'
  }
}

/**
 * Apply the persisted (or system-default) theme immediately. Call this once,
 * synchronously, before React renders so there is no light/dark flash.
 */
export function bootstrapTheme(): void {
  applyTheme(resolveTheme(readPersistedThemePreference()))
}
