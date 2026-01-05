# HiDock Device Connection Lifecycle

This document traces the complete connection lifecycle from app startup through device connection, initialization, and disconnection.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RENDERER PROCESS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐     ┌──────────────────────┐     ┌────────────────────────┐  │
│  │ App.tsx  │────▶│ HiDockDeviceService  │────▶│    JensenDevice        │  │
│  │          │     │  (hidock-device.ts)  │     │    (jensen.ts)         │  │
│  └──────────┘     │                      │     │                        │  │
│       │           │  - State management  │     │  - WebUSB API          │  │
│       │           │  - Auto-connect      │     │  - USB protocol        │  │
│       │           │  - Config loading    │     │  - Connection polling  │  │
│       │           │  - Init sequence     │     │  - Low-level I/O       │  │
│       ▼           └──────────────────────┘     └────────────────────────┘  │
│  ┌──────────┐              │                            │                   │
│  │Device.tsx│◀─────────────┴────────────────────────────┘                   │
│  │(UI page) │         (callbacks & state updates)                           │
│  └──────────┘                                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## State Machine Diagram

```
                              ┌─────────────────────────────────────────────┐
                              │              APP STARTUP                     │
                              │                                              │
                              │  1. main.tsx renders App                     │
                              │  2. App.tsx useEffect() runs                 │
                              │  3. getHiDockDeviceService() [singleton]     │
                              │  4. deviceService.initAutoConnect()          │
                              └──────────────────┬──────────────────────────┘
                                                 │
                                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                              SERVICE INITIALIZATION                                         │
│                                                                                             │
│  HiDockDeviceService constructor:                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ 1. this.jensen = getJensenDevice()          // Get low-level USB handler           │   │
│  │ 2. jensen.onconnect = handleConnect()       // Wire up connection callback         │   │
│  │ 3. jensen.ondisconnect = handleDisconnect() // Wire up disconnect callback         │   │
│  │ 4. configLoadPromise = loadAutoConnectConfig() // Start async config load          │   │
│  └────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                             │
│  State: { connected: false, autoConnectConfig: { enabled: false } } // Defaults           │
└────────────────────────────────────────────────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                              CONFIG LOADING (async)                                         │
│                                                                                             │
│  loadAutoConnectConfig():                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ 1. Wait for electronAPI to be available (up to 2s)                                  │   │
│  │ 2. Call window.electronAPI.config.get()                                             │   │
│  │ 3. Read config.device.autoConnect                                                   │   │
│  │ 4. Set autoConnectConfig.enabled = config.device.autoConnect === true               │   │
│  │ 5. Set configLoaded = true                                                          │   │
│  └────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                             │
│  Note: Device.tsx also loads config independently to fix race condition                    │
└────────────────────────────────────────────────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│                              initAutoConnect()                                              │
│                                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────────┐             │
│  │ 1. Check: Already has interval? → SKIP                                     │             │
│  │ 2. Check: Already connected? → SKIP                                        │             │
│  │ 3. await configLoadPromise                                                 │             │
│  │ 4. if (!configLoaded) poll for up to 2s                                    │             │
│  └───────────────────────────────────────────────────────────────────────────┘             │
│                          │                                                                  │
│                          ▼                                                                  │
│            ┌─────────────────────────────────┐                                             │
│            │ autoConnectConfig.enabled &&     │                                             │
│            │ connectOnStartup ?               │                                             │
│            └─────────────────────────────────┘                                             │
│                    │              │                                                         │
│                   YES            NO                                                         │
│                    │              │                                                         │
│                    ▼              ▼                                                         │
│         ┌────────────────┐  ┌───────────────────────┐                                      │
│         │startAutoConnect│  │ Log: "Auto-connect    │                                      │
│         │      ()        │  │ disabled"             │                                      │
│         └────────────────┘  └───────────────────────┘                                      │
│                    │              │                                                         │
└────────────────────┼──────────────┼─────────────────────────────────────────────────────────┘
                     │              │
                     ▼              ▼
              ┌──────────────────────────┐
              │    IDLE STATE            │◀─────────────────────────────────────┐
              │    (Waiting)             │                                       │
              │                          │                                       │
              │ connectionStatus: 'idle' │                                       │
              │ connected: false         │                                       │
              └──────────────────────────┘                                       │
                     │                                                           │
        ┌────────────┼────────────┐                                              │
        │            │            │                                              │
        ▼            ▼            ▼                                              │
   ┌─────────┐ ┌──────────┐ ┌──────────┐                                        │
   │  Auto   │ │  User    │ │   User   │                                        │
   │ Connect │ │  Clicks  │ │  Clicks  │                                        │
   │  Poll   │ │ Connect  │ │  Restart │                                        │
   │(5000ms) │ │  Button  │ │  Button  │                                        │
   └─────────┘ └──────────┘ └──────────┘                                        │
        │            │            │                                              │
        ▼            ▼            │                                              │
┌───────────────────────────────────────────────────────────────────────────┐   │
│                     CONNECTION ATTEMPT                                     │   │
├───────────────────────────────────────────────────────────────────────────┤   │
│                                                                            │   │
│  AUTO-CONNECT PATH                    USER CONNECT PATH                    │   │
│  ─────────────────                    ─────────────────                    │   │
│  tryConnectSilent()                   connect()                            │   │
│  ┌────────────────────┐               ┌─────────────────────────┐         │   │
│  │1. connected? →skip │               │1. enableAutoConnect()   │         │   │
│  │2. op in progress?  │               │   - autoConnectEnabled  │         │   │
│  │   → skip           │               │     = true              │         │   │
│  │3. jensen.tryConnect│               │   - userDisconnect      │         │   │
│  └────────────────────┘               │     = false             │         │   │
│           │                           │2. status: 'requesting'  │         │   │
│           │                           │3. jensen.connect()      │         │   │
│           │                           └─────────────────────────┘         │   │
│           │                                      │                         │   │
│           └──────────────┬───────────────────────┘                         │   │
│                          ▼                                                  │   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │   │
│  │                    JENSEN LOW-LEVEL CONNECTION                       │   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │   │
│  │                                                                      │   │   │
│  │  tryConnect() / connect()                                            │   │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │   │
│  │  │ 1. Check WebUSB supported                                       │ │   │   │
│  │  │ 2. Check not already connected                                  │ │   │   │
│  │  │ 3. Check no operation in progress                               │ │   │   │
│  │  │ 4. await this.disconnect() ← CRITICAL: cleanup stale connection │ │   │   │
│  │  │ 5. navigator.usb.getDevices() or requestDevice()                │ │   │   │
│  │  │ 6. Find device with vendorId=0x10D6, productName="HiDock"       │ │   │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │   │
│  │                          │                                           │   │   │
│  │              ┌───────────┴───────────┐                              │   │   │
│  │              │                       │                              │   │   │
│  │         NO DEVICE               DEVICE FOUND                        │   │   │
│  │              │                       │                              │   │   │
│  │              ▼                       ▼                              │   │   │
│  │    ┌──────────────────┐   ┌────────────────────────────────────┐   │   │   │
│  │    │ return false     │   │ USB SETUP                          │   │   │   │
│  │    │ status → 'idle'  │   │ ──────────                         │   │   │   │
│  │    └──────────────────┘   │ 1. device.open()                   │   │   │   │
│  │                           │ 2. device.selectConfiguration(1)   │   │   │   │
│  │                           │ 3. device.claimInterface(0)        │   │   │   │
│  │                           │ 4. Determine model from productId  │   │   │   │
│  │                           │ 5. Reset protocol state            │   │   │   │
│  │                           │ 6. startConnectionCheck() ←polling │   │   │   │
│  │                           │ 7. this.onconnect?.() → callback   │   │   │   │
│  │                           └────────────────────────────────────┘   │   │   │
│  │                                      │                              │   │   │
│  └──────────────────────────────────────┼──────────────────────────────┘   │   │
│                                         │                                   │   │
└─────────────────────────────────────────┼───────────────────────────────────┘   │
                                          │                                       │
                                          ▼                                       │
┌─────────────────────────────────────────────────────────────────────────────────┼───┐
│                         DEVICE INITIALIZATION                                    │   │
│                         handleConnect()                                          │   │
├──────────────────────────────────────────────────────────────────────────────────┼───┤
│                                                                                  │   │
│  State Changes:                                                                  │   │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │   │
│  │ initAborted = false                                                        │  │   │
│  │ state.connected = true                                                     │  │   │
│  │ state.model = jensen.getModel()                                            │  │   │
│  │ notifyStateChange() → UI updates                                           │  │   │
│  └───────────────────────────────────────────────────────────────────────────┘  │   │
│                                                                                  │   │
│  INITIALIZATION SEQUENCE (15s timeout per step, non-fatal):                     │   │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │   │
│  │                                                                            │  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │  │   │
│  │  │ STEP 1: Getting Device Info (20%)                                    │  │  │   │
│  │  │ status: 'getting-info'                                               │  │  │   │
│  │  │ refreshDeviceInfo() → CMD_GET_VERSION                                │  │  │   │
│  │  │ → serialNumber, firmwareVersion, model                               │  │  │   │
│  │  └───────────────────────┬─────────────────────────────────────────────┘  │  │   │
│  │                          │ (check initAborted)                            │  │   │
│  │                          ▼                                                 │  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │  │   │
│  │  │ STEP 2: Getting Storage Info (40%)                                   │  │  │   │
│  │  │ status: 'getting-storage'                                            │  │  │   │
│  │  │ refreshStorageInfo() → CMD_GET_CARD_INFO + CMD_GET_FILE_COUNT        │  │  │   │
│  │  │ → capacity, used, freePercent, recordingCount                        │  │  │   │
│  │  └───────────────────────┬─────────────────────────────────────────────┘  │  │   │
│  │                          │ (check initAborted)                            │  │   │
│  │                          ▼                                                 │  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │  │   │
│  │  │ STEP 3: Getting Settings (70%)                                       │  │  │   │
│  │  │ status: 'getting-settings'                                           │  │  │   │
│  │  │ refreshSettings() → CMD_GET_SETTINGS                                 │  │  │   │
│  │  │ → autoRecord setting                                                 │  │  │   │
│  │  └───────────────────────┬─────────────────────────────────────────────┘  │  │   │
│  │                          │ (check initAborted)                            │  │   │
│  │                          ▼                                                 │  │   │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │  │   │
│  │  │ STEP 4: Syncing Time (90%)                                           │  │  │   │
│  │  │ status: 'syncing-time'                                               │  │  │   │
│  │  │ syncTime() → CMD_SET_TIME                                            │  │  │   │
│  │  │ → Sets device clock to system time                                   │  │  │   │
│  │  └───────────────────────┬─────────────────────────────────────────────┘  │  │   │
│  │                          │                                                 │  │   │
│  └──────────────────────────┼─────────────────────────────────────────────────┘  │   │
│                             │                                                    │   │
│  ┌──────────────────────────▼───────────────────────────────────────────────┐   │   │
│  │ INITIALIZATION COMPLETE                                                   │   │   │
│  │ initializationComplete = true                                             │   │   │
│  │ status: 'ready' (100%)                                                    │   │   │
│  │ notifyConnectionChange(true) → Device.tsx onConnectionChange callback     │   │   │
│  └───────────────────────────────────────────────────────────────────────────┘   │   │
│                                                                                  │   │
└──────────────────────────────────────────────────────────────────────────────────┼───┘
                                          │                                        │
                                          ▼                                        │
              ┌───────────────────────────────────────────────────────┐            │
              │                    CONNECTED STATE                     │            │
              │                                                        │            │
              │  connectionStatus: 'ready'                             │            │
              │  state.connected: true                                 │            │
              │  initializationComplete: true                          │            │
              │                                                        │            │
              │  ┌─────────────────────────────────────────────────┐  │            │
              │  │ CONNECTION CHECK POLLING (every 100ms)          │  │            │
              │  │ startConnectionCheck() from jensen.ts           │  │            │
              │  │                                                  │  │            │
              │  │ if (device.opened === false) {                  │  │            │
              │  │   // Physical disconnect detected!               │  │            │
              │  │   ondisconnect?.() → handleDisconnect()         │  │            │
              │  │ }                                                │  │            │
              │  └─────────────────────────────────────────────────┘  │            │
              │                                                        │            │
              │  Available Operations:                                 │            │
              │  - listRecordings()                                    │            │
              │  - downloadRecording()                                 │            │
              │  - deleteRecording()                                   │            │
              │  - formatStorage()                                     │            │
              │  - setAutoRecord()                                     │            │
              │  - resetDevice()                                       │            │
              │  - Realtime streaming                                  │            │
              │  - P1: Battery, Bluetooth                              │            │
              │                                                        │            │
              └───────────────────────────────────────────────────────┘            │
                     │                        │                                     │
                     │                        │                                     │
        ┌────────────┘                        └─────────────┐                       │
        │                                                   │                       │
        ▼                                                   ▼                       │
┌───────────────────────┐                    ┌──────────────────────────────────┐  │
│  USER CLICKS          │                    │  PHYSICAL DISCONNECT             │  │
│  DISCONNECT           │                    │  (device.opened === false)       │  │
│                       │                    │                                   │  │
│  Device.tsx:          │                    │  Connection check polling        │  │
│  handleDisconnect()   │                    │  detects device.opened===false   │  │
└───────────────────────┘                    └──────────────────────────────────┘  │
        │                                                   │                       │
        ▼                                                   │                       │
┌───────────────────────────────────────────────────────────┼───────────────────────┤
│                    DISCONNECT FLOW                        │                       │
├───────────────────────────────────────────────────────────┼───────────────────────┤
│                                                           │                       │
│  HiDockDeviceService.disconnect()                         │                       │
│  ┌────────────────────────────────────────────────────┐  │                       │
│  │ 1. Log "User initiated disconnect"                  │  │                       │
│  │ 2. initAborted = true                               │  │                       │
│  │ 3. disableAutoConnect():                            │  │                       │
│  │    - autoConnectEnabled = false                     │  │                       │
│  │    - userInitiatedDisconnect = true ← IMPORTANT!    │  │                       │
│  │    - stopAutoConnect()                              │  │                       │
│  │ 4. await jensen.disconnect()                        │  │                       │
│  └────────────────────────────────────────────────────┘  │                       │
│                          │                                │                       │
│                          └────────────────────────────────┤                       │
│                                                           │                       │
│  JensenDevice.disconnect() ◀──────────────────────────────┘                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ 1. stopConnectionCheck() ← Stop the 100ms polling                           │ │
│  │ 2. if (device) {                                                            │ │
│  │      device.releaseInterface(0)                                             │ │
│  │      device.close()                                                         │ │
│  │      device = null                                                          │ │
│  │      Reset protocol state (sequenceId, receiveBuffer)                       │ │
│  │      Reset operation lock                                                   │ │
│  │      ondisconnect?.() → handleDisconnect()                                  │ │
│  │    }                                                                        │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                          │                                                        │
│                          ▼                                                        │
│  HiDockDeviceService.handleDisconnect()                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │ 1. initAborted = true                                                        │ │
│  │ 2. initializationComplete = false                                            │ │
│  │ 3. persistCacheToStorage() ← Save recordings cache for quick reconnect       │ │
│  │ 4. Reset state:                                                              │ │
│  │    - connected = false                                                       │ │
│  │    - serialNumber = null                                                     │ │
│  │    - firmwareVersion = null                                                  │ │
│  │    - storage = null                                                          │ │
│  │    - settings = null                                                         │ │
│  │    - recordingCount = 0                                                      │ │
│  │    (NOTE: cachedRecordings NOT cleared!)                                     │ │
│  │ 5. notifyStateChange() → UI updates                                          │ │
│  │ 6. updateStatus('idle', 'Device disconnected')                               │ │
│  │ 7. notifyConnectionChange(false) → Device.tsx callback                       │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
└───────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │
                                          ▼
                     ┌────────────────────────────────────────┐
                     │ Back to IDLE STATE                     │
                     │                                        │
                     │ If user disconnect:                    │
                     │   userInitiatedDisconnect = true       │
                     │   Auto-connect will NOT reconnect      │
                     │                                        │
                     │ If physical disconnect:                │
                     │   userInitiatedDisconnect unchanged    │
                     │   Auto-connect will try to reconnect   │
                     │   (if enabled in config)               │
                     └────────────────────────────────────────┘
                                          │
                                          ▼
                               (Loop back to IDLE)────────────────────────────────┘
```

