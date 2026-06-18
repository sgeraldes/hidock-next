import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { DashboardDatabase } from './services/database'
import { DeviceBridge } from './services/deviceBridge'
import { SettingsStore } from './services/settings'

let mainWindow: BrowserWindow | null = null
let database: DashboardDatabase | null = null
let settings: SettingsStore | null = null
const deviceBridge = new DeviceBridge()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'HiDock Dashboard',
    backgroundColor: '#f6f7f4',
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupServices(): void {
  const userData = app.getPath('userData')
  database = new DashboardDatabase(join(userData, 'dashboard.sqlite3'))
  database.migrate()
  settings = new SettingsStore(join(userData, 'settings.json'))
}

function getDatabase(): DashboardDatabase {
  if (!database) throw new Error('Dashboard database is not initialized')
  return database
}

function getSettings(): SettingsStore {
  if (!settings) throw new Error('Dashboard settings are not initialized')
  return settings
}

function registerIpc(): void {
  ipcMain.handle('dashboard:getSummary', () => getDatabase().getSummary())
  ipcMain.handle('recordings:list', () => getDatabase().listRecordings())
  ipcMain.handle('recordings:get', (_event, id) => getDatabase().getRecordingDetail(String(id)))
  ipcMain.handle('tasks:list', () => getDatabase().listTasks())
  ipcMain.handle('tasks:create', (_event, input) => getDatabase().taskService.createTask(input ?? {}))
  ipcMain.handle('tasks:update', (_event, id, patch) => getDatabase().taskService.updateTask(String(id), patch ?? {}))
  ipcMain.handle('tasks:listEvents', (_event, taskId) => getDatabase().tasks.listEvents(String(taskId)))
  ipcMain.handle('sync:listRecent', (_event, limit) => getDatabase().syncRunService.listRecent(Number(limit ?? 10)))
  ipcMain.handle('settings:get', () => getSettings().get())
  ipcMain.handle('settings:update', (_event, patch) => getSettings().update(patch ?? {}))
  ipcMain.handle('device:getStatus', () => deviceBridge.getStatus())
  ipcMain.handle('device:listRecordings', () => deviceBridge.listRecordings())
  ipcMain.handle('device:downloadRecording', (_event, recordingId) => deviceBridge.downloadRecording(String(recordingId)))
  ipcMain.handle('device:syncMetadata', async () => {
    const run = getDatabase().syncRunService.startRun('Read-only metadata sync requested')
    try {
      const result = await deviceBridge.syncMetadata()
      getDatabase().syncRunService.finishRun(run.id, 'ready', result.message)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Metadata sync failed'
      getDatabase().syncRunService.finishRun(run.id, 'failed', message)
      throw error
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.hidock.dashboard')
  setupServices()
  registerIpc()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  database?.close()
})
