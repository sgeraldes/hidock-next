---
id: "027"
priority: P3
status: closed
category: performance
title: Subscription Memory Leaks - Missing Cleanup
files:
  - apps/electron/src/services/hidock-device.ts
  - apps/electron/src/pages/Device.tsx
created: 2024-12-27
reviewed: 2024-12-27
---

# Subscription Memory Leaks - Missing Cleanup

## Assessment: LOW RISK - Pattern Is Sound

After reviewing `hidock-device.ts`, the subscription pattern is **correctly implemented** using Set:

```typescript
// Lines 111-115 - Uses Set for listeners (correct)
private statusListeners: Set<StatusListener> = new Set()

onStatusChange(listener: StatusListener): () => void {
  this.statusListeners.add(listener)
  return () => this.statusListeners.delete(listener)  // Works correctly
}
```

### Why Original Todo Was Overstated

1. **Set.delete() works correctly with function references**:
   - The same function reference added is the one deleted
   - No indexOf/reference equality issues

2. **The pattern follows React best practices**:
   - Returns unsubscribe function
   - Cleanup is caller's responsibility

3. **Memory leak only if**:
   - Component unmounts without cleanup (component bug)
   - Not a service architecture bug

### Downgraded Improvements (P3)

If desired for debugging:

1. **Add subscription count debug helper:**
   ```typescript
   getSubscriptionCounts(): { status: number; state: number; activity: number } {
     return {
       status: this.statusListeners.size,
       state: this.stateListeners.size,
       activity: this.activityListeners.size
     }
   }
   ```

2. **Add max listener warning (optional):**
   ```typescript
   if (this.statusListeners.size > 5) {
     console.warn('[HiDockDevice] Unusual number of status listeners:', this.statusListeners.size)
   }
   ```

## Conclusion

The subscription pattern is correct. Priority downgraded from P2 to P3. This is a "nice to have" debugging feature, not a performance issue.

## Related

- #026 and #029 address the real issue: Device.tsx has duplicate subscriptions that should be removed entirely.
