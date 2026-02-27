# TODO-001: Device Page Individual File Operations

**Priority**: CRITICAL - Showstopper #1
**Phase**: A
**Domain**: Device Page
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Device Page CRITICAL bugs

## Problem

The Device page has NO individual file operations. Users cannot:
- Download individual files from the device
- Delete individual files from the device
- See a list of recordings on the device

This is a fundamental feature gap that makes the Device page nearly useless.

## Current State

From audit findings:
- Device page missing individual file download functionality
- Device page missing individual file deletion functionality
- Device page missing recordings list display
- Only bulk "sync all" operation exists

## What's Missing

1. **File List Display**
   - Show list of recordings on connected device
   - Display file metadata (name, size, date, duration)
   - Selection UI for individual files

2. **Individual Download**
   - Download button for selected file(s)
   - Progress indicator for individual downloads
   - Success/error feedback

3. **Individual Delete**
   - Delete button for selected file(s)
   - Confirmation dialog
   - Update device file list after deletion
   - Handle errors (e.g., file in use)

4. **IPC Handlers**
   - `device:downloadFile` - download single file
   - `device:deleteFile` - delete single file
   - `device:listFiles` - get file list from device

## Dependencies

- USB transfer service must support individual operations (not just bulk sync)
- Device service needs file list query method
- File operations must respect device connection state

## Acceptance Criteria

- [ ] Device page displays list of recordings when device is connected
- [ ] User can select individual files from the list
- [ ] User can download selected file(s) with progress indication
- [ ] Downloaded files appear in Library page
- [ ] User can delete selected file(s) from device
- [ ] Delete operation shows confirmation dialog
- [ ] File list updates after delete operation
- [ ] All IPC handlers exist and are registered
- [ ] Error handling for disconnected device, file in use, etc.
- [ ] Tests cover individual download, delete, and file list operations

## Related Bugs

- Device CRITICAL: No individual file download
- Device CRITICAL: No individual file deletion
- Device CRITICAL: No recordings list displayed
