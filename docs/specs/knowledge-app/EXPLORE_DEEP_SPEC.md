# Explore View - Deep Functional Specification

## 1. Overview & Goals
**Explore** is the "Dashboard" and "Discovery" engine. It moves beyond simple lists (Library) to provide aggregated insights, trend analysis, and global search across all entity types (Knowledge, People, Projects).
**Goal**: Help users "connect the dots" by surfacing recurring topics, active projects, and providing a powerful global search entry point.

## 2. Views & Components

### 2.1 View Structure
1.  **Dashboard (Default)**: Widget-based layout showing overview stats and trends.
2.  **Search Results**: A dedicated view overlay or replacement when a query is active.

### 2.2 Minimal Viable Components (MVC)

#### A. Global Search Hero (Top)
*   **Large Input**: "What are you looking for?" centered search bar.
*   **Behavior**: As user types, it transitions from Dashboard to Results view.

#### B. Dashboard Widgets (Grid)
*   **Topic Cloud**: Visual tag cloud of recurring keywords from transcripts.
*   **Recent Activity**: "Last 3 Meetings", "New Action Items".
*   **People Spotlight**: "People you met with most this week".
*   **Project Status**: Quick links to active projects.

#### C. Search Results View
*   **Tabs**: All, Knowledge, People, Projects.
*   **Result Card (Knowledge)**: Title, Snippet (with keyword highlight), Date.
*   **Result Card (Person)**: Avatar, Name, "Mentioned in X meetings".
*   **Result Card (Project)**: Icon, Name, "Last active".

## 3. Data States

| State | Visual Representation | Behavior |
| :--- | :--- | :--- |
| **Dashboard (Loading)** | Skeleton cards for widgets. | Non-interactive. |
| **Dashboard (Ready)** | Populated widgets. | Click widget -> Filter Search. |
| **Search (Loading)** | "Searching..." spinner in input right. | Results area dimmed. |
| **Search (No Results)** | "No matches found". | Suggest broader terms. |
| **Search (Results)** | List of result cards. | Click card -> Detail View. |

## 4. Interaction Patterns

### 4.1 Discovery
*   **Topic Click**: Clicking a tag in "Topic Cloud" triggers a search for that tag.
*   **Person Click**: Clicking a person in "Spotlight" goes to `/person/:id`.

### 4.2 Search Experience
*   **Debounce**: Search triggers 300-500ms after typing stops.
*   **Highlighting**: Matched terms in snippets should be bold/yellow background.
*   **Navigation**: `Up/Down` arrow keys to select result, `Enter` to navigate.

## 5. Visual Hierarchy

1.  **Primary**: Search Input (Hero element).
2.  **Secondary**: Widget Titles, Result Titles.
3.  **Tertiary**: Meta-data (dates, counts), snippets.

**Theme Tokens**:
-   **Topic Tag**: `bg-secondary`, `hover:bg-primary`, `hover:text-primary-foreground`.
-   **Card Background**: `bg-card`, `border-border`.
-   **Highlight**: `bg-yellow-200` (Light mode), `bg-yellow-900` (Dark mode).

## 6. Responsiveness

| Breakpoint | Layout Change |
| :--- | :--- |
| **Desktop (>1024px)** | 3-Column Grid for Widgets. |
| **Tablet (768px-1024px)** | 2-Column Grid. |
| **Mobile (<768px)** | 1-Column Stack. Search Input becomes standard size (not Hero). |

## 7. Implementation Manual (Step-by-Step)

### Phase 1: Dashboard Structure
1.  **Layout**: Create a Grid container in `Explore.tsx`.
2.  **Widgets**: Componentize `TopicCloud.tsx`, `RecentActivity.tsx`.
3.  **Data**: Create `useExploreData` hook that aggregates:
    *   `rag.getTopics()` (New API needed or derived from existing).
    *   `knowledge.getRecent()`.
    *   `people.getTop()`.

### Phase 2: Global Search Logic
1.  **State**: Lift `query` state to URL param (`?q=...`) to support bookmarking/back-button.
2.  **Service**: Enhance `rag.search()` to return structured `Snippet` data with hit highlights.
3.  **UI**: Implement the "Tabs" interface for filtering results.

### Phase 3: Visuals
1.  **Hero Input**: Style the input to be large and central initially, animating to the top bar when searching.
2.  **Cards**: Polish the `ResultCard` components to clearly distinguish types (Person vs File vs Project) using Icons/Avatars.

## 8. Proposed Design Mockup Description
*   **Hero**: Top 1/3 of screen is a gradient background (subtle). Centered is a large, rounded Search Bar with shadow.
*   **Widgets**: Below the hero, a masonry grid.
    *   **Topics**: A card with colorful bubbles of varying sizes.
    *   **People**: A horizontal scroll row of circular avatars.
*   **Results Transition**: When user types, the Hero Search Bar slides to the top (sticky header), the Widgets fade out, and the Results List fades in.
