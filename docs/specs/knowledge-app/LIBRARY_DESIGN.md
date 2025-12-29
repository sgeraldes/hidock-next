# Library View - Visual Design & Mockups

## 1. Design System (Material-Aligned)

### 1.1 Color Palette
Using a specialized `Slate` (Neutral) and `Indigo` (Primary) palette to ensure a professional, knowledge-centric aesthetic.

| Token | Tailwind Class | Hex Value | Usage |
| :--- | :--- | :--- | :--- |
| **Primary** | `bg-indigo-600` | `#4f46e5` | Primary actions (New, Play), Active States. |
| **Primary fg** | `text-white` | `#ffffff` | Text on primary buttons. |
| **Background** | `bg-slate-50` | `#f8fafc` | App background (Desktop). |
| **Surface** | `bg-white` | `#ffffff` | Cards, Sidebar, Header. |
| **Border** | `border-slate-200` | `#e2e8f0` | Dividers, Card outlines. |
| **Text Main** | `text-slate-900` | `#0f172a` | Titles, Primary content. |
| **Text Muted** | `text-slate-500` | `#64748b` | Meta data (Dates, Sizes). |
| **Accent** | `bg-indigo-50` | `#eef2ff` | Hover states, Selected rows. |
| **Success** | `text-emerald-600` | `#059669` | "Synced" status, "Completed". |
| **Warning** | `text-amber-600` | `#d97706` | "Processing", "Device Only". |

### 1.2 Typography
Font Family: **Inter** (sans-serif) - Clean, high legibility for dense data.

| Component | Size | Weight | Line Height | Example |
| :--- | :--- | :--- | :--- | :--- |
| **Page Title** | `text-2xl` (24px) | `font-semibold` (600) | `leading-tight` | **Library** |
| **Section Header** | `text-xs` (12px) | `font-bold` (700) | `leading-none` | *ALL RECORDINGS* |
| **Row Title** | `text-sm` (14px) | `font-medium` (500) | `leading-normal` | Q1 Planning Meeting |
| **Meta Data** | `text-xs` (12px) | `font-normal` (400) | `leading-normal` | 10 mins ago • 45 MB |

### 1.3 Iconography (Lucide React)
*   **Play/Pause**: `Play`, `Pause` (Filled when active).
*   **Status**: `Cloud` (Device), `CheckCircle2` (Local), `Loader2` (Processing).
*   **Actions**: `MoreHorizontal` (Menu), `Download` (Import), `Trash2` (Delete).

---

## 2. Layout & Wireframes

### 2.1 Desktop Layout (Mermaid)
```mermaid
graph TD
    subgraph Window [Application Window 1280x800]
        Header[Header Bar: Title | Search | Filters | View Toggle]
        
        subgraph Main [Main Content Area]
            List[Virtualized List Container]
            Row1[Row: Checkbox | Icon | Title | Date | Duration | Actions]
            Row2[Row: Checkbox | Icon | Title | Date | Duration | Actions]
            Row3[Row: Checkbox | Icon | Title | Date | Duration | Actions]
        end
        
        Drawer[Detail Drawer (Overlay right 400px)]
        DrawerHeader[Drawer: Title & Meta]
        DrawerPlayer[Drawer: Waveform Player]
        DrawerTabs[Drawer: Transcript / Summary / Notes]
    end
    
    Header --> Main
    Row1 -- Click --> Drawer
```

### 2.2 Responsive Breakpoints
*   **Desktop (>1024px)**:
    *   Full Table with 6 columns: `Select`, `Status`, `Name`, `Date`, `Duration`, `Actions`.
    *   Detail Drawer: Slide-over (Right), width `400px`.
*   **Tablet (768px - 1024px)**:
    *   Reduced Table: `Status`, `Name`, `Date`, `Actions`.
    *   Detail Drawer: Modal Dialog (Centered).
*   **Mobile (<768px)**:
    *   Card View (Stacked): Icon + Name on top, Meta below.
    *   Detail View: Full-screen navigation.

---

## 3. High-Fidelity Component Mockup (React/Tailwind)

This code represents the visual target for the `LibraryRow` component.

```tsx
export function LibraryRow({ recording, isSelected, onPlay }: LibraryRowProps) {
  return (
    <div 
      className={cn(
        "group flex items-center h-[52px] px-4 border-b border-slate-100 transition-colors",
        "hover:bg-slate-50",
        isSelected && "bg-indigo-50/50 border-indigo-100"
      )}
    >
      {/* 1. Selection */}
      <div className="w-10 flex-shrink-0">
        <Checkbox 
          checked={isSelected} 
          className="data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
        />
      </div>

      {/* 2. Status Icon */}
      <div className="w-10 flex-shrink-0 flex items-center justify-center text-slate-400">
        {recording.location === 'device' ? (
          <Cloud className="h-4 w-4 text-amber-500" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        )}
      </div>

      {/* 3. Title & Player Trigger */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <button 
          onClick={onPlay}
          className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-600 hover:text-white"
        >
          <Play className="h-4 w-4 fill-current" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">
            {recording.title || recording.filename}
          </p>
          <p className="text-xs text-slate-500 truncate md:hidden">
            {/* Mobile-only subtext */}
            {formatDate(recording.createdAt)}
          </p>
        </div>
      </div>

      {/* 4. Meta Columns (Desktop) */}
      <div className="hidden md:block w-32 text-sm text-slate-500">
        {formatDate(recording.createdAt)}
      </div>
      <div className="hidden md:block w-24 text-sm text-slate-500 font-mono">
        {formatDuration(recording.duration)}
      </div>

      {/* 5. Actions */}
      <div className="w-20 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600">
          <FileText className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-900">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          {/* Menu Items... */}
        </DropdownMenu>
      </div>
    </div>
  )
}
```

## 4. Interaction States

### 4.1 Empty State (Zero Data)
*   **Visual**: Large SVG illustration of a "Box" or "Folder".
*   **Text**: "No recordings found" (H3, Bold), "Connect your HiDock device or import a file to get started." (Body, Muted).
*   **Actions**:
    *   Primary Button: `Connect Device` (Indigo).
    *   Secondary Button: `Import File` (Outline).

### 4.2 Loading State
*   **Visual**: 5 Skeleton Rows.
*   **Animation**: `animate-pulse` gradient from slate-100 to slate-200.

### 4.3 Drag & Drop
*   **State**: When user drags file over list.
*   **Visual**: Overlay `bg-indigo-500/10` with dashed border `border-2 border-indigo-500 border-dashed`.
*   **Text**: "Drop audio files to import".

## 5. Navigation Flow

1.  **Entry**: `/library` loads. Skeleton list appears.
2.  **Populate**: List fades in.
3.  **Detail**: User clicks row.
    *   **Desktop**: URL updates to `/library?id=xyz`. Drawer slides in from right. List remains visible (dimmed).
    *   **Mobile**: URL updates to `/library/xyz`. Page transition to Detail View.
4.  **Back**: User clicks "X" or "Back".
    *   **Desktop**: Drawer slides out. URL resets to `/library`.
    *   **Mobile**: Page transition back to List.
