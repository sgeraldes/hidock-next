# Feature Requests and Enhancement Tracker

This document lists requested features and enhancements for the HiDock Desktop Application. It serves as a roadmap for future development and helps prioritize new functionality based on user needs and technical feasibility.

## How to Use This Document

**Documenting a New Feature Request:**

- Add a new entry to the appropriate section (`High-Priority` or `Low-Priority`).
- Use the following template for each feature:
  - **`Title:`** A concise, descriptive title.
  - **`Status:`** `REQUESTED`
  - **`Description:`** A clear description of the desired functionality.
  - **`User Story:`** Describe the feature from the user's perspective (e.g., "As a user, I want to...")
  - **`Justification:`** Explain why this feature would be valuable and how it improves the user experience.
  - **`Files to Modify:`** List the file(s) that would likely need changes to implement this feature.
  - **`Implementation Notes:`** Technical considerations, dependencies, or architectural changes needed.
  - **`Acceptance Criteria:`** Clear criteria that define when the feature is complete and working correctly.

**Working on a Feature:**

- When you start working on a feature, change its status to `IN PROGRESS`.
- Work on features in the `Active` sections in order of priority (from top to bottom).
- When implementing a feature, adhere to the project's coding standards and architecture.
- Ensure that your implementation includes appropriate tests and documentation.
- If during implementation you discover related features or improvements, add them to the appropriate section.

**Updating the File:**

- When a feature is implemented, change its `Status` to `COMPLETED`.
- Replace the `Implementation Notes` section with a `Implementation Summary` section detailing the changes made.
- **Move the entire entry** from the `Active` section to the `Completed Features` section at the bottom of the file.
- Keep a prioritized list of features in the `Active` section. The top entry should be the most important feature to work on.
- Re-prioritize the remaining active features as needed.

**Development Interaction:**

- **Always provide this `FEATURE_REQUESTS.md` file in the context** when asking for help implementing a feature. This gives the necessary context to understand the requirements and scope.
- **Always add all files listed in the feature's 'Files to Modify' section to the context.** This ensures proper understanding of the current implementation.

---

## High-Priority Features (Active)

1. **Transcription and Insights Integration**
- **Title:** Integrate Transcription and AI Insights into the Main Application
- **Status:** REQUESTED
- **Description:** Integrate the `transcription_module.py` functionality into the main application to allow users to generate transcriptions and extract AI-powered insights from their audio files. This involves creating a new UI panel to display the results and connecting it to the backend module.
- **User Story:** As a user, I want to select an audio file and click a button to get a full text transcription and a summary of key insights, like action items and topics, so I can quickly understand the content of my recordings.
- **Justification:** This is a core feature of the HiDock ecosystem, providing significant value by turning raw audio into structured, actionable information. It transforms the app from a simple file manager into a powerful productivity tool.
- **Files to Modify:** `gui_main_window.py`, `transcription_module.py`, `gui_actions_file.py`
- **Implementation Notes:**
  - Add a "Get Insights" button to the file context menu or toolbar.
  - Create a new tab or collapsible section in the UI to display the transcription and the structured insights (summary, action items, etc.).
  - The UI should handle loading states while the API calls are in progress.
  - Display errors gracefully if the transcription or insight extraction fails.
- **Acceptance Criteria:**
  - User can select a file and trigger the transcription/insight process.
  - A loading indicator is shown during processing.
  - The final transcription and insights are displayed clearly in a dedicated UI section.
  - API errors are caught and shown to the user with a helpful message.

2. **Secure API Key Management**
- **Title:** Securely Manage and Store User's Gemini API Key
- **Status:** REQUESTED
- **Description:** Implement a secure way for users to enter, store, and validate their Google Gemini API key. The key should be stored encrypted and not be hardcoded.
- **User Story:** As a user, I want a settings page where I can securely enter and save my Gemini API key so that the application can use it for transcription services without me having to enter it every time.
- **Justification:** API keys are sensitive secrets. Storing them securely is critical for user trust and application security. A dedicated settings panel improves usability and avoids insecure practices like using environment variables for a desktop app.
- **Files to Modify:** `settings_window.py`, `config_and_logger.py`, `transcription_module.py`
- **Implementation Notes:**
  - Add a new field in the Settings window for the Gemini API key.
  - Use a library like `cryptography` to encrypt the key before saving it to the `hidock_config.json` file.
  - Add a "Validate Key" button that makes a simple, low-cost API call to confirm the key is valid.
  - The application should load and decrypt the key at startup.
