# Settings Window Test Plan

## Overview
This document outlines the comprehensive test plan for `settings_window.py` to achieve 100% test coverage. The settings window is a complex dialog with multiple tabs, AI configuration, device settings, and various UI interactions.

## Test Categories

### 1. Initialization Tests
- **Test dialog creation and setup**
  - Window initialization with parent GUI
  - Initial config snapshot creation
  - Local variables cloning from parent
  - Widget creation and layout
  - Tab structure setup
  - Button state initialization

### 2. Tab Content Tests
- **General Tab**
  - Appearance mode selection
  - Color theme selection
  - Exit confirmation settings
  - Download directory selection and reset
  
- **Connection Tab**
  - Enhanced device selector integration
  - Autoconnect checkbox
  - USB interface configuration
  - Device selection when connected vs disconnected
  
- **Operation Tab**
  - Timing settings (recording check interval, timeouts)
  - Auto-refresh settings
  - Numeric validation for all fields
  
- **Device Specific Tab**
  - Device settings checkboxes (auto record, auto play, bluetooth tone, notification sound)
  - Enable/disable based on connection status
  - Loading device settings from connected device
  
- **AI Transcription Tab**
  - Provider selection (11 providers)
  - Model selection based on provider
  - API key entry and validation
  - Temperature slider
  - Max tokens setting
  - Language selection
  - Provider-specific configuration frames
  
- **Logging Tab**
  - Log level selection
  - Console/GUI output suppression
  - Log color configuration for all levels
  - Color preview widgets

### 3. Button Action Tests
- **OK Button**
  - Apply settings and close dialog
  - Validation before applying
  - Error handling for invalid settings
  
- **Apply Button**
  - Apply settings without closing
  - Update dialog baseline after apply
  - Button state changes after apply
  
- **Cancel/Close Button**
  - Close without applying changes
  - Reset local variables to initial state
  - Handle both "Cancel" and "Close" modes

### 4. Settings Validation Tests
- **Numeric Field Validation**
  - Empty values
  - Non-numeric values
  - Out-of-range values
  - Edge cases (min/max values)
  
- **API Key Validation**
  - Empty keys
  - Invalid keys
  - Valid keys
  - Provider-specific validation
  - Background validation thread

### 5. AI Provider Configuration Tests
- **Provider Selection**
  - Model list updates based on provider
  - Provider-specific configuration frames
  - API key loading for each provider
  
- **Provider-Specific Frames**
  - OpenRouter configuration
  - Amazon Bedrock region selection
  - Qwen API base URL
  - DeepSeek API base URL
  - Ollama local server configuration
  - LM Studio local server configuration

### 6. Device Integration Tests
- **Connected Device**
  - Load device settings in background thread
  - Enable device-specific checkboxes
  - Apply device settings changes
  - Handle device communication errors
  
- **Disconnected Device**
  - Disable device selection
  - Show informational messages
  - Handle device scanning

### 7. Encryption Tests
- **API Key Encryption**
  - Generate encryption key
  - Encrypt API keys for storage
  - Decrypt API keys for display
  - Handle encryption errors
  - Fallback when encryption unavailable

### 8. UI State Management Tests
- **Button State Changes**
  - Initial state (only Close button visible)
  - Changed state (OK, Apply, Cancel buttons visible)
  - After Apply state (back to Close only)
  
- **Change Tracking**
  - Detect when settings change
  - Update button states accordingly
  - Handle multiple rapid changes
  
- **Window Management**
  - Fade-in animation
  - Window sizing and positioning
  - Focus management
  - Modal behavior

### 9. Color Management Tests
- **Log Color Configuration**
  - Color preview updates
  - Invalid color handling
  - Theme-based color application
  
- **Theme Integration**
  - Appearance mode changes
  - Color theme changes
  - Button color updates

### 10. Directory Management Tests
- **Download Directory**
  - Directory selection dialog
  - Directory validation
  - Reset to default directory
  - Path display updates

### 11. Enhanced Device Selector Tests
- **Device Selection**
  - Handle device selection events
  - Update VID/PID variables
  - Mark settings as changed
  
- **Device Scanning**
  - Initial scan on dialog open
  - Scan completion handling
  - Auto-select HiDock devices
  - Handle scan errors

### 12. Background Thread Tests
- **Device Settings Loading**
  - Async device settings retrieval
  - UI updates from background thread
  - Error handling in background thread
  - Thread safety

- **API Key Validation**
  - Background validation thread
  - UI updates on validation complete
  - Handle validation errors
  - Thread cleanup

### 13. Error Handling Tests
- **USB/Device Errors**
  - Connection failures
  - Communication timeouts
  - Device not found
  
- **Configuration Errors**
  - Invalid configuration values
  - File I/O errors
  - JSON parsing errors
  
- **UI Errors**
  - Widget destruction during operations
  - Tkinter errors
  - Thread synchronization issues

### 14. Integration Tests
- **Parent GUI Integration**
  - Variable synchronization
  - Configuration updates
  - Theme application
  - Logger updates
  
- **Config System Integration**
  - Load initial configuration
  - Save configuration changes
  - Handle config file errors

### 15. Edge Cases and Cleanup Tests
- **Window Lifecycle**
  - Proper cleanup on close
  - Handle premature destruction
  - Memory leak prevention
  
- **Concurrent Operations**
  - Multiple background threads
  - Rapid UI changes
  - Thread cancellation

## Test Implementation Strategy

### Phase 1: Core Infrastructure (25 tests)
- Dialog initialization
- Basic widget creation
- Tab structure
- Button states

### Phase 2: Settings Logic (35 tests)
- All tab content
- Validation logic
- Change tracking
- Apply/Cancel logic

### Phase 3: AI Integration (20 tests)
- Provider configuration
- API key management
- Encryption/decryption
- Validation threads

### Phase 4: Device Integration (15 tests)
- Device settings loading
- Enhanced device selector
- Background operations
- Error handling

### Phase 5: Edge Cases (10 tests)
- Error scenarios
- Thread safety
- Cleanup
- Integration edge cases

## Coverage Goals
- **Target**: 100% line coverage
- **Minimum**: 95% line coverage
- **Focus Areas**: Error handling, background threads, UI state management
- **Test Types**: Unit tests (80%), Integration tests (20%)

## Test Fixtures and Mocks
- Mock parent GUI with all required attributes
- Mock HiDock device instance
- Mock configuration dictionary
- Mock enhanced device selector
- Mock AI service manager
- Mock encryption system
- Mock file dialogs
- Mock background threads

## Success Criteria
1. All lines of settings_window.py covered by tests
2. All error paths tested
3. All UI interactions tested
4. All background operations tested
5. Thread safety verified
6. Memory leaks prevented
7. Integration with parent GUI verified