# Master Test Plan: HiDock Next

**Version:** 2.1
**Date:** 2025-12-28
**Scope:** `apps/web` (React/Electron Frontend)
**Target Audience:** QA Engineers, Developers

---

## 1. Overview
This document serves as the single source of truth for testing the HiDock Next frontend application. It details screen analysis, expected behaviors, and a rigorous testing strategy covering Unit, Integration, and End-to-End (E2E) layers.

**Core Objectives:**
*   **Functional Integrity:** Ensure all interactive elements perform their intended actions.
*   **State Consistency:** Verify data persistence across navigation and sessions.
*   **Resilience:** Validate error handling and recovery mechanisms.
*   **UX Compliance:** Adhere to design standards (loading states, empty states, feedback).

---

## 2. Environment & Prerequisites

### 2.1 Test Environments
*   **Local (Dev):** `npm run dev` (Vite + Electron). Uses local SQLite DB.
*   **Staging:** `npm run build` + `npm run preview`. Uses seeded mock DB.
*   **Production:** Signed Installer (.exe/.dmg). Real hardware connection required.

### 2.2 Data Seeding
*   **Database:** `tests/fixtures/db_seed.sql` contains:
    *   50 Recordings (Mixed: Local, Device-Only, Synced).
    *   10 Meetings (Past and Future).
    *   5 Projects.
    *   20 People contacts.
*   **Hardware Mock:** `tests/mocks/device_mock.ts` simulates:
    *   HiDock H1 connection.
    *   Jensen Protocol responses (file lists, download streams).

---

## 3. Screen-by-Screen Analysis & Test Cases

### 3.1 Library (`src/pages/Recordings.tsx`)
**Purpose:** Central hub for viewing, filtering, and managing audio recordings.

**UI Elements:**
*   **Filter Bar:** Tags (Meeting, Interview, etc.), Status Dropdown, Search Input.
*   **Toolbar:** "Add Capture", "Open Folder", "Download All", "Refresh".
*   **List/Grid:** Virtualized view of recordings.
*   **Item Actions:** Play, Download, Delete, Transcribe status.

**Behavioral Requirements:**
*   **Search:** Debounced input (300ms). Filters local and remote files by filename.
*   **Playback:**
    *   *Local:* Immediate playback via `AudioPlayer`.
    *   *Device-Only:* Auto-triggers download, shows spinner, plays upon completion.
*   **Persistence:** `viewMode` (List/Card) saved in `localStorage`.

**Test Cases:**
| ID | Type | Description | Expected Result |
| :--- | :--- | :--- | :--- |
| **LIB-01** | **E2E** | Large List Rendering | Render 1000 items without layout shift or key warnings. |
| **LIB-02** | **Int** | Filter Logic | Select "Meeting" tag -> Only items with `tag: meeting` appear. |
| **LIB-03** | **Int** | Search | Enter "Amazon" -> List updates to matching filenames. |
| **LIB-04** | **Unit** | Time Formatting | Verify `formatDuration(125)` returns "02:05". |
| **LIB-05** | **E2E** | Device Playback | Click Play on device-only file -> Download starts -> Playback begins. |

---

### 3.2 Calendar (`src/pages/Calendar.tsx`)
**Purpose:** Visualize recordings in a temporal context and link to meetings.

**UI Elements:**
*   **View Toggle:** Day / Work Week / Week / Month.
*   **Navigation:** Prev/Next buttons, "Today".
*   **Grid:** Time slots with Meeting blocks (dashed) and Recording blocks (solid).
*   **Sync Button:** Triggers calendar provider fetch.

**Behavioral Requirements:**
*   **Date Safety:** Must handle `null` current dates gracefully (Fixed in **CAL-02**).
*   **Sync:** `electronAPI.calendar.sync()` must be awaited; loading spinner shown.
*   **Orphans:** Recordings without meetings must appear in the correct time slot.

