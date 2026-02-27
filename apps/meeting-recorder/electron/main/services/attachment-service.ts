import { app } from "electron";
import { join, basename, resolve } from "path";
import { mkdirSync, copyFileSync, existsSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { createAttachment, getAttachmentsBySession } from "./database";
import type { AttachmentType } from "./database.types";

function validateSourcePath(sourcePath: string): void {
  const resolved = resolve(sourcePath);
  const home = homedir();
  const tmp = tmpdir();
  if (!resolved.startsWith(home) && !resolved.startsWith(tmp)) {
    throw new Error(
      `Access denied: source path must be within user home or temp directory`,
    );
  }
}

function validateSessionId(sessionId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
}

function getAttachmentsDir(sessionId: string): string {
  validateSessionId(sessionId);
  const base = join(
    app.getPath("documents"),
    "MeetingRecorder",
    "sessions",
    sessionId,
    "attachments",
  );
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }
  return base;
}

export function addFileAttachment(
  sessionId: string,
  sourcePath: string,
  filename: string,
  mimeType: string,
): ReturnType<typeof createAttachment> {
  validateSourcePath(sourcePath);
  const safeFilename = basename(filename);
  const dir = getAttachmentsDir(sessionId);
  const destPath = join(dir, safeFilename);
  copyFileSync(sourcePath, destPath);

  return createAttachment({
    session_id: sessionId,
    type: "file" as AttachmentType,
    filename,
    file_path: destPath,
    mime_type: mimeType,
  });
}

export function addNoteAttachment(
  sessionId: string,
  text: string,
): ReturnType<typeof createAttachment> {
  return createAttachment({
    session_id: sessionId,
    type: "note" as AttachmentType,
    content_text: text,
  });
}

export function addScreenshotAttachment(
  sessionId: string,
  imageData: Buffer,
  filename: string,
): ReturnType<typeof createAttachment> {
  const safeFilename = basename(filename);
  const dir = getAttachmentsDir(sessionId);
  const destPath = join(dir, safeFilename);
  writeFileSync(destPath, imageData);

  return createAttachment({
    session_id: sessionId,
    type: "screenshot" as AttachmentType,
    filename,
    file_path: destPath,
    mime_type: "image/png",
  });
}

export function getSessionAttachments(sessionId: string) {
  return getAttachmentsBySession(sessionId);
}
