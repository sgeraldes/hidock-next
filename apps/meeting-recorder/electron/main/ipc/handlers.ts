/**
 * Central IPC handler registry.
 * Each domain registers its handlers here.
 * Domain handler files: *-handlers.ts in this directory.
 */

import { registerAppHandlers } from "./app-handlers";
import { registerAudioHandlers } from "./audio-handlers";
import { registerAIHandlers } from "./ai-handlers";
import { registerSessionHandlers } from "./session-handlers";
import { registerSessionDataHandlers } from "./session-data-handlers";
import { registerTranscriptionHandlers } from "./transcription-handlers";
import { registerSpeakerHandlers } from "./speaker-handlers";
import { registerAttachmentHandlers } from "./attachment-handlers";
import { registerMeetingTypeHandlers } from "./meeting-type-handlers";
import { registerTranslationSummarizationHandlers } from "./translation-handlers";
import { registerHistoryHandlers } from "./history-handlers";
import { registerSettingsHandlers } from "./settings-handlers";
import { registerWindowHandlers } from "./window-handlers";

export function registerIpcHandlers(): void {
  registerAppHandlers();
  registerAudioHandlers();
  registerAIHandlers();
  registerSessionHandlers();
  registerSessionDataHandlers();
  registerTranscriptionHandlers();
  registerSpeakerHandlers();
  registerAttachmentHandlers();
  registerMeetingTypeHandlers();
  registerTranslationSummarizationHandlers();
  registerHistoryHandlers();
  registerSettingsHandlers();
  registerWindowHandlers();
  console.log("[IPC] Handlers registered");
}
