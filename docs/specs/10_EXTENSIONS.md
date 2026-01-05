# Extensions & Plugin Architecture Specification

**Module:** Core Architecture
**Component:** Plugin System
**Target:** Future Expansion (Phase 3+)
**References:** [11_CONCEPTUAL_FRAMEWORK.md](./11_CONCEPTUAL_FRAMEWORK.md), [11_REDESIGN_ARCH.md](./11_REDESIGN_ARCH.md)

## 1. Overview
To realize the vision of "registering and understanding EVERYTHING," the HiDock Knowledge System must expand beyond audio recordings. This document defines a modular **Plugin Architecture** that allows the ingestion of data from diverse external sources (Slack, Teams, Jira, etc.) into the unified Knowledge Graph.

## 2. Architectural Principles

### 2.1 "Everything is an Event"
Regardless of the source (a Slack message, a Jira ticket, a Voice Memo), all ingested data is normalized into a common `KnowledgeEvent` schema.

```typescript
interface KnowledgeEvent {
  id: string;
  source: string;       // 'hidock-audio', 'slack', 'jira', 'outlook-email'
  external_id: string;  // Original ID in the source system
  timestamp: Date;
  content: string;      // The raw text or transcript
  author: Identity;     // Who created it
  metadata: Record<string, any>; // Source-specific data (e.g., channel_id)
  embeddings?: number[]; // Vector representation
}
```

### 2.2 The Connector Pattern
Plugins act as "Connectors" that bridge external APIs to the internal Event Bus.

*   **Authentication:** Handles OAuth/API Key flows securely.
*   **Polling/Webhook:** Strategies for fetching updates (Real-time vs. Periodic).
*   **Mapping:** Transforms source-specific JSON to `KnowledgeEvent`.

---

## 3. Plugin Interface (API Contract)

Plugins must implement the following interface to be loaded by the core system:

```typescript
interface KnowledgePlugin {
  // Metadata
  id: string;           // 'com.hidock.slack'
  name: string;         // "Slack Integration"
  version: string;
  icon: string;         // SVG or URL

  // Lifecycle
  initialize(config: PluginConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Configuration
  getConfigSchema(): FormSchema; // For Settings UI generation
  validateConfig(config: any): Promise<boolean>;

  // Operations
  connect(): Promise<ConnectionResult>;
  disconnect(): Promise<void>;
  
  // Data Ingestion
  sync(since: Date): Promise<SyncResult>; // Pull historical data
  subscribe(callback: (event: KnowledgeEvent) => void): Promise<void>; // Real-time
}
```

---

## 4. Core System Responsibilities

### 4.1 Plugin Manager
*   **Discovery:** Scans a `plugins/` directory or a registry.
*   **Sandboxing:** Runs plugins in isolated contexts (preferred: separate process) to prevent crashes from affecting the main app.
*   **Lifecycle Management:** Loads, enables, disables, and updates plugins.

### 4.2 Data Normalization & Schema Mapping
*   **Identity Resolution:** Merges "User A" from Slack and "User A" from Email into a single `Person` entity.
*   **Topic Unification:** Maps "Project X" in Jira to "Project X" in Audio Transcripts.

### 4.3 Error Handling & Retries
*   **Circuit Breaker:** If a plugin fails repeatedly (e.g., API rate limit), it is temporarily disabled.
*   **Dead Letter Queue:** Failed ingestion events are stored for manual or retry processing.
*   **Logging:** Centralized logging for all plugin activities.

---

## 5. User Experience (Settings)

### 5.1 "Integrations" Tab
A new section in Settings (`/settings/integrations`) will manage these extensions.

*   **Catalog:** Browse available plugins.
*   **Configuration:** Enter API Keys, select channels/folders to sync.
*   **Status:** View sync health (Last synced: 2 mins ago, Status: Healthy/Error).
*   **Permissions:** Granular control over what data each plugin can access.

---

## 6. Security Considerations

*   **Credential Storage:** API Keys/Tokens must be encrypted at rest (using the existing `config.json` encryption mechanism).
*   **Data Scope:** Plugins should only ingest data they are explicitly configured for (e.g., specific Slack channels, not all DMs).
*   **Audit Log:** Track every data ingress event.

---

## 7. Roadmap

### Phase 3.1: Foundation
*   Define `KnowledgeEvent` schema in DB.
*   Implement `PluginManager` in the Electron main process and expose a minimal IPC surface to the renderer.
*   Create "Integrations" UI skeleton.

---

## 8. Implementation notes (practical constraints)

- Keep plugin execution out of the renderer; only the main process should talk to external networks.
- Treat all plugin input as untrusted: validate payload sizes, sanitize strings, and apply timeouts.
- Start with a single built-in "Local File Import" connector to validate the architecture before adding OAuth-heavy integrations.

### Phase 3.2: Pilot Plugins
*   **Text File Importer:** Simple plugin to ingest local `.md` or `.txt` files.
*   **Slack Connector:** MVP integration for public channels.

### Phase 3.3: Ecosystem
*   Open API for community developers.
*   Marketplace for sharing connectors.
