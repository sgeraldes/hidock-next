import { Loader2 } from 'lucide-react'

interface LoadingSpinnerProps {
  /** Custom message to display below the spinner */
  message?: string
  /** Additional CSS classes for the container */
  className?: string
}

/**
 * A loading spinner component for Suspense fallbacks during lazy loading.
 * Uses lucide-react for consistent iconography with the rest of the app.
 *
 * @example
 * <Suspense fallback={<LoadingSpinner message="Loading page..." />}>
 *   <LazyComponent />
 * </Suspense>
 */
export function LoadingSpinner({
  message = 'Loading...',
  className = ''
}: LoadingSpinnerProps): React.ReactElement {
  return (
    <div
      className={`flex flex-col items-center justify-center min-h-[200px] ${className}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
