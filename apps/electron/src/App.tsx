import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Calendar } from '@/pages/Calendar'
import { MeetingDetail } from '@/pages/MeetingDetail'
import { Chat } from '@/pages/Chat'
import { Explore } from '@/pages/Explore'
import { Device } from '@/pages/Device'
import { Library } from '@/pages/Library'
import { People } from '@/pages/People'
import { PersonDetail } from '@/pages/PersonDetail'
import { Projects } from '@/pages/Projects'
import { Actionables } from '@/pages/Actionables'
import { Settings } from '@/pages/Settings'
import { ToastProvider } from '@/components/ui/toaster'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { NavigationLogger, initInteractionLogger, initErrorLogger } from '@/services/qa-monitor'

function App(): React.ReactElement {
  // Initialize QA monitoring and auto-connect
  useEffect(() => {
    // Initialize QA Monitoring
    initInteractionLogger();
    initErrorLogger();

    const deviceService = getHiDockDeviceService()
    deviceService.initAutoConnect()

    // Critical: Disconnect device when window closes to release USB interface
    // Without this, the device stays "in use" and subsequent connections fail
    const handleBeforeUnload = () => {
      if (deviceService.isConnected()) {
        // Use synchronous disconnect to ensure it completes before window closes
        deviceService.disconnect()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    // Cleanup on unmount (shouldn't happen for App, but good practice)
    return () => {
      deviceService.stopAutoConnect()
      window.removeEventListener('beforeunload', handleBeforeUnload)
      // Also disconnect on unmount
      if (deviceService.isConnected()) {
        deviceService.disconnect()
      }
    }
  }, [])

  return (
    <ToastProvider>
      <Layout>
        <NavigationLogger />
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/calendar" element={<ErrorBoundary><Calendar /></ErrorBoundary>} />
          <Route path="/meeting/:id" element={<ErrorBoundary><MeetingDetail /></ErrorBoundary>} />
          <Route path="/assistant" element={<ErrorBoundary><Chat /></ErrorBoundary>} />
          <Route path="/explore" element={<ErrorBoundary><Explore /></ErrorBoundary>} />
          <Route path="/sync" element={<ErrorBoundary><Device /></ErrorBoundary>} />
          <Route path="/library" element={<ErrorBoundary><Library /></ErrorBoundary>} />
          <Route path="/people" element={<ErrorBoundary><People /></ErrorBoundary>} />
          <Route path="/person/:id" element={<ErrorBoundary><PersonDetail /></ErrorBoundary>} />
          <Route path="/projects" element={<ErrorBoundary><Projects /></ErrorBoundary>} />
          <Route path="/actionables" element={<ErrorBoundary><Actionables /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
        </Routes>
      </Layout>
    </ToastProvider>
  )
}

export default App
