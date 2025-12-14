import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
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

    // Cleanup on unmount (shouldn't happen for App, but good practice)
    return () => {
      deviceService.stopAutoConnect()
    }
  }, [])

  return (
    <ToastProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/calendar" replace />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/meeting/:id" element={<MeetingDetail />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/search" element={<Search />} />
          <Route path="/device" element={<Device />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/outputs" element={<Outputs />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </ToastProvider>
  )
}

export default App
