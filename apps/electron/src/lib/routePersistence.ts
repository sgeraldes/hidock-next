/**
 * H8: Session route persistence helpers.
 *
 * Preserve the user's current route across background-triggered renderer reloads.
 * A heavy background task (e.g. a blocking calendar sync loading ~1800 meetings)
 * could starve the main process long enough that electron-vite reloaded the
 * renderer from the base URL. With HashRouter, a base-URL reload drops the
 * `#/route` hash and lands on `/`, which redirects to the default page — looking
 * like a spontaneous "navigate to the default/Today" the user never requested.
 *
 * We record the active route to sessionStorage and restore it on the root path.
 * sessionStorage (not localStorage) is intentional: it survives a reload/HMR
 * within the session but resets on a genuine fresh launch, preserving the normal
 * "open to the default page" behavior.
 */

export const LAST_ROUTE_KEY = 'hidock:last-route'
export const DEFAULT_ROUTE = '/library'

/**
 * Persist a route for the current session. The transient root path (`/`) is never
 * persisted — it is only the redirect entry point.
 */
export function persistRoute(pathWithSearch: string): void {
  if (!pathWithSearch || pathWithSearch === '/' || !pathWithSearch.startsWith('/')) {
    return
  }
  try {
    sessionStorage.setItem(LAST_ROUTE_KEY, pathWithSearch)
  } catch {
    /* sessionStorage unavailable — best-effort, non-fatal */
  }
}

/**
 * Resolve the route the root path should redirect to: the last persisted route
 * for this session, or the default page on a fresh session.
 */
export function getInitialRoute(): string {
  try {
    const saved = sessionStorage.getItem(LAST_ROUTE_KEY)
    if (saved && saved.startsWith('/') && saved !== '/') {
      return saved
    }
  } catch {
    /* sessionStorage unavailable — fall back to default */
  }
  return DEFAULT_ROUTE
}
