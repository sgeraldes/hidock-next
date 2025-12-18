import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Calendar } from '@/pages/Calendar'
import { MeetingDetail } from '@/pages/MeetingDetail'
import { Chat } from '@/pages/Chat'
import { Search } from '@/pages/Search'
import { Device } from '@/pages/Device'
import { Recordings } from '@/pages/Recordings'
import { Settings } from '@/pages/Settings'
import { Contacts } from '@/pages/Contacts'
import { Projects } from '@/pages/Projects'
import { Outputs } from '@/pages/Outputs'
import { ToastProvider } from '@/components/ui/toaster'
import { getHiDockDeviceService } from '@/services/hidock-device'

function App(): React.ReactElement {
  // Initialize auto-connect on app startup (if enabled in config)
  useEffect(() => {
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
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/meeting/:id" element={<MeetingDetail />} />
          <Route path="/assistant" element={<Chat />} />
          <Route path="/explore" element={<Search />} />
          <Route path="/sync" element={<Device />} />
          <Route path="/library" element={<Recordings />} />
          <Route path="/people" element={<Contacts />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/actionables" element={<ErrorBoundary><Outputs /></ErrorBoundary>} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </ToastProvider>
  )
}

export default App