**Test Cases:**
| ID | Type | Description | Expected Result |
| :--- | :--- | :--- | :--- |
| **CAL-01** | **E2E** | Load Stability | Page loads without crashing on first install (no cached date). |
| **CAL-02** | **Int** | Date Navigation | Click "Next Week" -> Date range advances by 7 days. |
| **CAL-03** | **Unit** | Event Matching | `matchRecordingsToMeetings` correctly links by time overlap. |
| **CAL-04** | **E2E** | Orphan Display | Recording at 3 PM (no meeting) appears as a standalone block. |

---

### 3.3 Assistant (`src/pages/Assistant.tsx`)
**Purpose:** RAG-based chat interface.

**UI Elements:**
*   **Chat Window:** Message history bubble list.
*   **Input Area:** Text area, Send button.
*   **Context Selector:** Dropdown to filter RAG scope (specific recordings).
*   **New Chat:** Resets session.

**Behavioral Requirements:**
*   **Streaming:** AI responses must stream token-by-token (or chunked).
*   **Persistence:** Chat history saved to DB on every user/AI message.
*   **Error Handling:** API failures show a toast error, not a page crash.

**Test Cases:**
| ID | Type | Description | Expected Result |
| :--- | :--- | :--- | :--- |
| **AST-01** | **E2E** | Full Conversation | Send "Hello" -> Verify "Thinking" -> Verify response appears. |
| **AST-02** | **Int** | DB Persistence | Send message -> Reload page -> Message persists. |
| **AST-03** | **Unit** | Context Filter | Selecting "Rec-001" filters RAG context to that file ID. |

---

### 3.4 People (`src/pages/People.tsx`)
**Purpose:** Contact management.

**UI Elements:**
*   **Grid:** Cards representing people.
*   **Search:** Filter by name.
*   **Add Person:** Button (Currently Disabled).

**Known Limitations:**
*   "Add Person" is unimplemented (Disabled state).

**Test Cases:**
| ID | Type | Description | Expected Result |
| :--- | :--- | :--- | :--- |
| **PPL-01** | **Int** | List Rendering | Contacts load from DB and render as cards. |
| **PPL-02** | **Int** | Type Filter | Select "Customer" -> Only contacts with `type: customer` show. |
| **PPL-03** | **UX** | Add Person State | Verify "Add Person" button is present but `disabled`. |

---

### 3.5 Projects (`src/pages/Projects.tsx`)
**Purpose:** Project-based grouping.

**UI Elements:**
*   **Sidebar:** List of projects.
*   **Detail View:** Stats, Description, AI Insights.
*   **Create Button:** Triggers creation flow.

**Known Limitations:**
*   Uses `window.prompt()` for creation. **Blocking Issue for Automation**.

**Test Cases:**
| ID | Type | Description | Expected Result |
| :--- | :--- | :--- | :--- |
| **PRJ-01** | **Int** | Project Selection | Click Project A -> Detail view updates to Project A data. |
| **PRJ-02** | **Manual**| Create Project | Click "New" -> Native Prompt appears -> Enter Name -> Project created. |
| **PRJ-03** | **Int** | Status Filter | Toggle Active/Archived filters list correctly. |

---

### 3.6 Sync (`src/pages/Dashboard.tsx` Device Panel)
**Purpose:** Hardware management.

**UI Elements:**
*   **Connection Card:** Status indicator, Firmware version, Storage bar.
*   **Sync Button:** "Sync [N] Recordings".
*   **Toggles:** Auto-download, Auto-transcribe.

**Behavioral Requirements:**
*   **Hotplug:** UI updates within 2s of USB insertion.
*   **Locking:** Sync buttons disabled if device is disconnected or busy.

**Test Cases:**
| ID | Type | Description | Expected Result |
| :--- | :--- | :--- | :--- |
| **SNC-01** | **E2E** | Connection Cycle | Plug -> "Connected". Unplug -> "Disconnected". |
| **SNC-02** | **Int** | Download Logic | "Sync All" queues items; Global progress bar updates. |
| **SNC-03** | **Unit** | Storage Calc | Verify bytes -> GB conversion logic. |

---

## 4. Integration Workflows (E2E)

