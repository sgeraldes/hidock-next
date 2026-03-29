import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import { SuggestionGetActiveInput, SuggestionDismissInput } from "./validation";

export function registerSuggestionHandlers(): void {
  createHandler({
    channel: CHANNELS.suggestion.getActive,
    schema: SuggestionGetActiveInput,
    handler: async (_input) => {
      // TODO: wire to SuggestionService
      return [];
    },
  });

  createHandler({
    channel: CHANNELS.suggestion.dismiss,
    schema: SuggestionDismissInput,
    handler: async (_input) => {
      // TODO: wire to SuggestionService
      return null;
    },
  });

  console.log("[IPC] Suggestion handlers registered");
}
