/** Mirrors ModelDefinition from electron/main/services/model-config.types.ts */
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

/** Context definition from config */
export interface ContextDefinition {
  name: string;
  description: string;
  priority: "speed" | "quality" | "cost";
}
