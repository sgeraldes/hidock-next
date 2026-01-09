import { ipcMain, app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'

export function registerAppHandlers(): void {
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
