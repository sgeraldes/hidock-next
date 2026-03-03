import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

// Import the actual service (not mocked) - it reads the real config file
import { modelConfig } from "../services/model-config";

describe("ModelConfigService", () => {
  it("loads config successfully", () => {
    expect(modelConfig.getProviderIds()).toContain("google");
    expect(modelConfig.getProviderIds()).toContain("openai");
    expect(modelConfig.getProviderIds()).toContain("anthropic");
    expect(modelConfig.getProviderIds()).toContain("bedrock");
    expect(modelConfig.getProviderIds()).toContain("ollama");
  });

  it("returns correct default model for google", () => {
    expect(modelConfig.getDefaultModel("google")).toBe("gemini-2.5-flash");
  });

  it("returns correct default model for openai", () => {
    expect(modelConfig.getDefaultModel("openai")).toBe("gpt-4o");
  });

  it("returns correct default model for anthropic", () => {
    expect(modelConfig.getDefaultModel("anthropic")).toBe("claude-sonnet-4-20250514");
  });

  it("returns correct default model for bedrock", () => {
    expect(modelConfig.getDefaultModel("bedrock")).toBe("anthropic.claude-sonnet-4-20250514-v1:0");
  });

  it("returns correct default model for ollama", () => {
    expect(modelConfig.getDefaultModel("ollama")).toBe("llama3.2");
  });

  it("validates known model", () => {
    expect(modelConfig.validateModel("google", "gemini-2.5-flash")).toBe(true);
  });

  it("rejects unknown model", () => {
    expect(modelConfig.validateModel("google", "nonexistent")).toBe(false);
  });

  it("allows custom models for ollama", () => {
    expect(modelConfig.validateModel("ollama", "any-custom-model")).toBe(true);
  });

  it("returns false for unknown provider", () => {
    expect(modelConfig.validateModel("nonexistent", "model")).toBe(false);
  });

  it("identifies deprecated models", () => {
    expect(modelConfig.isModelDeprecated("google", "gemini-2.0-flash")).toBe(true);
    expect(modelConfig.isModelDeprecated("google", "gemini-2.5-flash")).toBe(false);
  });

  it("returns migration target for deprecated model", () => {
    expect(modelConfig.getDeprecationMigration("google", "gemini-2.0-flash")).toBe("gemini-2.5-flash");
  });

  it("returns null migration for non-deprecated model", () => {
    expect(modelConfig.getDeprecationMigration("google", "gemini-2.5-flash")).toBeNull();
  });

  it("returns correct cost multiplier", () => {
    expect(modelConfig.getCostMultiplier("google", "gemini-2.5-flash")).toBe(1);
    expect(modelConfig.getCostMultiplier("google", "gemini-2.5-pro")).toBe(10);
  });

  it("returns default cost multiplier for unknown model", () => {
    expect(modelConfig.getCostMultiplier("google", "nonexistent")).toBe(1);
  });

  it("detects audio capability from config", () => {
    expect(modelConfig.isAudioCapable("google")).toBe(true);
    expect(modelConfig.isAudioCapable("openai")).toBe(false);
    expect(modelConfig.isAudioCapable("anthropic")).toBe(false);
    expect(modelConfig.isAudioCapable("bedrock")).toBe(false);
    expect(modelConfig.isAudioCapable("ollama")).toBe(false);
  });

  it("returns false audio capability for unknown provider", () => {
    expect(modelConfig.isAudioCapable("nonexistent")).toBe(false);
  });

  it("selects correct model for context", () => {
    const realtime = modelConfig.getModelForContext("google", "realtime");
    expect(realtime).toBe("gemini-2.5-flash"); // recommended for realtime
  });

  it("selects recommended model over cheaper alternatives", () => {
    // gemini-2.5-flash is recommended and in postprocess context
    const postprocess = modelConfig.getModelForContext("google", "postprocess");
    expect(postprocess).toBe("gemini-2.5-flash");
  });

  it("returns provider default when no context model matches", () => {
    const unknown = modelConfig.getModelForContext("google", "nonexistent-context");
    expect(unknown).toBe("gemini-2.5-flash"); // falls back to default
  });

  it("returns empty string for unknown provider context", () => {
    expect(modelConfig.getModelForContext("nonexistent", "realtime")).toBe("");
  });

  it("returns empty string for unknown provider default", () => {
    expect(modelConfig.getDefaultModel("nonexistent")).toBe("");
  });

  it("getFullConfig returns valid structure", () => {
    const config = modelConfig.getFullConfig();
    expect(config.version).toBe(1);
    expect(config.providers).toBeDefined();
    expect(config.contexts).toBeDefined();
  });

  it("getModelsForProvider returns all models for google", () => {
    const models = modelConfig.getModelsForProvider("google");
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models.map((m) => m.id)).toContain("gemini-2.5-flash");
    expect(models.map((m) => m.id)).toContain("gemini-2.5-pro");
    expect(models.map((m) => m.id)).toContain("gemini-2.0-flash");
  });

  it("getActiveModelsForProvider excludes deprecated models", () => {
    const active = modelConfig.getActiveModelsForProvider("google");
    const ids = active.map((m) => m.id);
    expect(ids).toContain("gemini-2.5-flash");
    expect(ids).toContain("gemini-2.5-pro");
    expect(ids).not.toContain("gemini-2.0-flash");
  });

  it("getModelsForProvider returns empty array for unknown provider", () => {
    expect(modelConfig.getModelsForProvider("nonexistent")).toEqual([]);
  });

  it("getModel returns correct model definition", () => {
    const model = modelConfig.getModel("google", "gemini-2.5-flash");
    expect(model).not.toBeNull();
    expect(model!.name).toBe("Gemini 2.5 Flash");
    expect(model!.costMultiplier).toBe(1);
    expect(model!.recommended).toBe(true);
  });

  it("getModel returns null for unknown model", () => {
    expect(modelConfig.getModel("google", "nonexistent")).toBeNull();
  });

  it("getModel returns null for unknown provider", () => {
    expect(modelConfig.getModel("nonexistent", "gemini-2.5-flash")).toBeNull();
  });

  it("getContextIds returns all contexts", () => {
    const ids = modelConfig.getContextIds();
    expect(ids).toContain("realtime");
    expect(ids).toContain("postprocess");
    expect(ids).toContain("critical");
    expect(ids).toContain("batch");
  });

  it("getContext returns context definition", () => {
    const ctx = modelConfig.getContext("realtime");
    expect(ctx).toBeDefined();
    expect(ctx!.name).toBe("Real-time Transcription");
    expect(ctx!.priority).toBe("speed");
  });

  it("getContext returns undefined for unknown context", () => {
    expect(modelConfig.getContext("nonexistent")).toBeUndefined();
  });

  it("getProvider returns provider definition", () => {
    const provider = modelConfig.getProvider("google");
    expect(provider).toBeDefined();
    expect(provider!.name).toBe("Google Gemini");
    expect(provider!.audioCapable).toBe(true);
  });

  it("getProvider returns undefined for unknown provider", () => {
    expect(modelConfig.getProvider("nonexistent")).toBeUndefined();
  });

  it("deprecated model has empty contexts", () => {
    const model = modelConfig.getModel("google", "gemini-2.0-flash");
    expect(model).not.toBeNull();
    expect(model!.deprecated).toBe(true);
    expect(model!.contexts).toEqual([]);
  });
});
