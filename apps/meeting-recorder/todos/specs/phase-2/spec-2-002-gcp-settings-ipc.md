# Spec 2-002: Google Cloud Settings & IPC

## Summary

Add settings infrastructure for Google Cloud credentials and transcription backend selection. This enables the UI to configure Chirp 3 and the main process to read credentials.

## Consolidates

- todo-2-007 (Add Google Cloud credentials to settings)
- todo-2-009 (Update IPC handlers for Chirp 3 settings)

## Layer: 1 (Foundation)

## New Setting Keys

| Key | Type | Default | Encrypted | Purpose |
|-----|------|---------|-----------|---------|
| `ai.transcriptionBackend` | string | `"gemini-multimodal"` | No | `"chirp3+gemini"` or `"gemini-multimodal"` |
| `ai.gcp.projectId` | string | `""` | No | Google Cloud project ID |
| `ai.gcp.apiKey` | string | `""` | Yes | GCP API key (if using API key auth) |
| `ai.gcp.serviceAccountJson` | string | `""` | Yes | Service account JSON (if using SA auth) |
| `ai.gcp.authType` | string | `"api-key"` | No | `"api-key"` or `"service-account"` |
| `ai.gcp.location` | string | `"global"` | No | GCP location for Speech API |
| `ai.chirp3.languageCode` | string | `"en-US"` | No | Speech recognition language |
| `ai.chirp3.confidenceThreshold` | string | `"0.7"` | No | Word confidence filter threshold |

## Files to Modify

### `electron/main/ipc/settings-handlers.ts`

1. Add GCP keys to `AI_SETTING_KEYS`:
   ```typescript
   "ai.transcriptionBackend",
   "ai.gcp.projectId",
   "ai.gcp.apiKey",
   "ai.gcp.serviceAccountJson",
   "ai.gcp.authType",
   "ai.gcp.location",
   "ai.chirp3.languageCode",
   "ai.chirp3.confidenceThreshold",
   ```

2. Add GCP keys to `SENSITIVE_KEYS`:
   ```typescript
   "ai.gcp.apiKey",
   "ai.gcp.serviceAccountJson",
   ```

3. Update `WRITABLE_PREFIXES` - already includes `"ai."` so no change needed.

4. Update `reconfigureAIIfNeeded()` to also reconfigure Chirp3Provider when GCP settings change.

5. Add `settings:getChirp3Config` IPC handler that returns the full Chirp3Config object (with masked sensitive values for UI display).

6. Add `settings:testChirp3Connection` IPC handler that creates a temporary SpeechClient and makes a test recognize call.

### `electron/preload/index.ts`

Expose new IPC methods:
```typescript
settings: {
  // ... existing ...
  getChirp3Config: () => ipcRenderer.invoke("settings:getChirp3Config"),
  testChirp3Connection: () => ipcRenderer.invoke("settings:testChirp3Connection"),
}
```

### `src/env.d.ts`

Add TypeScript types for new IPC methods.

### `src/store/useSettingsStore.ts`

Add fields (all transient, loaded from main process):
```typescript
transcriptionBackend: "chirp3+gemini" | "gemini-multimodal";
gcpProjectId: string;
gcpAuthType: "api-key" | "service-account";
chirp3Language: string;
```

Add actions:
```typescript
setTranscriptionBackend(backend: string): void
setGcpProjectId(projectId: string): void
setGcpAuthType(type: string): void
setChirp3Language(language: string): void
```

## Implementation Details

### Settings Migration

Add migration step in `migrateModelSettings()`:
- Migration 5: Set `ai.transcriptionBackend` to `"gemini-multimodal"` if not present
- This ensures existing users keep their current behavior by default

### Chirp 3 Config Assembly

The `settings:getChirp3Config` handler assembles a Chirp3Config object from individual settings:
```typescript
ipcMain.handle("settings:getChirp3Config", () => {
  return {
    projectId: getSetting("ai.gcp.projectId") || "",
    authType: getSetting("ai.gcp.authType") || "api-key",
    location: getSetting("ai.gcp.location") || "global",
    languageCode: getSetting("ai.chirp3.languageCode") || "en-US",
    confidenceThreshold: parseFloat(getSetting("ai.chirp3.confidenceThreshold") || "0.7"),
    hasApiKey: !!(getSetting("ai.gcp.apiKey")),
    hasServiceAccount: !!(getSetting("ai.gcp.serviceAccountJson")),
    // Never send actual keys to renderer
  };
});
```

### Connection Test

```typescript
ipcMain.handle("settings:testChirp3Connection", async () => {
  try {
    const chirp3 = getChirp3Provider();
    if (!chirp3?.isConfigured()) {
      return { valid: false, error: "Chirp 3 not configured" };
    }
    // Send a tiny silent audio clip to verify credentials work
    const silentOgg = createSilentOggBuffer(); // 100ms silence
    await chirp3.recognizeChunk(silentOgg, "audio/ogg");
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
});
```

## Test Cases (10 tests)

### `electron/main/__tests__/chirp3-settings.test.ts`

1. GCP settings keys are in AI_SETTING_KEYS
2. GCP sensitive keys are in SENSITIVE_KEYS set
3. settings:set persists ai.gcp.projectId
4. settings:set encrypts ai.gcp.apiKey
5. settings:set encrypts ai.gcp.serviceAccountJson
6. settings:getChirp3Config returns assembled config
7. settings:getChirp3Config never leaks raw credentials
8. settings:testChirp3Connection returns valid:true with valid config
9. settings:testChirp3Connection returns valid:false without credentials
10. Migration sets default transcriptionBackend to "gemini-multimodal"

## Dependencies

- Spec 2-001 (Chirp3Provider types used in settings assembly)

## Acceptance Criteria

- [ ] All 8 new setting keys functional (get/set/persist)
- [ ] Sensitive keys encrypted in database
- [ ] settings:getChirp3Config assembles complete config
- [ ] settings:testChirp3Connection tests real connectivity
- [ ] Migration preserves existing user behavior
- [ ] 10 tests pass
- [ ] TypeScript compiles without errors
