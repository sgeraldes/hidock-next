# Bug and Issue Tracker

This document lists the identified bugs and areas for improvement based on console output, user reports, and code review. It serves as a living document to track the project's health and guide development priorities.

## How to Use This Document

**Documenting a New Bug:**

- Add a new entry to the appropriate section (`High-Priority` or `Low-Priority`).
- Use the following template for each bug:
  - **`Title:`** A concise, descriptive title.
  - **`Status:`** `OPEN`
  - **`Problem:`** A clear description of what is going wrong.
  - **`Evidence:`** Include log snippets, tracebacks, or steps to reproduce the issue.
  - **`Files to Blame:`** List all file(s) that are likely responsible for the bug or are needed to understand and implement the fix.
  - **`Proposed Solution / Expected Behavior:`** Outline a clear plan to fix the bug and describe the desired outcome.

**Working on a Bug:**

- When you start working on a bug, you can optionally change its status to `IN PROGRESS`.
- Work on bugs in the `Active` sections in order of priority (from top to bottom).
- When fixing a bug, adhere to the project's coding standards and architecture.
- Ensure that your fix is accompanied by relevant tests if applicable.
- If during analyzing a file while working a bug you find another potential bug, add it to the `Active` section.

**Updating the File:**

- When a bug is fixed, change its `Status` to `FIXED`.
- Replace the `Proposed Solution` section with a `Resolution` section detailing the changes made.
- **Move the entire entry** from the `Active` section to the `Fixed Issues (Completed)` section at the bottom of the file.
- Keep a prioritized list of bugs in the `Active` section. The top entry should be the most important bug to work on.
- Re-prioritize the remaining active bugs as needed.

**LLM Interaction:**

- **Always provide this `BUG_LIST.md` file in the context window** when asking an LLM assistant to work on a bug. This gives the assistant the necessary context to understand the issue and its history.
- **Always add all files listed in the bug's 'Files to Blame' section to the context window.** This ensures the assistant has all the necessary code to implement a correct fix.

## High-Priority Issues (Active)

1. **Settings Dialog Fails When Device is Connected:**

- **Status:** OPEN
- **Problem:** Opening the settings dialog when a device is connected causes multiple errors:
  - Device description shows "[Error Reading Info (USBError)] (VID=0x10d6, PID=0xb00d)" instead of proper device name
  - Console shows "AttributeError: 'DesktopDeviceAdapter' object has no attribute 'get_device_settings'"
  - The app unnecessarily scans the connected device causing USB access conflicts
- **Evidence:** User report with screenshot showing error in device dropdown and console log showing AttributeError.
- **Files to Blame:** @settings_window.py, @desktop_device_adapter.py, @gui_auxiliary.py
- **Proposed Solution / Expected Behavior:** When a device is connected, the settings dialog should:
  - Use the already-available device information instead of re-scanning
  - Show the proper device name that was obtained during initial connection
  - Implement the missing `get_device_settings` method in `DesktopDeviceAdapter`
  - Avoid USB conflicts by not scanning the currently connected device

2. **Waveform and Spectrum Visualization Not Working During Playback:**

- **Status:** OPEN
- **Problem:** The waveform and spectrum visualizations are not working properly during audio playback:
  - Waveform shows static display with no progress indicator during playback
  - Spectrum view shows nothing during playback
  - Real-time audio analysis and visualization features are not functional
- **Evidence:** User report with screenshots showing static waveform during playback and empty spectrum view.
- **Files to Blame:** @audio_visualization.py, @enhanced_gui_integration.py
- **Proposed Solution / Expected Behavior:**
  - Fix waveform visualization to show real-time progress indicator during playback
  - Implement real-time spectrum analysis and display during audio playback
  - Ensure visualization components are properly integrated with the audio player
  - Add position updates to waveform display showing current playback position

3. **Missing Download Queue Cancellation Functionality:**

- **Status:** OPEN
- **Problem:** There is no way to cancel or stop downloads once they are queued or in progress. This functionality was previously available but has been removed or broken. Users are stuck waiting for downloads to complete even if they no longer want them, leading to wasted bandwidth and time.
- **Evidence:** User report: "There is no way to stop a downloading queue... there was before... now gone."
- **Files to Blame:** @gui_actions_file.py, @file_operations_manager.py, @gui_main_window.py
- **Proposed Solution / Expected Behavior:**
  - Add cancel/stop buttons or menu options for active downloads
  - Implement queue management UI showing all active downloads with individual cancel options
  - Add "Cancel All Downloads" functionality
  - Ensure cancelled downloads are properly cleaned up and don't leave partial files
  - Update file status to show "Cancelled" when downloads are stopped
  - Restore the download management interface that was previously available

4. **Missing Audio Playback Stop/Cancel Functionality:**

- **Status:** OPEN
- **Problem:** There is no way to stop audio playback once it has started. Users cannot cancel or stop playing files, forcing them to wait for the entire file to finish playing. This functionality was previously available but has been removed or broken.
- **Evidence:** User report: "There is no way to stop a playing file anymore."
- **Files to Blame:** @gui_main_window.py, @audio_player.py, @gui_actions_file.py
- **Proposed Solution / Expected Behavior:**
  - Add stop/pause buttons for audio playback control
  - Implement keyboard shortcuts for playback control (spacebar for play/pause, escape for stop)
  - Add playback controls to the main interface or context menu
  - Ensure stop functionality properly releases audio resources
  - Update file status to reflect when playback is stopped vs. completed
  - Restore the playback control interface that was previously available

5. **Inefficient Memory Usage During File Download:**

- **Status:** OPEN
- **Problem:** The `download_recording` method in `DesktopDeviceAdapter` reads the entire file from the device into a memory buffer (`bytearray`) before returning it. The `FileOperationsManager` then writes this buffer to disk. This approach consumes memory equal to the size of the file being downloaded, which can be problematic for large recordings and systems with limited RAM. The previous implementation streamed data directly to a file, which was more memory-efficient.
- **Evidence:** The implementation of `download_recording` in `desktop_device_adapter.py` accumulates all data chunks into a `file_data` bytearray before returning.
- **Files to Blame:** @desktop_device_adapter.py, @device_interface.py, @file_operations_manager.py (the `download_recording` signature forces returning `bytes`).
- **Proposed Solution / Expected Behavior:** Refactor the download process to support streaming.
  a. The `IDeviceInterface.download_recording` method signature should be changed to accept a file-like object or a path to write to, instead of returning `bytes`. For example: `async def download_recording(self, recording_id: str, output_path: str, ...)`
  b. The `DesktopDeviceAdapter` implementation should be updated to write chunks directly to the `output_path` inside its `data_callback`, avoiding the large memory buffer.
  c. The `FileOperationsManager._execute_download` method would then be simplified, passing the `local_path` to the adapter instead of writing the file itself. This restores the more memory-efficient streaming behavior.

