# Tri-Pane Library Layout - Design Specification

## Overview

The Library page uses a **tri-pane notebook workspace** layout, inspired by professional knowledge management tools like Notion, Obsidian, and Apple Notes. This layout enables users to browse their knowledge sources, read content in detail, and interact with an AI assistant—all without leaving the page.

```
+------------------+------------------------+------------------+
|                  |                        |                  |
|   LIBRARY LIST   |     SOURCE READER      |    ASSISTANT     |
|     (Panel 1)    |       (Panel 2)        |    (Panel 3)     |
|                  |                        |                  |
|   25% width      |      45% width         |    30% width     |
|   min: 200px     |      min: 300px        |    min: 250px    |
|   max: 400px     |      flexible          |    max: 450px    |
|                  |                        |                  |
+------------------+------------------------+------------------+
```

---

## Panel 1: Library List (Left)

### Purpose
Browse, search, filter, and select knowledge sources. This is the navigation hub.

### Dimensions
- **Default width:** 25% of viewport
- **Minimum width:** 200px
- **Maximum width:** 400px
- **Height:** 100% of available space (below app header)

### Content Structure

```
+----------------------------------+
|  HEADER                          |
|  [icon] Library    [+] [refresh] |
|  "847 sources"                   |
+----------------------------------+
|  FILTERS BAR                     |
|  [Search........................]|
|  [Location v] [Type v] [More v]  |
|  [Compact] [Cards]               |
+----------------------------------+
|  SOURCE LIST (virtualized)       |
|  +----------------------------+  |
|  | [icon] Meeting with John   |  |
|  | 45:23 · Dec 28 · Audio     |  |
|  | [play] [download] [...]    |  |
|  +----------------------------+  |
|  | [icon] Q4 Strategy Doc     |  |  <-- SELECTED (highlighted)
|  | 12 pages · Dec 27 · PDF    |  |
|  | [view] [...]               |  |
|  +----------------------------+  |
|  | [icon] Research Notes      |  |
|  | 2,341 words · Dec 26 · MD  |  |
|  | [edit] [...]               |  |
|  +----------------------------+  |
|  | ... (virtualized list)     |  |
|  +----------------------------+  |
+----------------------------------+
|  BULK ACTIONS BAR (when items    |
|  are selected)                   |
|  "3 selected" [Download] [Delete]|
+----------------------------------+
```

### Visual Details

#### Header
- App icon (book or library icon) + "Library" title
- Source count as subtle subtitle: "847 sources"
- Action buttons (right-aligned):
  - **[+] Import** - Opens import dialog or enables drag-drop mode
  - **[Refresh]** - Syncs with device, circular arrow icon

#### Filters Bar
- **Search input:** Full width, placeholder "Search sources...", magnifying glass icon, clear button when text present
- **Filter dropdowns** (compact pills/chips):
  - Location: All | Device | Local
  - Type: All | Audio | PDF | Markdown | Image | Web Clip
  - More: Category, Quality, Status (expandable)
- **View toggle:** Icon buttons for Compact (list icon) vs Cards (grid icon)

#### Source List Items (Compact View)
Each item is 56px tall with:
- **Left:** Type icon (mic for audio, file-text for PDF, markdown icon, image icon, globe for web clip)
- **Center:**
  - Title (truncated with ellipsis, bold, 14px)
  - Metadata line (muted, 12px): duration/pages/words + date + type badge
- **Right:** Action buttons (appear on hover):
  - Play (audio only)
  - View/Open
  - Download (if device-only)
  - More menu (...)

#### Selection States
- **Unselected:** Default background
- **Hover:** Subtle background highlight (gray-100 / dark:gray-800)
- **Selected:** Accent background (blue-50 / dark:blue-950), left border accent
- **Multi-select:** Checkbox appears on left side

#### Empty States
- **No sources:** Illustration + "No Knowledge Captured Yet" + "Connect your HiDock or import files to get started" + [Connect Device] button
- **No matches:** "No sources match your filters" + [Clear Filters] button

---

## Panel 2: Source Reader (Center)

### Purpose
Display the full content of the selected source. This is the main reading/viewing area.

### Dimensions
- **Default width:** 45% of viewport
- **Minimum width:** 300px
- **Maximum width:** Flexible (takes remaining space)
- **Height:** 100% of available space

### Content Structure (varies by source type)

