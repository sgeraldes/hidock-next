import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './components/providers/ThemeProvider'
import { ToastProvider } from './components/providers/ToastProvider'
import { MiniBarContent } from './components/mini-bar/MiniBarContent'
import './globals.css'

import { initSessionStore, initTranscriptStore } from './stores'

const cleanups = [initSessionStore(), initTranscriptStore()]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <MiniBarContent />
      <ToastProvider />
    </ThemeProvider>
  </StrictMode>,
)

window.addEventListener('beforeunload', () => cleanups.forEach((fn) => fn()))
