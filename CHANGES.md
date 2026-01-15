# P2 Remote Debugging Security Fix

## Summary

This change disables remote debugging in production builds and adds a visible warning banner when debugging is explicitly enabled.

## Changes Made

### 1. Main Process (`apps/electron/electron/main/index.ts`)

- **Consolidated duplicate remote debugging switches**: Removed the duplicate `app.commandLine.appendSwitch('remote-debugging-port', '9222')` calls (previously on lines 157 and 164)
- **Added conditional gating**: Remote debugging is now only enabled when:
  - Running in development mode (`is.dev` is true), OR
  - Explicitly opted-in via environment variable (`ENABLE_REMOTE_DEBUGGING=true`)
- **Added console warning**: When remote debugging is enabled, a warning is logged: `[SECURITY] Remote debugging enabled on port 9222`
- **Added IPC notification**: In production, when debugging is explicitly enabled, sends a `security-warning` event to the renderer process

### 2. Preload Script (`apps/electron/electron/preload/index.ts`)

- **Added `onSecurityWarning` to ElectronAPI interface**: Defines the type for the new security warning listener
- **Implemented `onSecurityWarning` handler**: Listens for `security-warning` IPC events and provides cleanup function

### 3. New Component (`apps/electron/src/components/SecurityWarningBanner.tsx`)

- **Created SecurityWarningBanner component**: A React component that:
  - Listens for security warnings via the `onSecurityWarning` API
  - Displays a fixed-position red banner at the top of the screen when remote debugging is enabled in production
  - Shows warning icon and message: "Remote debugging is enabled. This should only be used for troubleshooting."

### 4. App Integration (`apps/electron/src/App.tsx`)

- **Imported SecurityWarningBanner**: Added import for the new component
- **Added banner to layout**: Placed `<SecurityWarningBanner />` at the top of the component tree (before Layout)

## Behavior

| Environment | ENABLE_REMOTE_DEBUGGING | Remote Debugging | Warning Banner |
|-------------|------------------------|------------------|----------------|
| Development | N/A | Enabled | Not shown |
| Production | Not set | Disabled | Not shown |
| Production | `true` | Enabled | Shown |

## Testing

To test the production warning banner:
1. Build the app: `npm run build`
2. Set environment variable: `ENABLE_REMOTE_DEBUGGING=true`
3. Run the packaged app
4. Verify red warning banner appears at top of screen

## Security Implications

- Remote debugging exposes the Chrome DevTools Protocol on port 9222
- This can be used by attackers on the local network to inspect/control the application
- By disabling it in production by default, users are protected unless they explicitly opt-in
- The visible warning ensures users know when debugging is active