#### Common Header (all types)
```
+--------------------------------------------------+
|  SOURCE HEADER                                    |
|  [Back <] Q4 Strategy Document           [x]     |
|  PDF · 12 pages · Added Dec 27, 2024             |
|  Tags: [strategy] [quarterly] [+]                |
+--------------------------------------------------+
```

- **Back button:** Returns to list focus (mobile), or deselects (desktop)
- **Title:** Large, bold, 18-20px
- **Close button [x]:** Collapses reader panel (shows empty state)
- **Metadata line:** Type badge, size/duration, date
- **Tags:** Editable tag chips with [+] to add

#### Audio Source View
```
+--------------------------------------------------+
|  [HEADER - as above]                             |
+--------------------------------------------------+
|  STICKY AUDIO PLAYER                             |
|  [waveform visualization ==================]     |
|  [|<] [<<] [ PLAY ] [>>] [>|]  12:34 / 45:23    |
|  [1x v] [volume] [download]                      |
+--------------------------------------------------+
|  TABS: [Transcript] [Summary] [Notes]            |
+--------------------------------------------------+
|  TRANSCRIPT CONTENT                              |
|                                                  |
|  [00:00:00] Speaker 1                            |
|  "Welcome everyone to today's meeting..."        |
|                                                  |
|  [00:00:15] Speaker 2                            |  <-- Highlighted during playback
|  "Thanks for having me. I wanted to discuss..."  |
|                                                  |
|  [00:00:45] Speaker 1                            |
|  "That's a great point. Let me share my screen."|
|                                                  |
|  (scrollable, synced with audio position)        |
+--------------------------------------------------+
```

**Audio Player Features:**
- Waveform visualization showing audio amplitude
- Current position indicator (vertical line on waveform)
- Playback controls: Previous, Rewind 10s, Play/Pause, Forward 10s, Next
- Time display: Current / Total
- Speed selector: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x
- Volume slider
- Download button

**Transcript Features:**
- Clickable timestamps that seek audio
- Speaker labels (when diarization available)
- Current segment highlighted during playback
- Auto-scroll to follow playback (toggleable)
- Text selection for copying
- Search within transcript

#### PDF Source View
```
+--------------------------------------------------+
|  [HEADER - as above]                             |
+--------------------------------------------------+
|  PDF TOOLBAR                                     |
|  [<] Page 3 of 12 [>]  |  [-] 100% [+]  | [fit] |
+--------------------------------------------------+
|  PDF CONTENT                                     |
|  +--------------------------------------------+  |
|  |                                            |  |
|  |         (Rendered PDF page)                |  |
|  |                                            |  |
|  |    Scrollable, zoomable PDF viewer         |  |
|  |                                            |  |
|  |    Text selectable if not scanned          |  |
|  |                                            |  |
|  +--------------------------------------------+  |
|                                                  |
|  EXTRACTED TEXT (collapsible)                    |
|  [v] Show extracted text                         |
|  "The quick brown fox jumps over..."             |
+--------------------------------------------------+
```

**PDF Viewer Features:**
- Page navigation: Previous/Next, page number input
- Zoom controls: Zoom in, Zoom out, Fit to width, Fit to page
- Scroll through all pages (continuous or paginated mode)
- Text selection (when text layer available)
- Extracted/OCR text shown in collapsible section below

#### Markdown Source View
```
+--------------------------------------------------+
|  [HEADER - as above]                             |
+--------------------------------------------------+
|  MARKDOWN TOOLBAR                                |
|  [Edit] [Preview]  |  [Export v]                 |
+--------------------------------------------------+
|  MARKDOWN CONTENT (Preview Mode)                 |
|                                                  |
|  # Research Notes                                |
|                                                  |
|  ## Key Findings                                 |
|                                                  |
|  The study revealed several important insights:  |
|                                                  |
|  - Finding one with **bold emphasis**            |
|  - Finding two with `code snippets`              |
|  - Finding three with [links](url)               |
|                                                  |
|  > A blockquote for important callouts           |
|                                                  |
|  ```python                                       |
|  def example():                                  |
|      return "syntax highlighted"                 |
|  ```                                             |
|                                                  |
+--------------------------------------------------+
```

**Markdown Features:**
- Toggle between Edit (raw) and Preview (rendered) modes
- Full GitHub-flavored markdown support
- Syntax highlighting for code blocks
- Export options: Copy, Download .md, Download .pdf

