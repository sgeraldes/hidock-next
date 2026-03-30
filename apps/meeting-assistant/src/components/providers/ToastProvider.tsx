import {
  ToastProvider as RadixToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
} from '../ui/toast'
import { useToastStore } from '../../hooks/use-toast'
import type { ToastVariant } from '../../hooks/use-toast'

function toastRadixVariant(
  variant: ToastVariant | undefined
): 'default' | 'live' | 'success' | 'warning' | 'info' | 'destructive' {
  if (!variant) return 'default'
  // 'destructive' maps directly; all others map directly too
  return variant as 'default' | 'success' | 'warning' | 'info' | 'destructive'
}

export function ToastProvider() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  return (
    <RadixToastProvider swipeDirection="right">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          variant={toastRadixVariant(t.variant)}
          onOpenChange={(open) => {
            if (!open) removeToast(t.id)
          }}
          open
        >
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <ToastTitle>{t.title}</ToastTitle>
            {t.description && (
              <ToastDescription>{t.description}</ToastDescription>
            )}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </RadixToastProvider>
  )
}
