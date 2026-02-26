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

  window.addEventListener('click', (event) => {
    if (!isQaEnabled()) return
    const target = event.target as HTMLElement
    const interactive = target.closest('button, a, input, select, [role="button"]') || target
    console.log(`[QA-MONITOR] Interaction: Clicked ${getElementLabel(interactive as HTMLElement)}`)
  }, true)
}

export function initErrorLogger() {
  if (IS_PROD) return
  window.addEventListener('error', (event) => {
    if (!isQaEnabled()) return
    console.error(`[QA-MONITOR] Uncaught Error: ${event.message}`, event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (!isQaEnabled()) return
    console.error(`[QA-MONITOR] Unhandled Promise Rejection:`, event.reason)
  })
}

export function logStateChange(storeName: string, partialState: any) {
  if (!isQaEnabled()) return
  const keys = Object.keys(partialState)
  const filteredKeys = keys.filter(k => !['meetings', 'recordings', 'unifiedRecordings', 'activityLog'].includes(k))
  if (filteredKeys.length > 0) {
    const updates = filteredKeys.reduce((acc, k) => ({ ...acc, [k]: partialState[k] }), {})
    console.log(`[QA-MONITOR] State [${storeName}]:`, updates)
  }
}

declare global {
  interface Window {
    hasInitializedInteractionLogger: boolean
  }
}
