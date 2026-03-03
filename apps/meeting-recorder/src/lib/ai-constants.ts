// Model defaults are now loaded from models.config.json via IPC.
// This file retains only type re-exports needed by the renderer.
//
// To get default models in the renderer:
//   const config = await window.electronAPI.models.getConfig();
//   const defaultModel = config.providers[providerId].defaultModel;

// Re-export provider key type for renderer convenience
export type AIProviderKey =
  | "google"
  | "openai"
  | "anthropic"
  | "bedrock"
  | "ollama";
