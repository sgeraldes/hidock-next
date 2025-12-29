# Calendar Specification

**Module:** Organization
**Screen:** Calendar (`/calendar`)
**Screenshot:** ![Calendar Month View](../qa/screenshots/calendar_month_master.png)

## Overview
The Calendar provides an **Event-Centric View** of knowledge. It links recordings to scheduled meetings, allowing users to visualize gaps in their knowledge capture and organize content temporally.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **View Switching** | Toggle Buttons | Click Day/Week/Month | Switches grid layout. Fetches events for new date range. | Standard Calendar views. |
| **Date Navigation** | Prev/Next (< >) | Click | Moves backward/forward by one unit (Day/Week/Month). | "Temporal Navigation". |
| **Sync** | "Syncing..." Indicator | Auto or Manual Click | Fetches latest events from Outlook/Google. Updates grid. | "Auto-population" trigger. |
| **Meeting Blocks** | Dashed Box | Click | Opens Meeting Details. Shows "No Recording Linked" status. | Visual distinction for missing knowledge. |
| **Recording Blocks** | Solid Box | Click | Navigates to Library/Player for that recording. | Visual confirmation of captured knowledge. |
| **Orphan Handling** | Solid Box (No Meeting) | View Grid | Displays recordings without matching meetings in their respective time slots. | "Knowledge without Event". |

## Data Requirements
*   **Data Source:** `meetings` table (Calendar Events), `recordings` table.
*   **Logic:** `matchRecordingsToMeetings` (Time-based overlap algorithm).
*   **State:** `currentDate`, `calendarView` persisted in store.
