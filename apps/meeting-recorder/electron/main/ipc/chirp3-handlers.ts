import { ipcMain } from "electron";
import { Chirp3Provider } from "../services/chirp3-provider";
import type { Chirp3Config } from "../services/chirp3-provider.types";
import { getSetting } from "../services/database-extras";
import {
  BACKEND_CHIRP3_GEMINI,
  BACKEND_GEMINI_MULTIMODAL,
} from "../services/transcription-backend";

let chirp3Provider: Chirp3Provider | null = null;

export function getChirp3Provider(): Chirp3Provider | null {
  return chirp3Provider;
}

/** Read all Chirp 3 settings from the database. */
function loadChirp3Settings() {
  const authType = (getSetting("ai.gcp.authType") || "api-key") as "api-key" | "service-account";
  const projectId = getSetting("ai.gcp.projectId") || "";
  const location = getSetting("ai.gcp.location") || "global";
  const languageCode = getSetting("ai.chirp3.languageCode") || "en-US";
  const confidenceThreshold = parseFloat(getSetting("ai.chirp3.confidenceThreshold") || "0.7");
  const backend = getSetting("ai.transcriptionBackend") || BACKEND_GEMINI_MULTIMODAL;
  const hasApiKey = !!getSetting("ai.gcp.apiKey");
  const hasServiceAccount = !!getSetting("ai.gcp.serviceAccountJson");

  return {
    authType,
    projectId,
    location,
    languageCode,
    confidenceThreshold,
    backend,
    hasApiKey,
    hasServiceAccount,
    apiKey: authType === "api-key" ? (getSetting("ai.gcp.apiKey") ?? undefined) : undefined,
    serviceAccountJson: authType === "service-account"
      ? (getSetting("ai.gcp.serviceAccountJson") ?? undefined)
      : undefined,
  };
}

export function initializeChirp3(): void {
  const settings = loadChirp3Settings();

  if (settings.backend !== BACKEND_CHIRP3_GEMINI) {
    console.log(
      "[Chirp3] Backend is not chirp3+gemini, skipping initialization",
    );
    return;
  }

  // projectId is optional — inferred from API key or service account credentials
  if (!settings.projectId) {
    console.log("[Chirp3] No explicit GCP project ID configured (will use credential default)");
  }

  const config: Chirp3Config = {
    credentials: {
      type: settings.authType,
      apiKey: settings.apiKey,
      serviceAccountJson: settings.serviceAccountJson,
    },
    projectId: settings.projectId,
    location: settings.location,
    languageCode: settings.languageCode,
    confidenceThreshold: settings.confidenceThreshold,
  };

  if (!chirp3Provider) {
    chirp3Provider = new Chirp3Provider();
  }

  try {
    chirp3Provider.configure(config);
    console.log(
      `[Chirp3] Provider configured (project: ${settings.projectId}, auth: ${settings.authType})`,
    );
  } catch (err) {
    console.error("[Chirp3] Configuration failed:", err);
    chirp3Provider = null;
  }
}

/** Immediately dispose and re-initialize the Chirp 3 provider. */
function reconfigureChirp3Immediate(): void {
  if (chirp3Provider) {
    chirp3Provider.dispose();
  }
  chirp3Provider = null;
  initializeChirp3();
}

/** Debounce timer for reconfiguration (avoids rebuilding SpeechClient on every keystroke). */
let reconfigureTimer: ReturnType<typeof setTimeout> | null = null;
const RECONFIGURE_DEBOUNCE_MS = 500;

export function reconfigureChirp3(): void {
  if (reconfigureTimer) clearTimeout(reconfigureTimer);
  reconfigureTimer = setTimeout(reconfigureChirp3Immediate, RECONFIGURE_DEBOUNCE_MS);
}

export function registerChirp3Handlers(): void {
  ipcMain.handle("settings:getChirp3Config", () => {
    const settings = loadChirp3Settings();
    return {
      projectId: settings.projectId,
      authType: settings.authType,
      location: settings.location,
      languageCode: settings.languageCode,
      confidenceThreshold: settings.confidenceThreshold,
      hasApiKey: settings.hasApiKey,
      hasServiceAccount: settings.hasServiceAccount,
      backend: settings.backend,
      isConfigured: chirp3Provider?.isConfigured() ?? false,
    };
  });

  ipcMain.handle("settings:testChirp3Connection", async () => {
    try {
      // Ensure provider is initialized with latest settings (immediate, not debounced)
      reconfigureChirp3Immediate();

      if (!chirp3Provider?.isConfigured()) {
        return {
          valid: false,
          error:
            "Chirp 3 not configured. Check project ID and credentials.",
        };
      }

      // Create a minimal silent OGG buffer to test connectivity
      // This is a valid Opus OGG file with ~100ms of silence
      const silentOgg = createSilentTestBuffer();
      await chirp3Provider.recognizeChunk(silentOgg, "audio/ogg");
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Connection test failed",
      };
    }
  });
}

/**
 * Create a minimal valid OGG/Opus buffer for connection testing.
 * This is a tiny silent audio clip that the API can process.
 */
function createSilentTestBuffer(): Buffer {
  // Minimal OGG page header + Opus identification header
  // This is the smallest valid OGG/Opus file structure
  const oggHeader = Buffer.from([
    // OGG page header
    0x4f, 0x67, 0x67, 0x53, // "OggS" capture pattern
    0x00, // stream structure version
    0x02, // header type: beginning of stream
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // granule position
    0x01, 0x00, 0x00, 0x00, // stream serial number
    0x00, 0x00, 0x00, 0x00, // page sequence number
    0x00, 0x00, 0x00, 0x00, // CRC checksum (simplified)
    0x01, // number of segments
    0x13, // segment table: 19 bytes
    // Opus identification header (19 bytes)
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
    0x01, // version
    0x01, // channel count (mono)
    0x38, 0x01, // pre-skip
    0x80, 0x3e, 0x00, 0x00, // input sample rate: 16000
    0x00, 0x00, // output gain
    0x00, // channel mapping family
  ]);

  return oggHeader;
}
