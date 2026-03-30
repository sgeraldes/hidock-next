import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKeyboardShortcut } from '../../hooks/use-keyboard-shortcut'
import { useAppStore } from '../../stores/app-store'
import { useSessionStore } from '../../stores/session-store'
import { useScreenshotStore } from '../../stores/screenshot-store'

export function KeyboardShortcuts() {
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const isRecording = useAppStore((s) => s.isRecording)
  const navigate = useNavigate()

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

  // Ctrl+Shift+M — Toggle mute
  useKeyboardShortcut('ctrl+shift+m', () => {
    const { isMuted, setIsMuted } = useAppStore.getState()
    setIsMuted(!isMuted)
  })

  // Ctrl+, — Open Settings (requires preventDefault to stop browser default)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key === ',') {
        e.preventDefault()
        navigate('/settings')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  // Escape — Close overlay window (only when electronAPI.window.close is available)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const win = window as unknown as { electronAPI?: { window?: { close?: () => void } } }
        if (win.electronAPI?.window?.close) {
          win.electronAPI.window.close()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return null
}
