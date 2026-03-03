import { ipcMain } from "electron";
import { modelConfig } from "../services/model-config";
import { getSetting } from "../services/database-extras";

export function registerModelHandlers(): void {
  ipcMain.handle("models:getConfig", () => {
    return modelConfig.getFullConfig();
  });

  ipcMain.handle("models:getForProvider", (_, providerId: string) => {
    return modelConfig.getModelsForProvider(providerId);
  });

  ipcMain.handle(
    "models:getActiveForProvider",
    (_, providerId: string) => {
      return modelConfig.getActiveModelsForProvider(providerId);
    },
  );

  ipcMain.handle("models:getForContext", (_, context: string) => {
    const provider = getSetting("ai.provider") || "google";
    return modelConfig.getModelForContext(provider, context);
  });

  ipcMain.handle("models:getContexts", () => {
    const contextIds = modelConfig.getContextIds();
    const contexts: Record<string, unknown> = {};
    for (const id of contextIds) {
      contexts[id] = modelConfig.getContext(id);
    }
    return contexts;
  });

  ipcMain.handle(
    "models:validate",
    (_, providerId: string, modelId: string) => {
      return {
        valid: modelConfig.validateModel(providerId, modelId),
        deprecated: modelConfig.isModelDeprecated(providerId, modelId),
        migratesTo: modelConfig.getDeprecationMigration(
          providerId,
          modelId,
        ),
      };
    },
  );

  ipcMain.handle(
    "models:getCostMultiplier",
    (_, providerId: string, modelId: string) => {
      return modelConfig.getCostMultiplier(providerId, modelId);
    },
  );
}
