import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Hoisted mocks ---

const { mockHandle, mockGetSetting, mockConfigure, mockDispose, mockIsConfigured, mockRecognizeChunk } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockGetSetting: vi.fn(),
  mockConfigure: vi.fn(),
  mockDispose: vi.fn(),
  mockIsConfigured: vi.fn().mockReturnValue(false),
  mockRecognizeChunk: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mockHandle, on: vi.fn() },
}));

vi.mock("../../services/database-extras", () => ({
  getSetting: mockGetSetting,
}));

vi.mock("../../services/transcription-backend", () => ({
  BACKEND_CHIRP3_GEMINI: "chirp3+gemini",
  BACKEND_GEMINI_MULTIMODAL: "gemini-multimodal",
}));

vi.mock("../../services/chirp3-provider", () => ({
  Chirp3Provider: vi.fn(function (this: Record<string, unknown>) {
    this.configure = mockConfigure;
    this.dispose = mockDispose;
    this.isConfigured = mockIsConfigured;
    this.recognizeChunk = mockRecognizeChunk;
  }),
}));

import {
  initializeChirp3,
  reconfigureChirp3,
  getChirp3Provider,
  registerChirp3Handlers,
} from "../chirp3-handlers";

// --- Helpers ---

function setupSettings(settings: Record<string, string | null>) {
  mockGetSetting.mockImplementation((key: string) => settings[key] ?? null);
}

// --- Tests ---

