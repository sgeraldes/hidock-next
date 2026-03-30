import { Tray, Menu, nativeImage, app } from "electron";
import {
  getMainWindow,
  showMainWindow,
  showMiniBar,
  hideMiniBar,
  isMiniBarVisible,
} from "../windows";

export type TrayState = "idle" | "recording" | "processing";

let tray: Tray | null = null;
let currentState: TrayState = "idle";

interface TrayCallbacks {
  onStartRecording: () => void;
  onStopRecording: () => void;
}

let callbacks: TrayCallbacks = {
  onStartRecording: () => {},
  onStopRecording: () => {},
};

function getTrayIcon(state: TrayState): Electron.NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  let color: [number, number, number, number];

  switch (state) {
    case "recording":
      color = [255, 60, 60, 255];
      break;
    case "processing":
      color = [255, 180, 0, 255];
      break;
    case "idle":
    default:
      color = [100, 160, 255, 255];
      break;
  }

  for (let i = 0; i < size * size; i++) {
    buffer[i * 4] = color[0];
    buffer[i * 4 + 1] = color[1];
    buffer[i * 4 + 2] = color[2];
    buffer[i * 4 + 3] = color[3];
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function getTooltip(state: TrayState): string {
  switch (state) {
    case "recording":
      return "Meeting Assistant - Recording";
    case "processing":
      return "Meeting Assistant - Processing";
    case "idle":
    default:
      return "Meeting Assistant";
  }
}

function buildContextMenu(): Electron.Menu {
  const isRecording = currentState === "recording";
  const isProcessing = currentState === "processing";
  const miniBarVisible = isMiniBarVisible();

  return Menu.buildFromTemplate([
    {
      label: isRecording ? "Stop Recording" : "Start Recording",
      enabled: !isProcessing,
      click: () => {
        if (isRecording) {
          callbacks.onStopRecording();
        } else {
          callbacks.onStartRecording();
        }
      },
    },
    { type: "separator" },
    {
      label: miniBarVisible ? "Hide Mini Bar" : "Show Mini Bar",
      click: () => {
        if (isMiniBarVisible()) {
          hideMiniBar();
        } else {
          showMiniBar();
        }
      },
    },
    {
      label: "Open Meeting Assistant",
      click: () => {
        showMainWindow();
      },
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => {
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
          win.webContents.send("navigate", "/settings");
        } else {
          showMainWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);
}

export function setTrayCallbacks(newCallbacks: TrayCallbacks): void {
  callbacks = newCallbacks;
}

export function initializeTray(): void {
  if (tray) return;

  tray = new Tray(getTrayIcon(currentState));
  tray.setToolTip(getTooltip(currentState));
  tray.setContextMenu(buildContextMenu());

  tray.on("click", () => {
    showMainWindow();
  });
}

export function updateTrayState(state: TrayState): void {
  currentState = state;
  if (tray) {
    tray.setImage(getTrayIcon(state));
    tray.setToolTip(getTooltip(state));
    tray.setContextMenu(buildContextMenu());
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

export function getTrayState(): TrayState {
  return currentState;
}
