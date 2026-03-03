import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }));

vi.mock("electron", () => ({
  ipcMain: { handle: mockHandle },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
}));

const { mockGetSetting, mockSetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn().mockReturnValue(null),
  mockSetSetting: vi.fn(),
}));

vi.mock("../../services/database-extras", () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
}));

const mockExec = vi.hoisted(() => vi.fn());
const { mockSaveDatabase } = vi.hoisted(() => ({
  mockSaveDatabase: vi.fn(),
}));

vi.mock("../../services/database", () => ({
  getDatabase: vi.fn(() => ({ exec: mockExec })),
  saveDatabase: mockSaveDatabase,
}));

const mockValidateApiKey = vi.hoisted(() => vi.fn());
vi.mock("../ai-handlers", () => ({
  getAIService: vi.fn(() => ({
    configure: vi.fn(),
    validateApiKey: mockValidateApiKey,
    getModel: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: false },
}));

vi.mock("../translation-handlers", () => ({
  getTranslationService: vi.fn(() => ({ setModel: vi.fn() })),
  getSummarizationService: vi.fn(() => ({ setModel: vi.fn() })),
}));

vi.mock("../meeting-type-handlers", () => ({
  getEndOfMeetingProcessor: vi.fn(() => ({ setModel: vi.fn() })),
}));

import { registerSettingsHandlers } from "../settings-handlers";

function getHandler(channel: string) {
  return mockHandle.mock.calls.find(
    (c: unknown[]) => c[0] === channel,
  )?.[1] as (...args: unknown[]) => unknown;
}

describe("registerSettingsHandlers", () => {
  beforeEach(() => {
    mockHandle.mockClear();
    mockGetSetting.mockReset();
    mockSetSetting.mockClear();
    mockSaveDatabase.mockClear();
    mockValidateApiKey.mockClear();

    mockExec.mockReturnValue([
      {
        values: [
          ["ai.apiKey", "sk-realkey1234abcd", 1],
          ["ai.provider", "openai", 0],
          ["ai.model", "gpt-4", 0],
          ["ai.bedrockAccessKeyId", "AKIAIOSFODNN7EXAMPLE", 1],
          ["ai.bedrockSecretAccessKey", "wJalrXUtnFEMI/K7MDENG", 1],
          ["ai.bedrockSessionToken", "AQoDYXdzEJr/session", 1],
        ],
      },
    ]);

    mockGetSetting.mockImplementation((key: string) => {
      const db: Record<string, string> = {
        "ai.apiKey": "sk-realkey1234abcd",
        "ai.provider": "openai",
        "ai.model": "gpt-4",
        "ai.bedrockRegion": "us-east-1",
        "ai.bedrockAccessKeyId": "AKIAIOSFODNN7EXAMPLE",
        "ai.bedrockSecretAccessKey": "wJalrXUtnFEMI/K7MDENG",
        "ai.bedrockSessionToken": "AQoDYXdzEJr/session",
      };
      return db[key] ?? null;
    });
  });

  it("registers all settings IPC handlers including testConnection", () => {
    registerSettingsHandlers();
    const channels = mockHandle.mock.calls.map((c: unknown[]) => c[0]);
    expect(channels).toContain("settings:get");
    expect(channels).toContain("settings:set");
    expect(channels).toContain("settings:getAll");
    expect(channels).toContain("settings:testConnection");
  });

  it("settings:getAll masks AI key fields before sending to renderer", async () => {
    registerSettingsHandlers();
    const result = (await getHandler("settings:getAll")({})) as Record<
      string,
      string
    >;

    expect(result["ai.apiKey"]).toBe("****abcd");
    expect(result["ai.apiKey"]).not.toContain("sk-realkey");
    expect(result["ai.bedrockAccessKeyId"]).toBe("****MPLE");
    expect(result["ai.bedrockSecretAccessKey"]).toMatch(/^\*{4}/);
    expect(result["ai.bedrockSessionToken"]).toMatch(/^\*{4}/);
  });

  it("settings:getAll does not mask non-sensitive fields", async () => {
    registerSettingsHandlers();
    const result = (await getHandler("settings:getAll")({})) as Record<
      string,
      string
    >;

    expect(result["ai.provider"]).toBe("openai");
    expect(result["ai.model"]).toBe("gpt-4");
  });

  it("settings:getAll returns empty string for empty sensitive fields", async () => {
    mockGetSetting.mockImplementation((key: string) => {
      return key === "ai.apiKey" ? "" : null;
    });
    mockExec.mockReturnValue([
      {
        values: [["ai.apiKey", "", 1]],
      },
    ]);

    registerSettingsHandlers();
    const result = (await getHandler("settings:getAll")({})) as Record<
      string,
      string
    >;

    expect(result["ai.apiKey"]).toBe("");
  });

  it("settings:testConnection uses key from database, not renderer input", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: true });

    registerSettingsHandlers();
    const result = (await getHandler("settings:testConnection")({})) as {
      valid: boolean;
    };

    expect(mockValidateApiKey).toHaveBeenCalled();
    const [calledProvider, calledKey] =
      mockValidateApiKey.mock.calls[0] as string[];
    expect(calledKey).toBe("sk-realkey1234abcd");
    expect(calledProvider).toBe("openai");
    expect(result.valid).toBe(true);
  });

  it("settings:testConnection returns error when format check fails", async () => {
    mockValidateApiKey.mockReturnValue({ valid: false, error: "API key is required" });

    registerSettingsHandlers();
    const result = (await getHandler("settings:testConnection")({})) as {
      valid: boolean;
      error?: string;
    };

    expect(result.valid).toBe(false);
    expect(result.error).toBe("API key is required");
  });
});
