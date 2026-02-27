import { ipcMain, app } from "electron";

export function registerAppHandlers(): void {
  ipcMain.handle("app:info", () => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      path: app.getAppPath(),
    };
  });
}
