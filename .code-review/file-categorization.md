# File Categorization by Importance

## Apps/Web (Web Application)

### HIGH Priority - Core Business Logic & User Features
- `src/services/deviceService.ts` - Core device communication via WebUSB
- `src/services/firmwareService.ts` - Firmware update functionality
- `src/services/geminiService.ts` - AI transcription service
- `src/services/audioProcessingService.ts` - Audio processing logic
- `src/hooks/useDeviceConnection.ts` - Device connection state management
- `src/store/useAppStore.ts` - Global application state
- `src/pages/Recordings.tsx` - Main recordings page
- `src/pages/Transcription.tsx` - Transcription interface
- `src/pages/Dashboard.tsx` - Dashboard view
- `src/components/FirmwareUpdate.tsx` - Firmware update UI
- `src/components/FileManager/index.tsx` - File management
- `src/components/AudioPlayer/index.tsx` - Audio playback

### MEDIUM Priority - Supporting Features & UI Components
- `src/adapters/webDeviceAdapter.ts` - Device adapter layer
- `src/components/Layout/Header.tsx` - App header
- `src/components/Layout/Sidebar.tsx` - Navigation sidebar
- `src/components/AudioProcessor/index.tsx` - Audio processing UI
- `src/components/AudioRecorder/index.tsx` - Recording UI
- `src/components/AudioVisualization/index.tsx` - Audio visualization
- `src/components/StorageManager/index.tsx` - Storage UI
- `src/pages/Settings.tsx` - Settings page
- `src/utils/audioUtils.ts` - Audio utility functions
- `src/utils/formatters.ts` - Formatting utilities
- `src/components/ErrorBoundary.tsx` - Error handling
- `src/components/Toast.tsx` - Notifications

### LOW Priority - Config, Types, Tests
- `src/test/*.ts` - All test files
- `src/types/index.ts` - Type definitions
- `src/interfaces/deviceInterface.ts` - Interface definitions
- `src/constants/index.ts` - Constants
- `src/utils/mockData.ts` - Mock data
- `vite.config.ts` - Build configuration
- `vitest.config.ts` - Test configuration
- `tsconfig.json` - TypeScript config
- `package.json` - Dependencies

## Apps/Desktop (Desktop Application)

### HIGH Priority - Core Business Logic
- `src/hidock_device.py` - Main device communication class
- `src/device_interface.py` - Device interface abstraction
- `src/desktop_device_adapter.py` - Desktop device adapter
- `src/file_operations_manager.py` - File operations
- `src/transcription_module.py` - Transcription engine
- `src/ai_service.py` - AI integration service
- `src/gemini_models.py` - Gemini model management
- `src/gui_main_window.py` - Main application window
- `src/gui_treeview.py` - File tree view
- `src/gui_actions_device.py` - Device actions
- `src/gui_actions_file.py` - File actions
- `src/audio_player_enhanced.py` - Audio playback
- `src/storage_management.py` - Storage management
- `src/firmwareService.ts` - Firmware updates

### HIGH Priority - Calendar Integration (Critical Feature)
- `src/calendar_service.py` - Calendar service abstraction
- `src/outlook_calendar_service.py` - Outlook integration
- `src/microsoft_graph_api.py` - MS Graph API client
- `src/oauth2_manager.py` - OAuth2 authentication
- `src/oauth2_token_manager.py` - Token management
- `src/calendar_filter_engine.py` - Meeting filtering
- `src/calendar_search_widget.py` - Search UI
- `src/async_calendar_mixin.py` - Async calendar operations
- `src/calendar_cache_manager.py` - Calendar caching

### HIGH Priority - HiNotes Cloud Integration
- `src/hinotes_service.py` - HiNotes cloud service
- `src/hidock_auth_service.py` - Authentication
- `src/hidock_login_dialog.py` - Login UI
- `src/hinotes_calendar_service.py` - HiNotes calendar

### MEDIUM Priority - Supporting Features
- `src/audio_metadata_db.py` - Audio metadata database
- `src/audio_metadata_mixin.py` - Metadata handling
- `src/audio_visualization.py` - Visualization
- `src/enhanced_device_selector.py` - Device selector UI
- `src/gui_auxiliary.py` - GUI utilities
- `src/gui_event_handlers.py` - Event handling
- `src/settings_window.py` - Settings UI
- `src/status_filter_widget.py` - Filter widget
- `src/unified_filter_widget.py` - Unified filtering
- `src/offline_mode_manager.py` - Offline mode
- `src/toast_notification.py` - Notifications
- `src/config_and_logger.py` - Configuration & logging
- `src/hta_converter.py` - HTA format conversion

### MEDIUM Priority - OAuth & Security
- `src/oauth2_providers.py` - OAuth providers config
- `src/oauth2_server.py` - Local OAuth server
- `src/oauth2_pkce.py` - PKCE implementation
- `src/calendar_oauth_dialog.py` - OAuth dialog
- `src/calendar_oauth_dialog_direct.py` - Direct OAuth

### LOW Priority - Utilities & Config
- `src/constants.py` - Constants
- `src/ctk_custom_widgets.py` - Custom widgets
- `src/_version.py` - Version info
- `src/__init__.py` - Package init
- `src/jensen_protocol_extensions.py` - Protocol extensions
- `src/jensen_command_discovery.py` - Command discovery
- `config/hidock_config.json` - Configuration file

### LOW Priority - Tests (All test files)
- `tests/*.py` - All 65+ test files

## Apps/Audio-Insights (Standalone Audio Analysis)

### HIGH Priority - Core Functionality
- `services/geminiService.ts` - Gemini AI integration
- `App.tsx` - Main application component
- `components/AudioInput.tsx` - Audio input handling

### MEDIUM Priority - UI Components
- `components/InsightsDisplay.tsx` - Insights presentation
- `components/TranscriptionDisplay.tsx` - Transcription UI
- `components/LoadingSpinner.tsx` - Loading states
- `components/ErrorMessage.tsx` - Error display

### LOW Priority - Config & Types
- `types.ts` - Type definitions
- `constants.ts` - Constants
- `components/IconComponents.tsx` - Icon components
- `index.tsx` - Entry point
- `vite.config.ts` - Build config
- `tsconfig.json` - TypeScript config
- `package.json` - Dependencies

## Summary Statistics

### Apps/Web
- HIGH: 12 files
- MEDIUM: 12 files
- LOW: 9 files
- **Total: 33 files**

### Apps/Desktop
- HIGH: 23 files
- MEDIUM: 16 files
- LOW: 70+ files (including 65+ test files)
- **Total: 109+ files**

### Apps/Audio-Insights
- HIGH: 3 files
- MEDIUM: 4 files
- LOW: 8 files
- **Total: 15 files**

## Next Step
Code review all HIGH priority files (38 total across all 3 apps)
