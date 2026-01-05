import { app, shell, BrowserWindow, session, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// HiDock USB Vendor/Product IDs
const USB_VENDOR_ID = 0x10d6 // Actions Semiconductor
const USB_PRODUCT_IDS = [0xaf0c, 0xaf0d, 0xb00d, 0xaf0e, 0xb00e]
import { initializeDatabase, closeDatabase } from './services/database'
import { initializeConfig } from './services/config'
import { initializeFileStorage } from './services/file-storage'
import { registerIpcHandlers } from './ipc/handlers'
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

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

// Inline splash HTML to avoid build complexity
const SPLASH_HTML = "<!DOCTYPE html>\n<html><head><meta charset=\"UTF-8\"><title>HiDock</title>\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\nbody{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#e8e8e8;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;-webkit-app-region:drag;user-select:none}\n.logo{font-size:28px;font-weight:600;margin-bottom:24px;color:#fff}\n.spinner{width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);border-top-color:#4f8cff;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:20px}\n@keyframes spin{to{transform:rotate(360deg)}}\n.status{font-size:13px;color:#a0a0a0;text-align:center;max-width:280px;min-height:40px}\n.progress-container{width:200px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin:16px 0;overflow:hidden}\n.progress-bar{height:100%;background:#4f8cff;border-radius:2px;transition:width 0.3s ease;width:0%}\n.cancel-btn{-webkit-app-region:no-drag;margin-top:24px;padding:8px 20px;background:transparent;border:1px solid rgba(255,255,255,0.2);color:#a0a0a0;border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s}\n.cancel-btn:hover{background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.3);color:#fff}\n</style></head>\n<body>\n<div class=\"logo\">HiDock</div>\n<div class=\"spinner\"></div>\n<div class=\"progress-container\"><div class=\"progress-bar\" id=\"progress\"></div></div>\n<div class=\"status\" id=\"status\">Initializing...</div>\n<button class=\"cancel-btn\" id=\"cancelBtn\">Cancel</button>\n<script>\nconst statusEl=document.getElementById('status');\nconst progressEl=document.getElementById('progress');\nconst cancelBtn=document.getElementById('cancelBtn');\nwindow.electronAPI?.onSplashStatus?.((status,progress)=>{statusEl.textContent=status;if(progress!==undefined)progressEl.style.width=progress+'%';});\ncancelBtn.addEventListener('click',()=>{window.electronAPI?.quitApp?.();});\n</script>\n</body></html>"

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 340,
    height: 280,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/splash.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML))
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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
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

  updateSplashStatus('Starting application...', 100)
}

app.commandLine.appendSwitch('remote-debugging-port', '9222')

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.hidock.meeting-intelligence')

  // Enable remote debugging for MCP tools
  app.commandLine.appendSwitch('remote-debugging-port', '9222')

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
        device.vendorId === USB_VENDOR_ID &&
        (USB_PRODUCT_IDS.includes(device.productId) ||
          device.productName?.toLowerCase().includes('hidock'))
    )

    if (hidockDevice) {
      console.log('Auto-selecting HiDock device:', hidockDevice.productName)
      callback(hidockDevice.deviceId)
    } else if (details.deviceList.length > 0) {
      const vendorDevice = details.deviceList.find(d => d.vendorId === USB_VENDOR_ID)
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

  // Initialize all services before creating window (shows progress in splash)
  await initializeServices()

  createWindow()

  if (mainWindow) {
    setWatcherMainWindow(mainWindow)
    setMainWindowForTranscription(mainWindow)
    setMainWindowForEventBus(mainWindow)
    setMainWindowForMigration(mainWindow)
  }

  startRecordingWatcher()
  startTranscriptionProcessor()
  console.log('Background services started')

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
  stopRecordingWatcher()
  stopTranscriptionProcessor()
  closeDatabase()
  console.log('Cleanup complete')
})
