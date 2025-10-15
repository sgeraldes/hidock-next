# HiDock Desktop Logging Configuration Guide

## Overview
The HiDock Desktop application features a sophisticated multi-level logging system that provides detailed debugging information while maintaining performance and usability.

## Logging Architecture

### Three-Channel System
The application uses three independent logging channels:

1. **Console Logging** - Terminal/command line output
2. **File Logging** - Persistent log files with rotation
3. **GUI Logging** - In-application log display

Each channel can be independently configured for level and enablement.

## Default Configuration

### Production Defaults
```json
{
    "enable_console_logging": true,
    "console_log_level": "ERROR",     // Only critical issues
    
    "enable_file_logging": true,
    "file_log_level": "INFO",         // Operational details
    
    "enable_gui_logging": false,      // Disabled for performance
    "gui_log_level": "ERROR"
}
```

### Development Configuration
```json
{
    "enable_console_logging": true,
    "console_log_level": "DEBUG",
    
    "enable_file_logging": true,
    "file_log_level": "DEBUG",
    
    "enable_gui_logging": true,
    "gui_log_level": "DEBUG"
}
```

## Log Levels

### Level Hierarchy
1. **DEBUG** - Detailed diagnostic information
2. **INFO** - General operational messages
3. **WARNING** - Recoverable issues or unexpected behavior
4. **ERROR** - Failures requiring attention
5. **CRITICAL** - System-critical failures

### Level Guidelines

#### DEBUG Level
Use for:
- Detailed operation flow
- Variable values and state changes
- USB packet contents
- Performance metrics
- Aborted operations (expected during disconnect)

Example:
```python
logger.debug("Jensen", "connect", f"Flushed {flush_count} packets")
```

#### INFO Level
Use for:
- Successful operations
- State transitions
- Configuration changes
- Connection/disconnection events

Example:
```python
logger.info("GUI", "connect_device", "Successfully connected to HiDock")
```

#### WARNING Level
Use for:
- Recoverable errors
- Degraded performance
- Fallback behavior
- Missing optional features

Example:
```python
logger.warning("GUI", "load_icons", "Icon file not found, using defaults")
```

#### ERROR Level
Use for:
- Operation failures
- Unrecoverable errors
- Missing required resources
- Communication failures

Example:
```python
logger.error("USB", "connect", f"Failed to claim interface: {e}")
```

## Configuration Options

### File Logging Settings
```json
{
    "enable_file_logging": true,
    "log_file_path": "hidock.log",     // Relative to logs/ directory
    "log_file_max_size_mb": 10,        // Rotation size
    "log_file_backup_count": 5,        // Number of backups
    "file_log_level": "INFO"
}
```

### Console Logging Settings
```json
{
    "enable_console_logging": true,
    "console_log_level": "ERROR",
    "suppress_console_output": false   // Legacy, use enable_console_logging
}
```

### GUI Logging Settings
```json
{
    "enable_gui_logging": false,
    "gui_log_level": "ERROR",
    "gui_log_filter_level": "DEBUG",   // Filter for display
    "logs_pane_visible": false,        // Show/hide log pane
    "suppress_gui_log_output": false   // Legacy, use enable_gui_logging
}
```

## Smart Logging Features

### Contextual Log Levels
The system automatically adjusts log levels based on context:

```python
# Aborted operations - logged as DEBUG, not ERROR
if "aborted" in error_msg.lower():
    logger.debug("Operation cancelled: {error_msg}")
else:
    logger.error("Operation failed: {error_msg}")
```

### Real-World Examples from Debugging Session

#### Before Optimization (Noisy Logs):
```
[ERROR] File list operation failed: Operation aborted
[ERROR] USB communication error: Device disconnected
[WARNING] Device returned incomplete data (488 vs 491)
```

#### After Optimization (Clean Logs):
```
[DEBUG] File list operation cancelled: Operation aborted
[DEBUG] Device disconnect detected during operation
[INFO] Device data accepted (488 files, 95% of cached)
```

### Performance Optimizations
- GUI logging disabled by default
- Lazy string formatting
- Conditional logging based on level
- Buffered file writes

### Log Rotation
- Automatic rotation when file reaches max size
- Configurable backup count
- Timestamp-based naming for archives

## Log Message Format

### Standard Format
```
[TIMESTAMP][LEVEL] Component::Method - Message
```

### Examples
```
[2025-08-31 22:00:00.000][INFO] GUI::connect_device - Connecting to device
[2025-08-31 22:00:01.234][DEBUG] Jensen::list_files - Retrieved 488 files
[2025-08-31 22:00:02.567][ERROR] USB::write - Communication timeout
```

### Component Naming
- **GUI** - User interface operations
- **Jensen** - Device protocol implementation
- **USB** - Low-level USB operations
- **FileOps** - File operations
- **Config** - Configuration management
- **Calendar** - Calendar integration

## Debugging Scenarios

### Connection Issues
Enable DEBUG for console to see:
```json
{
    "console_log_level": "DEBUG",
    "enable_console_logging": true
}
```

Watch for:
- Device detection
- Interface claiming
- Endpoint configuration
- Buffer flushing

**Example Debug Output**:
```
[DEBUG] Jensen::_attempt_connection - Clearing receive buffer
[DEBUG] Jensen::_attempt_connection - Flushed packet 1: 64 bytes
[DEBUG] Jensen::_attempt_connection - Flushed packet 2: 64 bytes
[INFO] Jensen::connect - Successfully connected to HiDock
```

### Performance Analysis
Enable file logging at DEBUG:
```json
{
    "file_log_level": "DEBUG",
    "enable_file_logging": true
}
```

