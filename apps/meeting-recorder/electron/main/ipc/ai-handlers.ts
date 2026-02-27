import { ipcMain } from "electron";
import { AIProviderService } from "../services/ai-provider";
import type { AIProviderConfig } from "../services/ai-provider.types";

const aiService = new AIProviderService();

export function registerAIHandlers(): void {
  ipcMain.handle("ai:configure", async (_event, config: AIProviderConfig) => {
    aiService.configure(config);
    return { provider: config.provider, model: config.model };
  });

  ipcMain.handle("ai:getActiveProvider", async () => {
    return aiService.getActiveProvider();
  });

  ipcMain.handle("ai:isAudioCapable", async () => {
    return aiService.isAudioCapable();
  });

  ipcMain.handle("ai:transcribe", async (_event, text: string) => {
    return await aiService.transcribe(text);
  });

  ipcMain.handle(
    "ai:transcribeAudio",
    async (_event, audioData: ArrayBuffer, mimeType: string) => {
      return await aiService.transcribeAudio(Buffer.from(audioData), mimeType);
    },
  );

  ipcMain.handle("ai:summarize", async (_event, transcript: string) => {
    return await aiService.summarize(transcript);
  });

  ipcMain.handle(
    "ai:validateApiKey",
    async (
      _event,
      provider: string,
      apiKey: string,
      extras?: Record<string, string>,
    ) => {
      return aiService.validateApiKey(
        provider as AIProviderConfig["provider"],
        apiKey,
        extras,
      );
    },
  );
}

export function getAIService(): AIProviderService {
  return aiService;
}