- **Acceptance Criteria:**
  - User can enter their API key in the settings.
  - The key is saved in an encrypted format.
  - A validation mechanism confirms the key works.
  - The transcription module successfully uses the saved key for API calls.

3. **Background Processing for AI Tasks**
- **Title:** Run Transcription and AI Analysis in a Background Thread
- **Status:** REQUESTED
- **Description:** Refactor the AI processing logic to run in a separate, non-blocking background thread. This will prevent the main application UI from freezing while waiting for network responses from the Gemini API.
- **User Story:** As a user, I want the application to remain responsive while it's generating a transcription, so I can continue to browse other files or use other features without waiting.
- **Justification:** API calls for transcription can be time-consuming. A frozen UI provides a poor user experience and can make the application feel broken. Background processing is essential for a smooth and professional feel.
- **Files to Modify:** `gui_main_window.py`, `gui_actions_file.py`, `transcription_module.py`
- **Implementation Notes:**
  - Use Python's `threading` or `asyncio` (if the GUI framework supports it well) to run the `process_audio_file_for_insights` function.
  - Implement a callback or event system to notify the main UI thread when the results are ready.
  - The UI should update with the results once the background task is complete.
  - Ensure thread-safe updates to any shared data or UI components.
- **Acceptance Criteria:**
  - The application UI remains fully responsive and usable while transcription is in progress.
  - A loading indicator is shown and correctly removed when the process finishes.
  - The results from the background thread are correctly displayed in the UI.

4. **HTA Audio File Conversion Utility**
- **Title:** Utility to Convert Proprietary HTA Files to WAV
- **Status:** REQUESTED
- **Description:** Implement a utility function that can convert the proprietary `.hta` audio files from the HiDock device into a standard format like `.wav` that is compatible with the Gemini API.
- **User Story:** As a user, I want the application to automatically handle the conversion of my `.hta` files so I can get transcriptions without needing to use an external converter.
- **Justification:** The core function of the application is to work with HiDock devices. Since these devices produce `.hta` files, the application must be able to process them to be useful. This conversion is a prerequisite for the transcription feature.
- **Files to Modify:** `file_operations_manager.py`, `transcription_module.py`, `hidock_device.py`
- **Implementation Notes:**
  - The exact conversion logic needs to be determined. This may require reverse-engineering the format or using a specific library if one exists.
  - The conversion should happen automatically in the background before transcription is attempted on an `.hta` file.
  - Converted `.wav` files could be stored in a temporary cache directory.
- **Acceptance Criteria:**
  - Selecting an `.hta` file for transcription successfully generates a `.wav` file.
  - The resulting `.wav` file is a valid audio file that can be played and sent to the API.
  - The process is seamless to the user.

5. **Pinned Waveform Visualization:**

- **Status:** REQUESTED
- **Description:** Add ability to "pin" the waveform visualization so it remains visible even when no file is selected or when switching between files without playing them. This would allow users to keep the waveform section expanded for quick reference and comparison between files.
- **User Story:** As a user, I want to pin the waveform visualization section so it stays visible when I'm browsing through files, allowing me to quickly see waveforms without having to play each file or keep a file selected.
- **Justification:** Currently, the waveform section hides when no file is selected, which interrupts the workflow when browsing through multiple files. A pin feature would allow users to maintain visual continuity and compare waveforms more efficiently. This is especially useful for audio professionals who need to quickly identify files by their waveform patterns.
- **Files to Modify:** @gui_main_window.py, @audio_visualization.py
- **Implementation Notes:**
  - Add a pin/unpin toggle button to the waveform visualization header
  - Modify visibility logic to respect pinned state
  - Save pinned state in user preferences
  - When pinned, show placeholder waveform or last viewed waveform when no file selected
