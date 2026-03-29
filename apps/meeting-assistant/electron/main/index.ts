import { app, BrowserWindow, shell } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow, destroyAllWindows } from "./windows";
import { initializeTray, destroyTray } from "./services/tray-manager";
import { registerIpcHandlers } from "./ipc/handlers";

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.hidock.meeting-assistant");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const mainWindow = createMainWindow();

  registerIpcHandlers();

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  initializeTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  destroyTray();
  destroyAllWindows();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
