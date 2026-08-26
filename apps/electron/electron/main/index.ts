import { app, shell, BrowserWindow, session, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// HiDock USB Vendor/Product IDs
// Source: Official HiDock HiNotes jensen.js (December 2025)
const USB_VENDOR_IDS = [
  0x10d6, // Actions Semiconductor (older H1, H1E, P1 devices)
  0x3887  // HiDock (newer P1 Mini devices)
]
const USB_PRODUCT_IDS = [
  0xaf0c,  // H1
  0xaf0d,  // H1E
  0xb00d,  // H1E (alternate)
  0xaf0e,  // P1
  0xb00e,  // P1 (alternate)
  0xaf0f,  // P1 Mini
  0x2041   // P1 Mini (alternate)
]
import { initializeDatabase, closeDatabase, isGraphProvenanceCleanupRegistered } from './services/database'
import { initializeConfig, getConfig } from './services/config'
import { setAutoConnectChecker } from './services/jensen'
import { initializeFileStorage } from './services/file-storage'
import { registerIpcHandlers } from './ipc/handlers'
import { stopAutoSync, initializeCalendarAutoSync } from './ipc/calendar-handlers'
import {
  startRecordingWatcher,
  stopRecordingWatcher,
  setMainWindow as setWatcherMainWindow
} from './services/recording-watcher'
import {
  stopTranscriptionProcessor,
  setMainWindowForTranscription
} from './services/transcription'
import { setMainWindowForEventBus } from './services/event-bus'
import { getStoragePolicyService } from './services/storage-policy'
import { setMainWindowForMigration } from './ipc/migration-handlers'
import { setMainWindowForValueBackfill } from './services/value-backfill'
import { acquireSingleInstanceLock } from './single-instance'
import { startBootScheduler } from './services/boot-scheduler'
import { registerGatedBootTasks } from './services/boot-tasks'
import { isFeatureEnabled, captureBootEffectiveFeatures } from './services/feature-gate'
import { createSplashWindow } from './splash-screen'
import { configureEarlyStartup } from './startup-configuration'
import { getStartupState } from './startup-state'
import { revealMainWindow, type WindowRevealReason } from './window-reveal'

const startup = getStartupState()
configureEarlyStartup() // idempotent fallback when this module is launched directly in tests/tools
const runtimeDir = startup.runtimeDir ?? __dirname
let mainWindow: BrowserWindow | null = startup.mainWindow
let splashWindow: BrowserWindow | null = startup.splashWindow
let mainWindowReveal: Promise<WindowRevealReason | null> | null = null

async function updateSplashStatus(status: string, progress?: number): Promise<void> {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:status', status, progress)
    // Let the IPC flush and the splash PAINT before whatever heavy (often
    // synchronous) work follows. A fire-and-forget send queues behind a
    // blocked event loop — that was the blank-splash boot freeze: the
    // 'Initializing search index…' update only rendered AFTER the vector
    // store's multi-second sync load had already run.
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
    splashWindow = null
    startup.splashWindow = null
  }
}

// Handle quit request from splash window
ipcMain.on('splash:quit', () => {
  app.quit()
})