- **Acceptance Criteria:**
  - Pin button toggles between pinned and unpinned states
  - When pinned, waveform section remains visible regardless of file selection
  - When unpinned, normal hide/show behavior applies
  - Pinned state persists between application sessions
  - Clear visual indication of pinned vs unpinned state

6. **Enhanced Device Detection and Selection Interface:**

- **Status:** REQUESTED
- **Description:** Improve the device detection and selection interface in the Connection Settings to provide more insightful information about detected hardware. The current interface shows a basic dropdown with device names, but doesn't clearly indicate which devices are HiDock devices, their connection status, or provide helpful details for device identification.
- **User Story:** As a user, I want to see a clear, informative interface that shows me all detected USB devices with visual indicators for HiDock devices, connection status, and device details, so I can easily identify and select the correct device for connection.
- **Justification:** The current device selection interface is confusing and doesn't provide enough information for users to make informed decisions. Users can't easily distinguish between HiDock devices and other USB devices, and there's no clear indication of device status or capabilities. An enhanced interface would reduce user confusion and improve the connection experience.
- **Files to Modify:** @settings_window.py, @gui_auxiliary.py, @device_interface.py, @desktop_device_adapter.py
- **Implementation Notes:**
  - Replace the simple dropdown with a more sophisticated device selection widget
  - Add visual indicators (icons, colors) to distinguish HiDock devices from other USB devices
  - Display additional device information such as:
    - Device model and firmware version (if available)
    - Connection status (connected, available, error)
    - VID/PID information in a user-friendly format
    - Device capabilities and supported features
  - Implement device categorization (HiDock devices vs. other devices)
  - Add device health indicators and connection quality information
  - Consider using a list/table view instead of a dropdown for better information display
  - Add refresh functionality with visual feedback during scanning
  - Implement proper error handling and user feedback for device detection issues
- **Acceptance Criteria:**
  - Device selection interface clearly distinguishes HiDock devices from other USB devices
  - Users can see device status, model, and connection information at a glance
  - Interface provides helpful feedback during device scanning and selection
  - Error states are clearly communicated with actionable guidance
  - The interface is intuitive and reduces user confusion about device selection
  - Device information is accurate and updated in real-time
  - Interface works properly when no devices are detected or when devices have errors

7. **Audio Playback Speed Control:**

- **Status:** REQUESTED
- **Description:** Add audio playback speed control buttons to allow users to adjust playback speed from 0.25x to 2.0x in 0.25x intervals. This would include speed options: 0.25x, 0.5x, 0.75x, 1.0x (normal), 1.25x, 1.5x, 1.75x, and 2.0x.
- **User Story:** As a user, I want to control the playback speed of audio files so I can slow down audio for detailed analysis or speed up audio for quick review, similar to functionality found in professional audio software and media players.
- **Justification:** Audio playback speed control is essential for various use cases including transcription work (slower speeds), quick content review (faster speeds), language learning, and detailed audio analysis. This feature is standard in most professional audio applications and would significantly enhance the utility of the audio player for different workflows.
- **Files to Modify:** @audio_player_enhanced.py, @gui_main_window.py, @audio_visualization.py
- **Implementation Notes:**
  - Add speed control buttons or dropdown to the audio player interface
  - Implement speed adjustment in the EnhancedAudioPlayer class
  - Ensure audio quality is maintained at different speeds (pitch correction may be needed)
  - Update position tracking and visualization to work correctly at different speeds
  - Consider using audio processing libraries that support time-stretching without pitch change
  - Add keyboard shortcuts for common speed adjustments (e.g., +/- keys)
  - Display current playback speed in the UI
  - Ensure speed changes are smooth and don't cause audio glitches