### 4.1 The "Happy Path" (Recording -> Knowledge)
1.  **Connect Device:** Mock H1 connection.
2.  **Sync:** Click "Download All". Verify file appears in Library.
3.  **Transcribe:** Click "Transcribe". Verify status changes to "Processing" -> "Complete".
4.  **Chat:** Go to Assistant. Ask "What was in that meeting?". Verify context usage.

### 4.2 The "Offline Path"
1.  **Disconnect Network:** Simulate offline mode.
2.  **Load App:** Verify cached data loads (Calendar, Library).
3.  **Playback:** Verify local files play; remote files show "Offline/Unavailable".

---

## 5. Execution Matrix

| Phase | Scope | Environment | Trigger |
| :--- | :--- | :--- | :--- |
| **Smoke** | Login, Nav, Basic Load | Dev (Local) | On PR Creation |
| **Functional** | All Test Cases (Manual/Auto) | Staging | Pre-Release |
| **Regression** | Critical Paths (E2E) | Staging | Pre-Release |
| **Hardware** | Sync, Firmware, Audio | Prod (Physical) | Weekly |

---

## 6. Recommendations & Roadmap

### 6.1 Critical Fixes
1.  **Refactor Project Creation:** Replace `window.prompt` with a Shadcn UI Dialog to enable automated testing and better UX.
2.  **Implement People Creation:** Enable the "Add Person" button with a backend mutation.
3.  **Fix React Warnings:** Resolve "Missing Key" warnings in Library to prevent render issues.

### 6.2 Automation Improvements
1.  **Playwright Integration:** Set up Playwright for Electron to automate the "Happy Path".
2.  **Mock Mode:** Create a dedicated `npm run mock` command that forces the Electron main process to use `MockDeviceService` instead of real USB.

---

## 7. Artifacts (Visual Baseline)

The following screenshots capture the application state as of Version 2.0 of this plan:

*   **Library:** `docs/qa/screenshots/library_master.png`
*   **Calendar (Month):** `docs/qa/screenshots/calendar_month_master.png`
*   **Calendar (Work):** `docs/qa/screenshots/calendar_work_master.png`
*   **Assistant:** `docs/qa/screenshots/assistant_master.png`
*   **People:** `docs/qa/screenshots/people_master.png`
*   **Projects:** `docs/qa/screenshots/projects_master.png`
*   **Actionables:** `docs/qa/screenshots/actionables_master.png`
*   **Sync:** `docs/qa/screenshots/sync_master.png`
*   **Settings:** `docs/qa/screenshots/settings_master.png`

---

## 8. Lessons Learned & Automation Pitfalls

### 8.1 Navigation & Click Simulation
*   **Pitfall:** Relying solely on `click_by_text` or `click_by_selector` for navigation is unreliable in Electron/React apps where click events might be intercepted or debounced.
*   **Lesson:** For robust E2E test navigation, prefer direct routing via `window.location.hash = '#/route'` or React Router hooks. Always verify the URL (`window.location.href`) *after* an action to confirm success.

### 8.2 Native Dialogs (`window.prompt`)
*   **Pitfall:** Electron apps using native browser dialogs like `alert`, `confirm`, or `prompt` block the execution thread and are often invisible or inaccessible to standard web automation tools (headless or not).
*   **Lesson:** Avoid native dialogs in production code. Use custom UI modals (e.g., Shadcn Dialog) which are fully accessible to the DOM and automation agents.

### 8.3 State Initialization
*   **Pitfall:** Components accessing global stores (Zustand/Redux) may crash if they assume data exists before the store hydration completes (e.g., `currentDate` being undefined).
*   **Lesson:** Always implement "Loading" states or safe default values in components. E2E tests should wait for a "Ready" signal (e.g., specific DOM element) before interacting.

### 8.4 Visual Verification
*   **Pitfall:** Taking screenshots without confirming the UI state can lead to duplicate or misleading artifacts (e.g., capturing the "Loading" spinner instead of the data).
*   **Lesson:** Implement a "Wait for Selector" step before every screenshot command to ensure the page has settled.