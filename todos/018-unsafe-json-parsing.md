---
id: "018"
title: "Add validation for JSON parsing"
status: pending
priority: P3
category: reliability
source: data-integrity-guardian
created: 2025-12-30
files:
  - apps/electron/src/types/index.ts
---

# Add validation for JSON parsing

## Problem

Helper functions in `types/index.ts` parse JSON without schema validation. Malformed JSON from database or external sources could cause runtime errors.

## Location

`apps/electron/src/types/index.ts`

## Current Code

```typescript
export function parseJsonArray<T>(json?: string | null): T[] {
  if (!json) return []
  try {
    return JSON.parse(json)  // No validation that result is array
  } catch {
    return []
  }
}

export function parseAttendees(attendeesJson?: string | null): MeetingAttendee[] {
  if (!attendeesJson) return []
  try {
    return JSON.parse(attendeesJson)  // No validation
  } catch {
    return []
  }
}
```

## Suggested Fix

```typescript
export function parseJsonArray<T>(json?: string | null): T[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) {
      console.warn('Expected array, got:', typeof parsed)
      return []
    }
    return parsed
  } catch (e) {
    console.warn('Failed to parse JSON array:', e)
    return []
  }
}

// With zod for schema validation
import { z } from 'zod'

const MeetingAttendeeSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  status: z.string().optional(),
})

export function parseAttendees(json?: string | null): MeetingAttendee[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    const result = z.array(MeetingAttendeeSchema).safeParse(parsed)
    if (!result.success) {
      console.warn('Invalid attendees format:', result.error)
      return []
    }
    return result.data
  } catch (e) {
    console.warn('Failed to parse attendees:', e)
    return []
  }
}
```

## Impact

- Silent data corruption if JSON structure changes
- Potential runtime errors from unexpected types
- Difficult debugging for data issues

## Acceptance Criteria

- [ ] Array type validation for parseJsonArray
- [ ] Schema validation for parseAttendees (optional)
- [ ] Logging for invalid data
- [ ] Graceful fallback to empty array