#### Image Source View
```
+--------------------------------------------------+
|  [HEADER - as above]                             |
+--------------------------------------------------+
|  IMAGE TOOLBAR                                   |
|  [-] 100% [+] | [Fit] [Actual] | [Rotate]       |
+--------------------------------------------------+
|  IMAGE CONTENT                                   |
|  +--------------------------------------------+  |
|  |                                            |  |
|  |                                            |  |
|  |         (Zoomable, pannable image)         |  |
|  |                                            |  |
|  |                                            |  |
|  +--------------------------------------------+  |
|                                                  |
|  IMAGE DETAILS                                   |
|  Dimensions: 1920 x 1080                         |
|  File size: 2.4 MB                               |
|  Format: PNG                                     |
|                                                  |
|  EXTRACTED TEXT (if OCR performed)               |
|  [v] Show extracted text                         |
|  "Text found in image..."                        |
+--------------------------------------------------+
```

**Image Viewer Features:**
- Pan and zoom with mouse/touch gestures
- Zoom controls: In, Out, Fit to view, Actual size
- Rotate controls
- Image metadata display
- OCR extracted text (collapsible)

#### Web Clip Source View
```
+--------------------------------------------------+
|  [HEADER - as above]                             |
+--------------------------------------------------+
|  WEB CLIP TOOLBAR                                |
|  [Open Original] [Copy Link] | Clipped Dec 27   |
+--------------------------------------------------+
|  WEB CONTENT                                     |
|  +--------------------------------------------+  |
|  |                                            |  |
|  |    (Rendered HTML content from clip)       |  |
|  |                                            |  |
|  |    Preserves formatting, images, links     |  |
|  |                                            |  |
|  |    Links open in external browser          |  |
|  |                                            |  |
|  +--------------------------------------------+  |
|                                                  |
|  SOURCE INFO                                     |
|  Original URL: https://example.com/article      |
|  Clipped: December 27, 2024 at 3:45 PM          |
+--------------------------------------------------+
```

**Web Clip Features:**
- Rendered HTML with original styling (sanitized)
- Open original URL in browser
- Copy URL to clipboard
- Source URL and clip timestamp display

#### Empty State (no source selected)
```
+--------------------------------------------------+
|                                                  |
|                                                  |
|              [illustration]                      |
|                                                  |
|         Select a source to view                  |
|                                                  |
|    Choose an item from the library list         |
|    to see its contents here.                     |
|                                                  |
|                                                  |
+--------------------------------------------------+
```

---

## Panel 3: Assistant (Right)

### Purpose
AI-powered assistant that understands the context of the currently selected source. Enables Q&A, summarization, and note-taking.

### Dimensions
- **Default width:** 30% of viewport
- **Minimum width:** 250px
- **Maximum width:** 450px
- **Height:** 100% of available space

### Content Structure

```
+----------------------------------+
|  ASSISTANT HEADER                |
|  [icon] Assistant      [collapse]|
|  Context: Q4 Strategy Doc        |
+----------------------------------+
|  QUICK ACTIONS                   |
|  [Summarize] [Key Points]        |
|  [Action Items] [Questions]      |
+----------------------------------+
|  CONVERSATION                    |
|                                  |
|  +----------------------------+  |
|  | USER                       |  |
|  | What are the main goals    |  |
|  | for Q4?                    |  |
|  +----------------------------+  |
|                                  |
|  +----------------------------+  |
|  | ASSISTANT                  |  |
|  | Based on the document,     |  |
|  | the main Q4 goals are:     |  |
|  |                            |  |
|  | 1. Launch product v2.0     |  |
|  | 2. Expand to 3 markets     |  |
|  | 3. Hire 15 engineers       |  |
|  |                            |  |
|  | [Copy] [Insert to Notes]   |  |
|  +----------------------------+  |
|                                  |
|  (scrollable conversation)       |
|                                  |
+----------------------------------+
|  INPUT AREA                      |
|  +----------------------------+  |
|  | Ask about this source...   |  |
|  |                        [>] |  |
|  +----------------------------+  |
|  [Attach Selection]              |
+----------------------------------+
```

### Visual Details

#### Header
- Assistant icon (sparkles or brain icon)
- "Assistant" title
- Context indicator showing currently selected source name (truncated)
- Collapse button to hide panel

