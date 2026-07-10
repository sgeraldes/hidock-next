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
import { initializeDatabase, closeDatabase } from './services/database'
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
  startTranscriptionProcessor,
  stopTranscriptionProcessor,
  setMainWindowForTranscription
} from './services/transcription'
import { getVectorStore } from './services/vector-store'
import { getRAGService } from './services/rag'
import { setMainWindowForEventBus } from './services/event-bus'
import { getStoragePolicyService } from './services/storage-policy'
import { setMainWindowForMigration } from './ipc/migration-handlers'
import { getIntegrityService } from './services/integrity-service'
import { acquireSingleInstanceLock } from './single-instance'
import { registerBootTask, startBootScheduler } from './services/boot-scheduler'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

// Inline splash HTML to avoid build complexity
const SPLASH_HTML = "<!DOCTYPE html>\n<html><head><meta charset=\"UTF-8\"><title>Meeting Intelligence</title>\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#e8e8e8;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;-webkit-app-region:drag;user-select:none}\n.logo{font-size:22px;font-weight:600;margin-bottom:24px;color:#fff;text-align:center;max-width:300px}\n.spinner{width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);border-top-color:#4f8cff;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:20px}\n@keyframes spin{to{transform:rotate(360deg)}}\n.status{font-size:13px;color:#a0a0a0;text-align:center;max-width:280px;min-height:40px}\n.progress-container{width:200px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin:16px 0;overflow:hidden}\n.progress-bar{height:100%;background:#4f8cff;border-radius:2px;transition:width 0.3s ease;width:0%}\n.cancel-btn{-webkit-app-region:no-drag;margin-top:24px;padding:8px 20px;background:transparent;border:1px solid rgba(255,255,255,0.2);color:#a0a0a0;border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s}\n.cancel-btn:hover{background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.3);color:#fff}\n</style></head>\n<body>\n<div class=\"logo\">Meeting Intelligence</div>\n<div class=\"spinner\"></div>\n<div class=\"progress-container\"><div class=\"progress-bar\" id=\"progress\"></div></div>\n<div class=\"status\" id=\"status\">Initializing...</div>\n<button class=\"cancel-btn\" id=\"cancelBtn\">Cancel</button>\n<script>\nconst statusEl=document.getElementById('status');\nconst progressEl=document.getElementById('progress');\nconst cancelBtn=document.getElementById('cancelBtn');\nwindow.electronAPI?.onSplashStatus?.((status,progress)=>{statusEl.textContent=status;if(progress!==undefined)progressEl.style.width=progress+'%';});\ncancelBtn.addEventListener('click',()=>{window.electronAPI?.quitApp?.();});\n</script>\n</body></html>"