Analyze:
- Operation timings
- Data transfer sizes
- Retry attempts
- Cache hits/misses

### User Support
Share log file from `logs/hidock.log`:
- Contains INFO level by default
- Includes operational history
- Excludes sensitive DEBUG data

## Log Analysis Tools

### Filtering Logs
```bash
# Show only errors
grep "ERROR" hidock.log

# Show specific component
grep "Jensen::" hidock.log

# Show connection events
grep -E "(connect|disconnect)" hidock.log
```

### Log Statistics
```bash
# Count by level
grep -o "\[ERROR\]" hidock.log | wc -l
grep -o "\[WARNING\]" hidock.log | wc -l

# Most common errors
grep "\[ERROR\]" hidock.log | sort | uniq -c | sort -rn
```

## Troubleshooting

### No Console Output
Check:
1. `enable_console_logging` is true
2. `console_log_level` is appropriate
3. Not running with output redirection

### Large Log Files
Adjust:
```json
{
    "log_file_max_size_mb": 5,      // Smaller files
    "log_file_backup_count": 3,     // Fewer backups
    "file_log_level": "WARNING"     // Less verbose
}
```

### GUI Performance Issues
Disable GUI logging:
```json
{
    "enable_gui_logging": false,
    "logs_pane_visible": false
}
```

## Best Practices

### For Development
1. Use DEBUG level during development
2. Enable all channels for full visibility
3. Clear logs before reproducing issues
4. Include timestamps in bug reports

### Lessons Learned from Production Issues

#### USB Buffer Corruption Debug
**Problem**: Stale data causing connection failures
**Log Pattern to Watch**:
```
[DEBUG] Buffer content: 123400040000000400001ff4...
[WARNING] Unexpected Seq/CMD: Expected 0x00/0x12, got 0x34/0x00
```
**Solution**: Added buffer flushing, visible in logs as:
```
[DEBUG] Flushed 3 packets from USB endpoints
```

#### Slow Disconnect Debug
**Problem**: 30+ second disconnect times
**Log Pattern**:
```
[INFO] Disconnect initiated
[DEBUG] Waiting for file list operation...
[WARNING] Operation timeout after 30000ms
```
**Solution**: Non-blocking disconnect, now shows:
```
[INFO] Fast disconnect initiated
[DEBUG] File operations aborted
[INFO] Disconnected in 0.3s
```

### For Production
1. Console: ERROR only
2. File: INFO for audit trail
3. GUI: Disabled for performance
4. Regular log rotation

### For Support
1. Ask users for `logs/hidock.log`
2. Enable DEBUG temporarily for specific issues
3. Use file logging to avoid console spam
4. Include last 100 lines in bug reports

## Environment Variables

### Override Settings
```bash
# Force debug logging
set HIDOCK_LOG_LEVEL=DEBUG

# Custom log directory
set HIDOCK_LOG_DIR=C:\Logs\HiDock

# Disable file logging
set HIDOCK_NO_FILE_LOG=1
```

## Integration with Error Handling

### Structured Error Logging
```python
try:
    operation()
except ExpectedException as e:
    logger.debug(f"Expected condition: {e}")
except RecoverableError as e:
    logger.warning(f"Recovered from: {e}")
except CriticalError as e:
    logger.error(f"Critical failure: {e}")
    raise
```

### Actual Implementation Examples

#### File List Handling (desktop_device_adapter.py)
```python
if not success:
    error_msg = recordings.get("error", "Unknown error")
    # Smart error level based on context
    if "aborted" in error_msg.lower():
        logger.debug("DesktopDeviceAdapter", "get_recordings", 
                    f"File list operation cancelled: {error_msg}")
    else:
        logger.error("DesktopDeviceAdapter", "get_recordings", 
                    f"Device returned error: {error_msg}")
```

#### Connection with Retry (hidock_device.py)
```python
for attempt in range(max_retries):
    if self._abort_operations:
        logger.debug("Jensen", "list_files_with_retry", 
                    "Operation aborted by user")
        return {"success": False, "error": "Operation aborted"}
    
    try:
        result = self.list_files()
        if result.get("success"):
            return result
    except Exception as e:
        if attempt < max_retries - 1:
            logger.warning("Jensen", "list_files_with_retry", 
                          f"Attempt {attempt + 1} failed: {e}")
        else:
            logger.error("Jensen", "list_files_with_retry", 
                        f"All attempts failed: {e}")
```

### Operation Context
```python
logger.info("Starting operation X")
try:
    result = perform_operation()
    logger.debug(f"Operation X result: {result}")
except Exception as e:
    logger.error(f"Operation X failed: {e}")
    raise
finally:
    logger.debug("Operation X cleanup")
```

## Performance Considerations

### Log Level Impact
- **DEBUG**: ~10-15% performance impact
- **INFO**: ~5% performance impact
- **WARNING**: ~2% performance impact
- **ERROR**: Negligible impact

### Optimization Tips
1. Use lazy formatting: `logger.debug(f"Value: {expensive_call()}")`
2. Check level before complex operations
3. Batch log writes when possible
4. Avoid logging in tight loops

## Migration from Legacy Settings

### Old Settings (Deprecated)
```json
{
    "suppress_console_output": false,
    "suppress_gui_log_output": false,
    "log_level": "INFO"
}
```

### New Settings
```json
{
    "enable_console_logging": true,
    "enable_gui_logging": true,
    "console_log_level": "INFO",
    "gui_log_level": "INFO",
    "file_log_level": "INFO"
}
```

The system maintains backward compatibility but new settings take precedence.