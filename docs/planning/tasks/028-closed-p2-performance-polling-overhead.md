---
id: "028"
priority: P2
status: closed
category: performance
title: 100ms Polling Overhead - Browser USB Events Available
files:
  - apps/electron/src/services/jensen.ts
created: 2024-12-27
---

# 100ms Polling Overhead - Browser USB Events Available

## Problem

The disconnect detection uses 100ms setInterval polling to check `device.opened` state. However, the browser provides native USB disconnect events that are more efficient.

## Location

`apps/electron/src/services/jensen.ts`

## Current Code

```typescript
// Polling-based disconnect detection
private connectionCheckInterval: NodeJS.Timeout | null = null

startConnectionCheck() {
  if (this.connectionCheckInterval) return

  this.connectionCheckInterval = setInterval(async () => {
    if (this.device && !this.device.opened) {
      console.log('[Jensen] Device disconnected (detected via polling)')
      await this.handleDisconnect()
    }
  }, 100)  // 100ms = 10 checks per second
}
```

## Issues

1. **CPU overhead**: 10 checks/second even when idle
2. **Battery drain**: Constant wakeups on laptops
3. **Delayed detection**: Up to 100ms delay vs instant event
4. **Redundant**: Browser already provides `disconnect` event

## Solution

1. **Use browser USB disconnect event:**

```typescript
private usbDisconnectHandler: ((event: USBConnectionEvent) => void) | null = null

setupUsbDisconnectListener(): void {
  if (this.usbDisconnectHandler) return

  this.usbDisconnectHandler = (event: USBConnectionEvent) => {
    if (event.device === this.device) {
      console.log('[Jensen] Device disconnected (via USB event)')
      this.handleDisconnect()
    }
  }

  navigator.usb.ondisconnect = this.usbDisconnectHandler
}

removeUsbDisconnectListener(): void {
  if (this.usbDisconnectHandler) {
    navigator.usb.ondisconnect = null
    this.usbDisconnectHandler = null
  }
}
```

2. **Keep polling as fallback only (optional):**

```typescript
// Reduce frequency dramatically if keeping as fallback
private FALLBACK_CHECK_INTERVAL = 5000  // 5 seconds, not 100ms

startFallbackConnectionCheck() {
  // Only as safety net, not primary detection
  this.connectionCheckInterval = setInterval(async () => {
    if (this.device && !this.device.opened) {
      console.warn('[Jensen] Disconnect detected via fallback polling')
      await this.handleDisconnect()
    }
  }, this.FALLBACK_CHECK_INTERVAL)
}
```

3. **Update connect flow:**

```typescript
async connect(): Promise<boolean> {
  // ... existing connect logic ...

  if (success) {
    this.setupUsbDisconnectListener()  // Primary: event-based
    // Optionally: this.startFallbackConnectionCheck()
  }

  return success
}

async disconnect(): Promise<void> {
  this.removeUsbDisconnectListener()
  this.stopConnectionCheck()
  // ... rest of disconnect
}
```

## Browser Support

`navigator.usb.ondisconnect` is supported in:
- Chrome 61+
- Edge 79+
- Opera 48+
- Electron (Chromium-based)

Not supported in Firefox or Safari (but they don't support WebUSB anyway).

## Benefits

- **Zero polling overhead** when device is stable
- **Instant detection** vs up to 100ms delay
- **Better battery life** on laptops
- **Cleaner code** using native APIs

## Testing

- [ ] Disconnect detection works with event handler
- [ ] No polling interval running during normal use
- [ ] Fallback polling works if event handler fails
- [ ] Multiple connect/disconnect cycles work correctly

## Acceptance Criteria

- [ ] Primary disconnect detection uses `navigator.usb.ondisconnect`
- [ ] Polling removed or reduced to 5+ second fallback
- [ ] No CPU overhead when device is connected and idle
- [ ] Disconnect detected within 50ms
