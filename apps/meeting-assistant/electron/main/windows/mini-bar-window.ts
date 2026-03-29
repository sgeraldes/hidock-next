import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";

let miniBarWindow: BrowserWindow | null = null;

type PositionPersistence = {
  getPosition: () => { x: number; y: number } | null;
  savePosition: (x: number, y: number) => void;
};

let positionPersistence: PositionPersistence | null = null;

export function setMiniBarPositionPersistence(callbacks: PositionPersistence): void {
  positionPersistence = callbacks;
}

function isPositionVisible(x: number, y: number, width: number, height: number): boolean {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const { bounds } = display;
    if (
      x < bounds.x + bounds.width &&
      x + width > bounds.x &&
      y < bounds.y + bounds.height &&
      y + height > bounds.y
    ) {
      return true;
    }
  }
  return false;
}

function getDefaultPosition(): { x: number; y: number } {
  const primary = screen.getPrimaryDisplay();
  const { width } = primary.workAreaSize;
  const barWidth = 400;
  return {
    x: Math.round((width - barWidth) / 2),
    y: 0,
  };
}

export function createMiniBarWindow(): BrowserWindow {
  const barWidth = 400;
  const barHeight = 60;

  let startX: number;
  let startY: number;

  const saved = positionPersistence?.getPosition() ?? null;
  if (saved && isPositionVisible(saved.x, saved.y, barWidth, barHeight)) {
    startX = saved.x;
    startY = saved.y;
  } else {
    const pos = getDefaultPosition();
    startX = pos.x;
    startY = pos.y;
  }

  const win = new BrowserWindow({
    width: barWidth,
    height: barHeight,
    x: startX,
    y: startY,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Disabled to enable getUserMedia for audio recording
    },
  });

  win.setContentProtection(true);

  win.on("moved", () => {
    const [x, y] = win.getPosition();
    positionPersistence?.savePosition(x, y);
  });

  win.on("closed", () => {
    miniBarWindow = null;
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"] + "/mini-bar.html");
  } else {
    win.loadFile(join(__dirname, "../../renderer/mini-bar.html"));
  }

  miniBarWindow = win;
  return win;
}

export function getMiniBarWindow(): BrowserWindow | null {
  return miniBarWindow;
}

export function showMiniBar(): void {
  if (!miniBarWindow) {
    createMiniBarWindow();
  }
  miniBarWindow?.show();
}

export function hideMiniBar(): void {
  miniBarWindow?.hide();
}

export function isMiniBarVisible(): boolean {
  return miniBarWindow?.isVisible() ?? false;
}
