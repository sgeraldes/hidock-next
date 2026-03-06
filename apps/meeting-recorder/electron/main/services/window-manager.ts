import { BrowserWindow, desktopCapturer, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

let mainWindow: BrowserWindow | null = null;
let controlBarWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    title: "Meeting Recorder",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
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

  // SPEC-008: System audio loopback via WASAPI (Windows only).
  // On Windows: intercept getDisplayMedia() to provide automatic loopback audio.
  // On macOS/Linux: do NOT register a handler — let the OS picker show so the user
  // can enable "Share audio" (macOS) or PipeWire audio capture (Linux) themselves.
  if (process.platform === "win32") {
    win.webContents.session.setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
          if (sources.length === 0) {
            callback({});
            return;
          }
          callback({ video: sources[0], audio: "loopback" });
        }).catch((err) => {
          console.warn("[window-manager] desktopCapturer.getSources failed:", err);
          callback({});
        });
      },
    );
  }

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  return win;
}

export function createControlBarWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;

  const barWidth = 400;
  const barHeight = 48;

  const win = new BrowserWindow({
    width: barWidth,
    height: barHeight,
    x: Math.round((width - barWidth) / 2),
    y: 0,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Disabled to enable getUserMedia for audio recording
    },
  });

  win.on("closed", () => {
    controlBarWindow = null;
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(
      process.env["ELECTRON_RENDERER_URL"] + "/mini-control-bar.html",
    );
  } else {
    win.loadFile(join(__dirname, "../renderer/mini-control-bar.html"));
  }

  controlBarWindow = win;
  return win;
}

export function showControlBar(): void {
  if (!controlBarWindow) {
    createControlBarWindow();
  }
  controlBarWindow?.show();
}

export function hideControlBar(): void {
  controlBarWindow?.hide();
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function getControlBarWindow(): BrowserWindow | null {
  return controlBarWindow;
}

export function focusMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

export function setMainWindowAlwaysOnTop(enabled: boolean): void {
  mainWindow?.setAlwaysOnTop(enabled);
}
