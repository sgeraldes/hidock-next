# Test Coverage Improvement Plan for hidock-desktop-app

## 1. Introduction

This document outlines a plan to increase the test coverage of the `hidock-desktop-app` to at least 80%. The focus will be on testing the most critical features of the application to ensure its stability and reliability.

## 2. Current State

The current test coverage is unknown. The first step is to measure the current test coverage to identify the areas that need the most attention.

## 3. Scope & Detailed Plan

The scope of this plan is to improve the test coverage of the following modules. Each module has a detailed checklist of tests to be implemented.

### `audio_player.py`

**Note on Testability:** This module, in its current form as a `Mixin`, is tightly coupled with the main GUI window, making it difficult to unit test. To enable effective testing, it is highly recommended to refactor it first. The core audio playback logic (interacting with `pygame`) should be extracted into a separate, UI-agnostic class (`AudioPlayer`). This new class would use callbacks to communicate state changes (e.g., `on_progress`, `on_stop`) to the GUI layer. The tests below are designed for such a refactored, testable architecture.

#### `AudioPlayer` (Proposed new class for core logic)

This class encapsulates all direct interaction with `pygame.mixer`. It should be initializable and not depend on a GUI.

- **Initialization:**
  - [ ] Test that `AudioPlayer` initializes correctly with mock callbacks.
  - [ ] Test that it handles the case where `pygame` is not available or not initialized, possibly by raising an exception or entering a disabled state.
- **Playback Control:**
  - [ ] Test `play()` with a valid file path successfully loads and starts the audio.
  - [ ] Test `play()` calls the `on_start` callback.
  - [ ] Test `play()` fails gracefully with an invalid file path (e.g., `pygame.error`), and calls an `on_error` callback.
  - [ ] Test `stop()` successfully stops playback and calls the `on_stop` callback.
  - [ ] Test `set_volume()` correctly calls `pygame.mixer.music.set_volume()`.
  - [ ] Test `seek()` correctly calls `pygame.mixer.music.set_pos()`.
  - [ ] Test `seek()` handles `pygame.error` during the seek operation.
- **Progress and State Reporting:**
  - [ ] Test that the `on_progress` callback is triggered periodically during playback with the correct time.
  - [ ] Test that when playback finishes naturally, the `on_end` callback is triggered.
  - [ ] Test that if looping is enabled, playback restarts instead of calling `on_end`.
  - [ ] Test that properties like `is_playing` and `current_position` return the correct state from `pygame`.

#### `AudioPlayerMixin` (The refactored GUI layer)

This mixin orchestrates the UI based on user actions and callbacks from the `AudioPlayer`.

- **User Actions:**
  - [ ] Test `play_selected_audio_gui()` when no file is selected (shows info message).
  - [ ] Test `play_selected_audio_gui()` when multiple files are selected (shows info message).
  - [ ] Test `play_selected_audio_gui()` when audio is already playing (calls `audio_player.stop()`).
  - [ ] Test `play_selected_audio_gui()` with a local file (calls `audio_player.play()` with the correct path).
  - [ ] Test `play_selected_audio_gui()` with a remote file (initiates the download process).
- **Download Logic (`_download_for_playback_thread`):**
  - [ ] Test successful download: the file is saved, and the `on_success` callback (which would then call `audio_player.play()`) is invoked.
  - [ ] Test download failure (e.g., `ConnectionError`): the `on_error` callback is invoked, and a message is shown to the user.
  - [ ] Test that temporary files (`.tmp`) are correctly renamed on success and cleaned up on failure.
- **UI Updates (Callbacks from `AudioPlayer`):**
  - [ ] Test that the `on_start` callback creates the playback controls (`_create_playback_controls`).
  - [ ] Test that calling `_create_playback_controls` again does not create duplicate widgets.
  - [ ] Test that the `on_stop` or `on_end` callback destroys the playback controls (`_destroy_playback_controls`).
  - [ ] Test that calling `_destroy_playback_controls` when controls are already gone does not raise an error.
  - [ ] Test that the `on_progress` callback updates the playback slider and time labels.
  - [ ] Test that the `on_progress` callback does _not_ update the slider position if the user is dragging it.
- **UI Controls Interaction:**
  - [ ] Test `_on_playback_slider_drag` updates the time label correctly.
  - [ ] Test `_on_slider_release()` calls `audio_player.seek()` with the correct value.
  - [ ] Test `_on_volume_change()` calls `audio_player.set_volume()` with the correct value.
  - [ ] Test that checking the "Loop" checkbox correctly configures the `AudioPlayer`.

