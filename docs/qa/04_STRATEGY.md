# In-Depth Testing Strategy: HiDock Next (Electron/Web)

**Version:** 1.1
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
**Detailed Test Cases:**
| ID | Category | Test Case | Expected Result |
| :--- | :--- | :--- | :--- |
| **LIB-01** | Functional | Load 1000+ recordings | List renders without lag; "Missing Key" warning resolved. |
| **LIB-02** | Interaction | Click "Meeting" filter | List updates to show *only* items with "Meeting" tag. |
| **LIB-03** | Interaction | Click Play (Local File) | Audio player opens; playback starts. |
| **LIB-04** | Interaction | Click Play (Device File) | App requests download; shows spinner; plays when ready. |
| **LIB-05** | State | Toggle Card/List View | View preference persists after page reload. |

### 2.2 Calendar (`src/pages/Calendar.tsx`)
**Purpose:** Connect recordings to calendar events.
**Detailed Test Cases:**
| ID | Category | Test Case | Expected Result |
| :--- | :--- | :--- | :--- |
| **CAL-01** | Critical | Page Load Integrity | Page loads without crashing. `currentDate` null-check verified. |
| **CAL-02** | Interaction | Navigation | Clicking "Day" / "Work" / "Month" switches views correctly. |
| **CAL-03** | Functional | Sync Success | "Sync" fetches latest events and updates `lastCalendarSync`. |
| **CAL-04** | Stability | Store Action | `setCurrentDate` properly updates state and triggers re-fetch. |

### 2.3 Assistant (`src/pages/Assistant.tsx`)
**Purpose:** RAG-based chat interface for querying meeting knowledge.
**Detailed Test Cases:**
| ID | Category | Test Case | Expected Result |
| :--- | :--- | :--- | :--- |
| **AST-01** | Functional | Send Query | User message appears; AI response streams in. |
| **AST-02** | Integrity | Transaction Safety | Check for `cannot rollback` errors during chat history save. |
| **AST-03** | Interaction | Clear History | "New Chat" clears state. |

### 2.4 Organization (People & Projects)
**Purpose:** Entity management.
**Detailed Test Cases:**
| ID | Category | Test Case | Expected Result |
| :--- | :--- | :--- | :--- |
| **ORG-01** | Functional | People: Add Person | Clicking "Add Person" opens creation modal. |
| **ORG-02** | Functional | Projects: Create Project | Clicking "Create New Project" opens creation modal. |
| **ORG-03** | Resilience | Error Recovery | Component recovers via "Try Again" if initial DB fetch fails. |

---

## 3. Execution Plan & Tooling

### 3.1 Environment Setup
*   **Mocks:** Use `tests/mocks` for USB and AI API responses.
*   **Database:** Pre-seeded SQLite.

### 3.2 Automated Testing
1.  **Unit (Vitest):** Target hooks and utility functions.
2.  **Integration (Testing Library):** Target page rendering and user interactions.
3.  **E2E (Playwright):** Target critical paths (Sync -> Transcribe -> Chat).

### 3.3 Regression Prevention
*   **Action:** Add a Vitest test for `Calendar.tsx` specifically testing the `currentDate` initialization to prevent another `toLocaleDateString` regression.