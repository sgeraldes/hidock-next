import { BrowserWindow } from "electron";

/** Send a message to all open renderer windows. */
export function broadcastToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}
