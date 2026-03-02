import { generateObject, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOllama } from "ollama-ai-provider";

import {
  TranscriptionResultSchema,
  SummarizationResultSchema,
} from "./ai-schemas";
import { PROMPTS, buildTranscriptionPrompt } from "./ai-prompts";
import type {
  AIProviderConfig,
  AIProviderKey,
  TranscriptionResult,
  SummarizationResult,
} from "./ai-provider.types";

export class AIProviderService {
  private config: AIProviderConfig | null = null;
  private model: LanguageModel | null = null;
  /** Secondary model used for audio transcription when main provider is text-only. */
  private transcriptionModel: LanguageModel | null = null;

  configure(config: AIProviderConfig): void {
    this.config = config;
    this.model = this.createModel(config);

    if (
      !this.isAudioCapableForConfig(config) &&
      config.transcriptionProvider === "google" &&
      config.transcriptionApiKey
    ) {
      const google = createGoogleGenerativeAI({
        apiKey: config.transcriptionApiKey,
      });
      this.transcriptionModel = google("gemini-2.0-flash");
    } else {
      this.transcriptionModel = null;
    }
  }

  getModel(): LanguageModel | null {
    return this.model;
  }

  getActiveProvider(): AIProviderKey | null {
    return this.config?.provider ?? null;
  }

  isAudioCapable(): boolean {
    if (!this.config) return false;
    return this.isAudioCapableForConfig(this.config);
  }

  private isAudioCapableForConfig(config: AIProviderConfig): boolean {
    return config.provider === "google";
  }

  async transcribe(
    text: string,
    options?: { attendees?: string[]; meetingContext?: string },
  ): Promise<TranscriptionResult> {
    if (!this.model || !this.config) {
      throw new Error("AI provider not configured");
    }

    const prompt = buildTranscriptionPrompt(
      options?.meetingContext,
      options?.attendees,
    );

    try {
      const { object } = await generateObject({
        model: this.model,
        schema: TranscriptionResultSchema,
        system: prompt,
        prompt: text,
      });
      return object;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.isAuthError(message)) {
        console.error("[AIProvider] Auth error during transcription:", message);
        throw new Error(`API key error: ${message}`);
      }
      console.warn("[AIProvider] generateObject failed, using fallback:", err);
      return this.fallbackTranscription(text);
    }
  }

  async transcribeAudio(
    audioData: Buffer,
    mimeType: string,
    options?: { attendees?: string[]; meetingContext?: string },
  ): Promise<TranscriptionResult> {
    if (!this.model || !this.config) {
      throw new Error("AI provider not configured");
    }
    const effectiveModel = this.isAudioCapable()
      ? this.model
      : this.transcriptionModel;

    if (!effectiveModel) {
      throw new Error(
        `Provider '${this.config.provider}' is not audio-capable. Configure a transcription provider (e.g. Google Gemini) in Settings.`,
      );
    }

    const prompt = buildTranscriptionPrompt(
      options?.meetingContext,
      options?.attendees,
    );

    // Normalize mimeType: strip codec params (e.g. "audio/ogg;codecs=opus" -> "audio/ogg")
    // AI models typically only need the base media type
    const baseMimeType = mimeType.split(";")[0].trim();

    try {
      const { object } = await generateObject({
        model: effectiveModel,
        schema: TranscriptionResultSchema,
        system: prompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "file",
                data: audioData,
                mediaType: baseMimeType,
              },
              {
                type: "text",
                text: "Transcribe the speech in this audio clip.",
              },
            ],
          },
        ],
      });
      return object;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Detect auth/config errors - these should NOT be silently swallowed
      if (this.isAuthError(message)) {
        console.error("[AIProvider] Auth error during audio transcription:", message);
        throw new Error(`API key error: ${message}`);
      }
      console.warn(
        "[AIProvider] Audio transcription failed, using fallback:",
        err,
      );
      return this.fallbackTranscription("[Audio transcription failed]");
    }
  }

  async summarize(transcript: string): Promise<SummarizationResult> {
    if (!this.model || !this.config) {
      throw new Error("AI provider not configured");
    }

    try {
      const { object } = await generateObject({
        model: this.model,
        schema: SummarizationResultSchema,
        system: PROMPTS.SUMMARIZATION,
        prompt: transcript,
      });
      return object;
    } catch (err) {
      console.warn("[AIProvider] Summarization failed:", err);
      throw new Error(
        `Summarization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  validateApiKey(
    provider: AIProviderKey,
    apiKey: string,
    extras?: {
      bedrockRegion?: string;
      bedrockAccessKeyId?: string;
      bedrockSecretAccessKey?: string;
    },
  ): { valid: boolean; error?: string } {
    if (provider === "ollama") {
      return { valid: true };
    }

    if (provider === "bedrock") {
      if (!extras?.bedrockRegion) {
        return { valid: false, error: "AWS region is required for Bedrock" };
      }
      if (!extras?.bedrockAccessKeyId || !extras?.bedrockSecretAccessKey) {
        return {
          valid: false,
          error: "AWS access key and secret are required for Bedrock",
        };
      }
      return { valid: true };
    }

    if (!apiKey || apiKey.trim().length === 0) {
      return {
        valid: false,
        error: `API key is required for ${provider}`,
      };
    }
    return { valid: true };
  }

  private createModel(config: AIProviderConfig): LanguageModel {
    switch (config.provider) {
      case "google": {
        const google = createGoogleGenerativeAI({
          apiKey: config.apiKey,
        });
        return google(config.model);
      }
      case "openai": {
        const openai = createOpenAI({ apiKey: config.apiKey });
        return openai(config.model);
      }
      case "anthropic": {
        const anthropic = createAnthropic({ apiKey: config.apiKey });
        return anthropic(config.model);
      }
      case "bedrock": {
        const bedrock = createAmazonBedrock({
          region: config.bedrockRegion ?? "us-east-1",
          accessKeyId: config.bedrockAccessKeyId,
          secretAccessKey: config.bedrockSecretAccessKey,
          sessionToken: config.bedrockSessionToken,
        });
        return bedrock(config.model);
      }
      case "ollama": {
        const ollama = createOllama({
          baseURL: config.ollamaBaseUrl ?? "http://localhost:11434/api",
        });
        return ollama(config.model) as unknown as LanguageModel;
      }
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  private isAuthError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("api key not valid") ||
      lower.includes("invalid api key") ||
      lower.includes("permission_denied") ||
      lower.includes("unauthenticated") ||
      lower.includes("unauthorized") ||
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("api_key_invalid")
    );
  }

  private fallbackTranscription(text: string): TranscriptionResult {
    return {
      segments: [
        {
          speaker: "Unknown",
          text,
          sentiment: "neutral",
        },
      ],
      topics: [],
      actionItems: [],
    };
  }
}
