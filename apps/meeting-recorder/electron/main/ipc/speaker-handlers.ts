import { ipcMain } from "electron";
import {
  getSpeakers,
  createSpeaker,
  getSessionSpeakers,
  linkSpeakerToSession,
} from "../services/database";

export function registerSpeakerHandlers(): void {
  ipcMain.handle("speaker:list", () => {
    return getSpeakers();
  });

  ipcMain.handle("speaker:create", (_, name: string, displayName?: string) => {
    return createSpeaker(name, displayName);
  });

  ipcMain.handle("speaker:getForSession", (_, sessionId: string) => {
    return getSessionSpeakers(sessionId);
  });

  ipcMain.handle(
    "speaker:linkToSession",
    (_, sessionId: string, speakerId: string) => {
      linkSpeakerToSession(sessionId, speakerId);
    },
  );
}