- **Acceptance Criteria:**
  - Users can select playback speeds from 0.25x to 2.0x in 0.25x intervals
  - Audio quality remains acceptable at all speed settings
  - Position tracking and visualization work correctly at all speeds
  - Speed changes are applied smoothly without audio interruption
  - Current playback speed is clearly displayed in the interface
  - Speed setting persists during playback but resets to 1.0x for new files
  - Keyboard shortcuts work for speed adjustment

---

## Low-Priority Features (Active)

1. **Advanced Audio Visualization Enhancements:**

- **Status:** REQUESTED
- **Description:** Enhance the audio visualization capabilities with real-time spectrum analysis, improved waveform display, and additional visualization modes during playback.
- **User Story:** As a user, I want to see rich, real-time audio visualizations during playback that help me understand the audio content and provide an engaging visual experience.
- **Justification:** Current audio visualization is basic and doesn't provide real-time feedback during playback. Enhanced visualizations would improve the user experience and provide valuable audio analysis information.
- **Files to Modify:** @audio_visualization.py, @enhanced_gui_integration.py, @audio_player_enhanced.py
- **Implementation Notes:**
  - Implement real-time spectrum analysis during playback
  - Add waveform progress indicator showing current playback position
  - Consider additional visualization modes (spectrogram, VU meters, etc.)
  - Optimize performance for real-time updates
  - Add user controls for visualization settings
- **Acceptance Criteria:**
  - Real-time visualizations update smoothly during audio playback
  - Waveform shows current playback position
  - Spectrum analysis displays frequency content accurately
  - Visualizations don't impact audio playback performance
  - User can customize visualization settings

2. **Batch File Operations Enhancement:**

- **Status:** REQUESTED
- **Description:** Improve batch file operations with better progress tracking, operation queuing, and the ability to pause/resume batch operations.
- **User Story:** As a user, I want to perform batch operations on multiple files with clear progress tracking and the ability to control the operation flow.
- **Justification:** Current batch operations lack detailed progress information and user control, making it difficult to manage large file operations effectively.
- **Files to Modify:** @file_operations_manager.py, @gui_actions_file.py, @gui_main_window.py
- **Implementation Notes:**
  - Add detailed progress tracking for batch operations
  - Implement pause/resume functionality for batch operations
  - Add operation queuing with priority management
  - Provide better error handling and recovery for failed operations
  - Add estimated time remaining for batch operations
- **Acceptance Criteria:**
  - Users can see detailed progress for each file in batch operations
  - Batch operations can be paused and resumed
  - Failed operations are handled gracefully with retry options
  - Progress information is accurate and helpful

3. **Advanced File Filtering and Search:**

- **Status:** REQUESTED
- **Description:** Add advanced filtering and search capabilities to help users find specific files based on various criteria such as date range, file size, duration, and content.
- **User Story:** As a user, I want to quickly find specific files using advanced search and filtering options, so I can efficiently manage large collections of recordings.
- **Justification:** As users accumulate many recordings, finding specific files becomes challenging. Advanced search and filtering would significantly improve file management efficiency.
- **Files to Modify:** @gui_treeview.py, @file_operations_manager.py, @gui_main_window.py
- **Implementation Notes:**
  - Add search bar with real-time filtering
  - Implement date range filtering
  - Add file size and duration range filters
  - Consider content-based search (if transcription is available)
  - Add saved search/filter presets
  - Implement advanced sorting options
- **Acceptance Criteria:**
  - Users can search files by name with real-time results
  - Date range filtering works accurately
  - Multiple filters can be combined effectively
  - Search results are highlighted and easy to navigate
  - Filter settings can be saved and reused

---

## Completed Features

_No completed features yet. Features will be moved here when implemented._

---

## Rejected Features

_Features that have been considered but rejected will be documented here with reasoning._

---

## Notes for Developers

- When implementing features, consider the impact on existing functionality and ensure backward compatibility
- All new features should include appropriate error handling and user feedback
- Consider performance implications, especially for real-time features like audio visualization
- Ensure new features are accessible and follow the application's UI/UX patterns
- Add appropriate logging and debugging capabilities for new features
- Consider internationalization and localization needs for user-facing text
- Document any new configuration options or settings added by features