function createWindow(): void {
  const isMac = process.platform === 'darwin'

  // Office-365-style unified titlebar: the native window controls render OVER our
  // custom React titlebar (src/components/layout/TitleBar.tsx).
  //  - Windows/Linux: 'hidden' + titleBarOverlay draws native min/max/close in the
  //    top-right, tinted to match our dark titlebar chrome (slate-900 / slate-200).
  //  - macOS: 'hiddenInset' keeps the traffic lights top-left; TitleBar reserves
  //    left padding for them.
  // The overlay height MUST match the TitleBar height (h-14 = 56px), and the
  // overlay color MUST match the TitleBar's solid background (#0f1626) so the
  // flat native-controls gutter blends seamlessly into the bar (no visible seam).
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 15, y: 13 },
    ...(isMac
      ? {}
      : {
          titleBarOverlay: {
            color: '#0f1626', // matches TitleBar solid background (bg-[#0f1626])
            symbolColor: '#e2e8f0', // slate-200 — matches TitleBar icon color
            height: 56
          }
        }),
    webPreferences: {
      preload: join(runtimeDir, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  startup.mainWindow = mainWindow

  mainWindowReveal = revealMainWindow(mainWindow, {
    closeSplash,
    log: (message) => console.log(message),
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(runtimeDir, '../renderer/index.html'))
  }
}

// Initialize services with splash screen progress updates
async function initializeServices(): Promise<void> {
  console.log('Initializing services...')

  await updateSplashStatus('Loading configuration...', 10)
  await initializeConfig()
  console.log('Config initialized')

  // Track I (Review-2 [CRITICAL]): snapshot the effective feature state from the
  // desired config NOW, before any IPC handlers register or any USB path can run.
  // Restart-gated features (device-sync, assistant) are pinned to this snapshot
  // for the IPC gate, so enabling them at runtime cannot open their IPC until the
  // next boot — the USB safety boundary.
  captureBootEffectiveFeatures()

  await updateSplashStatus('Setting up storage...', 20)
  await initializeFileStorage()
  console.log('File storage initialized')

  await updateSplashStatus('Initializing database...', 30)
  await initializeDatabase()
  console.log('Database initialized')

  // The semantic index can exceed 2 GB. It is restored after the renderer's
  // first paint by the assistant boot task, so opening the library never waits
  // minutes for optional search infrastructure. RAG status remains honestly
  // not-ready until that task has populated the in-memory store.
  await updateSplashStatus('Finalizing setup...', 60)
  getStoragePolicyService()
  console.log('Storage policy service initialized')

  registerIpcHandlers()
  console.log('IPC handlers registered')

  // spec-006/F17 T6 AR3-1 — loud startup tripwire. registerRecordingDeletionHandlers()
  // (called from registerIpcHandlers() above) wires the graph-provenance
  // cleanup seam as a side effect of registration; the hard-purge branch
  // itself already fails closed if this is ever skipped (a refactor that
  // reorders registration, an early throw, etc.), but that failure would
  // otherwise only surface the next time a user tries to permanently delete
  // something. Converts a silent wiring regression into a loud boot error.
  if (!isGraphProvenanceCleanupRegistered()) {
    console.error(
      '[startup] graph provenance cleanup NOT wired — permanent deletes will leak graph residue'
    )
  }

  // Living knowledge graph (v27): subscribe graph-sync to entity events now, so
  // renames/merges and finished transcripts keep the graph in step. DB-only +
  // debounced ingest; guarded so it can never break the pipeline.
  // Track I: gated on the Context Graph feature (skipped under library-only).
  if (isFeatureEnabled('context-graph')) {
    import('./services/graph-sync')
      .then(({ startGraphSync }) => startGraphSync())
      .catch((e) => console.error('[GraphSync] startup wiring failed:', e))
  }

  // Gate USB hot-plug auto-connect on the user's "Auto-connect on startup"
  // preference. Without this the device reconnects on every power-on / plug-in
  // regardless of the toggle. Manual "Connect Device" is unaffected.
  // Track I: additionally requires the Device Sync feature. Auto-connect is an
  // INITIATION path (round-3 partition): isFeatureEnabled('device-sync') is
  // boot-enabled AND desired-enabled, so a live disable stops hot-plug
  // auto-connect immediately, while boot-disabled keeps it off regardless of a
  // live enable (USB safety — activation only across a reboot). Teardown /
  // observation IPC stays reachable via the boot-only half of the gate.
  setAutoConnectChecker(
    () => getConfig().device.autoConnect === true && isFeatureEnabled('device-sync')
  )

  // CS-010: Initialize calendar auto-sync after IPC handlers and DB are ready.
  // Track I: gated on the Calendar feature (skipped under library-only).
  if (isFeatureEnabled('calendar')) {
    initializeCalendarAutoSync()
  }

  // Connectors (Layer 2): build the host + attempt silent (non-interactive)
  // resume for connectors that already have credentials. Never launches an
  // interactive sign-in on startup; failures are best-effort.
  import('./services/connectors')
    .then(({ initConnectors }) => initConnectors())
    .catch((e) => console.error('[Connectors] startup wiring failed:', e))

  await updateSplashStatus('Starting application...', 100)
}

// Single-instance guard — MUST run before any window is created and before the
// database is opened. With better-sqlite3 + WAL against one on-disk file, a
// second concurrent main process running migrations / repair / self-heal
// backfill / VACUUM is a data-integrity and lock-contention hazard (WAL allows
// concurrent readers, not two independent app boots each mutating schema). If
// another instance already owns the lock, acquireSingleInstanceLock() calls
// app.quit() and returns false; we then skip all boot so this process never
// touches the DB.
const hasSingleInstanceLock = startup.hasSingleInstanceLock ?? acquireSingleInstanceLock({
  getMainWindow: () => mainWindow,
  getSplashWindow: () => splashWindow
})

// BUG-R6 / BUG-R7 — accepted cosmetic stderr noise (documented decision, NOT a bug):
//
//   R6: residual "SetupDiGetDeviceProperty" USB enumeration errors from
//       usb_service_win.cc, and R7: "Request Autofill.enable/setAddresses failed"
//       DevTools-protocol errors when DevTools is open (Electron's CDP backend does
//       not implement the Autofill domain).
//
// Both are written to stderr by native Chromium/DevTools code (fd 2), NOT via the
// JS console. A JS-level filter (monkey-patching process.stderr.write) cannot catch
// native writes, and raising the global Chromium --log-level would also hide genuine
// errors — so there is no safe in-process suppression.
//
// R6 root cause CONFIRMED (not just believed) via Chromium source
// (components/device_event_log/device_event_log_impl.cc): usb_service_win.cc logs
// these via USB_PLOG(ERROR), and device_event_log's AddLogEntry() unconditionally
// escalates LOG_LEVEL_ERROR entries to LOG(ERROR) (stderr) regardless of the
// configured --device-event-log-level threshold —
// `if (log_entry.log_level != LOG_LEVEL_ERROR && !VLOG_IS_ON(1)) return;` skips the
// gate entirely for ERROR-severity entries. No value of --device-event-log-level or
// --disable-usb-device-event-log can suppress an ERROR-level entry; the switches
// above only affect USER/EVENT/DEBUG-level entries. There is no switch-level fix.
//
// The switches above are the clean mechanism and cover most of the USB noise;
// anything that still leaks can only be filtered by redirecting the Electron child's
// stderr in the dev launcher (dev-only concern). We therefore ACCEPT the remaining
// lines as cosmetic rather than adding a risky filter. See
// docs/specs/2026-03-25-remaining-bugs.md (BUG-R6, BUG-R7).

app.whenReady().then(async () => {
  // A non-primary instance already called app.quit() in the single-instance
  // guard above. Bail before creating any window or opening the DB, even if the
  // 'ready' event still races the pending quit — this process must never touch
  // the shared database file.
  if (!hasSingleInstanceLock) return

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.hidock.meeting-intelligence')

  // Show splash screen immediately
  // Do not start service initialization until the splash preload and first DOM
  // frame exist; otherwise the first progress IPC messages are lost and the
  // user sees a grey/zero-progress gap.
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = await createSplashWindow(join(runtimeDir, '../preload/splash.js'))
    startup.splashWindow = splashWindow
  }

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Handle WebUSB device selection - this is REQUIRED for Electron
  session.defaultSession.on('select-usb-device', (_event, details, callback) => {
    console.log('=== USB DEVICE SELECTION ===')
    console.log('Available devices:', details.deviceList.map(d => ({
      vendorId: d.vendorId.toString(16),
      productId: d.productId.toString(16),
      productName: d.productName
    })))

    const hidockDevice = details.deviceList.find(
      (device) =>
        USB_VENDOR_IDS.includes(device.vendorId) &&
        (USB_PRODUCT_IDS.includes(device.productId) ||
          device.productName?.toLowerCase().includes('hidock'))
    )

    if (hidockDevice) {
      console.log('Auto-selecting HiDock device:', hidockDevice.productName)
      callback(hidockDevice.deviceId)
    } else if (details.deviceList.length > 0) {
      const vendorDevice = details.deviceList.find(d => USB_VENDOR_IDS.includes(d.vendorId))
      if (vendorDevice) {
        console.log('Auto-selecting vendor device:', vendorDevice.productName)
        callback(vendorDevice.deviceId)
      } else {
        console.log('No matching device found')
        callback()
      }
    } else {
      console.log('No USB devices available')
      callback()
    }
  })

  session.defaultSession.setPermissionCheckHandler(() => {
    return true
  })

  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'usb') {
      return true
    }
    return false
  })

  // Allow all USB protected classes - required for some USB devices that use
  // protected USB classes (like audio, HID, mass storage, etc.)
  // This fixes "Unable to claim interface" errors on Windows
  session.defaultSession.setUSBProtectedClassesHandler(() => {
    // Return empty array to protect nothing (allow all classes)
    // This is necessary for HiDock devices which may use protected USB classes
    return []
  })

  // Initialize all services before creating window (shows progress in splash)
  await initializeServices()

  createWindow()

  if (mainWindow) {
    setWatcherMainWindow(mainWindow)
    setMainWindowForTranscription(mainWindow)
    setMainWindowForEventBus(mainWindow)
    setMainWindowForMigration(mainWindow)
    setMainWindowForValueBackfill(mainWindow)
  }

  // The recording watcher is cheap and powers auto-refresh — start it now.
  startRecordingWatcher()
  console.log('Recording watcher started')

  // ---------------------------------------------------------------------------
  // Deferred bounded boot work.
  //
  // ROOT CAUSE of the post-restart freeze: on a large DB these tasks used to
  // fire together right after the window showed (the transcription backlog drain
  // plus five overlapping setTimeout backfills at 8–20s, plus the living-graph
  // ingest they trigger). All of it is synchronous sql.js work on the single
  // main-process event loop, so it starved the renderer's IPC → "not responding"
  // with high CPU for a while.
  //
  // Fix: register bounded local work on the boot scheduler, which runs tasks ONE
  // AT A TIME with idle gaps (concurrency cap = 1) and only AFTER the renderer is
  // visible. Provider-backed corpus sweeps are deliberately not boot tasks;
  // startup must reach a terminal state rather than becoming a hidden
  // maintenance session.
  // ---------------------------------------------------------------------------

  // Register the deferred heavy boot tasks, GATED by feature (Track I): a task
  // whose owning feature is disabled by the active preset is simply never queued.
  // Under the default `full` preset every bounded task registers. The
  // definitions + gating live in services/boot-tasks.ts (unit-tested there):
  //   org-reconcile (calendar), knowledge-capture-backfill (library floor),
  //   meeting-wiki-backfill (meeting-intelligence), start-transcription-processor
  //   (transcription), semantic-index-restore (assistant). Provider-backed repair
  //   sweeps are explicit maintenance actions, not unbounded boot work.
  registerGatedBootTasks()

  // The scheduler may start ONLY after the native main window is visible and
  // the splash is closed. `did-finish-load` alone is too early: it previously
  // launched a 52s vector restore while the main window was still hidden, then
  // starved the `ready-to-show` handler and left the 100% splash up forever.
  // revealMainWindow() also owns the bounded reveal fallback, so there is no
  // background-work timer capable of firing behind a stuck splash.
  const reveal = mainWindowReveal
  if (reveal) {
    void reveal.then((reason) => {
      if (!reason) return
      startBootScheduler().catch((e) => console.error('[BootScheduler] error:', e))
    })
  }

  console.log('Background services scheduled')

  // Show security warning in production when remote debugging is explicitly enabled
  if (!is.dev && process.env.ENABLE_REMOTE_DEBUGGING === 'true' && mainWindow) {
    // Wait for window to be ready before sending the warning
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.send('security-warning', {
        type: 'remote-debugging-enabled',
        message: 'Remote debugging is enabled. This should only be used for troubleshooting.'
      })
    })
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAutoSync() // B-CAL-002: Clean up calendar auto-sync interval
  stopRecordingWatcher()
  stopTranscriptionProcessor()
  closeDatabase()
  console.log('Cleanup complete')
})
