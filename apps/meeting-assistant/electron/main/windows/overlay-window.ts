import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

let overlayWindow: BrowserWindow | null = null;

const OVERLAY_WIDTH = 350;
const OVERLAY_HEIGHT = 500;

function getOverlayPosition(): { x: number; y: number } {
  const primary = screen.getPrimaryDisplay();
  const { x: workX, y: workY, width: workWidth, height: workHeight } = primary.workArea;
  return {
    x: workX + workWidth - OVERLAY_WIDTH,
    y: workY + Math.round((workHeight - OVERLAY_HEIGHT) / 2),
  };
}

export function createOverlayWindow(): BrowserWindow {
  const pos = getOverlayPosition();

  const win = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setContentProtection(true);

  win.on("closed", () => {
    overlayWindow = null;
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"] + "/overlay.html");
  } else {
    win.loadFile(join(__dirname, "../renderer/overlay.html"));
  }

  overlayWindow = win;
  return win;
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

export function showOverlay(): void {
  if (!overlayWindow) {
    createOverlayWindow();
  }
  overlayWindow?.show();
}

export function hideOverlay(): void {
  overlayWindow?.hide();
}

export function toggleOverlay(): void {
  if (overlayWindow?.isVisible()) {
    hideOverlay();
  } else {
    showOverlay();
  }
}

export function isOverlayVisible(): boolean {
  return overlayWindow?.isVisible() ?? false;
}