### `audio_processing_advanced.py`

- [ ] Test `AudioProcessingSettings` initialization with default values.
- [ ] Test `AudioProcessingSettings` initialization with custom values.
- [ ] Test `ProcessingResult` initialization with default values.
- [ ] Test `ProcessingResult` initialization with custom values.
- [ ] Test `AudioEnhancer` initialization with default settings.
- [ ] Test `AudioEnhancer` initialization with custom settings.
- [ ] Test `AudioEnhancer.cleanup_temp_files` when temp files exist.
- [ ] Test `AudioEnhancer.cleanup_temp_files` when no temp files exist.
- [ ] Test `AudioEnhancer.process_audio_file` with a valid audio file and default settings.
- [ ] Test `AudioEnhancer.process_audio_file` with a valid audio file and custom settings (e.g., noise reduction, normalization).
- [ ] Test `AudioEnhancer.process_audio_file` with an invalid input path.
- [ ] Test `AudioEnhancer.process_audio_file` with a progress callback.
- [ ] Test `AudioEnhancer._load_audio` with a valid WAV file.
- [ ] Test `AudioEnhancer._load_audio` with a valid audio file (librosa path).
- [ ] Test `AudioEnhancer._load_audio` with an unsupported file format.
- [ ] Test `AudioEnhancer._load_audio` with a non-existent file.
- [ ] Test `AudioEnhancer._save_audio` with valid audio data (soundfile path).
- [ ] Test `AudioEnhancer._save_audio` with valid audio data (scipy fallback).
- [ ] Test `AudioEnhancer._save_audio` with an invalid output path.
- [ ] Test `AudioEnhancer._analyze_audio` with a simple audio array.
- [ ] Test `AudioEnhancer._analyze_audio` with an empty audio array.
- [ ] Test `AudioEnhancer._reduce_noise` when `noisereduce` is available and strength > 0.
- [ ] Test `AudioEnhancer._reduce_noise` when `noisereduce` is not available (falls back to spectral subtraction).
- [ ] Test `AudioEnhancer._reduce_noise` with strength = 0.
- [ ] Test `AudioEnhancer._spectral_subtraction` with a basic audio array.
- [ ] Test `AudioEnhancer._remove_silence` with silence present.
- [ ] Test `AudioEnhancer._remove_silence` with no silence.
- [ ] Test `AudioEnhancer._remove_silence` with very short speech segments.
- [ ] Test `AudioEnhancer._enhance_audio_quality` with default settings.
- [ ] Test `AudioEnhancer._enhance_audio_quality` with `HIGH_QUALITY` setting (de-emphasis).
- [ ] Test `AudioEnhancer._apply_compression` with audio above threshold.
- [ ] Test `AudioEnhancer._apply_compression` with audio below threshold.
- [ ] Test `AudioEnhancer._apply_deemphasis` with a sample audio.
- [ ] Test `AudioEnhancer._normalize_audio` with positive RMS.
- [ ] Test `AudioEnhancer._normalize_audio` with zero RMS.
- [ ] Test `AudioEnhancer.convert_format` with pydub available (resampling, bit depth).
- [ ] Test `AudioEnhancer.convert_format` with pydub unavailable (basic conversion).
- [ ] Test `AudioEnhancer.convert_format` with unsupported target format.
- [ ] Test `AudioEnhancer.batch_process` with multiple valid files.
- [ ] Test `AudioEnhancer.batch_process` with a mix of valid and invalid files.
- [ ] Test `AudioEnhancer.batch_process` with a progress callback.
- [ ] Test `AudioFormatConverter` initialization.
- [ ] Test `AudioFormatConverter.convert` with pydub available (MP3 conversion, different qualities).
- [ ] Test `AudioFormatConverter.convert` with pydub available (OGG conversion, different qualities).
- [ ] Test `AudioFormatConverter.convert` with pydub unavailable (basic WAV conversion).
- [ ] Test `AudioFormatConverter.convert` with unsupported target format.
- [ ] Test `AudioFormatConverter.get_supported_formats`.
- [ ] Test `AudioFormatConverter.cleanup_temp_files`.
- [ ] Test `enhance_audio_file` convenience function.
- [ ] Test `convert_audio_format` convenience function.
- [ ] Test `get_audio_analysis` convenience function.

### `device_interface.py`

