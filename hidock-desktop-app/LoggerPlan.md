# Logger Improvement Plan

## Overview
This document tracks the comprehensive improvement of the HiDock application's logging system, moving from a confusing "suppress"-based UI with fallback logic to a clean, intuitive enable/disable system with proper grouping and smart defaults.

## Current Status: PHASE 2 - UI REDESIGN ✅ (NEARLY COMPLETE)

## Core Changes Summary
1. **Remove confusing "Logger Processing Level" from UI** ✅ - make it internal only
2. **Replace "suppress" checkboxes with "enable" checkboxes** ✅ - positive logic
3. **Group enable/level controls together** ✅ - better UX
4. **Implement smart GUI auto-show on ERROR/CRITICAL** 🔲 - emergency visibility
5. **Update defaults for better developer/user experience** ✅

---

## Backlog Status

### ✅ High Priority - Core Architecture (PHASE 1 & 2 COMPLETED)
- [x] **Remove Logger Processing Level from UI and make it internal only** - The fallback log_level should not be exposed in settings UI. App should handle default values internally for console/gui/file levels, using log_level only as internal fallback for error cases.
- [x] **Redesign logging UI with enable/disable checkboxes grouped with levels** - Replace 'suppress' checkboxes with 'Enable console/GUI/file logging' checkboxes. Group each enable checkbox with its corresponding log level dropdown. Allow users to disable all three if desired.
- [x] **Update logging default configuration for better UX** - Set better defaults: Console enabled (INFO for dev), GUI enabled but set to ERROR (emergency only), File enabled (DEBUG for users). Remove suppress flags from config, use enable flags instead.
- [ ] **Implement GUI log panel auto-show on ERROR/CRITICAL** - Make GUI log panel hidden by default but automatically show when ERROR or CRITICAL messages are logged. Set default GUI level to ERROR. This provides emergency visibility without cluttering normal operation.

### 🔧 UI/UX Improvements
- [ ] **Fix GUI logging suppress/level conflict** - When 'Suppress GUI log output' is checked, disable/gray out the GUI Level dropdown since it has no effect
- [ ] **Add visual feedback for conflicting logging settings** - Add visual indication when settings conflict (e.g., GUI level set but GUI output suppressed)
- [ ] **Fix inconsistent logging terminology** - Clarify what happens when both GUI and console output are suppressed - where do logs go? Fix logical gap in suppress checkboxes

### 🎨 Polish & Validation
- [ ] **Add Browse button for Log File Path field** - Add a 'Browse...' button next to the Log File Path entry field in settings dialog for easier file selection
- [ ] **Add validation feedback for numeric logging fields** - Add visual feedback for invalid values like negative numbers in Max Size MB or Backup Count fields
- [ ] **Add placeholder text for logging numeric fields** - Show example values like 'e.g., 10' in Max Size MB and 'e.g., 5' in Backup Count fields
- [ ] **Add file path validation feedback** - Show indication if log file path is valid, directory exists, and file is writable
- [ ] **Improve numeric input validation for logging** - Add validation for realistic values (1MB might be too small), handle 0/negative values for backup count
- [ ] **Fix color preview alignment** - Align color preview squares properly with text and make hex code widths consistent
- [ ] **Add logging error state feedback** - Show UI feedback when file logging fails to initialize or settings won't work
- [ ] **Review logging default values** - 1MB max size and 3 backups might not be production-ready defaults - review and adjust

---

## Implementation Plan

### Phase 1: Core Architecture (IN PROGRESS)
1. Update config_and_logger.py to remove fallback UI logic
2. Add new enable flags to default configuration
3. Update Logger class to use enable flags instead of suppress flags
4. Test basic functionality

### Phase 2: UI Redesign
1. Update settings_window.py logging tab layout
2. Group enable/level controls together
3. Remove Logger Processing Level from UI
4. Update variable cloning and saving logic

### Phase 3: Smart Behavior
1. Implement GUI auto-show on ERROR/CRITICAL
2. Update default values for better UX
3. Test end-to-end logging behavior

### Phase 4: Polish & Validation
1. Add validation and feedback
2. Add convenience features (Browse button, tooltips)
3. Fix alignment and visual issues
4. Final testing and cleanup

---

## Target UI Design

```
Console Logging:
├─ ☑ Enable console logging
└─ Level: [INFO ▼] (enabled when checkbox checked)

GUI Logging:  
├─ ☑ Enable GUI logging
└─ Level: [ERROR ▼] (enabled when checkbox checked)

File Logging:
├─ ☑ Enable file logging
├─ Level: [DEBUG ▼] (enabled when checkbox checked)
├─ File Path: [hidock.log] [Browse...]
├─ Max Size (MB): [10] 
└─ Backup Count: [5]

Log Level Colors (Hex Codes, e.g., #RRGGBB):
[Existing color configuration unchanged]
```

---

## Configuration Changes

### Old Config Keys (to be deprecated):
- `suppress_console_output`
- `suppress_gui_log_output` 
- `log_level` (UI exposure only - keep internal)

### New Config Keys:
- `enable_console_logging: true`
- `enable_gui_logging: true` 
- `enable_file_logging: true`
- `console_log_level: "INFO"`
- `gui_log_level: "ERROR"`
- `file_log_level: "DEBUG"`

---

## Progress Log

### [Date] - Task Name
- Status: COMPLETED/IN_PROGRESS/BLOCKED
- Changes: Brief description of what was done
- Files modified: List of files changed
- Next steps: What needs to be done next

---

## Progress Log

### 2025-08-24 - Starting Phase 1: Core Architecture
- Status: IN_PROGRESS
- Changes: Created LoggerPlan.md and beginning implementation
- Files modified: LoggerPlan.md
- Next steps: Update config_and_logger.py with new enable flags

### 2025-08-24 - Updated logging configuration with enable flags
- Status: COMPLETED
- Changes: Added enable_console_logging and enable_gui_logging flags to default config. Updated Logger class to use enable flags with fallback to suppress flags for backward compatibility. Set better defaults: GUI level to ERROR, file level to DEBUG.
- Files modified: config_and_logger.py
- Next steps: Remove Logger Processing Level from UI

### 2025-08-24 - Phase 2 Complete: UI Redesign
- Status: COMPLETED
- Changes: Completely redesigned logging tab UI. Removed Logger Processing Level from UI (internal only now). Replaced suppress checkboxes with enable checkboxes. Grouped enable controls with their level dropdowns. Added callback methods to enable/disable controls based on checkbox state. Updated variable cloning to include new enable_console_logging_var and enable_gui_logging_var.
- Files modified: settings_window.py (major redesign of _populate_logging_tab and _clone_parent_vars)
- Next steps: Phase 3 - Implement GUI auto-show on ERROR/CRITICAL

---

*Last updated: 2025-08-24 - Phase 2 Complete: Core architecture and UI redesign done*
