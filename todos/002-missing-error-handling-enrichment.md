---
id: "002"
title: "Add error handling for enrichment loading"
status: pending
priority: P1
category: bug
source: feature-code-reviewer
created: 2025-12-30
files:
  - apps/electron/src/pages/Library.tsx
---

# Add error handling for enrichment loading

## Problem

The Library component loads enrichment data without proper error handling. If the enrichment loading fails, the component continues as if nothing happened, potentially leaving the UI in an inconsistent state.

## Location

`apps/electron/src/pages/Library.tsx` - enrichment loading logic in useEffect

## Current Behavior

- Enrichment data loaded in useEffect without try/catch
- No error state or fallback UI
- Silent failures lead to missing enrichment data

## Suggested Fix

```typescript
useEffect(() => {
  const loadEnrichment = async () => {
    setEnrichmentLoading(true)
    setEnrichmentError(null)
    try {
      const data = await window.api.recordings.getEnrichment(selectedId)
      setEnrichmentData(data)
    } catch (err) {
      console.error('Failed to load enrichment:', err)
      setEnrichmentError(err instanceof Error ? err.message : 'Failed to load details')
    } finally {
      setEnrichmentLoading(false)
    }
  }

  if (selectedId) {
    loadEnrichment()
  }
}, [selectedId])
```

## Impact

- Users see empty enrichment section with no indication of failure
- No retry mechanism available
- Debugging production issues is difficult

## Acceptance Criteria

- [ ] Error state tracked for enrichment loading
- [ ] Error UI shown when enrichment fails to load
- [ ] Retry option available to users
- [ ] Errors logged for debugging
