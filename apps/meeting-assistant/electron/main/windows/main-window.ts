import { BrowserWindow, desktopCapturer } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    title: "Meeting Assistant",
    webPreferences: {
      preload: join(__dirname, "../../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Disabled to enable getUserMedia for audio recording
    },
  });

  win.on("ready-to-show", () => {
    win.show();
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  // WASAPI loopback via setDisplayMediaRequestHandler (Windows only).
  // On macOS/Linux the OS picker handles audio capture natively.
  if (process.platform === "win32") {
    win.webContents.session.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer
          .getSources({ types: ["screen"] })
          .then((sources) => {
            if (sources.length === 0) {
              callback({});
              return;
            }
            callback({ video: sources[0], audio: "loopback" });
          })
          .catch((err) => {
            console.warn("[main-window] desktopCapturer.getSources failed:", err);
            callback({});
          });
      },
    );
  }

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../../renderer/index.html"));
  }

  mainWindow = win;
  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function focusMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

export function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
