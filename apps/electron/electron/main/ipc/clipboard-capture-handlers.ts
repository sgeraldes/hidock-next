/**
 * Clipboard Capture IPC Handlers
 *
 * Channels:
 *   clipboard:captureImage()          → capture the current clipboard image as an image capture
 *   clipboard:setAutoWatch(enabled)   → start/stop the background clipboard poll
 *   clipboard:isWatchActive()         → query watch state
 *
 * Push event (main → renderer):
 *   clipboard:captured                → emitted when the auto-watch adds a capture
 */

import { ipcMain, BrowserWindow } from 'electron'
import {
  captureClipboardImage,
  startClipboardWatch,
  stopClipboardWatch,
  isClipboardWatchActive,
  type ClipboardCaptureResult
} from '../services/clipboard-capture'

function broadcastCapture(result: ClipboardCaptureResult): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('clipboard:captured', result)
    }
  }
}

export function registerClipboardCaptureHandlers(): void {
  ipcMain.handle('clipboard:captureImage', async (): Promise<ClipboardCaptureResult> => {
    return captureClipboardImage()
  })

  ipcMain.handle('clipboard:setAutoWatch', async (_event, enabled: unknown): Promise<{ active: boolean }> => {
    if (enabled === true) {
      startClipboardWatch({ onCapture: broadcastCapture })
    } else {
      stopClipboardWatch()
    }
    return { active: isClipboardWatchActive() }
  })

  ipcMain.handle('clipboard:isWatchActive', async (): Promise<{ active: boolean }> => {
    return { active: isClipboardWatchActive() }
  })
}
