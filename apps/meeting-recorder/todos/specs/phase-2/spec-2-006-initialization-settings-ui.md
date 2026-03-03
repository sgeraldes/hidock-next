# Spec 2-006: Chirp3Provider Initialization & Settings UI

## Summary

Initialize Chirp3Provider in the main process on startup and when settings change. Add a UI section in Settings for configuring Google Cloud credentials and selecting the transcription backend.

## Consolidates

- todo-2-010 (Initialize Chirp3Provider in main process)
- todo-2-008 (Update Settings UI for Google Cloud credentials)

## Layer: 3 (Pipeline Integration)

## Files to Create

### `electron/main/ipc/chirp3-handlers.ts`

```typescript
import { Chirp3Provider } from "../services/chirp3-provider";
import type { Chirp3Config } from "../services/chirp3-provider.types";
import { getSetting } from "../services/database-extras";
import { ipcMain } from "electron";

let chirp3Provider: Chirp3Provider | null = null;

export function getChirp3Provider(): Chirp3Provider | null {
  return chirp3Provider;
}

export function initializeChirp3(): void {
  const backend = getSetting("ai.transcriptionBackend");
  if (backend !== "chirp3+gemini") {
    console.log("[Chirp3] Backend is not chirp3+gemini, skipping initialization");
    return;
  }

  const authType = getSetting("ai.gcp.authType") || "api-key";
  const projectId = getSetting("ai.gcp.projectId");

  if (!projectId) {
    console.warn("[Chirp3] No GCP project ID configured");
    return;
  }

  const config: Chirp3Config = {
    credentials: {
      type: authType as "api-key" | "service-account",
      apiKey: authType === "api-key" ? (getSetting("ai.gcp.apiKey") || undefined) : undefined,
      serviceAccountJson: authType === "service-account"
        ? (getSetting("ai.gcp.serviceAccountJson") || undefined)
        : undefined,
    },
    projectId,
    location: getSetting("ai.gcp.location") || "global",
    languageCode: getSetting("ai.chirp3.languageCode") || "en-US",
    confidenceThreshold: parseFloat(getSetting("ai.chirp3.confidenceThreshold") || "0.7"),
  };

  if (!chirp3Provider) {
    chirp3Provider = new Chirp3Provider();
  }

  try {
    chirp3Provider.configure(config);
    console.log(`[Chirp3] Provider configured (project: ${projectId}, auth: ${authType})`);
  } catch (err) {
    console.error("[Chirp3] Configuration failed:", err);
    chirp3Provider = null;
  }
}

export function reconfigureChirp3(): void {
  if (chirp3Provider) {
    chirp3Provider.dispose();
  }
  chirp3Provider = null;
  initializeChirp3();
}

export function registerChirp3Handlers(): void {
  // Handled via settings IPC - no dedicated chirp3 handlers needed
  // getChirp3Provider() is called by transcription pipeline
}
```

### `src/components/settings/TranscriptionBackendSettings.tsx`

New component for the transcription backend section:

