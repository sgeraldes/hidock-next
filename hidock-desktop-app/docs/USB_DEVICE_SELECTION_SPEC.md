# USB Device Selection Specification

## How It Should Work

### 1. Device Detection
- **Automatic Discovery**: The system should automatically detect all USB devices, with special recognition for HiDock devices
- **HiDock Device Identification**: 
  - Vendor ID (VID): `0x10D6` (Actions Semiconductor)
  - Product IDs (PIDs):
    - `0xB00D` - HiDock H1E (default)
    - `0xAF0C` - HiDock H1
    - `0xAF0D` - HiDock variant
    - `0xAF0E` - HiDock P1
- **Device Information Display**:
  - Device name with model (e.g., "HiDock H1E")
  - Connection status (Available/Connected/Error)
  - Version information if available
  - VID/PID in hex format

### 2. Settings Persistence
- **Selected Device**: The selected VID/PID should persist in `hidock_config.json`
- **Autoconnect Behavior**:
  - If `autoconnect: true`, attempt to connect to saved VID/PID on startup
  - If saved device not found, try other known HiDock devices
  - If no HiDock devices found, show device selector
- **Manual Selection**: When user manually selects a device in settings:
  - Update `selected_vid` and `selected_pid` in config
  - Save immediately when Apply/OK is clicked

### 3. Device Selector UI
- **Status Indicators**:
  - 🟢 Connected - Device is currently connected
  - 🔵 Available - Device detected but not connected
  - 🔴 Error - Device detected but has errors
  - 🎵 HiDock device indicator
  - 📱 Other USB device indicator
- **Sorting**: HiDock devices should appear first, then other devices alphabetically
- **Refresh**: Manual scan button to re-enumerate devices
- **Disable When Connected**: Device selection should be disabled while connected

### 4. Error Handling
- **No Devices Found**: Clear message when no USB devices detected
- **No HiDock Devices**: Specific message when USB devices found but no HiDock
- **Permission Errors**: Handle USB access permission issues gracefully
- **Device Disconnection**: Handle unexpected disconnection during operation

## Test Plan

### Test Case 1: Fresh Install Detection
1. Delete config file
2. Start application
3. **Expected**: Device selector shows all USB devices with HiDock devices marked and sorted first

### Test Case 2: Autoconnect Success
1. Set autoconnect=true with valid VID/PID
2. Start application
3. **Expected**: Automatically connects to saved device

### Test Case 3: Autoconnect Fallback
1. Set autoconnect=true with non-existent VID/PID
2. Start application with HiDock device connected
3. **Expected**: Falls back to available HiDock device

### Test Case 4: Manual Device Selection
1. Open Settings → Connection tab
2. Select a different device
3. Click Apply
4. **Expected**: Config file updated with new VID/PID

### Test Case 5: Settings Persistence
1. Select device in settings
2. Apply changes
3. Restart application
4. **Expected**: Previously selected device is remembered

### Test Case 6: Device Scan with No HiDock
1. Disconnect all HiDock devices
2. Click Scan in device selector
3. **Expected**: Shows "0 HiDock devices" with other USB devices listed

### Test Case 7: Device Scan with HiDock
1. Connect HiDock device
2. Click Scan in device selector
3. **Expected**: Shows HiDock device count and lists them first

### Test Case 8: Connected Device Lock
1. Connect to a device
2. Open Settings
3. **Expected**: Device selector is disabled with warning message

### Test Case 9: Multiple HiDock Devices
1. Connect multiple HiDock devices
2. Open device selector
3. **Expected**: All HiDock devices shown, sorted by model

### Test Case 10: Invalid Config Recovery
1. Set invalid VID/PID in config (e.g., strings instead of numbers)
2. Start application
3. **Expected**: Gracefully handles invalid config, uses defaults

## Implementation Checklist

- [ ] Fix hardcoded VID/PIDs in enhanced_device_selector.py
- [ ] Ensure device selection updates config immediately
- [ ] Add proper HiDock device detection logic
- [ ] Implement device sorting (HiDock first)
- [ ] Add connection status tracking
- [ ] Handle USB permission errors
- [ ] Create automated tests for device selection
- [ ] Update default VID/PID list with all known devices
- [ ] Add device model detection
- [ ] Improve error messages for better user guidance