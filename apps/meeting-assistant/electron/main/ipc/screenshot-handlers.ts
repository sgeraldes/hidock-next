import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import {
  ScreenshotCaptureInput,
  ScreenshotListInput,
  ScreenshotGetAnalysisInput,
  ScreenshotConfigureInput,
} from "./validation";

// ── Service interface ─────────────────────────────────────────────────────────

interface ScreenshotService {
  capture(sessionId: string): Promise<unknown>;
  listForSession(sessionId: string): Promise<unknown[]>;
  getAnalysis(screenshotId: string): Promise<unknown>;
  configure(options: {
    autoCapture?: boolean;
    intervalSeconds?: number;
    analyzeWithLLM?: boolean;
  }): Promise<void>;
}

let _service: ScreenshotService | null = null;

/** Wire up the ScreenshotService after it is instantiated in main. */
export function setScreenshotService(service: ScreenshotService): void {
  _service = service;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export function registerScreenshotHandlers(): void {
  createHandler({
    channel: CHANNELS.screenshot.capture,
    schema: ScreenshotCaptureInput,
    handler: async (input) => {
      if (!_service) return null;
      return _service.capture(input.sessionId);
    },
  });

  createHandler({
    channel: CHANNELS.screenshot.listForSession,
    schema: ScreenshotListInput,
    handler: async (input) => {
      if (!_service) return [];
      return _service.listForSession(input.sessionId);
    },
  });

  createHandler({
    channel: CHANNELS.screenshot.getAnalysis,
    schema: ScreenshotGetAnalysisInput,
    handler: async (input) => {
      if (!_service) return null;
      return _service.getAnalysis(input.screenshotId);
    },
  });

  createHandler({
    channel: CHANNELS.screenshot.configure,
    schema: ScreenshotConfigureInput,
    handler: async (input) => {
      if (!_service) return null;
      await _service.configure(input);
      return null;
    },
  });

  console.log("[IPC] Screenshot handlers registered");
}