6. **`TclError` Crash When Editing Numeric Settings:**

- **Status:** OPEN
- **Problem:** When a user edits a numeric value in an entry field in the Settings window (e.g., deleting the existing number to type a new one), the application throws a `TclError: expected integer but got ""`. This happens because the `CTkEntry` is bound to a `ctk.IntVar`, which cannot handle an empty string `""` as a value. This error likely causes a cascade of other UI failures.
- **Evidence:** The traceback provided by the user shows the `TclError` originating from a `_textvariable_callback` in `ctk_entry.py` when trying to `.get()` from a variable that expects a number but receives an empty string.
- **Files to Blame:** @settings_window.py, @gui_main_window.py (where the Entry widgets are created and bound to `IntVar`s).
- **Proposed Solution / Expected Behavior:** The `SettingsDialog` needs to handle this gracefully. The most robust solution is to bind the numeric entry fields to `ctk.StringVar` variables instead of `ctk.IntVar`. When the settings are applied or saved, the value from the `StringVar` should be validated and converted to an integer within a `try-except` block. If the conversion fails (e.g., empty or invalid string), an error message should be shown to the user, or a valid default should be used, preventing the crash.

7. **Settings "Apply" Button Not Enabled on Change:**

- **Status:** OPEN
- **Problem:** The "Apply" button in the Settings window remains disabled even after a user modifies a setting. This is a direct side effect of Bug #9. The `TclError` interrupts the execution of the callback function that is responsible for detecting changes and enabling the button.
- **Evidence:** User report. The log shows the change detection method (`_update_button_states_on_change`) is called, but the button state doesn't change, strongly suggesting an exception occurred within that method or a related callback.
- **Files to Blame:** @settings_window.py
- **Proposed Solution / Expected Behavior:** Fixing Bug #7 by preventing the `TclError` crash will likely resolve this issue, as the change detection logic will no longer be interrupted. The `_update_button_states_on_change` method should be reviewed to ensure it's robust and that an error in one part of the change detection logic doesn't prevent the UI from updating correctly.

8. **Settings Are Not Saved When "Ok" is Clicked:**

- **Status:** OPEN
- **Problem:** Changes made in the Settings window are not persisted after the application is restarted, even when the "Ok" button is used. This is also a side effect of Bug #9.
- **Evidence:** User report. A changed value reverts to the original on app restart. Because the `TclError` occurs when the entry is edited, the new value is never successfully read from the widget. Therefore, when "Ok" is clicked, the application saves the original, unchanged value that is still stored in the `ctk.Variable`.
- **Files to Blame:** @settings_window.py, @gui_main_window.py
- **Proposed Solution / Expected Behavior:** This bug will be fixed by resolving Bug #7. Once the `TclError` is prevented, the application will be able to correctly read the new value from the entry widget when the "Ok" or "Apply" button is clicked. The `_apply_and_save_changes` method in `SettingsDialog` will then be able to update the main window's configuration variables with the correct, user-provided values, which will then be saved correctly when the application closes.

10. **Settings Window Fails to Open Correctly When Device is Connected:**

- **Status:** OPEN
- **Problem:** When a device is connected, opening the Settings window triggers multiple errors, including a `USBError: Access denied` and two different `AttributeError` crashes. The root cause is that the Settings window unnecessarily tries to re-scan and query the already-active device, which is locked by the main application.
- **Evidence:**
  1. Log shows `scan_usb_devices_for_settings` is called on settings open.
  2. Log shows `USBError: [Errno 13] Access denied` when the scan tries to access the connected device's info.
  3. First traceback: `AttributeError: 'DesktopDeviceAdapter' object has no attribute 'device_interface'` in `gui_auxiliary.py` when trying to find the connected device in the new scan list.
  4. Second traceback: `AttributeError: 'DesktopDeviceAdapter' object has no attribute 'get_device_settings'` in `settings_window.py` when trying to load device-specific settings.
- **Files to Blame:** @gui_auxiliary.py, @settings_window.py, @device_interface.py, @desktop_device_adapter.py, @gui_main_window.py
- **Proposed Solution / Expected Behavior:** The Settings window should use the application's existing state when a device is connected, not attempt to re-discover it.
  a. **Stop Redundant Scan:** In `gui_auxiliary.py`, modify `scan_usb_devices_for_settings`. If `self.device_manager.device_interface.is_connected()` is true, it should not perform a new USB scan. Instead, it should get the connected device's info from `self.device_manager.get_current_device()` and populate the combobox with a single, pre-selected entry like "Currently Connected: HiDock H1E...".
  b. **Expose Settings Method:** The `get_device_settings` method is not part of the `IDeviceInterface`. It needs to be properly exposed. Add `async def get_device_settings(self) -> Optional[Dict[str, bool]]` to `IDeviceInterface` in `device_interface.py`.
  c. **Implement Settings Method:** Implement the new `get_device_settings` method in `desktop_device_adapter.py`. It will be a simple wrapper that calls `self.jensen_device.get_device_settings()`.
  d. **Fix Settings Dialog Call:** In `settings_window.py`, the `_load_device_settings_for_dialog_thread` must be updated to call the new `async` method on the device interface correctly.

---

## Low-Priority Issues (Active)

1. **Missing `ffmpeg` Dependency:**

   - **Status:** OPEN
   - **Problem:** The application warns that `ffmpeg` or `avconv` is not found. This will cause any advanced audio format conversion or processing to fail.
   - **Evidence:** The `RuntimeWarning: Couldn't find ffmpeg or avconv` from the `pydub` library.
   - **File to Blame:** N/A. This is an external dependency/environment issue, not a bug in a specific project file. The `pydub` library, likely used for audio operations, triggers this warning.
   - **Proposed Solution:** Raise a warning to the user about the missing dependency, and provide instructions on how to install it. This is a user-facing issue and should be addressed by the application.

2. **Deprecated `pkg_resources` Usage:**

   - **Status:** OPEN
   - **Evidence:** The `UserWarning: pkg_resources is deprecated as an API` at the start of the log.
   - **Problem:** The `pygame` library is using a deprecated package (`pkg_resources`) which is scheduled for removal. This could cause issues with future library updates.
   - **File to Blame:** N/A. This warning originates from the `pygame` dependency itself and is not a bug in the project's own code.
   - **Proposed Solution:** Update the `pygame` library to the latest version, which should address this deprecation.

