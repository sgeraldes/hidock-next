import { streamText, type LanguageModel } from "ai";
import { BrowserWindow } from "electron";
import { PROMPTS } from "./ai-prompts";
import {
  getTranscriptBySession,
  updateSession,
  saveDatabase,
} from "./database";
import type { SummarizationResult } from "./ai-provider.types";

export class SummarizationService {
  private model: LanguageModel | null = null;

  setModel(model: LanguageModel): void {
    this.model = model;
  }

  async summarizeSession(sessionId: string): Promise<SummarizationResult> {
    if (!this.model) {
      throw new Error("AI model not configured. Call setModel() first.");
    }

    const segments = getTranscriptBySession(sessionId);

    if (segments.length === 0) {
      return { summary: "No transcript content to summarize.", keyPoints: [] };
    }

    const transcriptText = segments
      .map((s) => `${s.speaker_name ?? "Unknown"}: ${s.text}`)
      .join("\n");

    try {
      const { textStream, text } = await streamText({
        model: this.model,
        system: PROMPTS.SUMMARIZATION,
        prompt: transcriptText,
      });

      for await (const chunk of textStream) {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send("summarization:chunk", {
            sessionId,
            text: chunk,
          });
        }
      }

      const fullText = await text;

      updateSession(sessionId, { summary: fullText });
      saveDatabase();

      return { summary: fullText, keyPoints: [] };
    } catch (err) {
      console.error("[Summarization] Failed for session", sessionId, err);
      throw new Error(
        `Summarization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
