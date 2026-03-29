import { BrowserWindow } from "electron";

/**
 * Broadcast an IPC event to all non-destroyed BrowserWindows.
 * Used by main-process services to push updates to the renderer.
 */
export function broadcastToAllWindows(channel: string, data?: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}
