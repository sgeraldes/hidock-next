import { create } from 'zustand'

export type ToastVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info'

export interface ToastData {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number  // ms, default 5000
}

interface ToastState {
  toasts: ToastData[]
  addToast: (toast: Omit<ToastData, 'id'>) => void
  removeToast: (id: string) => void
}

const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    set((state) => {
      const newToasts = [...state.toasts, { ...toast, id }]
      // Max 5 visible
      if (newToasts.length > 5) newToasts.shift()
      return { toasts: newToasts }
    })
    // Auto-dismiss
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) }))
    }, toast.duration ?? 5000)
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),
}))

// Imperative API
export function toast(options: Omit<ToastData, 'id'>) {
  useToastStore.getState().addToast(options)
}

export { useToastStore }
