# Knowledge Assistant Specification

**Module:** AI Intelligence
**Screen:** Assistant (`/assistant`)
**Screenshot:** ![Assistant View](../qa/screenshots/assistant_master.png)

## Overview
The Assistant is a **Knowledge-Powered AI** interface. It allows users to query their knowledge base, generate insights, and produce artifacts using a RAG (Retrieval-Augmented Generation) pipeline.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Chat Interface** | Message List | Scroll | Displays history of User and Assistant messages. Renders Markdown. | "Conversation History" feature. |
| **Input** | Text Area | Type + Enter | Sends message. Shows "Thinking..." state. Streams response token-by-token. | Standard Chat UI. |
| **Context Injection** | "Context" Dropdown | Select Recording/Meeting | Scopes RAG retrieval to specific items (e.g., "Summarize *this* meeting"). | "Context Injection" core feature. |
| **New Session** | "New Chat" Button | Click | Clears current message history. Resets context selection. | "Branch/Reset" functionality. |
| **Artifact Generation** | (Planned) Output Button | Click "Create Output" | (Future) Generates structured document from chat content. | Phase 2: "Create output from conversation". |

## Data Requirements
*   **Data Source:** `conversations` table (history), `knowledge_vectors` (RAG context).
*   **Entities:** `Conversation`, `Message`.
*   **AI Provider:** Google Gemini (via `electronAPI.rag`).
