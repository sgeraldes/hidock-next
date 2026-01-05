# QA Test Plan: Functional Checklist

**Objective:** Validate all functional requirements screen-by-screen.

---

## 1. Knowledge Library (`/library`)
*   **Goal:** Verify list rendering, virtualization, and filtering.
*   **Test Cases:**
    *   [ ] **Load List:** Page renders without "Missing Key" console warnings.
    *   [ ] **Filter Category:** Clicking "Meeting" filter updates list count.
    *   [ ] **View Toggle:** Switching from "List" to "Card" view persists (screenshot verification).
    *   [ ] **Play Audio:** Clicking "Play" on a *local* file starts playback (verify `[QA-MONITOR][Operation] Playing` log).

## 2. Assistant (`/assistant`)
*   **Goal:** Verify database write operations and chat context.
*   **Test Cases:**
    *   [ ] **Load History:** Previous conversations load.
    *   [ ] **Send Message:** Typing "test" and sending creates a new bubble.
    *   [ ] **DB Integrity:** **CRITICAL:** Check logs for `cannot rollback` errors during save.
    *   [ ] **New Chat:** Clicking "New Chat" clears the view.

## 3. Explore (`/explore`)
*   **Goal:** Verify search and aggregation logic.
*   **Test Cases:**
    *   [ ] **Render:** Page loads without crash.
    *   [ ] **Search:** Entering a query updates the results area.

## 4. Organization: Calendar (`/calendar`)
*   **Goal:** Verify date navigation logic and sync display.
*   **Test Cases:**
    *   [ ] **Day View Navigation:** Switch to Day View. Click Previous (`<`). Verify date moves back **1 day** (not 7).
    *   [ ] **Sync:** Click "Sync". Verify `calendar:sync` IPC call succeeds.
    *   [ ] **Event Click:** Clicking a meeting opens details.

## 5. Organization: People & Projects (`/people`, `/projects`)
*   **Goal:** Verify entity listing and creation.
*   **Test Cases:**
    *   [ ] **People List:** Loads contacts from DB.
    *   [ ] **Projects List:** Loads projects.
    *   [ ] **Create Project:** "New Project" button opens modal.

## 6. Actions: Actionables (`/actionables`)
*   **Goal:** Verify page shell (feature is known incomplete).
*   **Test Cases:**
    *   [ ] **Load:** Page loads without crashing.
    *   [ ] **Empty State:** Shows "No Actionables" message.

## 7. Device: Sync (`/sync`)
*   **Goal:** Verify connection handling and download logic.
*   **Test Cases:**
    *   [ ] **Connection:** Shows "Connected" status when device is attached.
    *   [ ] **Auto-Download:** **CRITICAL:** Does **NOT** trigger queue flood immediately on load.
    *   [ ] **Manual Sync:** Clicking "Sync All" queues files correctly.
    *   [ ] **Protocol:** Monitor logs for "Unexpected seq" flood (Jensen protocol check).

## 8. Settings (`/settings`)
*   **Goal:** Verify configuration and safety.
*   **Test Cases:**
    *   [ ] **Load:** Loads config values.
    *   [ ] **Advanced Ops:** "Purge/Reset" buttons are **HIDDEN** by default.
    *   [ ] **Toggle Advanced:** Clicking "Advanced Operations" reveals the buttons.
