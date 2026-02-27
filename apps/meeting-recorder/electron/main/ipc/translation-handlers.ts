import { ipcMain } from "electron";
import { TranslationService } from "../services/translation-service";
import { SummarizationService } from "../services/summarization-service";

const translationService = new TranslationService();
const summarizationService = new SummarizationService();

export function registerTranslationSummarizationHandlers(): void {
  ipcMain.handle(
    "translation:translateBatch",
    async (_, texts: string[], targetLanguage: string) => {
      return translationService.translateBatch(texts, targetLanguage);
    },
  );

  ipcMain.handle("summarization:generate", async (_, sessionId: string) => {
    return summarizationService.summarizeSession(sessionId);
  });
}

export function getTranslationService(): TranslationService {
  return translationService;
}

export function getSummarizationService(): SummarizationService {
  return summarizationService;
}
