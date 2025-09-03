# HiDock Desktop Troubleshooting Guide

## Quick Diagnosis Flowchart

```
Connection Issues?
├── Device not detected → Check USB connection, drivers
├── Connection fails → Clear app data, restart
├── Slow connection → Check logs for buffer issues
└── Frequent disconnects → USB power management settings

Operation Issues?
├── Slow disconnect → Update to latest version
├── File list incomplete → Normal if 95%+ files shown
├── UI freezing → Check GUI logging is disabled
└── Wrong monitor display → Check multi-monitor setup

Error Messages?
├── "Unexpected Seq/CMD" → Reconnect device
├── "Operation aborted" → Normal during disconnect
├── "No such device" → Device unplugged
└── "TclError" → Window closing, safe to ignore
```

## Common Issues and Solutions

### 1. Connection Problems

#### Device Not Detected
**Symptoms**: "No HiDock device found" message

**Solutions**:
1. Check USB cable and try different ports
2. Verify device is powered on
3. Install/update USB drivers
4. Run as administrator (Windows)
5. Check Device Manager for unknown devices

**Debug Steps**:
```json
// Enable debug logging in config/hidock_config.json
{
    "console_log_level": "DEBUG",
    "file_log_level": "DEBUG"
}
```

#### Connection Fails After Working Previously
**Symptoms**: Device detected but connection fails

**Common Causes**:
- Stale USB buffer data
- Sequence ID mismatch
- Previous connection not cleaned up

**Solutions**:
1. Unplug and replug device
2. Restart application
3. Clear application data:
   ```bash
   # Windows
   del %APPDATA%\HiDock\cache\*
   
   # Mac/Linux
   rm -rf ~/.hidock/cache/*
   ```

#### Rapid Connect/Disconnect Issues
**Symptoms**: Errors when quickly connecting and disconnecting

**What's Normal** (after recent fixes):
- Brief "Unexpected Seq/CMD" warnings - auto-corrects
- "Operation aborted" messages - expected behavior
- Sub-second disconnect times

**What's Not Normal**:
- Connection taking >5 seconds
- Disconnect taking >1 second
- Application freezing

### 2. Performance Issues

#### Slow Disconnect (>1 second)
**Symptoms**: "Disconnecting..." status for extended time

**Immediate Fix**:
- Force quit and restart application

**Permanent Fix**:
- Update to version with non-blocking disconnect
- Check logs for blocking operations:
  ```
  grep "Forcing disconnect" logs/hidock.log
  ```

#### UI Freezing During Operations
**Symptoms**: Application becomes unresponsive

**Solutions**:
1. Disable GUI logging:
   ```json
   {
       "enable_gui_logging": false,
       "logs_pane_visible": false
   }
   ```

2. Reduce file refresh interval:
   ```json
   {
       "auto_refresh_files": false,
       "auto_refresh_interval_s": 60
   }
   ```

#### High CPU Usage
**Symptoms**: Application using excessive CPU

**Common Causes**:
- GUI logging enabled with DEBUG level
- Continuous file refresh
- Large number of files (>1000)

**Solutions**:
1. Set appropriate log levels:
   ```json
   {
       "console_log_level": "ERROR",
       "file_log_level": "INFO",
       "gui_log_level": "ERROR"
   }
   ```

2. Disable auto-refresh:
   ```json
   {
       "auto_refresh_files": false
   }
   ```

### 3. Display Issues

#### Toast Notifications on Wrong Monitor
**Symptoms**: Notifications appear on primary monitor when app is on secondary

**Status**: Fixed in latest version

**Verification**:
- Toast should appear relative to main window
- Check toast_notification.py has parent-relative positioning

#### Settings Window Position
**Symptoms**: Settings opens on wrong monitor

**Solution**:
- Window should center on parent
- If not, manually move and close - position is saved

### 4. File Operations

#### Incomplete File List
**What's Normal**:
- "Device returned incomplete data (488 vs 491)" - OK if >95%
- Files appear gradually during fetch
- Some files may be filtered by type

**What's Not Normal**:
- Less than 95% of files shown
- File list never completes
- Duplicate files appearing

**Debug Commands**:
```bash
# Check file count discrepancies
grep "incomplete data" logs/hidock.log | tail -10

# Check for file operation aborts
grep "Operation aborted" logs/hidock.log | grep -v DEBUG
```

#### Download Failures
**Symptoms**: Files fail to download or corrupt

**Solutions**:
1. Check download directory permissions
2. Verify sufficient disk space
3. Increase timeout:
   ```json
   {
       "file_stream_timeout_s": 300
   }
   ```

### 5. Error Messages Explained

#### "Unexpected Seq/CMD: Expected X, got Y"
**Meaning**: Protocol sequence mismatch
**Severity**: Low - auto-corrects
**Action**: None needed unless persistent

#### "Operation aborted"
**Meaning**: Operation cancelled due to disconnect
**Severity**: None - expected behavior
**Action**: No action needed

