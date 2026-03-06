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

  // SPEC-008: Intercept getDisplayMedia() to provide system audio loopback.
  // On Windows: audio: 'loopback' = WASAPI loopback (all system audio, automatic, no dialog).
  // On macOS/Linux: audio: source = system audio via picker (user grants permission once).
  (win.webContents.session as unknown as {
    setDisplayMediaRequestHandler: (
      handler: (
        _request: unknown,
        callback: (response: { video?: unknown; audio?: unknown }) => void,
      ) => void,
    ) => void;
  }).setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      if (sources.length === 0) {
        callback({});
        return;
      }
      const audioConfig =
        process.platform === "win32" ? "loopback" : sources[0];
      callback({ video: sources[0], audio: audioConfig as "loopback" });
    }).catch(() => {
      callback({});
    });
  });

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