---

## ConnectionStep States

| Step | Status Message | Progress | Trigger |
|------|----------------|----------|---------|
| `idle` | "Not connected" / "Device disconnected" | - | Initial / After disconnect |
| `requesting` | "Requesting device access..." / "Looking for device..." | 5% | User clicks Connect / tryConnect |
| `opening` | "Device found, connecting..." | 10% | Auto-connect found device |
| `getting-info` | "Reading device information..." | 20% | handleConnect step 1 |
| `getting-storage` | "Reading storage information..." | 40% | handleConnect step 2 |
| `getting-settings` | "Loading device settings..." | 70% | handleConnect step 3 |
| `syncing-time` | "Syncing device time..." | 90% | handleConnect step 4 |
| `ready` | "Device ready" | 100% | Init complete |
| `error` | (error message) | - | Any failure |

---

## Key Flags & Their Purpose

| Flag | Location | Purpose |
|------|----------|---------|
| `autoConnectConfig.enabled` | Service | Master config switch (persisted to disk) |
| `autoConnectEnabled` | Service | Runtime flag (can be disabled temporarily) |
| `userInitiatedDisconnect` | Service | Prevents auto-reconnect after user clicks Disconnect |
| `initAborted` | Service | Allows quick abort during init sequence |
| `initializationComplete` | Service | Indicates recordingCount is populated |
| `isStopConnectionCheck` | Jensen | Prevents disconnect notification during manual disconnect |
| `configLoaded` | Service | Indicates config has been read from disk |