#### "USBError: [Errno 19] No such device"
**Meaning**: Device disconnected
**Severity**: Medium
**Action**: Reconnect device

#### "TclError: invalid command name"
**Meaning**: Widget destroyed during operation
**Severity**: Low
**Action**: Update to latest version with proper cleanup

#### "Device returned incomplete data"
**Meaning**: File count mismatch with cache
**Severity**: Low if >95% complete
**Action**: Refresh file list manually if needed

### 6. Log Analysis

#### Enable Detailed Logging
```json
{
    "console_log_level": "DEBUG",
    "file_log_level": "DEBUG",
    "enable_file_logging": true,
    "log_file_max_size_mb": 50
}
```

#### Key Log Patterns to Watch

**Successful Connection**:
```
[INFO] Attempting to connect to HiDock device
[DEBUG] Flushed X packets from USB endpoints
[INFO] Successfully connected to HiDock
```

**Successful Disconnect**:
```
[INFO] Fast disconnect initiated
[DEBUG] File operations aborted
[INFO] Device disconnected successfully
```

**Problem Indicators**:
```
[ERROR] Failed to claim interface
[ERROR] Communication timeout after Xms
[WARNING] Lock acquisition failed
```

#### Log Commands

```bash
# Show recent errors
grep ERROR logs/hidock.log | tail -20

# Show connection events
grep -E "(connect|disconnect)" logs/hidock.log | tail -20

# Count warnings by type
grep WARNING logs/hidock.log | cut -d' ' -f4- | sort | uniq -c | sort -rn

# Show abort patterns
grep -i abort logs/hidock.log | grep -v DEBUG
```

### 7. Configuration Reset

If experiencing persistent issues, reset configuration:

```bash
# Backup current config
cp config/hidock_config.json config/hidock_config.backup.json

# Reset to defaults
cat > config/hidock_config.json << 'EOF'
{
    "autoconnect": false,
    "download_directory": "../audio",
    "log_level": "INFO",
    "console_log_level": "ERROR",
    "file_log_level": "INFO",
    "gui_log_level": "ERROR",
    "enable_console_logging": true,
    "enable_file_logging": true,
    "enable_gui_logging": false,
    "suppress_console_output": false,
    "suppress_gui_log_output": true,
    "default_command_timeout_ms": 5000,
    "file_stream_timeout_s": 180
}
EOF
```

### 8. Platform-Specific Issues

#### Windows
- **USB Driver Issues**: Use Zadig to install WinUSB driver
- **Permission Errors**: Run as Administrator
- **Antivirus Blocking**: Add exception for hidock.exe

#### macOS
- **Permission Prompts**: Grant USB access in System Preferences
- **Gatekeeper Issues**: Right-click and select "Open" first time

#### Linux
- **USB Permissions**: Add user to dialout group
  ```bash
  sudo usermod -a -G dialout $USER
  ```
- **udev Rules**: Create rule for device access
  ```bash
  echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="10c4", MODE="0666"' | \
    sudo tee /etc/udev/rules.d/99-hidock.rules
  ```

### 9. Reporting Issues

When reporting issues, include:

1. **Version Information**:
   ```bash
   python --version
   pip show customtkinter
   ```

2. **Configuration** (sanitized):
   ```bash
   cat config/hidock_config.json | grep -v password
   ```

3. **Recent Logs**:
   ```bash
   tail -100 logs/hidock.log > issue_logs.txt
   ```

4. **Steps to Reproduce**:
   - Exact sequence of actions
   - Expected vs actual behavior
   - Frequency of occurrence

5. **System Information**:
   - Operating System
   - USB ports tried
   - Other USB devices working?

### 10. Emergency Recovery

If application won't start:

1. **Safe Mode Start**:
   ```bash
   python main.py --safe-mode
   ```

2. **Clear All Data**:
   ```bash
   # Windows
   rmdir /s %APPDATA%\HiDock
   
   # Mac/Linux  
   rm -rf ~/.hidock
   ```

3. **Minimal Config**:
   ```bash
   python main.py --no-config
   ```

4. **Debug Mode**:
   ```bash
   set HIDOCK_DEBUG=1
   python main.py
   ```

## Quick Reference Card

| Issue | Quick Fix | Permanent Solution |
|-------|-----------|-------------------|
| Slow disconnect | Force quit | Update application |
| Wrong monitor | Move window | Update application |
| Connection fails | Replug USB | Clear USB buffers |
| File list incomplete | Manual refresh | Increase timeout |
| High CPU | Disable GUI logs | Optimize settings |
| Toast errors | Restart app | Update application |

## Related Documentation
- [Connection Improvements](CONNECTION_IMPROVEMENTS.md)
- [Logging Configuration](LOGGING_CONFIGURATION.md)
- [Toast Notifications](TOAST_NOTIFICATIONS.md)

## Support Channels
- GitHub Issues: Report bugs and feature requests
- Documentation: Check docs/ folder for detailed guides
- Logs: Always check logs/hidock.log first