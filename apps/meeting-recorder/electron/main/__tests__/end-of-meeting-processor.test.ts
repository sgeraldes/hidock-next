import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateObject = vi.hoisted(() => vi.fn());
const mockGetDatabase = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    exec: vi.fn().mockReturnValue([]),
    run: vi.fn(),
  }),
);
const mockUpdateSession = vi.hoisted(() => vi.fn());
const mockGetTranscriptBySession = vi.hoisted(() =>
  vi.fn().mockReturnValue([]),
);
const mockGetAttachmentsBySession = vi.hoisted(() =>
  vi.fn().mockReturnValue([]),
);
const mockGetMeetingTypes = vi.hoisted(() => vi.fn().mockReturnValue([]));
const mockSaveDatabase = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
}));

vi.mock("../services/database", () => ({
  getDatabase: mockGetDatabase,
  getTranscriptBySession: mockGetTranscriptBySession,
  getAttachmentsBySession: mockGetAttachmentsBySession,
  getMeetingTypes: mockGetMeetingTypes,
  updateSession: mockUpdateSession,
  saveDatabase: mockSaveDatabase,
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

import { EndOfMeetingProcessor } from "../services/end-of-meeting-processor";

describe("EndOfMeetingProcessor", () => {
  let processor: EndOfMeetingProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new EndOfMeetingProcessor();
    processor.setModel("mock-model");
  });

  it("processes session with transcript and stores summary", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Alice",
        text: "Let's discuss the roadmap",
        start_ms: 0,
        end_ms: 5000,
        sentiment: "neutral",
        confidence: 0.9,
        language: "en",
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "seg2",
        session_id: "s1",
        speaker_name: "Bob",
        text: "I agree, we need to prioritize the API",
        start_ms: 5000,
        end_ms: 10000,
        sentiment: "positive",
        confidence: 0.8,
        language: "en",
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGetAttachmentsBySession.mockReturnValue([
      {
        id: "a1",
        session_id: "s1",
        type: "note",
        filename: null,
        file_path: null,
        mime_type: null,
        content_text: "Roadmap priorities for Q1",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGenerateObject.mockResolvedValue({
      object: {
        title: "Roadmap Discussion",
        summary: "Team discussed Q1 roadmap priorities.",
        keyTopics: ["Roadmap", "API prioritization"],
        actionItems: [
          { text: "Prioritize API work", assignee: "Bob" },
        ],
        sentiment: "positive",
      },
    });

    await processor.process("s1");

    expect(mockGetTranscriptBySession).toHaveBeenCalledWith("s1");
    expect(mockGetAttachmentsBySession).toHaveBeenCalledWith("s1");
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);

    expect(mockUpdateSession).toHaveBeenCalledWith("s1", {
      title: "Roadmap Discussion",
      summary: "Team discussed Q1 roadmap priorities.",
    });
    expect(mockSaveDatabase).toHaveBeenCalled();
  });

  it("uses meeting type template when session has meeting_type_id", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Dev1",
        text: "Yesterday I worked on the auth module",
        start_ms: 0,
        end_ms: 5000,
        sentiment: "neutral",
        confidence: 0.9,
        language: "en",
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGetMeetingTypes.mockReturnValue([
      {
        id: "mt-standup",
        name: "Standup",
        description: "Daily standup",
        prompt_template:
          "Summarize what each participant did yesterday, plans for today, and blockers.",
        icon: "clock",
        is_default: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGenerateObject.mockResolvedValue({
      object: {
        title: "Daily Standup",
        summary: "Dev1 reported working on auth module.",
        keyTopics: ["Auth module"],
        actionItems: [],
        sentiment: "neutral",
      },
    });

    await processor.process("s1", "mt-standup");

    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.system).toContain(
      "Summarize what each participant did yesterday",
    );
  });

  it("handles empty transcript gracefully", async () => {
    mockGetTranscriptBySession.mockReturnValue([]);

    await processor.process("s1");

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(mockUpdateSession).toHaveBeenCalledWith("s1", {
      title: "Empty Session",
      summary: "No transcript content recorded.",
    });
  });

  it("handles AI failure with error stored as summary", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Alice",
        text: "Something",
        start_ms: 0,
        end_ms: 5000,
        sentiment: null,
        confidence: null,
        language: null,
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGenerateObject.mockRejectedValue(new Error("API quota exceeded"));

    // process() re-throws after writing error state so the caller can handle it
    await expect(processor.process("s1")).rejects.toThrow("API quota exceeded");

    expect(mockUpdateSession).toHaveBeenCalledWith("s1", {
      title: "Processing Failed",
      summary: expect.stringContaining("API quota exceeded"),
    });
  });

  it("includes note content in the prompt context", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Alice",
        text: "Discussing priorities",
        start_ms: 0,
        end_ms: 5000,
        sentiment: null,
        confidence: null,
        language: null,
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGetAttachmentsBySession.mockReturnValue([
      {
        id: "n1",
        session_id: "s1",
        type: "note",
        filename: null,
        file_path: null,
        mime_type: null,
        content_text: "Focus on shipping the MVP by March",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "f1",
        session_id: "s1",
        type: "file",
        filename: "roadmap.docx",
        file_path: "/tmp/roadmap.docx",
        mime_type: "application/vnd.openxmlformats",
        content_text: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGenerateObject.mockResolvedValue({
      object: {
        title: "Priority Discussion",
        summary: "Team discussed MVP priorities.",
        keyTopics: ["MVP"],
        actionItems: [],
        sentiment: "neutral",
      },
    });

    await processor.process("s1");

    const call = mockGenerateObject.mock.calls[0][0];
    // Notes text should be in the prompt
    expect(call.prompt).toContain("Focus on shipping the MVP by March");
    expect(call.prompt).toContain("roadmap.docx");
  });

  it("builds full transcript text from segments", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Alice",
        text: "Hello everyone",
        start_ms: 0,
        end_ms: 3000,
        sentiment: null,
        confidence: null,
        language: null,
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "seg2",
        session_id: "s1",
        speaker_name: "Bob",
        text: "Hi Alice",
        start_ms: 3000,
        end_ms: 5000,
        sentiment: null,
        confidence: null,
        language: null,
        chunk_index: 1,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGenerateObject.mockResolvedValue({
      object: {
        title: "Greetings",
        summary: "Short greeting exchange.",
        keyTopics: [],
        actionItems: [],
        sentiment: "neutral",
      },
    });

    await processor.process("s1");

    const call = mockGenerateObject.mock.calls[0][0];
    expect(call.prompt).toContain("Alice: Hello everyone");
    expect(call.prompt).toContain("Bob: Hi Alice");
  });

  it("stores summary text and title from AI result", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Alice",
        text: "Meeting notes",
        start_ms: 0,
        end_ms: 5000,
        sentiment: null,
        confidence: null,
        language: null,
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const result = {
      title: "Team Sync",
      summary: "Quick team sync.",
      keyTopics: ["Updates"],
      actionItems: [{ text: "Follow up", assignee: "Alice" }],
      sentiment: "positive",
    };

    mockGenerateObject.mockResolvedValue({ object: result });

    await processor.process("s1");

    expect(mockUpdateSession).toHaveBeenCalledWith("s1", {
      title: "Team Sync",
      summary: "Quick team sync.",
    });
  });

  it("sanitizes speaker names to prevent prompt injection", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Alice<prompt>inject</prompt>",
        text: "Meeting content",
        start_ms: 0,
        end_ms: 5000,
        sentiment: null,
        confidence: null,
        language: null,
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGetAttachmentsBySession.mockClear();
    mockGetAttachmentsBySession.mockReturnValue([]);

    mockGenerateObject.mockResolvedValue({
      object: {
        title: "Test",
        summary: "Test",
        keyTopics: [],
        actionItems: [],
        sentiment: "neutral",
      },
    });

    await processor.process("s1");

    const call = mockGenerateObject.mock.calls[0][0];
    // Sanitization should remove < and > characters
    // So the speaker name should NOT contain angle brackets
    expect(call.prompt).not.toContain("<prompt>");
    expect(call.prompt).not.toContain("</prompt>");
    // But it should contain the sanitized version
    const prompt = call.prompt as string;
    const transcriptLine = prompt.split('\n')[1]; // Second line after "--- Transcript ---"
    // sanitizePromptInput strips < > { } — the / from </prompt> remains
    expect(transcriptLine).toMatch(/^Alicepromptinject\/prompt: Meeting content$/);
  });

  it("sanitizes note content to prevent prompt injection", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Alice",
        text: "Meeting content",
        start_ms: 0,
        end_ms: 5000,
        sentiment: null,
        confidence: null,
        language: null,
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGetAttachmentsBySession.mockReturnValue([
      {
        id: "n1",
        session_id: "s1",
        type: "note",
        filename: null,
        file_path: null,
        mime_type: null,
        content_text: "Important note {ignore this} and <dangerous>",
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGenerateObject.mockResolvedValue({
      object: {
        title: "Test",
        summary: "Test",
        keyTopics: [],
        actionItems: [],
        sentiment: "neutral",
      },
    });

    await processor.process("s1");

    const call = mockGenerateObject.mock.calls[0][0];
    // Note content should have dangerous chars removed
    expect(call.prompt).toContain("Important note ignore this and dangerous");
    expect(call.prompt).not.toContain("{ignore this}");
    expect(call.prompt).not.toContain("<dangerous>");
  });

  it("sanitizes filenames to prevent prompt injection", async () => {
    mockGetTranscriptBySession.mockReturnValue([
      {
        id: "seg1",
        session_id: "s1",
        speaker_name: "Alice",
        text: "Meeting content",
        start_ms: 0,
        end_ms: 5000,
        sentiment: null,
        confidence: null,
        language: null,
        chunk_index: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGetAttachmentsBySession.mockReturnValue([
      {
        id: "f1",
        session_id: "s1",
        type: "file",
        filename: "report<evil>{injection}.pdf",
        file_path: "/tmp/report.pdf",
        mime_type: "application/pdf",
        content_text: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    mockGenerateObject.mockResolvedValue({
      object: {
        title: "Test",
        summary: "Test",
        keyTopics: [],
        actionItems: [],
        sentiment: "neutral",
      },
    });

    await processor.process("s1");

    const call = mockGenerateObject.mock.calls[0][0];
    // Filename should have dangerous chars removed
    expect(call.prompt).toContain("reportevilinjection.pdf");
    expect(call.prompt).not.toContain("report<evil>{injection}.pdf");
  });
});