#### Quick Actions
- Pre-built prompts as clickable chips/buttons
- **Summarize:** Generate a concise summary
- **Key Points:** Extract bullet points of main ideas
- **Action Items:** Find tasks and to-dos mentioned
- **Questions:** Generate comprehension questions
- Actions are context-aware (e.g., "Summarize" for long content, "Transcribe" for unprocessed audio)

#### Conversation Thread
- Alternating user/assistant messages
- **User messages:** Right-aligned, accent background (blue)
- **Assistant messages:** Left-aligned, neutral background (gray)
- Messages support markdown formatting
- Each assistant message has action buttons:
  - **Copy:** Copy to clipboard
  - **Insert to Notes:** Add to source's notes tab
- Smooth scroll, auto-scroll to latest message

#### Input Area
- Multi-line text input that expands
- Placeholder: "Ask about this source..."
- Send button (arrow icon)
- **Attach Selection:** When text is selected in Source Reader, this button appears to include the selection as context

### Behavior

#### Context Awareness
- When a source is selected, the assistant automatically has access to:
  - Full transcript (audio)
  - Extracted text (PDF, image)
  - Full content (markdown, web clip)
  - Metadata (title, date, tags)
- Context indicator updates when source selection changes
- Conversation history is **scoped per source** (switching sources shows that source's conversation)

#### Streaming Responses
- Assistant responses stream in word-by-word
- Typing indicator shows while processing
- Cancel button appears during generation

#### No Source Selected
```
+----------------------------------+
|  ASSISTANT HEADER                |
|  [icon] Assistant      [collapse]|
|  No source selected              |
+----------------------------------+
|                                  |
|        [illustration]            |
|                                  |
|    Select a source to start      |
|    asking questions              |
|                                  |
|    The assistant can help you:   |
|    - Summarize content           |
|    - Extract key information     |
|    - Answer questions            |
|    - Generate notes              |
|                                  |
+----------------------------------+
```

---

## Resizable Panel Dividers

### Visual Design
- **Divider width:** 4px (expands to 8px on hover)
- **Color:** Subtle border color (gray-200 / dark:gray-700)
- **Hover state:** Highlighted color (gray-400 / dark:gray-500)
- **Active/dragging:** Accent color (blue-500)
- **Cursor:** `col-resize` on hover

### Behavior
- Click and drag to resize adjacent panels
- Double-click to reset to default sizes
- Panels respect min/max constraints
- Resize state persists across sessions (localStorage)
- Smooth animation when panels snap to constraints

### Collapse Behavior
- Panels can be collapsed by dragging to minimum
- Collapsed panels show a thin strip with expand button
- Keyboard shortcut to toggle panels:
  - `Cmd/Ctrl + 1`: Toggle Library List
  - `Cmd/Ctrl + 2`: Focus Source Reader
  - `Cmd/Ctrl + 3`: Toggle Assistant

---

## Responsive Behavior

### Desktop (>= 1280px)
- Full tri-pane layout as described
- All three panels visible by default
- Panels freely resizable

### Laptop (1024px - 1279px)
- Tri-pane layout maintained
- Narrower default widths
- Assistant panel may start collapsed

### Tablet (768px - 1023px)
- **Two-pane layout:** Library List + Source Reader
- Assistant accessible via slide-over drawer (right edge)
- Swipe or button to reveal Assistant

### Mobile (< 768px)
- **Single-pane layout with navigation**
- Stack: Library List (full screen) -> Source Reader (full screen) -> Assistant (sheet)
- Bottom navigation or gestures to switch views
- Source Reader has back button to return to list
- Assistant opens as bottom sheet (60% height)

---

## Color Scheme & Theming

### Light Mode
- **Background:** White (#FFFFFF)
- **Panel backgrounds:** White with subtle gray borders
- **Dividers:** Gray-200 (#E5E7EB)
- **Text:** Gray-900 (#111827)
- **Muted text:** Gray-500 (#6B7280)
- **Accent:** Blue-600 (#2563EB)
- **Selection highlight:** Blue-50 (#EFF6FF)

### Dark Mode
- **Background:** Gray-950 (#030712)
- **Panel backgrounds:** Gray-900 (#111827)
- **Dividers:** Gray-700 (#374151)
- **Text:** Gray-100 (#F3F4F6)
- **Muted text:** Gray-400 (#9CA3AF)
- **Accent:** Blue-500 (#3B82F6)
- **Selection highlight:** Blue-950 (#172554)

---

## Animations & Transitions

### Panel Resize
- Smooth 60fps resize during drag
- No content reflow jank (use CSS containment)

### Panel Collapse/Expand
- Duration: 200ms ease-out
- Content fades out during collapse, fades in during expand

### Source Selection
- List item: Instant highlight
- Reader content: Crossfade transition (150ms)
- Assistant context: Updates immediately, conversation preserved

### Loading States
- Source loading: Skeleton placeholders
- Assistant thinking: Animated dots or shimmer
- Transcript loading: Line-by-line skeleton

---

## Keyboard Navigation

### Global Shortcuts
| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + 1` | Focus Library List |
| `Cmd/Ctrl + 2` | Focus Source Reader |
| `Cmd/Ctrl + 3` | Focus Assistant |
| `Cmd/Ctrl + F` | Focus search input |
| `Escape` | Close modals, clear selection |

### Library List
| Shortcut | Action |
|----------|--------|
| `Arrow Up/Down` | Navigate items |
| `Enter` | Select/open item |
| `Space` | Toggle checkbox (multi-select) |
| `Cmd/Ctrl + A` | Select all visible |

### Source Reader
| Shortcut | Action |
|----------|--------|
| `Space` | Play/pause (audio) |
| `Arrow Left/Right` | Seek (audio) |
| `+/-` | Zoom (PDF/Image) |
| `Cmd/Ctrl + C` | Copy selection |

### Assistant
| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift + Enter` | New line in input |
| `Escape` | Cancel generation |

---

## Accessibility

### ARIA Roles
- Library List: `role="listbox"` with `role="option"` items
- Source Reader: `role="main"` landmark
- Assistant: `role="complementary"` landmark

### Screen Reader Announcements
- Source selection: "Selected [title], [type], [metadata]"
- Panel focus: "Library list panel" / "Source reader panel" / "Assistant panel"
- Assistant response: "Assistant says: [first 50 chars]..."

### Focus Management
- Logical tab order: List -> Reader -> Assistant -> back to List
- Focus visible indicators on all interactive elements
- Focus trapped in modals/dialogs

### Reduced Motion
- Respect `prefers-reduced-motion`
- Disable panel animations, crossfades
- Instant transitions instead

---

## Example Scenarios

### Scenario 1: Reviewing a Meeting Recording
1. User sees list of sources, filters by "Audio" type
2. Clicks on "Weekly Team Standup - Dec 28"
3. Reader shows audio player with waveform + transcript
4. User clicks timestamp [00:05:23] to jump to that moment
5. Audio plays, transcript highlights current sentence
6. User clicks "Key Points" in Assistant
7. Assistant generates bullet points of main discussion topics
8. User copies points and adds to their notes app

### Scenario 2: Researching from Multiple PDFs
1. User imports 3 PDF research papers via drag-drop
2. PDFs appear in list with thumbnails
3. User selects first PDF, reads through it
4. Highlights important passage, clicks "Attach Selection"
5. Asks Assistant: "How does this relate to the other papers?"
6. Switches to second PDF (conversation preserved)
7. Continues building understanding across sources

### Scenario 3: Quick Reference from Web Clips
1. User previously clipped 5 articles about a topic
2. Filters by "Web Clip" type to see them
3. Selects one, sees rendered article content
4. Asks Assistant: "Summarize this article in 3 sentences"
5. Clicks "Open Original" to see the live webpage
6. Uses summary in their own writing

---

## Visual Mockup Guidance

When creating visual prototypes, emphasize:

1. **Clean, minimal chrome** - Content should dominate, not UI controls
2. **Clear visual hierarchy** - Selected source stands out, current panel is obvious
3. **Generous whitespace** - Don't crowd the panels
4. **Subtle dividers** - Panels should feel connected, not boxed in
5. **Consistent typography** - Use system fonts, clear size hierarchy
6. **Purposeful color** - Accent color for selection/action, not decoration
7. **Professional aesthetic** - Think Notion, Linear, Raycast, not playful or skeuomorphic

### Reference Apps for Inspiration
- **Notion:** Clean sidebar + main content + comments panel
- **Apple Notes:** Three-column layout on iPad
- **Obsidian:** File tree + editor + backlinks panel
- **Spark Mail:** Inbox + email + detail sidebar
- **Linear:** Issue list + issue detail + activity panel