3. **Remove Redundant Waveform/Spectrum Checkboxes and Replace Theme Dropdown:**

   - **Status:** OPEN
   - **Problem:** The "Show Waveform" and "Show Spectrum" checkboxes in the visualization area are redundant since the tabs at the top already provide this functionality. Additionally, the "Theme" dropdown takes up valuable space that could be used for audio control buttons (play, pause, etc.) which are currently missing from the interface.
   - **Evidence:** User feedback indicating the checkboxes are useless and that audio control buttons are needed in that space.
   - **Files to Blame:** @gui_main_window.py, @audio_visualization.py
   - **Proposed Solution / Expected Behavior:**
     - Remove the "Show Waveform" and "Show Spectrum" checkboxes from the visualization area
     - Replace the "Theme" dropdown with a compact toggle button that switches between moon (dark) and sun (light) icons
     - Position the theme toggle button as a floating element in a top corner of the visualization section to minimize space usage
     - Use the freed space for audio control buttons (play, pause, stop, etc.) to improve the user experience
     - Ensure the theme toggle maintains the same functionality as the current dropdown but with a more space-efficient design

4. **Remove Confirmation Dialog for Play on Undownloaded Files:**

   - **Status:** OPEN
   - **Problem:** When clicking Play on a file that hasn't been downloaded, the application shows a dialog asking the user to download it first. This interrupts the user flow and creates unnecessary friction.
   - **Evidence:** User feedback indicating the dialog should be removed and download should proceed automatically.
   - **Files to Blame:** @gui_main_window.py
   - **Proposed Solution / Expected Behavior:**
     - Remove the confirmation dialog when playing undownloaded files
     - Automatically initiate download when Play is clicked on an undownloaded file
     - Show a brief status message or progress indicator during the download
     - Start playback immediately once download completes
     - Provide seamless user experience without interrupting dialogs

5. **Insufficient Visual Feedback During File List Loading:**
   - **Status:** OPEN
   - **Problem:** When the file list is being loaded from the device, there's insufficient visual feedback to indicate the loading process. Users can only tell something is happening by looking at the status bar, which is not prominent enough. The treeview appears empty or unchanged during loading, creating confusion about whether the application is working.
   - **Evidence:** User feedback indicating the loading process is not visually prominent and needs better indicators.
   - **Files to Blame:** @gui_treeview.py, @gui_actions_device.py
   - **Proposed Solution / Expected Behavior:**
     - Add prominent visual loading indicators on top of or within the treeview during file list loading
     - Consider options such as:
       - Animated loading icon or spinner overlay on the treeview
       - Placeholder text in the treeview (e.g., "Loading files from device...")
       - Progressive loading that shows files as they're received from the device
       - Loading progress bar above the treeview
     - Ensure the loading state is clearly visible and doesn't rely solely on the status bar
     - Provide immediate visual feedback when file list refresh is initiated

---

## Fixed Issues (Completed)

- **File List Not Updated After File Deletion:**

  - **Status:** FIXED
  - **Problem:** After a file was successfully deleted from the device, the file list in the GUI was not refreshed to reflect the change. The deleted file continued to appear in the file list even though it no longer existed on the device. This was misleading to users and could cause confusion or attempts to interact with non-existent files.
  - **Evidence:** User report: "After file is removed from the device, the file list is not updated. This is the only time you actually need to update the file list but failed to do so."
  - **Files to Blame:** @gui_actions_file.py, @file_operations_manager.py, @gui_actions_device.py
  - **Resolution:**
    - Modified `_perform_gui_update_for_operation` in `gui_actions_file.py` to handle deletion completion by removing the file from the treeview and refreshing the file list
    - Added `_remove_file_from_treeview` method in `gui_treeview.py` to properly remove deleted files from both the treeview display and the internal file list
    - Updated `delete_selected_files_gui` to immediately show "Delete Queued" status for files being queued for deletion
    - Files are now immediately removed from the display when deletion completes, and the file list is refreshed to ensure consistency with the device state
    - The file list now accurately reflects the current state of files on the device after deletion operations

- **Duplicate Downloads and Infinite Download Loop:**

  - **Status:** FIXED
  - **Problem:** The download system allowed the same file to be queued for download multiple times without any protection or indication. Users could repeatedly click the download button on the same file, causing it to download endlessly in the background. The UI showed no indication of multiple downloads happening, and files could get stuck in an infinite download loop that never stopped.
  - **Evidence:** User report with console logs showing multiple downloads of the same file being queued. Files would reach 100%, change to "Downloaded", then continue downloading invisibly in background.
  - **Files to Blame:** @gui_actions_file.py, @file_operations_manager.py, @gui_actions_device.py
  - **Resolution:**
    - Modified `queue_download` method in `FileOperationsManager` to check for existing active operations before queuing new downloads
    - Added duplicate download prevention that returns the existing operation ID if a file is already queued or downloading
    - Added `is_file_operation_active` method to check if a file has an active operation
    - Updated `download_selected_files_gui` to immediately show "Queued" status for files being queued for download
    - Files that are already downloaded can still be re-downloaded, but duplicate simultaneous downloads are prevented
    - The system now properly tracks active operations and prevents infinite download loops

- **Download Still Has Long Delays Despite Previous Fix:**

  - **Status:** FIXED
  - **Problem:** Downloads still experience significant delays (10+ seconds) before starting. The logs show that a full file list operation (CMD: 4) is being executed before each download, causing multiple timeouts and delays. Previous optimization attempt broke downloads entirely.
  - **Evidence:** Console log shows download queued but actual streaming doesn't start until after file list completes. Attempt to eliminate `get_recordings()` call caused downloads to fail with "expected length 0 bytes" because file size is required for proper streaming.
  - **Files to Blame:** @desktop_device_adapter.py, @hidock_device.py
  - **Resolution:**
    - Modified `DesktopDeviceAdapter.download_recording` to accept an optional `file_size` parameter to avoid expensive file list operations
    - Updated `FileOperationsManager._execute_download` to retrieve cached file metadata and pass the file size to the device adapter
    - When cached file size is available, downloads now skip the expensive `get_recordings()` call that was causing the delays
    - Added debug logging to track when cached vs. fresh file size is being used
    - Downloads now start immediately when file metadata is cached from the initial connection file list
    - Updated the abstract `IDeviceInterface.download_recording` method to include the new optional parameter
    - The optimization maintains backward compatibility by falling back to the original behavior when no cached size is available

