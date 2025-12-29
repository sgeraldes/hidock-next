# In-Depth Testing Strategy: HiDock Next (Electron/Web)

**Version:** 1.0
**Date:** 2025-12-28
**Scope:** `apps/web` (React/Electron Frontend)

---

## 1. Strategy Overview
This document defines a rigorous testing strategy for the HiDock Next React application. It moves beyond initial smoke testing to cover functional correctness, edge cases, and state management integrity for every screen.

**Core Principles:**
*   **Component-Driven Verification:** Test each page as an isolated unit before testing integration.
*   **State Integrity:** Verify that Zustand store updates correctly reflect UI actions.
*   **Hardware Simulation:** Mock WebUSB/Jensen protocol responses for consistent testing.
*   **Visual Regression:** Ensure UI stability across renders.

---

## 2. Screen Analysis & Test Plan

### 2.1 Library (`src/pages/Recordings.tsx`)
**Purpose:** The central hub for viewing, filtering, and managing audio recordings.
**Key Interactions:**
*   **List Rendering:** Virtualized list of recordings (local + device).
*   **Filtering:** Filter by tag (Meeting, Call, etc.), status, and date.
*   **Playback:** Integrated audio player with waveform.
*   **Sync Status:** Indicators for "On Device", "Downloaded", "Cloud".

**Detailed Test Cases:**
| ID | Category | Test Case | Expected Result |
| :--- | :--- | :--- | :--- |
| **LIB-01** | Functional | Load 1000+ recordings | List renders without lag; "Missing Key" warning is resolved. |
| **LIB-02** | Interaction | Click "Meeting" filter | List updates to show *only* items with "Meeting" tag. Count updates. |
| **LIB-03** | Interaction | Click Play (Local File) | Audio player opens; playback starts immediately. |
| **LIB-04** | Interaction | Click Play (Device File) | App requests file download/stream; shows loading spinner; plays when ready. |
| **LIB-05** | Edge Case | Empty State | "No recordings found" message shown when filters match nothing. |
| **LIB-06** | State | Toggle Card/List View | View preference persists after page reload (Local Storage). |

### 2.2 Calendar (`src/pages/Calendar.tsx`)
**Purpose:** Connect recordings to calendar events.
**Key Interactions:**
*   **Date Navigation:** Switch days/weeks.
*   **Event Rendering:** Display events from connected providers (Outlook/Google).
*   **Association:** Drag-and-drop or click to link a recording to a meeting.

**Detailed Test Cases:**
| ID | Category | Test Case | Expected Result |
| :--- | :--- | :--- | :--- |
| **CAL-01** | Critical | Page Load | Page loads **without crashing** (Fix `toLocaleDateString` error). |
| **CAL-02** | Interaction | Click "Next Day" | View updates to the next calendar date correctly. |
| **CAL-03** | Functional | Sync Events | Clicking "Sync" fetches latest events from API/Local DB. |
| **CAL-04** | Data | Event Details | Clicking an event card shows attendees, time, and linked recording status. |

### 2.3 Assistant (`src/pages/Assistant.tsx`)
**Purpose:** RAG-based chat interface for querying meeting knowledge.
**Key Interactions:**
*   **Chat Input:** Text entry and submission.
*   **Context Selection:** Choosing which meetings/files to "chat with".
*   **Response Rendering:** Markdown rendering of AI responses.

**Detailed Test Cases:**
| ID | Category | Test Case | Expected Result |
| :--- | :--- | :--- | :--- |
| **AST-01** | Functional | Send Query | User message appears immediately; "Thinking" state shown; AI response streams in. |
| **AST-02** | Functional | Context Awareness | "Summarize the last meeting" returns data specific to the most recent file. |
| **AST-03** | Interaction | Clear Chat | "New Chat" button clears history and resets context. |
| **AST-04** | Edge Case | API Error | Graceful error message if AI provider fails or times out. |

### 2.4 Device/Sync (`src/pages/Dashboard.tsx` / Sync Modal)
**Purpose:** Manage physical device connection and file transfers.
**Key Interactions:**
*   **Connection:** USB Hotplug detection.
*   **Transfer:** Bulk or single file download.
*   **Storage:** Visualization of device disk usage.

**Detailed Test Cases:**
| ID | Category | Test Case | Expected Result |
| :--- | :--- | :--- | :--- |
| **DEV-01** | Critical | Hotplug Connect | App detects device insertion within 2 seconds; status becomes "Connected". |
| **DEV-02** | Critical | Hotplug Disconnect | App detects removal; status becomes "Disconnected"; ongoing ops pause/fail gracefully. |
| **DEV-03** | Functional | Download All | Clicking "Sync All" queues all new files; progress bar updates per file. |
| **DEV-04** | Protocol | Protocol Error | If device sends invalid seq, app logs error and retries (does not crash). |

---

## 3. Execution Plan & Tooling

### 3.1 Environment
*   **Runtime:** Electron (Main + Renderer).
*   **Mocking:**
    *   **USB:** Use `tests/mocks/mockDevice.ts` to simulate Jensen protocol packets.
    *   **Database:** Use a pre-seeded `sqlite` DB for consistent data tests.
    *   **AI:** Mock OpenAI/Gemini API responses to avoid cost/latency during testing.

### 3.2 Automated Testing Strategy (Vitest + Playwright)
1.  **Unit Tests (Vitest):**
    *   Test `useUnifiedRecordings` hook for filtering logic.
    *   Test `Calendar` utility functions for date manipulation.
2.  **Integration Tests (Vitest + Testing Library):**
    *   Render `Recordings` page; assert items appear.
    *   Render `Calendar` page with mock data; assert no crash.
3.  **E2E Tests (Electron/Playwright - *Future*):**
    *   Full flow: Launch App -> Connect Mock Device -> Sync -> Play Audio.

### 3.3 Immediate Action Items (Next Steps)
1.  **Fix Calendar Crash:** Analyze `Calendar.tsx` and add null checks for date objects.
2.  **Fix Playback:** Investigate `AudioPlayer` component and file path resolution.
3.  **Implement Unit Tests:** Create `src/pages/Calendar.test.tsx` to prevent regression.
