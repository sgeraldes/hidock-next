import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

type ElectronAPI = {
  onNavigate?: (callback: (path: string) => void) => () => void
}

/**
 * Listens for navigation events sent from the main process (e.g. tray menu
 * "Settings" click) and navigates the React Router to the requested path.
 */
export function useMainNavigation(): void {
  const navigate = useNavigate()

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI
    if (!api?.onNavigate) return

    const unsub = api.onNavigate((path: string) => {
      navigate(path)
    })

    return () => {
      unsub?.()
    }
  }, [navigate])
}
