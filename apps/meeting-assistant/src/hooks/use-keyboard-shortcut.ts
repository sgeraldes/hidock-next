import { useEffect, useRef } from 'react'

interface ShortcutOptions {
  /** When false the listener is removed. Defaults to true. */
  enabled?: boolean
}

interface ParsedCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  key: string
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split('+')
  return {
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key: parts[parts.length - 1],
  }
}

function matchesCombo(event: KeyboardEvent, combo: ParsedCombo): boolean {
  if (event.ctrlKey !== combo.ctrl) return false
  if (event.shiftKey !== combo.shift) return false
  if (event.altKey !== combo.alt) return false
  if (event.metaKey !== combo.meta) return false
  return event.key.toLowerCase() === combo.key
}

/**
 * Register a global keyboard shortcut.
 *
 * @param key       Shortcut string, e.g. `"ctrl+shift+s"`, `"escape"`, `"ctrl+k"`.
 * @param callback  Function to invoke when the shortcut fires.
 * @param options   `{ enabled }` — set to false to temporarily disable the shortcut.
 *
 * The callback ref is updated on every render so callers do not need to
 * memoise it.  The listener itself is only added/removed when `key` or
 * `enabled` changes.
 */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  options: ShortcutOptions = {},
): void {
  const { enabled = true } = options

  // Keep a mutable ref so the handler always calls the latest callback without
  // needing to re-register the listener on every render.
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    if (!enabled) return

    const combo = parseCombo(key)

    const handler = (event: KeyboardEvent) => {
      if (matchesCombo(event, combo)) {
        callbackRef.current()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, enabled])
}
