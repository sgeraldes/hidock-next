import * as fs from "fs";
import * as path from "path";
import type {
  ModelConfig,
  ModelDefinition,
  ProviderDefinition,
  ContextDefinition,
} from "./model-config.types";

class ModelConfigService {
  private config: ModelConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): ModelConfig {
    // Try multiple paths to handle both dev and production builds.
    // In dev mode with electron-vite, __dirname points to the bundled output.
    // In production, the config must be adjacent to the main bundle.
    const candidates = [
      // Production build: out/main/ -> out/main/config/
      path.join(__dirname, "./config/models.config.json"),
      // Source tree: electron/main/services/ -> electron/main/config/
      path.join(__dirname, "../config/models.config.json"),
      // Fallback: project root -> electron/main/config/
      path.join(__dirname, "../../electron/main/config/models.config.json"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, "utf-8");
        try {
          const parsed = JSON.parse(raw) as ModelConfig;
          if (!parsed.providers || !parsed.contexts) {
            console.error(
              `[ModelConfig] Config at ${candidate} missing required fields`,
            );
            continue;
          }
          console.log(
            `[ModelConfig] Loaded config v${parsed.version} from ${candidate}`,
          );
          return parsed;
        } catch (e) {
          console.error(`[ModelConfig] Failed to parse ${candidate}:`, e);
          continue;
        }
      }
    }

    console.error(
      "[ModelConfig] Config file not found, tried:",
      candidates.join(", "),
    );
    throw new Error(
      "models.config.json not found. Ensure it exists in electron/main/config/.",
    );
  }

  /** Reload config from disk (useful for hot-reload in dev). */
  reload(): void {
    this.config = this.loadConfig();
  }

  getProvider(providerId: string): ProviderDefinition | undefined {
    return this.config.providers[providerId];
  }

  getProviderIds(): string[] {
    return Object.keys(this.config.providers);
  }

  getModel(providerId: string, modelId: string): ModelDefinition | null {
    const provider = this.getProvider(providerId);
    if (!provider) return null;
    return provider.models.find((m) => m.id === modelId) ?? null;
  }

  getModelsForProvider(providerId: string): ModelDefinition[] {
    return this.getProvider(providerId)?.models ?? [];
  }

  /** Get non-deprecated models for a provider. */
  getActiveModelsForProvider(providerId: string): ModelDefinition[] {
    return this.getModelsForProvider(providerId).filter((m) => !m.deprecated);
  }

  getDefaultModel(providerId: string): string {
    const provider = this.getProvider(providerId);
    if (!provider) {
      console.warn(
        `[ModelConfig] Unknown provider "${providerId}", falling back to Google default`,
      );
      // Fall back to Google's default model rather than returning empty string
      const googleProvider = this.getProvider("google");
      return googleProvider?.defaultModel ?? "gemini-2.5-flash";
    }
    return provider.defaultModel;
  }

  getModelForContext(providerId: string, context: string): string {
    const provider = this.getProvider(providerId);
    if (!provider) return "";

    const contextModels = provider.models.filter(
      (m) => m.contexts.includes(context) && !m.deprecated,
    );

    // Prefer recommended model for this context
    const recommended = contextModels.find((m) => m.recommended);
    if (recommended) return recommended.id;

    // Otherwise pick cheapest model that supports this context
    const sorted = [...contextModels].sort(
      (a, b) => a.costMultiplier - b.costMultiplier,
    );
    if (sorted.length > 0) return sorted[0].id;

    // Fallback to provider default
    return provider.defaultModel;
  }

  validateModel(providerId: string, modelId: string): boolean {
    const provider = this.getProvider(providerId);
    if (!provider) return false;

    // Allow custom models for providers that support them (e.g., ollama)
    if (provider.allowCustomModels) return true;

    return provider.models.some((m) => m.id === modelId);
  }

  isModelDeprecated(providerId: string, modelId: string): boolean {
    const model = this.getModel(providerId, modelId);
    return model?.deprecated === true;
  }

  getDeprecationMigration(
    providerId: string,
    modelId: string,
  ): string | null {
    const model = this.getModel(providerId, modelId);
    return model?.migratesTo ?? null;
  }

  getCostMultiplier(providerId: string, modelId: string): number {
    return this.getModel(providerId, modelId)?.costMultiplier ?? 1;
  }

  isAudioCapable(providerId: string): boolean {
    return this.getProvider(providerId)?.audioCapable === true;
  }

  getContext(contextId: string): ContextDefinition | undefined {
    return this.config.contexts[contextId];
  }

  getContextIds(): string[] {
    return Object.keys(this.config.contexts);
  }

  /** Get the full config (for IPC transport to renderer). Returns a deep copy. */
  getFullConfig(): ModelConfig {
    return JSON.parse(JSON.stringify(this.config));
  }
}

export const modelConfig = new ModelConfigService();
