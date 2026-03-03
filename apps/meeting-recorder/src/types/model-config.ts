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

/** Cost info returned by models:getCostInfo */
export interface ModelCostInfo {
  costMultiplier: number;
  recommended: boolean;
  deprecated: boolean;
  sunset: string | null;
  description: string;
}

/** Context definition from config */
export interface ContextDefinition {
  name: string;
  description: string;
  priority: "speed" | "quality" | "cost";
}
