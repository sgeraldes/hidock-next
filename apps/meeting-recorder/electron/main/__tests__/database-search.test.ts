import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExec = vi.hoisted(() => vi.fn((): unknown[] => []));
const mockGetDatabase = vi.hoisted(() => vi.fn(() => ({ exec: mockExec })));
const mockMapRows = vi.hoisted(() => vi.fn((): unknown[] => []));

vi.mock("../services/database", () => ({
  getDatabase: mockGetDatabase,
  mapRows: mockMapRows,
}));

describe("database-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("searchSessions", () => {
    it("escapes LIKE wildcard characters in query", async () => {
      const { searchSessions } = await import("../services/database-search");
      searchSessions("100%_test");
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("ESCAPE"),
        ["%100\\%\\_test%", "%100\\%\\_test%", "%100\\%\\_test%"],
      );
    });

    it("returns mapped session rows", async () => {
      const sessions = [{ id: "s1", title: "Test" }];
      mockMapRows.mockReturnValue(sessions);
      const { searchSessions } = await import("../services/database-search");
      const result = searchSessions("test");
      expect(result).toEqual(sessions);
    });
  });

  describe("getRecentTranscriptSegments", () => {
    it("queries with DESC order and LIMIT then reverses", async () => {
      const segments = [
        { id: "2", text: "second" },
        { id: "1", text: "first" },
      ];
      mockMapRows.mockReturnValue(segments);
      const { getRecentTranscriptSegments } = await import(
        "../services/database-search"
      );
      const result = getRecentTranscriptSegments("sess-1", 10);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY start_ms DESC LIMIT ?"),
        ["sess-1", 10],
      );
      expect(result).toEqual([
        { id: "1", text: "first" },
        { id: "2", text: "second" },
      ]);
    });
  });
});
