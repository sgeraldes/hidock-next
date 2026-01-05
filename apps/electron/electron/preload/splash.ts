import { contextBridge, ipcRenderer } from 'electron'

// Splash window preload - minimal API for startup progress
contextBridge.exposeInMainWorld('electronAPI', {
  onSplashStatus: (callback: (status: string, progress?: number) => void) => {
    ipcRenderer.on('splash:status', (_event, status: string, progress?: number) => {
      callback(status, progress)
    })
  },
  quitApp: () => {
    ipcRenderer.send('splash:quit')
  }
})
