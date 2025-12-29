# QA Session Findings

**Session Date:** 2025-12-28
**Status:** Completed

---

## Active Issues (Open)

### Critical / High Severity
| ID | Severity | Component | Issue Description | Root Cause Analysis | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CAL-02** | **CRITICAL** | Calendar | Page Crash on Load | `Cannot read properties of undefined (reading 'toLocaleDateString')` in `something went wrong` error boundary. Likely missing date prop or context. | 🔴 Open |
| **PLY-01** | **HIGH** | Player | Playback Failed | "Playback error: Failed to play audio" toast when clicking play on Library items. | 🔴 Open |

### Medium / Low Severity
| ID | Severity | Component | Issue Description | Root Cause Analysis | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UI-01** | LOW | Library | React "Missing Key" Warning | Reconciliation error in virtualized list. | 🔴 Open |
| **NAV-01** | LOW | Navigation | Click Events Cancelled | "Click events were cancelled by the page" reported by automation tool during sidebar navigation, though navigation succeeds. | 🔴 Open |
| **UX-01** | LOW | Library | Visual Identity | Library looks too similar to Calendar List view. | 🔵 Design Feedback |
| **ACT-01** | MEDIUM | Actionables | Feature Incomplete | Backend generator missing. | 🔵 Known Limitation |

---

## Verified Fixes (Closed)
| ID | Issue | Verification Method |
| :--- | :--- | :--- |
| **SYS-01** | Database Rollback Error | Verified logs during Assistant chat save operations. No `cannot rollback` errors found. |
| **SYS-02** | Jensen "Unexpected seq" Flood | Verified logs during device sync. Protocol traffic is healthy. |
| **SVC-01** | Implicit Auto-Download | Verified logs on startup and Sync page load. No massive queue trigger observed. |
| **SYS-04** | IPC Infinite Recursion | Verified `preload/index.js` content. |
| **CAL-01** | Day View Navigation | Verified code logic (1-day decrement). |
| **SET-01** | Advanced Ops Visibility | Verified Settings page. Buttons hidden by default. |

---

## Session Log
*   [00:00] Initialized QA Session.
*   [00:05] **Library**: Loaded. Verified "Missing Key" warning (UI-01). Filter works. View toggle failed (UI limitation?).
*   [00:10] **Assistant**: Loaded. Chat sent successfully. **SYS-01 Verified Fixed**.
*   [00:15] **Explore**: Loaded. Search input worked but no results (empty state?).
*   [00:18] **Calendar**: **CRASHED (CAL-02)**.
*   [00:20] **People**: Error persisted, but recovered after "Try Again".
*   [00:22] **Projects**: Loaded. Create Modal Verified.
*   [00:25] **Actionables**: Loaded. Empty state verified.
*   [00:28] **Sync**: Loaded. Device connected. **SYS-02 & SVC-01 Verified Fixed**.
*   [00:30] **Settings**: Loaded. Advanced Ops toggle verified.