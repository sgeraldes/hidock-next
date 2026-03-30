import { z } from "zod";
import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import { SuggestionGetActiveInput, SuggestionDismissInput } from "./validation";

// ── Service interface ─────────────────────────────────────────────────────────

interface SuggestionService {
  getActive(sessionId: string): Promise<unknown[]>;
  dismiss(suggestionId: string): Promise<void>;
  trigger(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
}

let _service: SuggestionService | null = null;

/** Wire up the SuggestionService after it is instantiated in main. */
export function setSuggestionService(service: SuggestionService): void {
  _service = service;
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export function registerSuggestionHandlers(): void {
  createHandler({
    channel: CHANNELS.suggestion.getActive,
    schema: SuggestionGetActiveInput,
    handler: async (input) => {
      if (!_service) return [];
      return _service.getActive(input.sessionId);
    },
  });

  createHandler({
    channel: CHANNELS.suggestion.dismiss,
    schema: SuggestionDismissInput,
    handler: async (input) => {
      if (!_service) return null;
      await _service.dismiss(input.suggestionId);
      return null;
    },
  });

  createHandler({
    channel: "suggestion:trigger",
    schema: z.void(),
    handler: async () => {
      if (!_service) return null;
      await _service.trigger();
      return null;
    },
  });

  createHandler({
    channel: "suggestion:setEnabled",
    schema: z.object({ enabled: z.boolean() }),
    handler: async (input) => {
      if (!_service) return null;
      await _service.setEnabled(input.enabled);
      return null;
    },
  });

  console.log("[IPC] Suggestion handlers registered");
}
