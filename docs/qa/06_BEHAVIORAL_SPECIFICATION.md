# Behavioral Specification: HiDock Next

**Version:** 1.0
**Date:** 2025-12-28
**Scope:** `apps/web` (React/Electron Frontend)
**Source:** Reverse-engineered from `apps/electron` source code and `preload/index.ts`.

---

## 1. Overview
This document formally defines the expected behavior, input validation rules, and API contracts for the HiDock Next application. It serves as the authoritative requirement source for the Master Test Plan.

---

## 2. Global Definitions

### 2.1 API Contract (`window.electronAPI`)
The application communicates with the main process via a strictly typed context bridge. All frontend services must adhere to this interface.

*   **Namespace:** `window.electronAPI`
*   **Async Pattern:** All methods return `Promise<Result<T>>` or `Promise<T>`.
*   **Error Handling:**
    *   IPC errors are caught in `preload.ts` and logged to `[QA-MONITOR][IPC-ERR]`.
    *   Frontend receives rejected promises or `{ success: false, error: string }` objects.

### 2.2 Common UI Patterns
*   **Loading State:** `loading` boolean state usually triggers a `<RefreshCw className="animate-spin" />` icon or a skeleton loader.
*   **Empty State:** When arrays (meetings, recordings) are empty, a specific component with an icon and "No items found" text is rendered.
*   **Navigation:** Uses `react-router-dom`. Routes are hash-based (`/#/library`).

---

## 3. Screen Specifications

### 3.1 Library (`/library`)
**Component:** `src/pages/Recordings.tsx`

**Functional Requirements:**
1.  **List Rendering:**
    *   Must render a virtualized list or grid of recordings.
    *   **Data Source:** `electronAPI.recordings.getAll()` + `electronAPI.deviceCache.getAll()`.
2.  **Filtering:**
    *   **Search:** Filters by `filename` (case-insensitive).
    *   **Tags:** Filters by `tags` array (Meeting, Interview, etc.).
    *   **Status:** Filters by `transcriptionStatus` (Pending, Processing, Complete).
3.  **Playback:**
    *   **Local File:** `electronAPI.storage.readRecording(path)` -> Blob URL.
    *   **Device File:** Triggers `downloadService.queueDownloads` -> Auto-play on completion.

**API Dependencies:**
*   `recordings.getAll()`
*   `deviceCache.getAll()`
*   `storage.readRecording(path)`

---

### 3.2 Calendar (`/calendar`)
**Component:** `src/pages/Calendar.tsx`

**Functional Requirements:**
1.  **View Modes:** Supports Day, Work Week, Week, Month.
2.  **Date Navigation:**
    *   `prev/next` increments based on current view.
    *   **Safety:** `currentDate` must be checked for validity before `toLocaleDateString`.
3.  **Synchronization:**
    *   **Trigger:** "Sync" button calls `electronAPI.calendar.sync()`.
    *   **Feedback:** Shows "Syncing..." text or spinner during operation.
4.  **Event Linking:**
    *   Dashed blocks = Meetings without recordings.
    *   Solid blocks = Recordings (linked or orphan).

**API Dependencies:**
*   `calendar.sync()`
*   `meetings.getAll(startDate, endDate)`
*   `recordings.getForMeeting(meetingId)`

---

### 3.3 Assistant (`/assistant`)
**Component:** `src/pages/Assistant.tsx`

**Functional Requirements:**
1.  **Chat Interface:**
    *   User input is appended immediately to local state.
    *   "Thinking..." indicator shown while awaiting `rag.chat()`.
2.  **Context Management:**
    *   User can select specific recordings to scope the RAG query.
3.  **Persistence:**
    *   Chat history is saved via `chat.addMessage()`.
    *   "New Chat" calls `chat.clearHistory()`.

**API Dependencies:**
*   `rag.chat(request)`
*   `chat.getHistory()`
*   `chat.addMessage()`

---

### 3.4 People (`/people`)
**Component:** `src/pages/People.tsx`

**Functional Requirements:**
1.  **Display:**
    *   Grid of contact cards showing Name, Role, Interaction Count.
2.  **Filtering:**
    *   Type: Team, Candidate, Customer, External.
3.  **Creation:**
    *   **Status:** Feature Disabled (`<Button disabled>`).
    *   **Requirement:** Button should be enabled only when backend mutation is ready.

**API Dependencies:**
*   `contacts.getAll(request)`

---

### 3.5 Projects (`/projects`)
**Component:** `src/pages/Projects.tsx`

**Functional Requirements:**
1.  **Display:**
    *   Sidebar list of Active/Archived projects.
    *   Detail view showing stats (Knowledge count, People count).
2.  **Creation:**
    *   **Current Implementation:** Uses `window.prompt("Enter project name")`.
    *   **Requirement:** Must be refactored to a React Modal to support automated testing.
3.  **Selection:**
    *   Clicking a project sets `activeProject` state and renders details.

**API Dependencies:**
*   `projects.getAll()`
*   `projects.create({ name })`

---

### 3.6 Sync (`/sync`)
**Component:** `src/pages/Dashboard.tsx` (Device Panel)

**Functional Requirements:**
1.  **Device Detection:**
    *   **Hotplug:** Listens for `domain-event` with `type: 'device-connected'`.
    *   **Polling:** Periodically calls `app.info` or `deviceCache` checks.
2.  **Download Queue:**
    *   "Sync All" iterates device files and calls `downloadService.queueDownloads`.
    *   Global progress bar reflects `downloadService` state events.

**API Dependencies:**
*   `downloadService.getState()`
*   `downloadService.queueDownloads(files)`
*   `onDomainEvent(callback)`

---

## 4. Input Validation Rules

| Field | Rule | Error Behavior |
| :--- | :--- | :--- |
| **Search (Global)** | Min length: 1 char. Debounce: 300ms. | No error; empty result list. |
| **Project Name** | Non-empty string. Unique constraint (backend). | `window.prompt` currently prevents empty submission locally. |
| **Chat Input** | Non-empty string. Max length: N/A (practical limit). | Send button disabled if empty. |
| **Date Range** | Start Date <= End Date. | UI enforcement via Calendar navigation logic. |

---

## 5. Error Handling Standards

1.  **API Failures:**
    *   Must display a Toast notification (Shadcn `useToast`).
    *   Console error logged with `[QA-MONITOR][IPC-ERR]` prefix.
2.  **Crash Recovery:**
    *   React Error Boundaries must catch component-level crashes (e.g., `CAL-02`).
    *   "Try Again" button resets the component state.
3.  **Network/Device:**
    *   Device disconnection during sync pauses queue; does not crash app.
