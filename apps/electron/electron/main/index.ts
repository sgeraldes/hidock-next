import { app, shell, BrowserWindow, session } from 'electron'
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

let mainWindow: BrowserWindow | null = null

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

// Initialize services
async function initializeServices(): Promise<void> {
  console.log('Initializing services...')

  // Initialize config first
  await initializeConfig()
  console.log('Config initialized')

  // Initialize file storage directories
  await initializeFileStorage()
  console.log('File storage initialized')

  // Initialize database
  await initializeDatabase()
  console.log('Database initialized')

  // Initialize vector store (for RAG)
  const vectorStore = getVectorStore()
  await vectorStore.initialize()
  console.log('Vector store initialized')

  // Initialize RAG service
  const rag = getRAGService()
  await rag.initialize()
  console.log('RAG service initialized')

  // Initialize storage policy service (subscribes to events)
  const storagePolicy = getStoragePolicyService()
  console.log('Storage policy service initialized')

  // Register IPC handlers
  registerIpcHandlers()
  console.log('IPC handlers registered')
}

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.hidock.meeting-intelligence')

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Handle WebUSB device selection - this is REQUIRED for Electron
  // Without this, navigator.usb.requestDevice() will fail silently
  session.defaultSession.on('select-usb-device', (event, details, callback) => {
    console.log('=== USB DEVICE SELECTION ===')
    console.log('Available devices:', details.deviceList.map(d => ({
      vendorId: d.vendorId.toString(16),
      productId: d.productId.toString(16),
      productName: d.productName
    })))

    // Find a HiDock device
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
      // If no HiDock found but there are devices, select first one matching vendor
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

  // Grant USB device permission
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'usb') {
      return true
    }
    return true
  })

  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'usb') {
      // Allow all USB devices from our app
      return true
    }
    return false
  })

  // Initialize all services before creating window
  await initializeServices()

  createWindow()

  // Set main window reference for services that need to notify renderer
  if (mainWindow) {
    setWatcherMainWindow(mainWindow)
    setMainWindowForTranscription(mainWindow)
    setMainWindowForEventBus(mainWindow)
    setMainWindowForMigration(mainWindow)
  }

  // Start background services
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

// Handle app quit
app.on('before-quit', () => {
  // Stop background services
  stopRecordingWatcher()
  stopTranscriptionProcessor()
  closeDatabase()
  console.log('Cleanup complete')
})