function createSplashWindow(): BrowserWindow {
  console.log('[Splash] Creating splash window...')
  const splash = new BrowserWindow({
    width: 340,
    height: 280,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: true, // Show immediately
    backgroundColor: '#1a1a2e', // Match splash background to avoid flash
    webPreferences: {
      preload: join(__dirname, '../preload/splash.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML))
  console.log('[Splash] Window created and loading content')
  return splash
}

function updateSplashStatus(status: string, progress?: number): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:status', status, progress)
  }
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
    splashWindow = null
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
  // The overlay height MUST match the TitleBar height (TITLEBAR_HEIGHT = 40px).
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
            color: '#0f172a', // slate-900 — matches TitleBar background
            symbolColor: '#e2e8f0', // slate-200 — matches TitleBar icon color
            height: 40
          }
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    closeSplash()
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Initialize services with splash screen progress updates
async function initializeServices(): Promise<void> {
  console.log('Initializing services...')

  updateSplashStatus('Loading configuration...', 10)
  await initializeConfig()
  console.log('Config initialized')

  updateSplashStatus('Setting up storage...', 20)
  await initializeFileStorage()
  console.log('File storage initialized')

  updateSplashStatus('Initializing database...', 30)
  await initializeDatabase()
  console.log('Database initialized')

  updateSplashStatus('Checking data integrity...', 40)
  const integrityService = getIntegrityService()
  const integrityResult = await integrityService.runStartupChecks()
  if (integrityResult.issuesFound > 0) {
    console.log(`Integrity checks: ${integrityResult.issuesFixed}/${integrityResult.issuesFound} issues fixed`)
  }

  updateSplashStatus('Initializing search index...', 60)
  const vectorStore = getVectorStore()
  await vectorStore.initialize()
  console.log('Vector store initialized')

  updateSplashStatus('Starting AI services...', 75)
  const rag = getRAGService()
  await rag.initialize()
  console.log('RAG service initialized')

  updateSplashStatus('Finalizing setup...', 90)
  getStoragePolicyService()
  console.log('Storage policy service initialized')

  registerIpcHandlers()
  console.log('IPC handlers registered')

  // Living knowledge graph (v27): subscribe graph-sync to entity events now, so
  // renames/merges and finished transcripts keep the graph in step. DB-only +
  // debounced ingest; guarded so it can never break the pipeline.
  import('./services/graph-sync')
    .then(({ startGraphSync }) => startGraphSync())
    .catch((e) => console.error('[GraphSync] startup wiring failed:', e))

  // Gate USB hot-plug auto-connect on the user's "Auto-connect on startup"
  // preference. Without this the device reconnects on every power-on / plug-in
  // regardless of the toggle. Manual "Connect Device" is unaffected.
  setAutoConnectChecker(() => getConfig().device.autoConnect === true)

  // CS-010: Initialize calendar auto-sync after IPC handlers and DB are ready
  initializeCalendarAutoSync()

  // Connectors (Layer 2): build the host + attempt silent (non-interactive)
  // resume for connectors that already have credentials. Never launches an
  // interactive sign-in on startup; failures are best-effort.
  import('./services/connectors')
    .then(({ initConnectors }) => initConnectors())
    .catch((e) => console.error('[Connectors] startup wiring failed:', e))

  updateSplashStatus('Starting application...', 100)
}

// Single-instance guard — MUST run before any window is created and before the
// database is opened. With better-sqlite3 + WAL against one on-disk file, a
// second concurrent main process running migrations / repair / self-heal
// backfill / VACUUM is a data-integrity and lock-contention hazard (WAL allows
// concurrent readers, not two independent app boots each mutating schema). If
// another instance already owns the lock, acquireSingleInstanceLock() calls
// app.quit() and returns false; we then skip all boot so this process never
// touches the DB.
const hasSingleInstanceLock = acquireSingleInstanceLock({
  getMainWindow: () => mainWindow,
  getSplashWindow: () => splashWindow
})

// Disable WebUSB blocklist to allow HiDock device access
// Required since Electron 37+ which introduced Chromium's WebUSB blocklist
// Without this, devices on the blocklist get "Access denied" errors
app.commandLine.appendSwitch('disable-usb-blocklist')

// Suppress Chromium-level USB/device enumeration noise on Windows
// (usb_service_win.cc SetupDiGetDeviceProperty errors for non-HiDock devices — harmless)
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-usb-device-event-log')
  // Suppress device_event_log severity to FATAL-only (3) to hide USB enumeration errors
  app.commandLine.appendSwitch('device-event-log-level', '3')
}

// Conditionally enable remote debugging (dev mode or explicit opt-in)
const enableRemoteDebugging = is.dev || process.env.ENABLE_REMOTE_DEBUGGING === 'true'
if (enableRemoteDebugging) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
  console.warn('[SECURITY] Remote debugging enabled on port 9222')
}

