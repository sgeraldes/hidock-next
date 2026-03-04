import { useEffect, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SecurityWarningBanner } from '@/components/SecurityWarningBanner'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ToastProvider } from '@/components/ui/toaster'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { NavigationLogger, initInteractionLogger, initErrorLogger, cleanupQAMonitor } from '@/services/qa-monitor'
import { lazyWithRetry } from '@/lib/lazyWithRetry'

// Lazy load all page components for code splitting
// Each page becomes a separate chunk, reducing initial bundle size
const Calendar = lazyWithRetry(() => import('@/pages/Calendar'))
const MeetingDetail = lazyWithRetry(() => import('@/pages/MeetingDetail'))
const Chat = lazyWithRetry(() => import('@/pages/Chat'))
const Explore = lazyWithRetry(() => import('@/pages/Explore'))
const Device = lazyWithRetry(() => import('@/pages/Device'))
const Library = lazyWithRetry(() => import('@/pages/Library'))
const People = lazyWithRetry(() => import('@/pages/People'))
const PersonDetail = lazyWithRetry(() => import('@/pages/PersonDetail'))
const Projects = lazyWithRetry(() => import('@/pages/Projects'))
const Actionables = lazyWithRetry(() => import('@/pages/Actionables'))
const Settings = lazyWithRetry(() => import('@/pages/Settings'))

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
        // Release USB interface before window closes.
        // disconnect() only sets session state — config.autoConnect is preserved.
        deviceService.disconnect()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    // Cleanup: runs on React StrictMode double-mount AND on real unmount.
    // IMPORTANT: Do NOT call disconnect() here.
    //
    // App is the top-level component — it never unmounts during normal navigation.
    // The cleanup runs in two cases:
    //   1. React StrictMode double-mount (dev): fires almost immediately after
    //      the effect, while auto-connect's handleConnect() may have already set
    //      state.connected=true but USB initialization is still in-flight. Calling
    //      disconnect() here calls releaseInterface(0) which cancels the pending
    //      transferIn with AbortError, breaking the entire connection sequence.
    //   2. Real page unload (reload/close): handleBeforeUnload already handles
    //      USB release via the 'beforeunload' event registered above.
    //
    // USB release is handled by:
    //   - handleBeforeUnload: real page close/reload
    //   - Device.tsx handleDisconnect: user explicitly clicks Disconnect
    return () => {
      cleanupQAMonitor()
      deviceService.stopAutoConnect()
      // Reset the init guard so initAutoConnect() can run again after renderer reload.
      deviceService.resetInitAutoConnect()
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  return (
    <ToastProvider>
      <SecurityWarningBanner />
      <Layout>
        <NavigationLogger />
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route
            path="/calendar"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading calendar..." />}>
                  <Calendar />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/meeting/:id"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading meeting..." />}>
                  <MeetingDetail />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/assistant"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading assistant..." />}>
                  <Chat />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/explore"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading explore..." />}>
                  <Explore />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/sync"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading device sync..." />}>
                  <Device />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/library"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading library..." />}>
                  <Library />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/people"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading people..." />}>
                  <People />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/person/:id"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading person details..." />}>
                  <PersonDetail />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/projects"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading projects..." />}>
                  <Projects />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/actionables"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading actionables..." />}>
                  <Actionables />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="/settings"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading settings..." />}>
                  <Settings />
                </Suspense>
              </ErrorBoundary>
            }
          />
        </Routes>
      </Layout>
    </ToastProvider>
  )
}

export default App
