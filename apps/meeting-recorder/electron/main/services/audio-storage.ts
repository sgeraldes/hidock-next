import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { join } from "path";

export class AudioStorage {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ??
      join(app.getPath("documents"), "MeetingRecorder", "recordings");
  }

  private validateSessionId(sessionId: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
      throw new Error(`Invalid session ID: ${sessionId}`);
    }
  }

  getSessionDir(sessionId: string): string {
    this.validateSessionId(sessionId);
    return join(this.baseDir, sessionId);
  }

  ensureSessionDir(sessionId: string): void {
    const dir = this.getSessionDir(sessionId);
    mkdirSync(dir, { recursive: true });
  }

  saveChunk(sessionId: string, chunkIndex: number, data: Buffer): string {
    this.ensureSessionDir(sessionId);
    const paddedIndex = String(chunkIndex).padStart(3, "0");
    const filename = `chunk-${paddedIndex}.ogg`;
    const filePath = join(this.getSessionDir(sessionId), filename);
    writeFileSync(filePath, data);
    // REQ-10: No pruning during recording — chunks must survive until concatenation
    return filePath;
  }

  getChunkFiles(sessionId: string): string[] {
    const dir = this.getSessionDir(sessionId);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir);
    return files
      .filter((f) => f.startsWith("chunk-") && f.endsWith(".ogg"))
      .sort();
  }

  getRecordingPath(sessionId: string, filename: string): string {
    return join(this.getSessionDir(sessionId), filename);
  }
}
