import { generateObject, type LanguageModel } from "ai";
import { BrowserWindow } from "electron";
import { EndOfMeetingResultSchema } from "./ai-schemas";
import { buildEndOfMeetingPrompt } from "./ai-prompts";
import {
  getTranscriptBySession,
  getAttachmentsBySession,
  getMeetingTypes,
  updateSession,
  saveDatabase,
} from "./database";
import type {
  TranscriptSegment,
  Attachment,
  MeetingType,
} from "./database.types";
import type { EndOfMeetingResult } from "./ai-provider.types";

function broadcastToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

function buildTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `${s.speaker_name ?? "Unknown"}: ${s.text}`)
    .join("\n");
}

function buildContextSection(attachments: Attachment[]): string {
  const parts: string[] = [];

  const notes = attachments.filter((a) => a.type === "note" && a.content_text);
  if (notes.length > 0) {
    parts.push("--- Notes ---");
    for (const note of notes) {
      parts.push(note.content_text!);
    }
  }

  const files = attachments.filter((a) => a.type === "file" && a.filename);
  if (files.length > 0) {
    parts.push("--- Attached Files ---");
    for (const file of files) {
      parts.push(`- ${file.filename} (${file.mime_type ?? "unknown type"})`);
    }
  }

  return parts.join("\n");
}

export class EndOfMeetingProcessor {
  private model: LanguageModel | null = null;

  setModel(model: LanguageModel): void {
    this.model = model;
  }

  async process(sessionId: string, meetingTypeId?: string): Promise<void> {
    if (!this.model) {
      throw new Error("AI model not configured. Call setModel() first.");
    }

    const segments = getTranscriptBySession(sessionId);

    if (segments.length === 0) {
      updateSession(sessionId, {
        title: "Empty Session",
        summary: "No transcript content recorded.",
      });
      saveDatabase();
      return;
    }

    const attachments = getAttachmentsBySession(sessionId);
    const transcriptText = buildTranscriptText(segments);
    const contextSection = buildContextSection(attachments);

    let promptTemplate: string | undefined;
    if (meetingTypeId) {
      const meetingTypes = getMeetingTypes();
      const mt = meetingTypes.find((t: MeetingType) => t.id === meetingTypeId);
      if (mt?.prompt_template) {
        promptTemplate = mt.prompt_template;
      }
    }

    const systemPrompt = buildEndOfMeetingPrompt(promptTemplate);

    let fullPrompt = `--- Transcript ---\n${transcriptText}`;
    if (contextSection) {
      fullPrompt += `\n\n${contextSection}`;
    }

    try {
      const { object } = await generateObject({
        model: this.model,
        schema: EndOfMeetingResultSchema,
        system: systemPrompt,
        prompt: fullPrompt,
      });

      const result = object as EndOfMeetingResult;

      updateSession(sessionId, {
        title: result.title,
        summary: JSON.stringify(result),
      });
      saveDatabase();

      broadcastToAllWindows("session:processingComplete", {
        sessionId,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";

      updateSession(sessionId, {
        title: "Processing Failed",
        summary: `Error: ${message}`,
      });
      saveDatabase();

      broadcastToAllWindows("session:processingError", {
        sessionId,
        error: message,
      });
    }
  }
}