- [ ] Mock the hardware communication (`usb.core`).
- [ ] Test `find_device` when a device is present and absent.
- [ ] Test `read_data` from the mocked device.
- [ ] Test `write_data` to the mocked device.
- [ ] Test handling of device connection errors (`usb.core.USBError`).
- [ ] Test handling of device disconnection during an operation.

### `file_operations_manager.py`

- [ ] Test `save_file` successfully.
- [ ] Test `load_file` successfully.
- [ ] Test `delete_file` successfully.
- [ ] Test `load_file` for a non-existent file (should raise `FileNotFoundError`).
- [ ] Test file operations with permission errors (mock `os` functions to raise `PermissionError`).
- [ ] Test saving and loading various supported file formats.

### `gui_main_window.py`

- [ ] Test `MainWindow` initialization and UI element creation (mock `customtkinter`).
- [ ] Test that button click events call the correct backend logic (e.g., `play_button` calls `audio_player.play_audio`).
- [ ] Test UI state changes in response to application events (e.g., a "recording" label appears when recording starts).
- [ ] Test the file selection dialog logic (mock `filedialog`).

### `hidock_device.py`

- [ ] Test `HiDockDevice` initialization.
- [ ] Test `get_device_status` (e.g., 'connected', 'disconnected', 'recording').
- [ ] Test `start_recording` and `stop_recording` state transitions.
- [ ] Test `get_recording` to retrieve audio data.
- [ ] Test error handling when the device is not connected.

### `main.py`

- [ ] Test the main application setup.
- [ ] Test argument parsing if command-line arguments are implemented.
- [ ] Test that the `App` class is instantiated and the `mainloop` is called.
- [ ] Test graceful shutdown and resource cleanup.

### `transcription_module.py`

- [ ] Test `transcribe_audio` with a sample audio file.
- [ ] Test with different audio formats (e.g., WAV, MP3).
- [ ] Mock the transcription service API to test:
  - [ ] Successful transcription.
  - [ ] API errors (e.g., network issues, authentication failure).
  - [ ] Empty or invalid responses from the API.
- [ ] Test the format and correctness of the returned transcription text.

## 4. Strategy

The following strategies will be used to improve test coverage:

- **Unit Tests:** Write unit tests for individual functions and classes to ensure they work as expected.
- **Integration Tests:** Write integration tests to verify that the different modules of the application work together correctly.
- **Mocking:** Use mocking to isolate the code under test from its dependencies, such as the GUI, hardware, and external services.
- **Atomic Tests:** Each checklist item corresponds to a single, focused test function. A test function should verify one specific aspect of the code's behavior or state.
- **Acceptance of Failure:** Tests are written to verify correctness. A test that fails indicates a potential issue in the software and is an acceptable outcome during the test creation phase. The goal is not to make tests pass immediately, but to accurately reflect the software's behavior.
- **Minimal Setup:** Test setup (mocking, data preparation) should be as minimal as possible, only including what is strictly necessary for the specific test function to run. Avoid over-mocking or setting up complex environments for simple checks.

## 5. Plan

The following steps will be taken to improve test coverage:

1. **Measure Current Test Coverage:**
   - Run `pytest --cov=src --cov-report=term-missing` to get a baseline of the current test coverage.
2. **Prioritize Modules:**
   - Prioritize the modules to be tested based on their importance and complexity. The modules listed in the "Scope" section are a good starting point.
3. **Write Unit Tests:**
   - Write unit tests for each function and class in the prioritized modules.
   - Focus on testing the business logic and edge cases.
4. **Write Integration Tests:**
   - Write integration tests to verify the interaction between the different modules.
   - For example, test the integration between the `device_interface.py` and the `hidock_device.py` modules.
5. **Mock Dependencies:**
   - Use the `unittest.mock` library to mock dependencies, such as the GUI and hardware.
   - This will allow for testing the business logic in isolation.
6. **Review and Refactor:**
   - Review the existing tests to ensure they are effective and maintainable.
   - Refactor the code as needed to improve its testability.
7. **Track Progress:**
   - Regularly run the test coverage report to track progress towards the 80% goal.

## 6. Tools

The following tools will be used to improve test coverage:

- **pytest:** A testing framework for Python.
- **pytest-cov:** A pytest plugin for measuring code coverage.
- **unittest.mock:** A library for mocking objects in Python.

## 7. Success Criteria

The success of this plan will be measured by the following criteria:

- The test coverage of the `hidock-desktop-app` is at least 80%.
- The number of bugs found in the application is reduced.
- The stability and reliability of the application are improved.
