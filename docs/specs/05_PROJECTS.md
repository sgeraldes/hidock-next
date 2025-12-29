# Projects Specification

**Module:** Organization
**Screen:** Projects (`/projects`)
**Screenshot:** ![Projects View](../qa/screenshots/projects_master.png)

## Overview
Projects provides a **Project-Centric View** of knowledge. It aggregates recordings, action items, and people under a common initiative. Projects are primarily **auto-detected** but can be manually managed.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Sidebar List** | Project Items | View | Lists Active/Archived projects. Shows unread/update indicators. | "Sidebar - Projects List". |
| **Selection** | Click Item | Click | Loads Project Detail view (Stats, Description, Insights). | "Project Detail" view. |
| **Creation** | "New Project" Button | Click | **Current:** Prompts for name.<br>**Target:** Opens Shadcn Modal for creation/suggestion review. | "Suggested Projects" workflow. |
| **Stats** | Cards (Knowledge, People) | View | Summarizes associated items (e.g., "12 Items", "5 People"). | "Overview" section. |
| **AI Insights** | "Project Insight" Card | View | Displays AI-generated summary of recent project activity. | "AI Project Insight". |

## Data Requirements
*   **Data Source:** `projects` table.
*   **Auto-Population:** Driven by recurring topics and meeting series titles.
*   **Entities:** `Project` (Name, Status, Knowledge Links).
