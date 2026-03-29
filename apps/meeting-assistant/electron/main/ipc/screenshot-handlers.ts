import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import {
  ScreenshotCaptureInput,
  ScreenshotListInput,
  ScreenshotGetAnalysisInput,
  ScreenshotConfigureInput,
} from "./validation";

export function registerScreenshotHandlers(): void {
  createHandler({
    channel: CHANNELS.screenshot.capture,
    schema: ScreenshotCaptureInput,
    handler: async (_input) => {
      // TODO: wire to ScreenshotService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.screenshot.listForSession,
    schema: ScreenshotListInput,
    handler: async (_input) => {
      // TODO: wire to ScreenshotService
      return [];
    },
  });

  createHandler({
    channel: CHANNELS.screenshot.getAnalysis,
    schema: ScreenshotGetAnalysisInput,
    handler: async (_input) => {
      // TODO: wire to ScreenshotService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.screenshot.configure,
    schema: ScreenshotConfigureInput,
    handler: async (_input) => {
      // TODO: wire to ScreenshotService
      return null;
    },
  });

  console.log("[IPC] Screenshot handlers registered");
}
