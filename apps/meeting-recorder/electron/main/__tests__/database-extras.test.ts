import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExec = vi.hoisted(() => vi.fn((): unknown[] => []));
const mockRun = vi.hoisted(() => vi.fn());
const mockGetDatabase = vi.hoisted(() =>
  vi.fn(() => ({ exec: mockExec, run: mockRun })),
);
const mockMapRows = vi.hoisted(() =>
  vi.fn((_result: unknown, _cols: string[]) => []),
);

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((val: string) => Buffer.from(`enc:${val}`)),
    decryptString: vi.fn((buf: Buffer) =>
      buf.toString().replace(/^enc:/, ""),
    ),
  },
}));

vi.mock("../services/database", () => ({
  getDatabase: mockGetDatabase,
  mapRows: mockMapRows,
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-1234"),
}));

describe("database-extras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateActionItem", () => {
    it("rejects invalid column names", async () => {
      const { updateActionItem } = await import(
        "../services/database-extras"
      );
      expect(() =>
        updateActionItem("item-1", {
          status: "done",
          // @ts-expect-error testing invalid column injection
          "status = 1; DROP TABLE action_items--": "hack",
        }),
      ).toThrow("Invalid column for action item update");
    });

    it("allows valid column names", async () => {
      const { updateActionItem } = await import(
        "../services/database-extras"
      );
      updateActionItem("item-1", { status: "done", text: "Updated text" });
      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE action_items SET"),
        expect.arrayContaining(["done", "Updated text", "item-1"]),
      );
    });

    it("does nothing when no updates provided", async () => {
      const { updateActionItem } = await import(
        "../services/database-extras"
      );
      updateActionItem("item-1", {});
      expect(mockRun).not.toHaveBeenCalled();
    });
  });

  describe("setSetting with encryption", () => {
    it("stores encrypted value with base64 encoding", async () => {
      const { setSetting } = await import("../services/database-extras");
      setSetting("ai.apiKey", "sk-secret-key", true);
      expect(mockRun).toHaveBeenCalledWith(
        "INSERT OR REPLACE INTO settings (key, value, encrypted) VALUES (?, ?, ?)",
        ["ai.apiKey", expect.any(String), 1],
      );
    });

    it("stores plaintext when encrypt is false", async () => {
      const { setSetting } = await import("../services/database-extras");
      setSetting("ai.provider", "google", false);
      expect(mockRun).toHaveBeenCalledWith(
        "INSERT OR REPLACE INTO settings (key, value, encrypted) VALUES (?, ?, ?)",
        ["ai.provider", "google", 0],
      );
    });
  });

  describe("getSetting", () => {
    it("returns null when key not found", async () => {
      mockExec.mockReturnValueOnce([]);
      const { getSetting } = await import("../services/database-extras");
      const result = getSetting("nonexistent");
      expect(result).toBeNull();
    });

    it("returns plaintext value for non-encrypted setting", async () => {
      mockExec.mockReturnValueOnce([
        { values: [["ai.provider", "google", 0]] },
      ]);
      const { getSetting } = await import("../services/database-extras");
      const result = getSetting("ai.provider");
      expect(result).toBe("google");
    });
  });
});
