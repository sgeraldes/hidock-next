# Knowledge App Specifications Overview

This directory contains implementation-oriented specifications for the HiDock Knowledge App redesign. These specs should stay consistent with:

- [11_CONCEPTUAL_FRAMEWORK.md](../11_CONCEPTUAL_FRAMEWORK.md)
- [11_REDESIGN_ARCH.md](../11_REDESIGN_ARCH.md)

When there is a conflict, the conceptual framework and redesign architecture win.

## Core Components

| Component | Spec File | Status | Description |
| :--- | :--- | :--- | :--- |
| **Library** | [`LIBRARY_SPEC.md`](./LIBRARY_SPEC.md) | Drafted | Sources list, playback, processing, and anchors/citations. |
| **Assistant** | [`ASSISTANT_SPEC.md`](./ASSISTANT_SPEC.md) | Drafted | Grounded chat + transformations + citations. |
| **Explore** | [`EXPLORE_SPEC.md`](./EXPLORE_SPEC.md) | Drafted | Discovery surface for derived entities + global search. |
| **People** | [`PEOPLE_SPEC.md`](./PEOPLE_SPEC.md) | Drafted | Person entity list/search and detail entry points. |
| **Projects** | [`PROJECTS_SPEC.md`](./PROJECTS_SPEC.md) | Drafted | Project/Notebook organization and master-detail view. |
| **Calendar** | [`CALENDAR_SPEC.md`](./CALENDAR_SPEC.md) | Drafted | Event-centric view and meeting ↔ recording linking. |
| **Actionables** | [`ACTIONABLES_SPEC.md`](./ACTIONABLES_SPEC.md) | Drafted | Artifact repository with exports and citations. |
| **Sync** | [`SYNC_SPEC.md`](./SYNC_SPEC.md) | Drafted | High-level Sync surface spec (bridge to device spec). |
| **Device Sync (Detail)** | [`DEVICE_SYNC_SPEC.md`](./DEVICE_SYNC_SPEC.md) | Drafted | Hardware connection, file sync, and realtime streaming. |
| **Settings** | [`SETTINGS_SPEC.md`](./SETTINGS_SPEC.md) | Drafted | App configuration (providers, integrations, storage). |
| **Extensions** | [`EXTENSIONS_SPEC.md`](./EXTENSIONS_SPEC.md) | Drafted | Plugin/connector ingestion architecture (future). |

## Pending / To Be Added

The numbered specs in [docs/specs](../) cover 01–10 and should remain the source of truth for UX intent. The files here are implementation-focused and should reference the numbered specs.

## Architecture Reference

The application is built on:
-   **Frontend**: React + TypeScript + Tailwind CSS (Electron Renderer)
-   **Backend**: Electron Main Process + Python/Node Services
-   **Data**: SQLite (Metadata) + Vector DB (Embeddings) + File System (Audio/Transcripts)
