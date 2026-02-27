import { ipcMain } from "electron";
import {
  addFileAttachment,
  addNoteAttachment,
  getSessionAttachments,
} from "../services/attachment-service";

export function registerAttachmentHandlers(): void {
  ipcMain.handle(
    "attachment:addFile",
    (
      _,
      sessionId: string,
      sourcePath: string,
      filename: string,
      mimeType: string,
    ) => {
      return addFileAttachment(sessionId, sourcePath, filename, mimeType);
    },
  );

  ipcMain.handle("attachment:addNote", (_, sessionId: string, text: string) => {
    return addNoteAttachment(sessionId, text);
  });

  ipcMain.handle("attachment:list", (_, sessionId: string) => {
    return getSessionAttachments(sessionId);
  });
}
