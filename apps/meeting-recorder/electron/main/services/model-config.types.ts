export interface ModelDefinition {
  id: string;
  name: string;
  description: string;
  costMultiplier: number;
  contexts: string[];
  capabilities: string[];
  deprecated?: boolean;
  recommended?: boolean;
  migratesTo?: string;
  sunset?: string;
}

export interface ProviderDefinition {
  name: string;
  audioCapable: boolean;
  models: ModelDefinition[];
  defaultModel: string;
  requiresTranscription?: boolean;
  transcriptionProvider?: string;
  allowCustomModels?: boolean;
}

export interface ContextDefinition {
  name: string;
  description: string;
  priority: "speed" | "quality" | "cost";
}

export interface ModelConfig {
  version: number;
  providers: Record<string, ProviderDefinition>;
  contexts: Record<string, ContextDefinition>;
}
