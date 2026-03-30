import { useKeyboardShortcut } from '../../hooks/use-keyboard-shortcut'
import { useAppStore } from '../../stores/app-store'
import { useSessionStore } from '../../stores/session-store'
import { useScreenshotStore } from '../../stores/screenshot-store'

export function KeyboardShortcuts() {
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const isRecording = useAppStore((s) => s.isRecording)

  // Ctrl+Shift+S — Screenshot (only during recording)
  useKeyboardShortcut(
    'ctrl+shift+s',
    () => {
      if (activeSessionId) {
        useScreenshotStore.getState().capture(activeSessionId)
      }
    },
    { enabled: isRecording },
  )

  // Ctrl+Shift+N — New session (only when not recording)
  useKeyboardShortcut('ctrl+shift+n', () => {
    if (!isRecording) {
      useSessionStore.getState().createSession()
    }
  })

  // Ctrl+Shift+E — End session (only during recording)
  useKeyboardShortcut(
    'ctrl+shift+e',
    () => {
      if (activeSessionId && isRecording) {
        useSessionStore.getState().endSession(activeSessionId)
      }
    },
    { enabled: isRecording },
  )

  return null
}
