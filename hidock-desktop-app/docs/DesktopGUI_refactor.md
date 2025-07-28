# Desktop GUI Refactoring Plan

This document outlines the plan to refactor the `gui_main_window.py` file into smaller, more manageable modules. The goal is to improve code organization, maintainability, and readability.

## Refactoring Strategy

The main `gui_main_window.py` file will be broken down into several mixin classes, each responsible for a specific set of functionalities. The main `HiDockToolGUI` class will then inherit from these mixins to compose the complete GUI application.

### Mixin Modules

The following mixin modules will be created:

- **`audio_player.py`**: Handles all audio playback functionalities, including loading, playing, stopping, and managing playback controls.
- **`gui_treeview.py`**: Manages the file list treeview, including creating, populating, sorting, and styling the treeview.
- **`gui_actions_device.py`**: Contains methods for handling direct device communication actions like connecting, disconnecting, refreshing file lists, and other device-specific commands.
- **`gui_actions_file.py`**: Provides methods for handling file operations such as downloading, deleting, and transcribing.
- **`gui_auxiliary.py`**: Includes helper methods for handling the settings dialog, GUI logging, and other auxiliary functions.
- **`gui_event_handlers.py`**: Manages GUI events such as button clicks, key presses, and selection changes.

### Main Application File

The `gui_main_window.py` file will be updated to:

- Import all the mixin classes.
- Inherit from the mixin classes in the `HiDockToolGUI` class definition.
- Remove all the methods that have been moved to the mixin modules.

The `gui_main_window.py` file's main job will be to assemble all the modular pieces (the mixins) and manage the application's lifecycle. It should remain clean and free of specific data-massaging logic for device quirks.
