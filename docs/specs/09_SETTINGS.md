# Settings Specification

**Version:** 1.1 (2025-12-29)
**Module:** Configuration
**Screen / Route:** Settings (`/settings`)
**Component:** `apps/electron/src/pages/Settings.tsx`
**References:** [11_REDESIGN_ARCH.md](./11_REDESIGN_ARCH.md), [10_EXTENSIONS.md](./10_EXTENSIONS.md)
**Screenshot:** ![Settings View](../qa/screenshots/settings_master.png)

## 1. Overview
Settings manages the global configuration for the application, including integrations (Calendar, AI), storage preferences, and application behavior.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Calendar Sync** | Input (ICS URL) | Enter URL + Save | Configures calendar source. Triggers initial sync. | "Calendar" config. |
| **Transcription** | Input (API Key) | Enter Key + Save | Authenticates with Gemini/OpenAI. Enables "Transcribe" actions. | "AI Integration" config. |
| **Chat Provider** | Toggle/Select | Choose Provider | Switches between Cloud (Gemini) and Local (Ollama) RAG. | "Privacy-sensitive use cases". |
| **Storage Paths** | Read-Only Field | View | Displays location of Recordings, Transcripts, Data. | Transparency. |
| **Advanced Ops** | Accordion | Click | Reveals destructive actions (Purge DB, Reset Config). | Safety. |

---

## 2. Component Specification

### 2.1 State Management
| State Variable | Type | Description | Persistence |
| :--- | :--- | :--- | :--- |
| `config` | `AppConfig` | Global config object. | Persistent (JSON) |
| `storageInfo` | `StorageInfo` | Disk usage and paths. | Session |
| `geminiApiKey` | `string` | Local form state for key. | Session |
| `chatProvider` | `'gemini'\|'ollama'` | Local form state for provider. | Session |
| `syncEnabled` | `boolean` | Local form state for calendar toggle. | Session |

### 2.2 Lifecycle & Events
*   **Mount:** Calls `loadConfig()` and `loadStorageInfo()`. Populates form fields.
*   **Save:** Individual save buttons for sections (Calendar, Transcription, Chat) to minimize writes.

---

## 3. Detailed Behavior

### 3.1 Configuration Updates
*   **Action:** Edit field -> Click "Save".
*   **Flow:**
    1.  Call `config.updateSection(section, values)`.
    2.  Wait for Promise resolution.
    3.  Button returns to enabled state.
*   **Visual:** "Saving..." spinner on button.

### 3.2 Storage Management
*   **Display:** Total Size, Recording Count.
*   **Action:** Click "Folder" icon.
*   **Outcome:** Opens native OS file explorer to `storageInfo.recordingsPath`.

### 3.3 Health Check
*   **Component:** `<HealthCheck />` (Child component).
*   **Function:** Runs integrity scan on DB/File consistency.

---

## 4. API Contracts

### `AppConfig` (Partial)
```typescript
interface AppConfig {
  calendar: { icsUrl: string; syncEnabled: boolean; syncIntervalMinutes: number };
  transcription: { geminiApiKey: string };
  chat: { provider: 'gemini' | 'ollama' };
  embeddings: { ollamaBaseUrl: string };
}
```

### IPC Methods
*   `config.get()`: Returns full config object.
*   `config.updateSection(section, values)`: Merges updates and persists to disk.
*   `storage.getInfo()`: Returns `{ totalSizeBytes, recordingsCount, paths }`.
*   `storage.openFolder(name)`: Shell open command.

---

## 5. Error Handling

*   **Load Fail:** Console error. Form fields remain empty.
*   **Save Fail:** Button remains stuck or shows error state (currently implementation uses `finally` to reset, error logging is console-only).

---

## 6. Accessibility & Styling

*   **Forms:** Standard Shadcn `Card` + `Input` layout.
*   **Security:** API Key input uses `type="password"`.

---

## 8. Security requirements (implementation)

- Secrets (API keys, tokens) must be stored encrypted at rest.
- The UI must never log secrets to console.
- Provide an explicit "Test Connection" action where applicable so users can validate configuration without guesswork.

---

## 7. Testing Strategy

### Integration Tests
*   **Load:** Mock `config.get` -> Verify input fields populated.
*   **Save:** Change API Key -> Click Save -> Verify `updateSection` called with new key.
*   **Validation:** Enter invalid URL -> Verify basic browser validation or custom error.

### Performance
*   **Load:** Instant local file read (< 50ms).