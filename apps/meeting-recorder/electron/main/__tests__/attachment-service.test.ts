import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir, tmpdir } from "os";
import { join } from "path";

const mockCopyFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockCreateAttachment = vi.hoisted(() =>
  vi.fn((params: Record<string, unknown>) => ({ id: "att-1", ...params })),
);
const mockGetAttachmentsBySession = vi.hoisted(() => vi.fn(() => []));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/mock/documents") },
}));

vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  copyFileSync: mockCopyFileSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: vi.fn(),
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    copyFileSync: mockCopyFileSync,
    writeFileSync: mockWriteFileSync,
    readFileSync: vi.fn(),
  },
}));

vi.mock("../services/database", () => ({
  createAttachment: mockCreateAttachment,
  getAttachmentsBySession: mockGetAttachmentsBySession,
}));

import {
  addFileAttachment,
  addNoteAttachment,
  getSessionAttachments,
} from "../services/attachment-service";

const VALID_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("attachment-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  describe("validateSourcePath", () => {
    it("accepts paths within home directory", () => {
      const sourcePath = join(homedir(), "docs", "file.pdf");
      expect(() =>
        addFileAttachment(VALID_UUID, sourcePath, "file.pdf", "application/pdf"),
      ).not.toThrow();
    });

    it("accepts paths within temp directory", () => {
      const sourcePath = join(tmpdir(), "upload-12345.pdf");
      expect(() =>
        addFileAttachment(VALID_UUID, sourcePath, "upload.pdf", "application/pdf"),
      ).not.toThrow();
    });

    it("rejects paths outside home and temp directories", () => {
      expect(() =>
        addFileAttachment(VALID_UUID, "/etc/shadow", "shadow", "text/plain"),
      ).toThrow("Access denied");
    });

    it("rejects path traversal attempts via resolve", () => {
      const traversal = join(homedir(), "..", "..", "etc", "passwd");
      expect(() =>
        addFileAttachment(VALID_UUID, traversal, "passwd", "text/plain"),
      ).toThrow("Access denied");
    });
  });

  describe("validateSessionId", () => {
    it("rejects non-UUID session IDs", () => {
      const sourcePath = join(homedir(), "file.pdf");
      expect(() =>
        addFileAttachment("not-a-uuid", sourcePath, "file.pdf", "application/pdf"),
      ).toThrow("Invalid session ID");
    });
  });

  describe("addFileAttachment", () => {
    it("sanitizes filename via basename", () => {
      const sourcePath = join(homedir(), "file.pdf");
      addFileAttachment(VALID_UUID, sourcePath, "../../../malicious.pdf", "application/pdf");

      expect(mockCopyFileSync).toHaveBeenCalledWith(
        sourcePath,
        expect.stringContaining("malicious.pdf"),
      );
    });

    it("creates attachment in database", () => {
      const sourcePath = join(homedir(), "report.docx");
      addFileAttachment(VALID_UUID, sourcePath, "report.docx", "application/vnd.openxmlformats");

      expect(mockCreateAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: VALID_UUID,
          type: "file",
          filename: "report.docx",
        }),
      );
    });
  });

  describe("addNoteAttachment", () => {
    it("creates a note attachment in database", () => {
      addNoteAttachment(VALID_UUID, "Important note text");

      expect(mockCreateAttachment).toHaveBeenCalledWith({
        session_id: VALID_UUID,
        type: "note",
        content_text: "Important note text",
      });
    });
  });

  describe("getSessionAttachments", () => {
    it("delegates to getAttachmentsBySession", () => {
      getSessionAttachments(VALID_UUID);
      expect(mockGetAttachmentsBySession).toHaveBeenCalledWith(VALID_UUID);
    });
  });
});
