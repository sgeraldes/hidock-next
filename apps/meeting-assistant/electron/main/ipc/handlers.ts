/**
 * Central IPC handler registry.
 * Call registerIpcHandlers() once at app startup to wire all domains.
 */

import { registerSessionHandlers } from "./session-handlers";
import { registerTranscriptHandlers } from "./transcript-handlers";
import { registerSuggestionHandlers } from "./suggestion-handlers";
import { registerNotesHandlers } from "./notes-handlers";
import { registerScreenshotHandlers } from "./screenshot-handlers";
import { registerSettingsHandlers } from "./settings-handlers";

export function registerIpcHandlers(): void {
  registerSessionHandlers();
  registerTranscriptHandlers();
  registerSuggestionHandlers();
  registerNotesHandlers();
  registerScreenshotHandlers();
  registerSettingsHandlers();
  console.log("[IPC] All handlers registered");
}
