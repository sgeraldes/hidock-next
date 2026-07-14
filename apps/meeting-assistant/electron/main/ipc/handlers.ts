/**
 * Central IPC handler registry.
 * Call registerIpcHandlers() once at app startup to wire all domains.
 */

import { registerAppHandlers } from "./app-handlers";
import { registerSessionHandlers } from "./session-handlers";
import { registerTranscriptHandlers } from "./transcript-handlers";
import { registerSuggestionHandlers } from "./suggestion-handlers";
import { registerNotesHandlers } from "./notes-handlers";
import { registerScreenshotHandlers } from "./screenshot-handlers";
import { registerSettingsHandlers } from "./settings-handlers";
import { registerKnowledgeHandlers } from "./knowledge-handlers";
import { registerAudioHandlers } from "./audio-handlers";

export function registerIpcHandlers(): void {
  registerAppHandlers();
  registerSessionHandlers();
  registerTranscriptHandlers();
  registerSuggestionHandlers();
  registerNotesHandlers();
  registerScreenshotHandlers();
  registerSettingsHandlers();
  registerKnowledgeHandlers();
  registerAudioHandlers();
  console.log("[IPC] All handlers registered");
}
