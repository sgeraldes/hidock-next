import { generateObject, type LanguageModel } from "ai";
import { TranslationResultSchema } from "./ai-schemas";
import { PROMPTS } from "./ai-prompts";
import type { TranslationResult } from "./ai-provider.types";

export class TranslationService {
  private model: LanguageModel | null = null;
  private activeCalls = 0;
  private readonly maxConcurrent = 2;
  private queue: Array<{
    resolve: (v: TranslationResult["translatedSegments"]) => void;
    texts: string[];
    targetLanguage: string;
  }> = [];

  setModel(model: LanguageModel): void {
    this.model = model;
  }

  async translateBatch(
    texts: string[],
    targetLanguage: string,
  ): Promise<TranslationResult["translatedSegments"]> {
    if (texts.length === 0) return [];

    if (this.activeCalls >= this.maxConcurrent) {
      return new Promise((resolve) => {
        this.queue.push({ resolve, texts, targetLanguage });
      });
    }

    return this.executeTranslation(texts, targetLanguage);
  }

  private async executeTranslation(
    texts: string[],
    targetLanguage: string,
  ): Promise<TranslationResult["translatedSegments"]> {
    this.activeCalls++;

    try {
      const result = await this.callWithBackoff(texts, targetLanguage);
      return result;
    } catch (error) {
      console.warn("[Translation] Failed:", error);
      return [];
    } finally {
      this.activeCalls--;
      this.processQueue();
    }
  }

  private async callWithBackoff(
    texts: string[],
    targetLanguage: string,
    attempt = 0,
  ): Promise<TranslationResult["translatedSegments"]> {
    const prompt = `Target language: ${targetLanguage}\n\nTexts to translate:\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;

    if (!this.model) {
      throw new Error("AI model not configured. Call setModel() first.");
    }

    try {
      const { object } = await generateObject({
        model: this.model,
        schema: TranslationResultSchema,
        system: PROMPTS.TRANSLATION,
        prompt,
      });
      return (object as TranslationResult).translatedSegments;
    } catch (error) {
      const is429 =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate"));
      if (is429 && attempt < 3) {
        const delayMs = 1000 * Math.pow(2, attempt);
        console.warn(
          `[Translation] Rate limited, retrying in ${delayMs}ms (attempt ${attempt + 1}/3)`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        return this.callWithBackoff(texts, targetLanguage, attempt + 1);
      }
      throw error;
    }
  }

  private processQueue(): void {
    if (this.queue.length === 0 || this.activeCalls >= this.maxConcurrent) {
      return;
    }

    const next = this.queue.shift()!;
    this.executeTranslation(next.texts, next.targetLanguage)
      .then(next.resolve)
      .catch(() => next.resolve([]));
  }
}