describe("chirp3-handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset module state by reconfiguring with non-chirp3 backend
    setupSettings({ "ai.transcriptionBackend": "gemini-multimodal" });
    reconfigureChirp3();
    vi.runAllTimers(); // Flush debounce
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initializeChirp3()", () => {
    it("skips when backend is not chirp3+gemini", () => {
      setupSettings({ "ai.transcriptionBackend": "gemini-multimodal" });
      initializeChirp3();
      expect(mockConfigure).not.toHaveBeenCalled();
      expect(getChirp3Provider()).toBeNull();
    });

    it("proceeds without project ID (uses credential default)", () => {
      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": null,
      });
      initializeChirp3();
      // projectId is optional — configure is called even without it
      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "" }),
      );
    });

    it("creates and configures provider with API key auth", () => {
      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": "my-project",
        "ai.gcp.authType": "api-key",
        "ai.gcp.apiKey": "test-api-key",
        "ai.gcp.location": "us-central1",
        "ai.chirp3.languageCode": "es-ES",
        "ai.chirp3.confidenceThreshold": "0.8",
      });

      initializeChirp3();

      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "my-project",
          credentials: expect.objectContaining({
            type: "api-key",
            apiKey: "test-api-key",
          }),
          location: "us-central1",
          languageCode: "es-ES",
          confidenceThreshold: 0.8,
        }),
      );
      expect(getChirp3Provider()).not.toBeNull();
    });

    it("creates and configures provider with service account auth", () => {
      const saJson = JSON.stringify({ type: "service_account", project_id: "test" });
      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": "my-project",
        "ai.gcp.authType": "service-account",
        "ai.gcp.serviceAccountJson": saJson,
      });

      initializeChirp3();

      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({
            type: "service-account",
            serviceAccountJson: saJson,
          }),
        }),
      );
    });

    it("sets provider to null on configuration failure", () => {
      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": "my-project",
        "ai.gcp.authType": "api-key",
        "ai.gcp.apiKey": "test-key",
      });
      mockConfigure.mockImplementationOnce(() => {
        throw new Error("Invalid credentials");
      });

      initializeChirp3();

      expect(getChirp3Provider()).toBeNull();
    });

    it("uses default values when settings are missing", () => {
      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": "my-project",
        "ai.gcp.apiKey": "key",
        // No location, language, or threshold set
      });

      initializeChirp3();

      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          location: "global",
          languageCode: "en-US",
          confidenceThreshold: 0.7,
        }),
      );
    });
  });

  describe("reconfigureChirp3()", () => {
    it("disposes existing provider before reinitializing (debounced)", () => {
      // First, create a provider
      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": "project-1",
        "ai.gcp.apiKey": "key-1",
      });
      initializeChirp3();
      vi.clearAllMocks();

      // Reconfigure with new settings
      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": "project-2",
        "ai.gcp.apiKey": "key-2",
      });
      reconfigureChirp3();
      vi.runAllTimers(); // Flush debounce

      expect(mockDispose).toHaveBeenCalled();
      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-2" }),
      );
    });
  });

  describe("registerChirp3Handlers()", () => {
    it("registers getChirp3Config and testChirp3Connection handlers", () => {
      registerChirp3Handlers();

      const registeredChannels = mockHandle.mock.calls.map(
        (call: unknown[]) => call[0],
      );
      expect(registeredChannels).toContain("settings:getChirp3Config");
      expect(registeredChannels).toContain("settings:testChirp3Connection");
    });

    it("getChirp3Config returns current settings", () => {
      registerChirp3Handlers();

      setupSettings({
        "ai.gcp.projectId": "test-project",
        "ai.gcp.authType": "api-key",
        "ai.gcp.location": "eu",
        "ai.chirp3.languageCode": "de-DE",
        "ai.chirp3.confidenceThreshold": "0.85",
        "ai.gcp.apiKey": "some-key",
        "ai.gcp.serviceAccountJson": null,
        "ai.transcriptionBackend": "chirp3+gemini",
      });

      const handler = mockHandle.mock.calls.find(
        (call: unknown[]) => call[0] === "settings:getChirp3Config",
      )?.[1] as () => unknown;

      const config = handler();

      expect(config).toEqual(
        expect.objectContaining({
          projectId: "test-project",
          authType: "api-key",
          location: "eu",
          languageCode: "de-DE",
          confidenceThreshold: 0.85,
          hasApiKey: true,
          hasServiceAccount: false,
          backend: "chirp3+gemini",
        }),
      );
    });

    it("testChirp3Connection returns error when not configured", async () => {
      registerChirp3Handlers();

      // Set up settings that won't configure (no project ID)
      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": null,
      });

      const handler = mockHandle.mock.calls.find(
        (call: unknown[]) => call[0] === "settings:testChirp3Connection",
      )?.[1] as () => Promise<{ valid: boolean; error?: string }>;

      const result = await handler();
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("testChirp3Connection returns success when recognition works", async () => {
      registerChirp3Handlers();

      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": "test-project",
        "ai.gcp.apiKey": "test-key",
      });

      mockIsConfigured.mockReturnValue(true);
      mockRecognizeChunk.mockResolvedValue({
        transcript: "",
        words: [],
        confidence: 0,
        languageCode: "en-US",
        isFinal: true,
      });

      const handler = mockHandle.mock.calls.find(
        (call: unknown[]) => call[0] === "settings:testChirp3Connection",
      )?.[1] as () => Promise<{ valid: boolean; error?: string }>;

      const result = await handler();
      expect(result.valid).toBe(true);
    });

    it("testChirp3Connection returns error on recognition failure", async () => {
      registerChirp3Handlers();

      setupSettings({
        "ai.transcriptionBackend": "chirp3+gemini",
        "ai.gcp.projectId": "test-project",
        "ai.gcp.apiKey": "bad-key",
      });

      mockIsConfigured.mockReturnValue(true);
      mockRecognizeChunk.mockRejectedValue(new Error("UNAUTHENTICATED"));

      const handler = mockHandle.mock.calls.find(
        (call: unknown[]) => call[0] === "settings:testChirp3Connection",
      )?.[1] as () => Promise<{ valid: boolean; error?: string }>;

      const result = await handler();
      expect(result.valid).toBe(false);
      expect(result.error).toBe("UNAUTHENTICATED");
    });
  });
});
