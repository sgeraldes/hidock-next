import { app, BrowserWindow, shell } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow, destroyAllWindows } from "./windows";
import { initializeTray, destroyTray } from "./services/tray-manager";
import { registerIpcHandlers } from "./ipc/handlers";
import { initializeDatabase } from "./services/database";
import { getSetting } from "./services/database-settings";
import { hydrate } from "./services/credential-store";
import { SENSITIVE_SETTING_KEYS } from "./services/sensitive-keys";

/**
 * Load any encrypted credential values from the DB into the in-memory
 * credential store cache so the main process can use them without re-querying.
 */
function hydrateCredentials(): void {
  for (const key of SENSITIVE_SETTING_KEYS) {
    const row = getSetting(key);
    if (row && row.value) {
      hydrate(key, row.value);
    }
  }
  console.log("[CredentialStore] Credentials hydrated from DB");
}

// Enable remote debugging in dev mode for Electron MCP testing
if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.hidock.meeting-assistant");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  await initializeDatabase();

  hydrateCredentials();

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
