import { useState, useEffect } from 'react'

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of
 * inactivity.
 *
 * @param value  The value to debounce.
 * @param delay  Debounce delay in milliseconds. Defaults to 300.
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(id)
  }, [value, delay])

  return debouncedValue
}