- **Poor Error Handling for Connection Failures:**

  - **Status:** FIXED
  - **Problem:** Connection failures show unfriendly error messages and stack traces instead of user-friendly messages:
    - When device is in "limbo" state (connected but unresponsive), shows "Device health check failed" with full stack trace
    - When device is not found/powered off, shows "Device VID=0x10d6, PID=0xb00d not found" with stack trace
    - Users should see friendly messages like "Device not found" or "Connection failed, please check device"
  - **Evidence:** Console logs show ConnectionError exceptions with full tracebacks reaching the GUI layer instead of being caught and handled gracefully.
  - **Files to Blame:** @gui_actions_device.py, @desktop_device_adapter.py
  - **Resolution:**
    - Enhanced the exception handling in `_connect_device_thread` to catch connection errors and provide user-friendly messages.
    - Added intelligent error message detection based on error content:
      - "Device not found" errors show: "No HiDock device found. Please check that your device is connected and powered on."
      - "Health check failed" errors show: "Connection failed. Please disconnect and reconnect your device, then try again."
      - "Access denied" errors show: "USB access denied. Please check device permissions or try running as administrator."
    - Replaced technical stack traces with user-friendly error dialogs using `messagebox.showerror`.
    - Technical errors are still logged for debugging but not shown to end users.
    - Status bar is updated with appropriate user-friendly status messages.

- **File Deletion Completely Broken:**

  - **Status:** FIXED
  - **Problem:** File deletion functionality is completely non-functional. When users attempt to delete files, the operation is queued and shows "Delete (0%)" status, but the deletion never completes and fails with an AttributeError. The FileOperationsManager is trying to call `delete_file()` on a DeviceManager object, but this method doesn't exist.
  - **Evidence:** Console error log shows:
    ```
    [2025-07-27 20:39:05.713][INFO] FileOpsManager::queue_delete - Queued deletion for 2025Jul11-223631-Rec04.hda
    [2025-07-27 20:39:05.713][INFO] FileOpsManager::queue_batch_delete - Queued batch deletion for 1 files
    Exception in thread FileOpsWorker-0:
    Traceback (most recent call last):
      File "file_operations_manager.py", line 475, in _execute_delete
        success = self.device_interface.delete_file(filename)
    AttributeError: 'DeviceManager' object has no attribute 'delete_file'
    ```
  - **Files to Blame:** @file_operations_manager.py, @device_manager.py, @desktop_device_adapter.py, @device_interface.py
  - **Resolution:**
    - Fixed the method call chain in `FileOperationsManager._execute_delete` to properly call the device interface using the correct async pattern: `self.device_interface.device_interface.delete_recording()`
    - Implemented the missing `delete_file` method in the `HiDockJensen` class using the `CMD_DELETE_FILE` command (command ID 7) from the device protocol
    - Added proper error handling and device lock synchronization to prevent conflicts with other device operations
    - The delete operation now properly uses asyncio.run() to handle the async device interface and includes comprehensive error logging
    - Files are now successfully deleted from the device, removed from the metadata cache, and operation statistics are properly updated

- **Poor Error Handling for Connection Failures:**

  - **Status:** FIXED
  - **Problem:** Connection failures show unfriendly error messages and stack traces instead of user-friendly messages:
    - When device is in "limbo" state (connected but unresponsive), shows "Device health check failed" with full stack trace
    - When device is not found/powered off, shows "Device VID=0x10d6, PID=0xb00d not found" with stack trace
    - Users should see friendly messages like "Device not found" or "Connection failed, please check device"
  - **Evidence:** Console logs show ConnectionError exceptions with full tracebacks reaching the GUI layer instead of being caught and handled gracefully.
  - **Files to Blame:** @gui_actions_device.py
  - **Resolution:**
    - Enhanced the exception handling in `_connect_device_thread` to catch connection errors and provide user-friendly messages.
    - Added intelligent error message detection based on error content:
      - "Device not found" errors show: "No HiDock device found. Please check that your device is connected and powered on."
      - "Health check failed" errors show: "Connection failed. Please disconnect and reconnect your device, then try again."
      - "Access denied" errors show: "USB access denied. Please check device permissions or try running as administrator."
    - Replaced technical stack traces with user-friendly error dialogs using `messagebox.showerror`.
    - Technical errors are still logged for debugging but not shown to end users.

- **File Status Not Updating During Download Operations:**

  - **Status:** FIXED
  - **Problem:** File status in the treeview doesn't update properly during download operations:
    - Files don't show "Queued" status when download is initiated
    - Files show "Completed" instead of "Downloaded" when download finishes
    - Status updates are not real-time during the download process
  - **Evidence:** User report: "I click Download from a file in 'On Device' status and doesn't change to Queued. And when the download is completed, it changes to 'Completed' but doesn't change to 'Downloaded'."
  - **Files to Blame:** @gui_actions_device.py, @gui_actions_file.py
  - **Resolution:**
    - Fixed the status comparison logic in `gui_actions_device.py` to use enum comparison (`FileOperationStatus.PENDING`) instead of string comparison (`"pending"`).
    - Modified the download completion handler in `gui_actions_file.py` to show "Downloaded" status instead of "Completed" for download operations.
    - Added immediate file list refresh in `download_selected_files_gui` to ensure "Queued" status appears immediately when downloads are initiated.
    - Files now properly show: "Queued" → "Downloading (X%)" → "Downloaded" status progression.

- **Column Sorting and Indicator Broken:**

  - **Status:** FIXED
  - **Problem:** Clicking on a column header in the file list (e.g., "Name", "Date/Time") does not sort the list. The UI flickers, but the file order remains unchanged. Additionally, the sort indicator arrow does not appear; instead, a black square is sometimes visible. Double-clicking on column headers also incorrectly triggered file double-click events.
  - **Evidence:** User report. The `sort_treeview_column` method in `gui_treeview.py` is called, but the `_sort_files_data` method might not be correctly handling the new `datetime` column or other data types, and `_update_treeview_heading_indicator` is failing to render the arrow.
  - **Files to Blame:** @gui_treeview.py
  - **Resolution:**
    - Fixed the arrow rendering issue in `_update_treeview_heading_indicator` by replacing problematic Unicode characters with simple ASCII characters (`v` and `^`) that display consistently across all systems.
    - Improved the `_sort_files_data` method to handle all data types correctly:
      - Added proper handling for "Recording..." status in duration column (sorts to top)
      - Enhanced datetime parsing with better error handling for empty/invalid dates
      - Added string normalization for text columns to ensure consistent sorting
      - Improved type checking and fallback values for all column types
    - Added event filtering for double-clicks to prevent header double-clicks from triggering file actions by implementing `_on_file_double_click_filtered` method that uses `identify_region` to distinguish between header and content clicks.
    - The sorting now works correctly for all columns including the merged datetime column, and the sort indicators display properly.

