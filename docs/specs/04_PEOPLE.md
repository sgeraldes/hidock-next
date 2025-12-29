# People Specification

**Module:** Organization
**Screen:** People (`/people`)
**Screenshot:** ![People View](../qa/screenshots/people_master.png)

## Overview
People is the **Person-Centric View** of knowledge. It is designed to be **auto-populated** from transcripts, identifying speakers and mentions to build a network of interactions.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Contact List** | Card Grid | View | Displays contacts with Name, Role, Interaction Count. | "List View" design. |
| **Filtering** | Type Tags | Click "Team", "Customer" | Filters grid by contact type. | Matches "Auto-population" classification. |
| **Search** | Input Field | Type Name | Filters contacts by name/email. | Standard search. |
| **Creation** | "Add Person" Button | Click | **Current:** Disabled.<br>**Target:** Opens manual creation modal (override auto-pop). | "Auto-populated... minimal manual creation". |
| **Detail View** | Click Card | Click | Navigates to `/person/:id` (Knowledge Map, Timeline). | "Person Detail" view. |

## Data Requirements
*   **Data Source:** `contacts` table.
*   **Auto-Population:** Driven by `transcript_speakers` and `calendar_attendees`.
*   **Entities:** `Person` (Name, Type, Knowledge Links).