app.whenReady().then(async () => {
  // A non-primary instance already called app.quit() in the single-instance
  // guard above. Bail before creating any window or opening the DB, even if the
  // 'ready' event still races the pending quit — this process must never touch
  // the shared database file.
  if (!hasSingleInstanceLock) return

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.hidock.meeting-intelligence')

  // Show splash screen immediately
  splashWindow = createSplashWindow()

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
  }

  // The recording watcher is cheap and powers auto-refresh — start it now.
  startRecordingWatcher()
  console.log('Recording watcher started')

  // ---------------------------------------------------------------------------
  // Deferred heavy boot work — spread out, not bursted.
  //
  // ROOT CAUSE of the post-restart freeze: on a large DB these tasks used to
  // fire together right after the window showed (the transcription backlog drain
  // plus five overlapping setTimeout backfills at 8–20s, plus the living-graph
  // ingest they trigger). All of it is synchronous sql.js work on the single
  // main-process event loop, so it starved the renderer's IPC → "not responding"
  // with high CPU for a while.
  //
  // Fix: register them on the boot scheduler, which runs them ONE AT A TIME with
  // idle gaps in between (concurrency cap = 1) and only AFTER the renderer has
  // painted. The same work still runs — just spread out so the UI stays live.
  // Ordered cheapest/most-user-visible DB self-heals first; the sustained
  // network-bound drains (transcription, embeddings) last so first paint and the
  // initial library load are not competing for the event loop.
  // ---------------------------------------------------------------------------

  // 1. Reconcile organization data (meeting↔recording links, People from
  //    attendees, ICS text repair, ~1,521-row status self-heal). DB-only, idempotent.
  registerBootTask({
    name: 'org-reconcile',
    run: async () => {
      await import('./services/org-reconciler')
        .then(({ reconcileOrganization }) => reconcileOrganization())
        .catch((e) => console.error('[OrgReconciler] error:', e))
    }
  })

  // 2. Self-heal the Knowledge Library: create a knowledge_capture for any
  //    transcript that lacks one. Cheap, DB-only, idempotent.
  registerBootTask({
    name: 'knowledge-capture-backfill',
    run: async () => {
      await import('./services/knowledge-capture-backfill')
        .then(({ backfillKnowledgeCaptures }) => backfillKnowledgeCaptures())
        .catch((e) => console.error('[KnowledgeCaptureBackfill] error:', e))
    }
  })

  // 3. Backfill the plain-markdown meeting wiki (no API calls — DB → files).
  registerBootTask({
    name: 'meeting-wiki-backfill',
    run: async () => {
      await import('./services/meeting-wiki')
        .then(({ backfillMeetingWiki }) => backfillMeetingWiki())
        .catch((e) => console.error('[MeetingWiki] Backfill error:', e))
    }
  })

  // 4. Start the transcription processor. This returns promptly (it arms the
  //    10s interval and kicks a first pass); the backlog drain then runs in the
  //    background, mutex-gated to one item at a time. Deferred to here so the
  //    240-item drain does not compete with first paint + the library load.
  //    NOTE: correctness and the queue's newest-first order are unchanged — only
  //    WHEN the processor starts moved.
  registerBootTask({
    name: 'start-transcription-processor',
    run: () => {
      startTranscriptionProcessor()
    }
  })

  // 5. Backfill vector embeddings for transcripts indexed before embeddings
  //    worked (or added while the app was closed). Network-bound, per-item.
  registerBootTask({
    name: 'embeddings-backfill',
    run: () =>
      import('./services/vector-store')
        .then(async ({ getVectorStore }) => {
          const store = getVectorStore()
          await store.initialize()
          await store.backfillMissingTranscripts()
        })
        .catch((e) => console.error('[VectorStore] Backfill error:', e))
  })

  // 6. Self-heal transcripts whose Gemini analysis failed (or was never run on an
  //    older build) by re-analysing the stored full_text. Bounded per run.
  registerBootTask({
    name: 'reanalyze-failed-transcripts',
    run: async () => {
      await import('./services/transcription')
        .then(({ reanalyzeFailedTranscripts }) => reanalyzeFailedTranscripts())
        .catch((e) => console.error('[Reanalyze] Backfill error:', e))
    }
  })

  // Kick the scheduler once the renderer has painted its first frame, so heavy
  // work never competes with first paint / the initial library IPC. A fallback
  // timer covers the rare case where 'did-finish-load' never fires (load error);
  // startBootScheduler is idempotent, so whichever fires first wins.
  const kickBootScheduler = (): void => {
    startBootScheduler().catch((e) => console.error('[BootScheduler] error:', e))
  }
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', kickBootScheduler)
  }
  setTimeout(kickBootScheduler, 30000)

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
