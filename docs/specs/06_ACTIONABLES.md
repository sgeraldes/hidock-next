# Actionables Specification

**Module:** Actions
**Screen:** Actionables (`/actionables`)
**Screenshot:** ![Actionables View](../qa/screenshots/actionables_master.png)

## Overview
Actionables is the **Proactive Action Center**. It aggregates "Needs Attention" items derived from knowledge (e.g., "Send meeting minutes", "Follow up") and facilitates the generation of artifacts.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Dashboard** | Sections | View | Grouped by "Needs Attention", "Suggestions", "Recently Generated". | "Actionables View" structure. |
| **Status Filter** | Tabs | Click "Pending", "Generated" | Filters list by item status. | Standard filter. |
| **Generation** | "Generate Now" Button | Click | Opens Output Generation flow (Template selection -> Draft -> Save). | "Output Generation Flow". |
| **Dismissal** | "Dismiss" Button | Click | Removes item from view (marks as dismissed). | User control. |
| **Empty State** | Placeholder | View | "No pending Actionables" with illustration. | Good UX practice. |

## Data Requirements
*   **Data Source:** `actionables` table, `outputs` table.
*   **Auto-Population:** Driven by `ACTIONABLE_RULES` (e.g., "meeting_type === team").
*   **Entities:** `Actionable` (Title, Type, Source ID), `Artifact` (Content).
