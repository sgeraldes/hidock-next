# Scaffold packages/calendar-sync
## Current State
Nothing exists.
## What to Create
Package @hidock/calendar-sync with tsup build:
- src/ics-parser.ts - stub ICS parser
- src/calendar-watcher.ts - stub with configurable poll interval
- src/meeting-correlator.ts - stub with types (autoLinkMinutes, suggestLinkMinutes)
- src/index.ts barrel exports
## Dependencies
None
## Acceptance Criteria
- Build and typecheck pass
- Calendar event types and correlation options exported
