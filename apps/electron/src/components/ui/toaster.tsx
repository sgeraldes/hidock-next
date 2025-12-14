import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

// Toast context for global state
interface Toast {
  id: string
  title?: string
  description?: string
  variant?: 'default' | 'success' | 'error' | 'warning'
  duration?: number
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}

// Convenience functions
export function toast(options: Omit<Toast, 'id'>) {
  // This will be set by the provider
  if (globalToastFn) {
    globalToastFn(options)
  }
}

let globalToastFn: ((options: Omit<Toast, 'id'>) => void) | null = null

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const addToast = React.useCallback((options: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9)
    setToasts((prev) => [...prev, { id, ...options }])

    // Auto-remove after duration
    const duration = options.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, duration)
    }
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Set global function
  React.useEffect(() => {
    globalToastFn = addToast
    return () => {
      globalToastFn = null
    }
  }, [addToast])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 flex flex-col p-4 gap-2 w-[390px] max-w-[100vw] m-0 list-none z-50 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast: t, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = {
    default: Info,
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertCircle
  }[t.variant || 'default']

  const iconColor = {
    default: 'text-muted-foreground',
    success: 'text-green-500',
    error: 'text-destructive',
    warning: 'text-yellow-500'
  }[t.variant || 'default']

  return (
    <ToastPrimitive.Root
      className={cn(
        'bg-background border rounded-lg shadow-lg p-4 flex items-start gap-3',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-80 data-[state=open]:slide-in-from-bottom-full',
        'data-[state=closed]:slide-out-to-right-full',
        t.variant === 'error' && 'border-destructive/50',
        t.variant === 'success' && 'border-green-500/50',
        t.variant === 'warning' && 'border-yellow-500/50'
      )}
      duration={t.duration}
    >
      <Icon className={cn('h-5 w-5 flex-shrink-0 mt-0.5', iconColor)} />
      <div className="flex-1 min-w-0">
        {t.title && (
          <ToastPrimitive.Title className="text-sm font-semibold">
            {t.title}
          </ToastPrimitive.Title>
        )}
        {t.description && (
          <ToastPrimitive.Description className="text-sm text-muted-foreground mt-1">
            {t.description}
          </ToastPrimitive.Description>
        )}
      </div>
      <ToastPrimitive.Close
        className="rounded-md p-1 hover:bg-accent transition-colors"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  )
}

// Legacy export for compatibility
export function Toaster() {
  return null
}
