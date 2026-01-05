"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  onSplashStatus: (callback) => {
    electron.ipcRenderer.on("splash:status", (_event, status, progress) => {
      callback(status, progress);
    });
  },
  quitApp: () => {
    electron.ipcRenderer.send("splash:quit");
  }
});
