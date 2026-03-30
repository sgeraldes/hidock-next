import { app, BrowserWindow, shell } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { createMainWindow, destroyAllWindows } from "./windows";
import { initializeTray, destroyTray, setTrayCallbacks } from "./services/tray-manager";
import { registerIpcHandlers } from "./ipc/handlers";
import { initializeDatabase } from "./services/database";
import { getSetting } from "./services/database-settings";
import { hydrate } from "./services/credential-store";
import { SENSITIVE_SETTING_KEYS } from "./services/sensitive-keys";
import { SessionOrchestrator, setOrchestratorInstance } from "./services/session-orchestrator";

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

let orchestrator: SessionOrchestrator | null = null;

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.hidock.meeting-assistant");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  await initializeDatabase();

  hydrateCredentials();

  // Initialize the session orchestrator (wires all services)
  orchestrator = new SessionOrchestrator();
  await orchestrator.initialize();
  setOrchestratorInstance(orchestrator);

  const mainWindow = createMainWindow();

  registerIpcHandlers();

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // Wire tray callbacks to orchestrator
  setTrayCallbacks({
    onStartRecording: () => orchestrator?.startSession(),
    onStopRecording: () => orchestrator?.stopSession(),
  });

  initializeTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  orchestrator?.shutdown();
  destroyTray();
  destroyAllWindows();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
