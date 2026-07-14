import { app, BrowserWindow, dialog, ipcMain } from "electron";

/**
 * Register handlers for window control and app-level IPC channels.
 * These use ipcMain.handle directly (not createHandler) because they need
 * access to the BrowserWindow from event.sender.
 */
export function registerAppHandlers(): void {
  ipcMain.handle("app:info", () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    };
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:isMaximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle("dialog:openFile", async (event, options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: options?.title ?? "Select file or folder",
      filters: options?.filters,
      properties: options?.properties ?? ['openFile', 'openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths;
  });

  console.log("[IPC] App/window handlers registered");
}
