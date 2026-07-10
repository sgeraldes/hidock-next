import { useEffect, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout } from '@/components/layout/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SecurityWarningBanner } from '@/components/SecurityWarningBanner'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ToastProvider } from '@/components/ui/toaster'
import { FloatingAssistant } from '@/components/assistant/FloatingAssistant'
import { getHiDockDeviceService } from '@/services/hidock-device'
import { NavigationLogger, initInteractionLogger, initErrorLogger, cleanupQAMonitor } from '@/services/qa-monitor'
import { lazyWithRetry } from '@/lib/lazyWithRetry'
import { useTheme } from '@/hooks/useTheme'
import { ClipboardCapture } from '@/hooks/useClipboardCapture'

// Lazy load all page components for code splitting
// Each page becomes a separate chunk, reducing initial bundle size
const Today = lazyWithRetry(() => import('@/pages/Today'))
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
const ContextGraph = lazyWithRetry(() => import('@/pages/ContextGraph'))

/**
 * Global floating AI assistant — makes the assistant bubble reachable on EVERY
 * page (Today, People, Projects, …), not just the Library.
 *
 * The Library route renders its own assistant inside TriPaneLayout (a floating
 * bubble when placement is `floating`, or a docked pane when `embedded`), so we
 * skip the global mount there to avoid two bubbles. On every other route we mount
 * the floating bubble regardless of the Settings "Chat Placement": `floating`
 * shows the bubble directly, and `embedded` — which has no tri-pane to dock into
 * off-Library — falls back to the same floating bubble rather than showing nothing.
 *
 * FloatingAssistant only renders its children (the Chat) while the overlay is
 * open, so the Chat is not initialized until the user actually opens the bubble.
 */
export function GlobalAssistant(): React.ReactElement | null {
  const location = useLocation()
  // Library owns its assistant (TriPaneLayout) in both placement modes.
  if (location.pathname === '/library') return null
  return (
    <FloatingAssistant title="Assistant">
      <Suspense fallback={<LoadingSpinner message="Loading assistant..." />}>
        <Chat />
      </Suspense>
    </FloatingAssistant>
  )
}

function App(): React.ReactElement {
  // Keep the applied theme reconciled with the persisted preference + OS.
  useTheme()

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
      <ClipboardCapture />
      <SecurityWarningBanner />
      <Layout>
        <NavigationLogger />
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route
            path="/today"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading your day..." />}>
                  <Today />
                </Suspense>
              </ErrorBoundary>
            }
          />
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
          <Route
            path="/context-graph"
            element={
              <ErrorBoundary>
                <Suspense fallback={<LoadingSpinner message="Loading context graph..." />}>
                  <ContextGraph />
                </Suspense>
              </ErrorBoundary>
            }
          />
          {/* Legacy path — the surface was renamed Knowledge Graph → Context Graph. */}
          <Route path="/knowledge-graph" element={<Navigate to="/context-graph" replace />} />
        </Routes>
        {/* Floating AI assistant, reachable on every page except Library (which
            renders its own assistant inside TriPaneLayout). */}
        <GlobalAssistant />
      </Layout>
    </ToastProvider>
  )
}

export default App
