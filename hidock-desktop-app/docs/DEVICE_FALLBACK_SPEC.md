# Device Connection Fallback Specification

## Current Behavior

1. **Autoconnect**: Works well - discovers available devices and updates config to match
2. **Manual Connect**: Rigidly tries only the configured VID/PID, fails if not found
3. **Config Saving**: Always saves current VID/PID on close, even if unchanged

## Problems

1. User has P1 (0xAF0E) in config but only H1E (0xB00D) is connected
2. Manual connect fails instead of trying available devices
3. Config file is created even when user just opens and closes app
4. No indication which device model was actually connected

## Proposed Solution

### 1. Smart Connection Logic
```python
def connect_device_smart(self):
    """Connect with intelligent fallback"""
    # First try configured device
    configured_vid = self.selected_vid_var.get()
    configured_pid = self.selected_pid_var.get()
    
    try:
        # Try configured device first
        device_info = connect(configured_vid, configured_pid)
        return device_info
    except ConnectionError:
        # Configured device not found, try discovery
        available_devices = discover_devices()
        
        if available_devices:
            # Use first available HiDock device
            first_device = available_devices[0]
            
            # Update UI to show what we're doing
            self.update_status_bar(
                f"Configured device not found, connecting to {first_device.name}..."
            )
            
            # Update selected VID/PID for this session
            self.selected_vid_var.set(first_device.vendor_id)
            self.selected_pid_var.set(first_device.product_id)
            
            # Connect to available device
            return connect(first_device.vendor_id, first_device.product_id)
        else:
            raise ConnectionError("No HiDock devices found")
```

### 2. Config File Creation Policy
- Only create config file when:
  - User changes settings
  - User explicitly saves preferences
  - Connection state changes (device selected)
- Don't create on:
  - Simple open/close without interaction
  - View-only operations

### 3. Device Model Display
- Show actual connected device in status bar
- Display configured vs connected device when different
- Example: "Connected to HiDock H1E (configured: P1)"

### 4. Multi-Device Priority
When multiple devices available:
1. Prefer configured device if available
2. Fall back to device priority order:
   - Same model as configured
   - Most recently used
   - First available

## Implementation Steps

1. [ ] Modify connect_device() to use smart fallback
2. [ ] Add flag to track if config needs saving
3. [ ] Update status bar to show device model mismatch
4. [ ] Add device model to connection success messages
5. [ ] Implement "dirty" flag for config changes