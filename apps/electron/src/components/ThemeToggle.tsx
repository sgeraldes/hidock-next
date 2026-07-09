/**
 * ThemeToggle — a sun/moon morph button for the titlebar.
 *
 * A single click flips between light and dark (pinning an explicit preference).
 * The two glyphs cross-fade and rotate through each other so the switch feels
 * like one icon morphing rather than two swapping. Styled for the dark chrome of
 * the titlebar (it lives next to the connection pill), so its colors are fixed
 * regardless of the app theme.
 */

import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cn(
        'titlebar-no-drag relative flex h-7 w-7 items-center justify-center rounded-md text-slate-300',
        'transition-colors hover:bg-slate-700 hover:text-white',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
        className
      )}
    >
      <Sun
        className={cn(
          'absolute h-4 w-4 transition-all duration-300 ease-out-soft motion-reduce:transition-none',
          isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'
        )}
        aria-hidden="true"
      />
      <Moon
        className={cn(
          'absolute h-4 w-4 transition-all duration-300 ease-out-soft motion-reduce:transition-none',
          isDark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'
        )}
        aria-hidden="true"
      />
    </button>
  )
}

export default ThemeToggle