- **Treeview Scrollbar Missing:**

  - **Status:** FIXED
  - **Problem:** The vertical scrollbar for the file list is not visible, making it impossible to scroll through the list when the number of files exceeds the visible area.
  - **Evidence:** User report. Visual inspection of the UI shows no scrollbar next to the `ttk.Treeview`.
  - **Files to Blame:** @gui_treeview.py
  - **Resolution:** Fixed the scrollbar visibility issue in `_create_file_tree_frame` by adding proper column configuration for the scrollbar. Added `tree_frame.grid_columnconfigure(1, weight=0)` to ensure the scrollbar column has the correct layout properties and doesn't get compressed or hidden. The scrollbar bindings were already correct, but the layout configuration was missing.

- **Download Fails with Checksum Mismatch and Long Delays:**

  - **Status:** FIXED
  - **Problem:** File downloads experience significant delays (10+ seconds) before starting and consistently fail with "Checksum mismatch" errors after successful data transfer. The download process shows timeouts during file list operations before the actual download begins.
  - **Evidence:** Log analysis shows download queued at 19:09:10 but doesn't start until 19:09:22 (12-second delay), multiple timeout warnings during file list operations, successful data transfer, but validation failure with "Checksum mismatch".
  - **Files to Blame:** @file_operations_manager.py, @gui_main_window.py
  - **Resolution:**
    - **Fixed Checksum Validation Issue:** The device provides a `signature` field (16-byte hex) that was being compared against SHA-256 checksums calculated locally, causing inevitable mismatches. Modified `_validate_downloaded_file` to skip incompatible checksum validation and rely on file size validation instead, which is more reliable for this device protocol.
    - **Fixed Download Delays:** Added device lock synchronization to the FileOperationsManager. Downloads now properly wait for ongoing device operations (like file list refreshes) to complete before starting, eliminating the timeout delays. Modified the constructor to accept a `device_lock` parameter and updated `_execute_download` to acquire the lock before device communication.
    - **Improved Validation Logging:** Enhanced validation logging to provide better debugging information and clearer success/failure messages.
    - Downloads now start immediately after queuing and complete successfully with proper validation.

- **Playback Does Not Auto-Download Files:**

  - **Status:** FIXED
  - **Problem:** When a user tries to play a file that has not been downloaded, the application shows a warning message asking the user to download it first, instead of automatically downloading and then playing it. This is poor user experience.
  - **Evidence:** The `play_selected_audio_gui` method in `gui_main_window.py` explicitly checks if the file exists and shows a warning if it doesn't.
  - **Files to Blame:** @gui_main_window.py
  - **Resolution:**
    - The auto-download functionality was already implemented in `_download_for_playback_and_play` method but had issues with status comparison using string literals instead of enum values.
    - Fixed the callback logic in `on_playback_download_complete` to use `FileOperationStatus` enum values (`COMPLETED`, `FAILED`, `CANCELLED`) instead of string comparisons.
    - Updated the user message to match the proposed solution: "'{filename}' needs to be downloaded before playback. Starting download now."
    - Fixed the error message callback to use proper lambda function for thread-safe GUI updates.
    - The playback experience is now streamlined: when play is clicked on an undownloaded file, it automatically downloads and then plays the file upon successful completion.

- **Hardcoded "Magic Number" for Duration Correction:**

  - **Status:** FIXED
  - **Problem:** The application calculates file duration in two separate places using "magic numbers". First, `hidock_device.py` calculates a base duration from file size assuming an incorrect bitrate (e.g., 256kbps). Then, `gui_actions_device.py` multiplies this result by another magic number (`4`) to get the final, correct duration. This two-step, magic-number-based calculation is brittle, confusing, and undocumented.
  - **Evidence:** `hidock_device.py`'s `list_files` method calculates `duration_sec` from `file_length_bytes`. Then, `gui_actions_device.py`'s `_refresh_file_list_thread` multiplies this duration by `4`.
  - **Files to Blame:** @hidock_device.py, @gui_actions_device.py
  - **Resolution:**
    - Created a comprehensive `_calculate_file_duration(file_size_bytes, file_version)` helper method in `hidock_device.py` that consolidates all duration calculation logic.
    - The method includes proper constants for audio format specifications (sample rates, channels, bytes per sample) with clear documentation.
    - Applied the 4x correction factor directly within the helper method for all file versions, eliminating the need for post-processing.
    - Removed the magic number multiplication (`* 4`) from `gui_actions_device.py` since the correction is now applied at the source.
    - Updated the `list_files` method to use the new helper function, ensuring consistent and accurate duration calculations.
    - The duration calculation is now centralized, well-documented, and eliminates the confusing two-step process with magic numbers.

