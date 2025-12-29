# Settings Specification

**Module:** Configuration
**Screen:** Settings (`/settings`)
**Screenshot:** ![Settings View](../qa/screenshots/settings_master.png)

## Overview
Settings manages the global configuration for the application, including integrations (Calendar, AI), storage preferences, and application behavior.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Calendar Sync** | Input (ICS URL) | Enter URL + Save | Configures calendar source. Triggers initial sync. | "Calendar" config. |
| **Transcription** | Input (API Key) | Enter Key + Save | Authenticates with Gemini/OpenAI. Enables "Transcribe" actions. | "AI Integration" config. |
| **Chat Provider** | Toggle/Select | Choose Provider | Switches between Cloud (Gemini) and Local (Ollama) RAG. | "Privacy-sensitive use cases". |
| **Storage Paths** | Read-Only Field | View | Displays location of Recordings, Transcripts, Data. | Transparency. |
| **Advanced Ops** | Accordion | Click | Reveals destructive actions (Purge DB, Reset Config). | Safety. |

## Data Requirements
*   **Storage:** `config.json` (Encrypted API keys).
*   **API:** `electronAPI.config.get()`, `electronAPI.config.update()`.
