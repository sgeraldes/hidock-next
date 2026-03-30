import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './components/providers/ThemeProvider'
import { OverlayContent } from './components/overlay/OverlayContent'
import './globals.css'

import { initTranscriptStore, initSuggestionStore } from './stores'

const cleanups = [initTranscriptStore(), initSuggestionStore()]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <OverlayContent />
    </ThemeProvider>
  </StrictMode>,
)

window.addEventListener('beforeunload', () => cleanups.forEach((fn) => fn()))