```tsx
interface TranscriptionBackendSettingsProps {
  provider: string;
}

export function TranscriptionBackendSettings({ provider }: Props) {
  // State
  const [backend, setBackend] = useState("gemini-multimodal");
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [gcpAuthType, setGcpAuthType] = useState("api-key");
  const [gcpApiKey, setGcpApiKey] = useState("");
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [language, setLanguage] = useState("en-US");
  const [confidenceThreshold, setConfidenceThreshold] = useState("0.7");
  const [testResult, setTestResult] = useState<{valid: boolean; error?: string} | null>(null);
  const [testing, setTesting] = useState(false);

  // Load from settings on mount
  // Save to settings on change
  // Test connection button

  return (
    <div className="space-y-4">
      {/* Backend selector */}
      <div>
        <label>Transcription Backend</label>
        <select value={backend} onChange={...}>
          <option value="gemini-multimodal">Gemini Multimodal (Current)</option>
          <option value="chirp3+gemini">Chirp 3 + Gemini (Recommended)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Chirp 3 provides higher accuracy speech-to-text.
          Gemini then analyzes the transcript for speakers, topics, and action items.
        </p>
      </div>

      {/* GCP credentials (only shown when chirp3+gemini selected) */}
      {backend === "chirp3+gemini" && (
        <>
          <div>
            <label>Google Cloud Project ID</label>
            <input value={gcpProjectId} onChange={...} />
          </div>

          <div>
            <label>Authentication</label>
            <select value={gcpAuthType} onChange={...}>
              <option value="api-key">API Key</option>
              <option value="service-account">Service Account</option>
            </select>
          </div>

          {gcpAuthType === "api-key" ? (
            <div>
              <label>GCP API Key</label>
              <input type="password" value={gcpApiKey} onChange={...} />
            </div>
          ) : (
            <div>
              <label>Service Account JSON</label>
              <textarea value={serviceAccountJson} onChange={...}
                placeholder="Paste service account JSON key..." />
            </div>
          )}

          <div>
            <label>Language</label>
            <select value={language} onChange={...}>
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
              <option value="ja-JP">Japanese</option>
              <option value="zh-CN">Chinese (Mandarin)</option>
              <option value="pt-BR">Portuguese (Brazil)</option>
            </select>
          </div>

          <div>
            <label>Confidence Threshold</label>
            <input type="range" min="0.3" max="0.9" step="0.1"
              value={confidenceThreshold} onChange={...} />
            <span>{confidenceThreshold}</span>
          </div>

          <button onClick={testConnection} disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </button>

          {testResult && (
            <div className={testResult.valid ? "text-green-500" : "text-red-500"}>
              {testResult.valid ? "Connection successful" : `Error: ${testResult.error}`}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

## Files to Modify

### `electron/main/ipc/handlers.ts`

Register chirp3 handlers:
```typescript
import { registerChirp3Handlers } from "./chirp3-handlers";

export function registerIpcHandlers(): void {
  // ... existing ...
  registerChirp3Handlers();
}
```

### `electron/main/index.ts`

Initialize Chirp3Provider after settings migration:
```typescript
import { initializeChirp3 } from "./ipc/chirp3-handlers";

// After initializeAIFromSettings():
initializeChirp3();
```

### `electron/main/ipc/settings-handlers.ts`

Update `reconfigureAIIfNeeded()` to also reconfigure Chirp3:
```typescript
import { reconfigureChirp3 } from "./chirp3-handlers";

// In reconfigureAIIfNeeded, after AI service reconfiguration:
if (changedKey.startsWith("ai.gcp.") || changedKey === "ai.transcriptionBackend") {
  reconfigureChirp3();
}
```

### `src/pages/Settings.tsx`

Import and render TranscriptionBackendSettings:
```tsx
import { TranscriptionBackendSettings } from "../components/settings/TranscriptionBackendSettings";

// In the settings layout, after the AI provider section:
<TranscriptionBackendSettings provider={provider} />
```

### `electron/preload/index.ts`

Already has settings:testChirp3Connection from spec-2-002.

### `src/env.d.ts`

Already has types from spec-2-002.

## Test Cases (12 tests)

### `electron/main/__tests__/chirp3-initialization.test.ts`

1. initializeChirp3 creates provider when backend is "chirp3+gemini"
2. initializeChirp3 skips when backend is "gemini-multimodal"
3. initializeChirp3 skips when projectId is missing
4. initializeChirp3 configures with API key credentials
5. initializeChirp3 configures with service account credentials
6. getChirp3Provider returns configured provider
7. getChirp3Provider returns null when not initialized
8. reconfigureChirp3 disposes old provider and creates new one
9. reconfigureChirp3 handles configuration errors gracefully

### `src/__tests__/TranscriptionBackendSettings.test.tsx`

10. Renders backend selector
11. Shows GCP fields when chirp3+gemini selected
12. Hides GCP fields when gemini-multimodal selected

## Dependencies

- Spec 2-001 (Chirp3Provider class)
- Spec 2-002 (GCP settings keys)

## Acceptance Criteria

- [ ] Chirp3Provider initialized on app startup when configured
- [ ] Reconfigures when GCP settings change
- [ ] Graceful handling of missing/invalid credentials
- [ ] Settings UI shows backend selector and GCP credentials
- [ ] Test connection button works
- [ ] 12 tests pass
- [ ] TypeScript compiles without errors
