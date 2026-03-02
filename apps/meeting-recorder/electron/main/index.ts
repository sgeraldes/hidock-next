import { app, BrowserWindow } from "electron";
import { electronApp, optimizer } from "@electron-toolkit/utils";
import { registerIpcHandlers } from "./ipc/handlers";
import { createMainWindow, getMainWindow } from "./services/window-manager";
import { initializeTray, destroyTray } from "./services/tray-manager";
import {
  initializeDatabase,
  closeDatabase,
  saveDatabase,
  markCleanShutdown,
} from "./services/database";
import { getSetting } from "./services/database-extras";
import { getAIService } from "./ipc/ai-handlers";
import {
  getTranslationService,
  getSummarizationService,
} from "./ipc/translation-handlers";
import { getEndOfMeetingProcessor } from "./ipc/meeting-type-handlers";
import type { AIProviderConfig } from "./services/ai-provider.types";

/**
 * Bootstrap AI services with saved configuration from database.
 * This ensures AI provider is ready when first transcription starts.
 * Fixes: TRX-001, SUM-001
 */
function bootstrapAIServices(): void {
  const provider = getSetting("ai.provider");
  const model = getSetting("ai.model");

  if (!provider || !model) {
    console.log("[Bootstrap] No AI provider configured yet");
    return;
  }

  const config: AIProviderConfig = {
    provider: provider as AIProviderConfig["provider"],
    model,
    apiKey: getSetting("ai.apiKey") ?? "",
    ollamaBaseUrl: getSetting("ai.ollamaBaseUrl") ?? undefined,
    bedrockRegion: getSetting("ai.bedrockRegion") ?? undefined,
    bedrockAccessKeyId: getSetting("ai.bedrockAccessKeyId") ?? undefined,
    bedrockSecretAccessKey:
      getSetting("ai.bedrockSecretAccessKey") ?? undefined,
    bedrockSessionToken: getSetting("ai.bedrockSessionToken") ?? undefined,
  };

  try {
    const aiService = getAIService();
    aiService.configure(config);

    const langModel = aiService.getModel();
    if (langModel) {
      getTranslationService().setModel(langModel);
      getSummarizationService().setModel(langModel);
      getEndOfMeetingProcessor().setModel(langModel);
    }

    console.log(`[Bootstrap] AI services configured: ${provider}/${model}`);
  } catch (err) {
    console.warn("[Bootstrap] Failed to initialize AI services:", err);
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.hidock.meeting-recorder");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  await initializeDatabase();

  // Initialize AI services with saved configuration (CRITICAL FIX)
  bootstrapAIServices();

  registerIpcHandlers();

  createMainWindow();
  initializeTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  // End any active sessions and finalize audio
  const { getSessionManager } = await import("./ipc/session-handlers");
  const sessionManager = getSessionManager();
  await sessionManager.dispose();

  markCleanShutdown(); // Mark clean shutdown before saving
  saveDatabase();
  closeDatabase();
  destroyTray();
});

export { getMainWindow };
