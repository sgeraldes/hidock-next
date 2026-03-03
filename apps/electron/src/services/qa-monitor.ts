import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useUIStore } from '@/store/ui/useUIStore'

const IS_PROD = typeof import.meta !== 'undefined' && import.meta.env?.PROD

function isQaEnabled(): boolean {
  if (IS_PROD) return false
  try {
    return useUIStore.getState().qaLogsEnabled
  } catch {
    return false
  }
}

/**
 * Shared QA logging check for hooks and services.
 * Respects the user's QA Logs toggle in all environments.
 * Import this instead of defining local shouldLogQa() in each file.
 */
export function shouldLogQa(): boolean {
  return isQaEnabled()
}

export function NavigationLogger() {
  const location = useLocation()
  const qaEnabled = useUIStore((s) => s.qaLogsEnabled)

  useEffect(() => {
    if (IS_PROD || !qaEnabled) return
    console.log(`[QA-MONITOR] Navigation: -> ${location.pathname}${location.search}`)
    const pageName = location.pathname.replace('/', '') || 'home'
    performance.mark(`page-load-${pageName}-start`)
  }, [location, qaEnabled])

  return null
}

// Store cleanup functions for all QA monitor listeners
let cleanupFunctions: (() => void)[] = []

export function initInteractionLogger() {
  if (IS_PROD) return
  if (window.hasInitializedInteractionLogger) return
  window.hasInitializedInteractionLogger = true

  const getElementLabel = (el: HTMLElement): string => {
    const id = el.id ? `#${el.id}` : ''
    const text = el.innerText ? ` ("${el.innerText.slice(0, 20)}")` : ''
    const role = el.getAttribute('role') ? `[role="${el.getAttribute('role')}"]` : ''
    const ariaLabel = el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : ''
    return `${el.tagName.toLowerCase()}${id}${role}${ariaLabel}${text}`
  }

  const clickHandler = (event: MouseEvent) => {
    if (!isQaEnabled()) return
    const target = event.target as HTMLElement
    const interactive = target.closest('button, a, input, select, [role="button"]') || target
    console.log(`[QA-MONITOR] Interaction: Clicked ${getElementLabel(interactive as HTMLElement)}`)
  }

  window.addEventListener('click', clickHandler, true)

  // Store cleanup function
  cleanupFunctions.push(() => {
    window.removeEventListener('click', clickHandler, true)
  })
}

export function initErrorLogger() {
  if (IS_PROD) return

  const errorHandler = (event: ErrorEvent) => {
    if (!isQaEnabled()) return
    console.error(`[QA-MONITOR] Uncaught Error: ${event.message}`, event.error)
  }

  const rejectionHandler = (event: PromiseRejectionEvent) => {
    if (!isQaEnabled()) return
    console.error(`[QA-MONITOR] Unhandled Promise Rejection:`, event.reason)
  }

  window.addEventListener('error', errorHandler)
  window.addEventListener('unhandledrejection', rejectionHandler)

  // Store cleanup functions
  cleanupFunctions.push(
    () => window.removeEventListener('error', errorHandler),
    () => window.removeEventListener('unhandledrejection', rejectionHandler)
  )
}

/**
 * Clean up all QA monitor event listeners.
 * Call this when unmounting the app or disabling QA monitoring.
 */
export function cleanupQAMonitor() {
  if (IS_PROD) return

  cleanupFunctions.forEach(cleanup => cleanup())
  cleanupFunctions = []
  window.hasInitializedInteractionLogger = false

  if (isQaEnabled()) console.log('[QA-MONITOR] All event listeners cleaned up')
}

declare global {
  interface Window {
    hasInitializedInteractionLogger: boolean
  }
}
