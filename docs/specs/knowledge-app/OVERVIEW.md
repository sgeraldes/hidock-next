# Knowledge App Specifications Overview

This directory contains the detailed technical specifications for the HiDock Knowledge App redesign components. These specs are derived from the [Redesign Vision](../../planning/knowledge-app-redesign.md) and current implementation status.

## Core Components

| Component | Spec File | Status | Description |
| :--- | :--- | :--- | :--- |
| **Library** | [`LIBRARY_SPEC.md`](./LIBRARY_SPEC.md) | âœ… Drafted | Central repository for all recordings (Device + Local). |
| **Assistant** | [`ASSISTANT_SPEC.md`](./ASSISTANT_SPEC.md) | âœ… Drafted | RAG-powered chat interface for knowledge retrieval. |
| **Device Sync** | [`DEVICE_SYNC_SPEC.md`](./DEVICE_SYNC_SPEC.md) | âœ… Drafted | Hardware connection, file sync, and realtime streaming. |

## Pending Components

The following components require detailed specifications in future iterations:

-   **Explore**: Dashboard for discovery and insights.
-   **People**: Speaker identity management and relationship mapping.
-   **Projects**: Grouping recordings by project/topic.
-   **Calendar**: Integration with Google/Outlook calendars.
-   **Actionables**: Extraction and management of tasks/todos.
-   **Settings**: Application configuration.

## Architecture Reference

The application is built on:
-   **Frontend**: React + TypeScript + Tailwind CSS (Electron Renderer)
-   **Backend**: Electron Main Process + Python/Node Services
-   **Data**: SQLite (Metadata) + Vector DB (Embeddings) + File System (Audio/Transcripts)
