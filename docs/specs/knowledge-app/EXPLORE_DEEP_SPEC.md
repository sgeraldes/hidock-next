# Explore View - Comprehensive Engineering Specification

## 1. Component Architecture
Explore is a dashboard-style view transforming from a widget grid to a search result list based on user interaction. It requires smooth state transitions.

### 1.1 Component Hierarchy
```
ExplorePage (Route: /explore)
â”œâ”€â”€ HeroHeader (Sticky behavior)
â”‚   â””â”€â”€ GlobalSearchInput (Animated)
â”œâ”€â”€ DashboardContent (Visible when query='')
â”‚   â”œâ”€â”€ WidgetGrid
â”‚   â”‚   â”œâ”€â”€ TopicCloudWidget
â”‚   â”‚   â”œâ”€â”€ RecentFilesWidget
â”‚   â”‚   â””â”€â”€ TopPeopleWidget
â””â”€â”€ SearchResultsContent (Visible when query!='')
    â”œâ”€â”€ ResultTabs (All, Knowledge, People, Projects)
    â””â”€â”€ ResultList
        â”œâ”€â”€ KnowledgeCard
        â”œâ”€â”€ PersonCard
        â””â”€â”€ ProjectCard
```

## 2. Data Model & State

### 2.1 Types & Interfaces
```typescript
interface ExploreData {
  topics: { text: string; weight: number }[];
  recentFiles: UnifiedRecording[];
  topPeople: Person[];
}

interface SearchResult {
  type: 'knowledge' | 'person' | 'project';
  id: string;
  title: string;
  subtitle?: string; // Date or Role
  snippet?: string; // Highlighted text
  meta?: Record<string, any>;
}

interface ExploreState {
  // Query
  query: string;
  debouncedQuery: string;
  
  // Dashboard Data
  dashboardData: ExploreData | null;
  loadingDashboard: boolean;
  
  // Search Data
  results: SearchResult[];
  isSearching: boolean;
  activeTab: 'all' | 'knowledge' | 'people';
}
```

## 3. Detailed Component Specifications

### 3.1 GlobalSearchInput
*   **Props**: `value`, `onChange`, `isHero: boolean`.
*   **Animation**:
    *   **Hero Mode**: Centered, `max-w-2xl`, `h-16`, text-lg.
    *   **Bar Mode**: Top of screen, `w-full`, `h-10`, text-base.
    *   *Transition*: Framer Motion or CSS Transition on focus/input.
*   **Behavior**:
    *   `onChange` updates local state immediately.
    *   `useEffect` triggers search API after 300ms debounce.

### 3.2 TopicCloudWidget
*   **Visual**: Flex wrap container.
*   **Items**: Pill-shaped tags. Size varies by `weight` (text-xs to text-lg).
*   **Color**: Random assignment from theme palette (blue, green, purple, orange) or heat-map based.
*   **Interaction**: Click -> Sets `query` to topic text -> Triggers search.

### 3.3 ResultCards
*   **KnowledgeCard**:
    *   Icon: File type.
    *   Title: Filename.
    *   Snippet: 2 lines max, `<strong>` tags for query matches.
*   **PersonCard**:
    *   Avatar: Initials or Image.
    *   Title: Name.
    *   Sub: "3 meetings".
*   **Action**: Click navigates to respective Detail View.

## 4. Interaction Patterns

### 4.1 Search Transition
1.  **User focuses Input** (Center).
2.  **User types** "P".
    *   Input moves to Top Header (Sticky).
    *   Dashboard fades out (`opacity-0`).
    *   Results container fades in (`opacity-100`).
3.  **User clears Input**:
    *   Reverse animation.

### 4.2 Tab Navigation
*   **Tabs**: Horizontal list.
*   **Selection**: Updates `activeTab`. Filters `results` list client-side (or triggers filtered API call if paginated).

## 5. Visual Hierarchy & Styling

*   **Dashboard**:
    *   **Cards**: `bg-card`, `rounded-xl`, `border-border`, `shadow-sm`.
    *   **Headers**: Uppercase, wide tracking, `text-xs text-muted-foreground`.
*   **Search Results**:
    *   **Highlights**: `bg-yellow-200/50` text highlight.
    *   **Separators**: `border-b` between items.

## 6. Accessibility (A11y)

*   **Search Input**: `role="searchbox"`, `aria-label="Search your knowledge base"`.
*   **Results**: `aria-live="polite"` region announcing "Found X results".
*   **Keyboard**:
    *   `ArrowDown` from input moves focus to first result.
    *   `Enter` on result opens it.

## 7. Performance Targets

*   **Transition**: Animation frame rate 60fps (use `transform` not `top/left`).
*   **Search Latency**: < 200ms (Local SQLite FTS5 query).
*   **Result Rendering**: Virtualize result list if > 50 items.

## 8. Test Plan

### 8.1 Unit Tests
*   **Search Logic**: Verify debounce timing.
*   **Highlighting**: Input "foo", Text "foobar" -> Output "`<strong>foo</strong>bar`".

### 8.2 Integration Tests
*   **Dashboard Load**: Verify widgets populate.
*   **Search Flow**:
    *   Type "Meeting" -> Verify Dashboard disappears -> Verify Results appear.
    *   Click Result -> Verify navigation to `/library/:id`.