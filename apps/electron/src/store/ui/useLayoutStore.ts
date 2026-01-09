/**
 * Layout Store (UI)
 *
 * Manages global UI layout state including sidebar, theme, and modals.
 * Persists user preferences to localStorage using persist middleware.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type ModalType = 'settings' | 'about' | 'generate-output' | 'link-recording' | null

export interface LayoutStore {
  // State
  sidebarOpen: boolean
  theme: Theme
  activeModal: ModalType
  modalProps: Record<string, any> | null

  // Actions
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setTheme: (theme: Theme) => void
  openModal: (modal: ModalType, props?: Record<string, any>) => void
  closeModal: () => void
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      // Initial state
      sidebarOpen: true,
      theme: 'system',
      activeModal: null,
      modalProps: null,

      // Actions
      toggleSidebar: () => {
        set((state) => ({ sidebarOpen: !state.sidebarOpen }))
      },

      setSidebarOpen: (open) => {
        set({ sidebarOpen: open })
      },

      setTheme: (theme) => {
        set({ theme })
        // Apply theme to document
        if (theme === 'dark') {
          document.documentElement.classList.add('dark')
        } else if (theme === 'light') {
          document.documentElement.classList.remove('dark')
        } else {
          // System preference
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
          if (prefersDark) {
            document.documentElement.classList.add('dark')
          } else {
            document.documentElement.classList.remove('dark')
          }
        }
      },

      openModal: (modal, props) => {
        set({ activeModal: modal, modalProps: props || null })
      },

      closeModal: () => {
        set({ activeModal: null, modalProps: null })
      }
    }),
    {
      name: 'layout-store', // localStorage key
      partialize: (state) => ({
        // Only persist these fields
        sidebarOpen: state.sidebarOpen,
        theme: state.theme
      })
    }
  )
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Check if a specific modal is active
 */
export const useIsModalActive = (modal: ModalType) => {
  return useLayoutStore((state) => state.activeModal === modal)
}

/**
 * Get current modal props
 */
export const useModalProps = <T = Record<string, any>>() => {
  return useLayoutStore((state) => state.modalProps as T | null)
}