---

## Callback Flow

```
JensenDevice                    HiDockDeviceService              Device.tsx
     │                                  │                             │
     │ ──────onconnect()───────────────▶│                             │
     │                                  │ handleConnect()             │
     │                                  │ ────notifyStateChange()────▶│ setDeviceState()
     │                                  │ ────notifyStatusChange()───▶│ setConnectionStatus()
     │                                  │ ────notifyConnectionChange()│ onConnectionChange cb
     │                                  │                             │ → loadRecordings()
     │                                  │                             │ → triggerAutoSync()
     │                                  │                             │
     │ ──────ondisconnect()────────────▶│                             │
     │                                  │ handleDisconnect()          │
     │                                  │ ────notifyStateChange()────▶│ setDeviceState()
     │                                  │ ────notifyStatusChange()───▶│ setConnectionStatus()
     │                                  │ ────notifyConnectionChange()│ onConnectionChange cb
     │                                  │                             │ → clear state
```

---

## File Locations

- `apps/electron/src/main.tsx` - React app entry point
- `apps/electron/src/App.tsx` - Auto-connect initialization
- `apps/electron/src/services/hidock-device.ts` - High-level device service
- `apps/electron/src/services/jensen.ts` - Low-level USB protocol
- `apps/electron/src/pages/Device.tsx` - Device sync UI
- `apps/web/jensen.js` - Official reference implementation
