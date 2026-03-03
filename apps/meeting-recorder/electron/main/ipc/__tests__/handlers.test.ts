import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: false, mac: false, windows: false, linux: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn().mockReturnValue(vi.fn()),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn().mockReturnValue(vi.fn()),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn().mockReturnValue(vi.fn()),
}));
vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn().mockReturnValue(vi.fn()),
}));
vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn().mockReturnValue(vi.fn()),
}));
vi.mock("ai", () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("../../services/database", () => ({
  getDatabase: vi.fn().mockReturnValue({
    run: vi.fn(),
    exec: vi.fn().mockReturnValue([]),
    export: vi.fn().mockReturnValue(new Uint8Array()),
  }),
  insertTranscriptSegment: vi.fn(),
  getRecentTranscriptSegments: vi.fn().mockReturnValue([]),
  saveDatabase: vi.fn(),
}));

vi.mock("../../services/database-extras", () => ({
  getSetting: vi.fn().mockReturnValue(null),
  setSetting: vi.fn(),
  createTalkingPoint: vi.fn(),
  createActionItem: vi.fn(),
}));

import { registerIpcHandlers } from "../handlers";

describe("registerIpcHandlers", () => {
  it("executes without throwing", () => {
    expect(() => registerIpcHandlers()).not.toThrow();
  });

  it("is a function", () => {
    expect(typeof registerIpcHandlers).toBe("function");
  });
});
