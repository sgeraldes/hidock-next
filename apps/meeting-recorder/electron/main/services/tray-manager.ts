import { Tray, Menu, nativeImage, app } from "electron";
import { getMainWindow } from "./window-manager";

let tray: Tray | null = null;
let isRecording = false;

function getTrayIcon(recording: boolean): Electron.NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const color = recording ? [255, 60, 60, 255] : [100, 160, 255, 255];
  for (let i = 0; i < size * size; i++) {
    buffer[i * 4] = color[0];
    buffer[i * 4 + 1] = color[1];
    buffer[i * 4 + 2] = color[2];
    buffer[i * 4 + 3] = color[3];
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function buildContextMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: "Show Window",
      click: () => {
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: isRecording ? "Recording..." : "Idle",
      enabled: false,
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

export function initializeTray(): void {
  if (tray) return;

  tray = new Tray(getTrayIcon(false));
  tray.setToolTip("Meeting Recorder");
  tray.setContextMenu(buildContextMenu());

  tray.on("click", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isVisible()) {
        win.focus();
      } else {
        win.show();
      }
    }
  });
}

export function updateTrayRecordingState(recording: boolean): void {
  isRecording = recording;
  if (tray) {
    tray.setImage(getTrayIcon(recording));
    tray.setContextMenu(buildContextMenu());
    tray.setToolTip(
      recording ? "Meeting Recorder - Recording" : "Meeting Recorder",
    );
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