- **Redundant Device Model Detection Logic:**

  - **Status:** FIXED
  - **Problem:** Device model detection logic is duplicated and inconsistent between `hidock_device.py` (low-level) and `device_interface.py` (high-level). This is a code smell and has already caused bugs (see Bug #8).
  - **Evidence:** The `_attempt_connection` method in `hidock_device.py` and the `detect_device_model` function in `device_interface.py` have separate, slightly different implementations.
  - **Files to Blame:** @hidock_device.py, @device_interface.py
  - **Resolution:**
    - Removed the redundant device model detection logic from `hidock_device.py` in the `_attempt_connection` method.
    - The low-level module now only reports the USB Product ID for logging purposes instead of attempting to determine user-facing model names.
    - The `detect_device_model` function in `device_interface.py` is now the single source of truth for model detection, as it should be.
    - This eliminates the code duplication and ensures consistent model detection across the application.
    - The separation of concerns is now proper: low-level USB communication in `hidock_device.py` and high-level device management in `device_interface.py`.

- **Inconsistent Device Model Name (Symptom of #4):**

  - **Status:** FIXED
  - **Problem:** The low-level `hidock_device.py` does not recognize the Product ID `0xb00d` for the HiDock H1E, resulting in a generic model name in its logs.
  - **Evidence:** The code in `hidock_device.py`'s `_attempt_connection` method is missing the `0xb00d` PID in its model detection logic.
  - **File to Blame:** @hidock_device.py
  - **Resolution:** This issue was resolved as part of fixing the redundant device model detection logic (Bug #4). By removing the model detection logic from `hidock_device.py` and centralizing it in `device_interface.py`, the inconsistency is eliminated. The `device_interface.py` already includes the `0xB00D` PID mapping for the HiDock H1E, ensuring consistent model detection across the application.

- **Redundant API Calls on Connection:**

  - **Status:** FIXED
  - **Problem:** Upon connecting, the application makes an unnecessary, redundant call to `get_device_info`.
  - **Evidence:** The `_connect_device_thread` in `gui_actions_device.py` calls `device_manager.device_interface.connect()`, which already fetches and stores the device info, and then immediately calls `device_manager.device_interface.get_device_info()` again.
  - **Files to Blame:** @gui_actions_device.py, @desktop_device_adapter.py, @device_interface.py
  - **Resolution:**
    - Removed the redundant `get_device_info()` call from `_connect_device_thread` in `gui_actions_device.py`.
    - Modified the connection logic to use the `DeviceInfo` object returned directly from the `connect()` method.
    - This eliminates the unnecessary second network request and improves connection performance.
    - The connection process is now more efficient and follows the intended API design where `connect()` returns all necessary device information.

- **P1 Device Not Supported (GitHub Issue):**

  - **Status:** FIXED
  - **Problem:** The new P1 Device (PID: 45070 / 0xAF0E) is not working with the application out of the box. Users need to manually update the hidock_config.json file to set "selected_pid": 45070 to make it work.
  - **Evidence:** GitHub user report: "I just got the new P1 Device and it was not working with this project. To get it working, I only needed to update the hidock_config.json - 'selected_pid': 45070"
  - **Files to Blame:** @gui_actions_device.py
  - **Resolution:**
    - Enhanced the `attempt_autoconnect_on_startup` method to use device discovery instead of relying solely on configured VID/PID values.
    - The autoconnect process now calls `discover_devices()` to find available HiDock devices and automatically selects the first discovered device.
    - If a device is discovered, the application automatically updates the selected VID/PID variables to match the discovered device.
    - This eliminates the need for users to manually configure the PID for P1 devices, as the application will auto-detect and connect to any supported HiDock device.
    - The P1 device (0xAF0E) was already supported in the device detection logic, but now the autoconnect feature properly utilizes this support.

- **Window Not Visible Due to Negative Coordinates (GitHub Issue):**

  - **Status:** FIXED
  - **Problem:** The application window may not be visible on single-monitor setups when the saved window geometry contains negative coordinates (e.g., "window_geometry": "798x305+-1062+424"). This happens when the configuration was saved on a multi-monitor setup and then used on a single-monitor system.
  - **Evidence:** GitHub user report: "Config file includes: 'window_geometry': '798x305+-1062+424', The negative number was causing the window to not show. I assume DEV has a multi-monitor setup."
  - **Files to Blame:** @gui_main_window.py
  - **Resolution:**
    - Added a comprehensive `_validate_window_geometry` method that validates and corrects window geometry on startup.
    - The method parses the geometry string and checks if the window position would be off-screen or invisible.
    - Negative coordinates are corrected to ensure at least 100 pixels of the window remain visible on screen.
    - Window size is validated to ensure minimum dimensions (400x300) for usability.
    - The validation process logs any corrections made to help users understand geometry changes.
    - If geometry validation fails, the application falls back to a safe default position (950x850+100+100).
    - This ensures the application window is always visible regardless of the monitor configuration where it was last used.

- **Fragile "Recording..." Status Logic:**

  - **Status:** FIXED
  - **Problem:** The logic to display the "Recording..." status assumes the currently recording file is always the first item in the list returned from the device, which is not a safe assumption.
  - **Evidence:** The `_refresh_file_list_thread` in `gui_actions_device.py` checks `recording_info[0].duration == "Recording..."` instead of identifying the recording file by its unique name.
  - **Files to Blame:** @gui_actions_device.py
  - **Resolution:**
    - Replaced the fragile array index-based logic with robust recording detection using `get_current_recording_filename()`.
    - The `_refresh_file_list_thread` now calls `get_current_recording_filename()` to get the actual name of the actively recording file.
    - The method iterates through the file list to find the file with the matching name and marks it as recording, regardless of its position in the list.
    - If the recording file is not found in the main file list, it's added to the beginning of the list with appropriate "Recording..." status.
    - Added proper error handling for cases where the recording filename cannot be retrieved.
    - The recording status detection is now independent of list order and more reliable.

- **Double-Click Playback Crashes with AttributeError:**

  - **Status:** FIXED
  - **Problem:** Double-clicking on a downloaded file to start playback crashes with `AttributeError: 'DesktopDeviceAdapter' object has no attribute 'device_interface'`. The error occurs in the double-click handler when trying to check device connection status.
  - **Evidence:** Console traceback shows the error in `gui_event_handlers.py` line 300: `if not self.device_manager.device_interface.device_interface.jensen_device.is_connected()` - this is accessing a non-existent nested `device_interface` attribute.
  - **Files to Blame:** @gui_event_handlers.py, @gui_auxiliary.py
  - **Resolution:**
    - Fixed incorrect attribute access patterns throughout the GUI code where `device_interface.device_interface` was being used instead of the correct single `device_interface`.
    - Updated multiple methods in `gui_event_handlers.py`: `_on_file_double_click`, `_on_delete_key_press`, `_on_enter_key_press`, `_on_f5_key_press`, and context menu creation.
    - Fixed device reference in `gui_auxiliary.py` for device settings and USB device scanning.
    - The architecture is: `self.device_manager.device_interface` points directly to the `DesktopDeviceAdapter`, so no double reference is needed.
    - Double-clicking on downloaded files now successfully starts playback without crashes.

- **Audio Playback Status and Controls Partially Fixed:**

  - **Status:** PARTIALLY FIXED
  - **Problem:** When audio is playing, there were multiple missing features: no indication in file status, play button not changing to stop, no playback controls, and visualization issues.
  - **Evidence:** User report with screenshots showing lack of visual feedback during playback.
  - **Files to Blame:** @audio_player.py
  - **Resolution (Partial):**
    - Fixed file status indication: Added forced treeview refresh in `_handle_playback_start` to ensure "Playing" status is visible in the file list.
    - The play button should now properly change to "Stop" during playback (existing logic was already correct).
    - Basic playback controls (time slider, volume, loop) are created during playback.
    - **Still needs work:** Waveform progress indicator and spectrum visualization are not working properly - these require more complex fixes to the audio visualization components.

- **Downloaded File Status Not Persisted Across Restarts:**

  - **Status:** FIXED
  - **Problem:** The application loses track of which files have been downloaded after restarting. All files show "On Device" status even if they were previously downloaded and are available in the download folder.
  - **Evidence:** User report: "tracking of which files are downloaded and which ones are not is lost... now on every restart of the application it always shows 'On Device' as if it is not downloaded, while the file is downloaded and available in the folder."
  - **Files to Blame:** @gui_actions_device.py
  - **Resolution:**
    - Added `_update_downloaded_file_status` method that checks the download directory for existing files during file list refresh.
    - The method scans for downloaded files and updates their `local_path` in the metadata cache.
    - Modified the file status determination logic to check if files exist locally and set "Downloaded" status accordingly.
    - Files that exist in the download directory now correctly show "Downloaded" status across application restarts.

- **No Visual Indication for Queued Downloads:**

  - **Status:** FIXED
  - **Problem:** Files queued for download have no visual indication in the file list. Users cannot see which files are waiting to be downloaded.
  - **Evidence:** User report: "The file queued for download is not properly marked as such. There is no indication that there is a file in queue."
  - **Files to Blame:** @gui_actions_device.py
  - **Resolution:**
    - Enhanced the file status determination logic to check active file operations from the FileOperationsManager.
    - Added "Queued" status for files with pending download operations.
    - Added "Downloading (X%)" status for files currently being downloaded with progress indication.
    - The file list now shows real-time status updates for queued and in-progress downloads.

- **UI Freezes During Download and Fails with Checksum Mismatch:**

  - **Status:** FIXED
  - **Problem:** When downloading a file, the entire application UI became unresponsive. After the download completed, it sometimes failed with a "Checksum mismatch" or similar validation error because the device communication protocol was desynchronized.
  - **Evidence:** User report and log snippets showing successful streaming followed by validation errors.
  - **Files to Blame:** @hidock_device.py, @file_operations_manager.py, @gui_actions_file.py
  - **Resolution:**
    - **Protocol Desync:** A latent bug in `hidock_device.py` was fixed. The `get_file_block` method incorrectly cleared the global USB receive buffer in its `finally` block. While this method may not have been directly used for downloads, this pattern is dangerous for any streaming command. The line `self.receive_buffer.clear()` was removed to prevent it from discarding data from subsequent USB packets, which would cause protocol desynchronization.
    - **UI Freeze:** The UI freeze was caused by progress update callbacks from the `FileOperationsManager`'s worker thread directly manipulating `tkinter` UI elements, which is not thread-safe. The fix was implemented in `gui_actions_file.py`:
      1. The `_update_operation_progress` callback now immediately schedules a new method, `_perform_gui_update_for_operation`, to run on the main GUI thread using `self.after(0, ...)`.
      2. The new `_perform_gui_update_for_operation` method contains all the original UI update logic (updating the status bar and treeview).
      3. Comparisons in the update logic were changed from using raw strings (e.g., `"in_progress"`) to using the `FileOperationStatus` enum for correctness and robustness.
         This ensures that all UI modifications happen safely on the main thread, keeping the application responsive during long operations like file downloads.

- **UI/UX Inconsistencies in File List:**

  - **Status:** FIXED
  - **Problem:** The file list display is not user-friendly. Size is in KB, duration is in raw seconds, and Date/Time are in separate columns.
  - **Evidence:** The `_populate_treeview_from_data` method in `gui_treeview.py` and `original_tree_headings` in `gui_main_window.py`.
  - **Files to Blame:** @gui_treeview.py, @gui_main_window.py, @file_operations_manager.py
  - **Resolution:**
    1. In `gui_main_window.py`, updated `original_tree_headings` to merge the "Date" and "Time" columns into a single "Date/Time" column and changed the units for "Size" to MB and "Duration" to a more readable format.
    2. Updated the default `treeview_columns_display_order` to reflect the new `datetime` column.
    3. The `_populate_treeview_from_data` method in `gui_treeview.py` was updated to format the values accordingly. Size is now calculated as `bytes / (1024*1024)`, duration is formatted as `hh:mm:ss` using `time.strftime`, and the date and time strings are concatenated.

- **Poor User Feedback During Connection:**

  - **Status:** FIXED
  - **Problem:** The application appeared to hang for 4-8 seconds after clicking "Connect". The status showed "Connecting..." and gave no feedback until the entire file list was loaded.
  - **Evidence:** The `_connect_device_thread` in `gui_actions_device.py` called `refresh_file_list_gui` immediately after connecting, with no intermediate UI update.
  - **Files to Blame:** @gui_actions_device.py, @gui_main_window.py
  - **Resolution:** Modified the `_connect_device_thread` in `gui_actions_device.py`. Upon a successful connection, it now immediately schedules a UI update to change the status bar to "Status: Connected, fetching file list...". This provides instant user feedback before the potentially slow file list refresh begins. The full status update still occurs after the file list is loaded.

- **`AttributeError` During File Download:**

  - **Status:** FIXED
  - **Problem:** Clicking the "Download" button triggers an `AttributeError: 'DeviceManager' object has no attribute 'download_file'`. This is due to an architectural mismatch between the new `FileOperationsManager` and the `DeviceManager`.
  - **Evidence:** The traceback originates in `file_operations_manager.py`'s `_execute_download` method. The call is `self.device_interface.download_file(...)`, but `self.device_interface` holds the `DeviceManager` object, not the adapter. Furthermore, the method name is wrong (`download_file` vs `download_recording`), and the new `download_recording` method is `async` and returns bytes, whereas the manager expects a synchronous call that writes to a file.
  - **Files to Blame:** @file_operations_manager.py, @gui_main_window.py
  - **Resolution:**
    1. Modified the `_execute_download` method in `file_operations_manager.py` to resolve the architectural mismatch.
    2. The method now correctly calls `self.device_interface.device_interface.download_recording()` to access the adapter's method through the manager.
    3. Since `download_recording` is an `async` method, it is now correctly invoked from the synchronous worker thread using `asyncio.run()`.
    4. A progress callback adapter was implemented to translate the detailed `OperationProgress` object from the device adapter into updates for the `FileOperation` object that the GUI's callback system expects.
    5. The `_execute_download` method now handles the `bytes` returned by the adapter and writes them to the local file, taking over the file-writing responsibility that was shifted away from the device layer in the new architecture.

- **Incorrect Storage Size Calculation and Display:**

  - **Status:** FIXED
  - **Problem:** The storage capacity is displayed with incorrect units. The GUI calculation incorrectly converts bytes to GB, resulting in a massively inflated number (e.g., `30507008.00 GB` instead of `~30.5 GB`).
  - **Evidence:** The `_update_all_status_info_thread` in `gui_main_window.py` receives capacity in bytes but performs an incorrect conversion (`capacity_bytes / 1024`) while labeling it "GB".
  - **Files to Blame:** @gui_main_window.py
  - **Resolution:**
    1. Modified the `_update_all_status_info_thread` method in `gui_main_window.py`.
    2. Renamed the misleading `used_mb` and `capacity_mb` variables to `used_bytes` and `capacity_bytes` for clarity.
    3. Corrected the conversion formulas. The logic now converts bytes to GB using `bytes / (1024*1024*1024)` and to MB using `bytes / (1024*1024)`.
    4. The logic now correctly displays the storage in GB if the total capacity is over 0.9 GB, and in MB otherwise, providing accurate and readable units.

- **App Unresponsive During Refresh:**

  - **Status:** `FIXED`
  - **Problem:** The application became unresponsive for several seconds during frequent, automatic file list refreshes. A periodic recording status check was using a "heavy" command (`list_files`) that re-downloaded the entire file list, blocking the UI.
  - **Evidence:** User reports of the UI freezing, and logs showing repeated, long-running `list_files` commands originating from the periodic status check.
  - **Files to Blame:** @gui_actions_device.py, @desktop_device_adapter.py, @device_interface.py
  - **Resolution:**
    1. Introduced a new, lightweight method `get_current_recording_filename` to the device interface, which only queries the active recording's name.
    2. Updated the periodic status check (`_check_recording_status_periodically`) to use this new lightweight method, eliminating the long-running operation.
    3. Fixed a redundant refresh on connect by ensuring the auto-refresh timer schedules its first run after the configured interval, rather than immediately.

- **Unstable Recording IDs:**

  - **Status:** `FIXED`
  - **Problem:** The `DesktopDeviceAdapter` generated file IDs based on their list order (e.g., `rec_0`, `rec_1`), which was unstable. If the list order changed, operations like delete or download would target the wrong file.
  - **Evidence:** The `get_recordings` method in `desktop_device_adapter.py` used `f"rec_{i}"` to create the ID.
  - **Files to Blame:** @desktop_device_adapter.py
  - **Resolution:** Modified the `get_recordings` method in `desktop_device_adapter.py` to use the filename as the stable `id` for each `AudioRecording` object. This ensures that all subsequent operations (download, delete) correctly reference the file by its unique filename, regardless of display order.

- **`KeyError: 'name'` in GUI File List:**

  - **Status:** `FIXED`
  - **Problem:** The application crashed with a `KeyError: 'name'` when populating the file list in the GUI. This was caused by a mismatch between the data structure provided by the backend (`FileMetadata` object with a `filename` attribute) and the data structure expected by the GUI's treeview (`dict` with a `name` key).
  - **Evidence:** The traceback provided by the user showed the `KeyError: 'name'` originating in `gui_treeview.py`'s `_populate_treeview_from_data` method, which was called from `gui_actions_device.py`.
  - **Files to Blame:** @gui_actions_device.py
  - **Resolution:** Modified the `_refresh_file_list_thread` in `gui_actions_device.py` to explicitly convert the list of `FileMetadata` objects into a list of dictionaries with the keys (`name`, `length`, etc.) that the GUI's treeview rendering code expects. This acts as a translation layer, resolving the data structure mismatch.

- **Recursive Health Check:**

  - **Status:** `FIXED`
  - **Problem:** The connection health check in `_perform_health_check` called `get_device_info`, which in turn called `_send_command`, which then called the health check again. This created a recursive loop that caused an immediate connection failure.
  - **Evidence:** The code in `hidock_device.py` showed `_perform_health_check` calling `get_device_info` without any flag or mechanism to prevent recursion.
  - **File to Blame:** @hidock_device.py
  - **Resolution:** Added a re-entrancy guard (`self._is_in_health_check`) to the `_perform_health_check` method. This flag prevents the method from calling itself indirectly through other functions (`get_device_info` -> `_send_command` -> `_perform_health_check`), thus breaking the recursive loop and stabilizing the connection process.

- **`AttributeError` on Connect due to missing `device_lock`:**

  - **Status:** `FIXED`
  - **Files to Blame:** @gui_main_window.py
  - **Resolution:** Added the initialization of `self.device_lock = threading.Lock()` to the `HiDockToolGUI.__init__` method. This attribute was being accessed by background threads (as part of the race condition fix) but was never created, causing a crash immediately upon trying to connect.

- **Spontaneous Disconnect / Race Condition:**

  - **Status:** `FIXED`
  - **Files to Blame:** @gui_main_window.py, @gui_actions_device.py
  - **Resolution:** Introduced a `threading.Lock` to serialize all access to the device from different background threads. The main background tasks (`_refresh_file_list_thread`, `_update_all_status_info_thread`) now use a blocking lock to ensure they complete their device I/O without interruption. The periodic recording status check (`_check_recording_status_periodically`) uses a non-blocking lock to prevent it from interfering with user-initiated actions, simply skipping a check if the device is busy. This prevents the race conditions that were leading to low-level USB errors and connection loss.

- **Endless Timeouts During File Listing:**

  - **Status:** `FIXED`
  - **File to Blame:** @hidock_device.py
  - **Resolution:** Implemented a consecutive timeout counter in the `list_files` method. The application now gracefully concludes the file list operation after a few successive timeouts, preventing the application from hanging.

- **`TypeError` in Status Update Thread:**

  - **Status:** `FIXED`
  - **Files to Blame:** @device_interface.py
  - **Resolution:** Added the `status_raw: int` attribute to the `StorageInfo` dataclass. The `DesktopDeviceAdapter` was passing this value from the low-level device call, but the dataclass was missing the field, causing a `TypeError`. The GUI in `gui_main_window.py` already expected this field to be present for displaying the raw storage status. This fix prevents the status update thread from crashing.

- **Log Flooding with Expected Timeouts:**
  - **Status:** `FIXED`
  - **File to Blame:** @hidock_device.py
  - **Resolution:** Modified the `_receive_response` method to no longer increment the error counter for expected timeouts during streaming operations (like file listing). This cleans up the log significantly and prevents false error inflation.
