import { ipcMain, app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { setQaLogsEnabled } from '../services/qa-logs'

export function registerAppHandlers(): void {
  // QA Logs toggle bridge. The toggle is renderer state (Zustand + localStorage)
  // and the main process cannot read it, so the renderer pushes it here: once on
  // mount and again on every change. See services/qa-logs.ts.
  ipcMain.handle('qa:set-logs-enabled', async (_event, enabled: unknown) => {
    setQaLogsEnabled(enabled === true)
    return { success: true }
  })

  // Restart the app (useful for development)
  ipcMain.handle('app:restart', async () => {
    // In development mode, just reload the window
    // app.relaunch() doesn't work well with electron-vite dev server
    if (is.dev) {
      const windows = BrowserWindow.getAllWindows()
      if (windows.length > 0) {
        windows[0].webContents.reload()
      }
    } else {
      // In production, do a full relaunch
      app.relaunch()
      app.exit(0)
    }
  })

  // Get app info
  ipcMain.handle('app:info', async () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      isPackaged: app.isPackaged,
      platform: process.platform
    }
  })

  console.log('App IPC handlers registered')
}
