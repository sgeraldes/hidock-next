"""
Configuration and Logging Management for the HiDock Tool.


This module handles the loading and saving of application settings from/to a
JSON configuration file (defined by `CONFIG_FILE_NAME` from `constants.py`).
It provides default settings if the configuration file is missing or corrupted.

It also defines a `Logger` class for standardized logging across the application.
The logger supports multiple levels (DEBUG, INFO, WARNING, ERROR, CRITICAL),
console output with ANSI color coding, and an optional callback for routing
logs to a GUI. A global `logger` instance is initialized and made available
for other modules to import and use.
"""

# config_and_logger.py
import json
import os
import sys
from datetime import datetime

# Import constants that might be needed for default config values
# or the config file name itself.
from constants import CONFIG_FILE_NAME, DEFAULT_PRODUCT_ID, DEFAULT_VENDOR_ID

# Get the directory where this script is located (src directory).
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Go up one level to the main hidock-desktop-app directory, then into config/
_APP_ROOT_DIR = os.path.dirname(_SCRIPT_DIR)
# Construct the absolute path to the config file in the config/ directory
_CONFIG_FILE_PATH = os.path.join(_APP_ROOT_DIR, "config", CONFIG_FILE_NAME)


# --- Configuration Management ---
def get_default_config() -> dict:
    """Returns the default configuration dictionary."""
    return {
        "autoconnect": False,
        "download_directory": os.path.join(_APP_ROOT_DIR, "..", "audio"),  # ../audio relative to hidock-desktop-app
        "log_level": "INFO",
        "selected_vid": DEFAULT_VENDOR_ID,  # From constants.py
        "selected_pid": DEFAULT_PRODUCT_ID,  # From constants.py
        "target_interface": 0,
        "recording_check_interval_s": 3,
        "default_command_timeout_ms": 5000,
        "file_stream_timeout_s": 180,
        "auto_refresh_files": False,
        "auto_refresh_interval_s": 30,
        "quit_without_prompt_if_connected": False,
        "appearance_mode": "System",
        "color_theme": "blue",
        "suppress_console_output": False,  # Deprecated - use enable_console_logging
        "suppress_gui_log_output": False,  # Deprecated - use enable_gui_logging
        "enable_console_logging": True,
        "enable_gui_logging": False,
        "window_geometry": "950x850+100+100",  # Default window size and position
        "treeview_columns_display_order": "name,size,duration,date,time,status",
        "logs_pane_visible": False,
        "gui_log_filter_level": "DEBUG",
        "loop_playback": False,
        "playback_volume": 0.5,
        "treeview_sort_col_id": "datetime",
        "treeview_sort_descending": True,
        "log_colors": {
            "ERROR": ["#FF6347", "#FF4747"],
            "WARNING": ["#FFA500", "#FFB732"],
            "INFO": ["#606060", "#A0A0A0"],
            "DEBUG": ["#202020", "#D0D0D0"],
            "CRITICAL": ["#DC143C", "#FF0000"],
        },
        "icon_theme_color_light": "black",
        "icon_theme_color_dark": "white",
        "icon_fallback_color_1": "blue",
        "icon_fallback_color_2": "default",
        "icon_size_str": "32",
        "calendar_chunking_period": "1 Week",
        "enable_file_logging": True,
        "log_file_path": "test_hidock.log",
        "log_file_max_size_mb": 10,
        "log_file_backup_count": 5,
        "console_log_level": "ERROR",  # Console only for ERROR and above
        "gui_log_level": "ERROR",  # GUI disabled by default
        "file_log_level": "INFO",  # File logs INFO and above
    }


def _validate_and_merge_config(defaults, loaded_config):
    """
    Validates loaded configuration values against expected types and merges with defaults.

    Args:
        defaults (dict): Default configuration with correct types
        loaded_config (dict): Configuration loaded from file

    Returns:
        dict: Validated and merged configuration
    """
    result = defaults.copy()

    # Define expected types for validation
    type_validators = {
        "autoconnect": bool,
        "auto_refresh_files": bool,
        "quit_without_prompt_if_connected": bool,
        "suppress_console_output": bool,
        "suppress_gui_log_output": bool,
        "logs_pane_visible": bool,
        "loop_playback": bool,
        "enable_file_logging": bool,
        "enable_console_logging": bool,
        "enable_gui_logging": bool,
        "log_file_max_size_mb": int,
        "log_file_backup_count": int,
        "console_log_level": lambda x: x in ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        "gui_log_level": lambda x: x in ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        "file_log_level": lambda x: x in ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        "selected_vid": int,
        "selected_pid": int,
        "target_interface": int,
        "recording_check_interval_s": int,
        "default_command_timeout_ms": int,
        "file_stream_timeout_s": int,
        "auto_refresh_interval_s": int,
        "playback_volume": (int, float),
        "treeview_sort_descending": bool,
        "log_level": lambda x: x in ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
        "appearance_mode": lambda x: x in ["Light", "Dark", "System"],
    }

    for key, value in loaded_config.items():
        if key in result:  # Only process known keys
            expected_type = type_validators.get(key)

            if expected_type is None:
                # No validation defined, use as-is
                result[key] = value
            elif callable(expected_type) and not isinstance(expected_type, type):
                # Custom validator function
                if expected_type(value):
                    result[key] = value
                else:
                    print(
                        f"[WARNING] ConfigManager::_validate_and_merge_config - "
                        f"Invalid value for {key}: {value}, using default: {result[key]}"
                    )
            elif isinstance(expected_type, tuple):
                # Multiple allowed types
                if isinstance(value, expected_type):
                    result[key] = value
                else:
                    print(
                        f"[WARNING] ConfigManager::_validate_and_merge_config - "
                        f"Invalid type for {key}: {type(value).__name__}, expected {expected_type}, "
                        f"using default: {result[key]}"
                    )
            elif expected_type == bool:
                # Special handling for boolean values
                if isinstance(value, bool):
                    result[key] = value
                elif isinstance(value, str):
                    # Try to convert string to boolean
                    if value.lower() in ["true", "1", "yes", "on"]:
                        result[key] = True
                    elif value.lower() in ["false", "0", "no", "off"]:
                        result[key] = False
                    else:
                        print(
                            f"[WARNING] ConfigManager::_validate_and_merge_config - "
                            f"Invalid boolean value for {key}: {value}, using default: {result[key]}"
                        )
                else:
                    print(
                        f"[WARNING] ConfigManager::_validate_and_merge_config - "
                        f"Invalid type for {key}: {type(value).__name__}, expected bool, "
                        f"using default: {result[key]}"
                    )
            elif isinstance(value, expected_type):
                result[key] = value
            else:
                print(
                    f"[WARNING] ConfigManager::_validate_and_merge_config - "
                    f"Invalid type for {key}: {type(value).__name__}, expected {expected_type.__name__}, "
                    f"using default: {result[key]}"
                )
        else:
            # Unknown key, add it anyway (for extensibility)
            result[key] = value

    return result


def load_config():
    """
    Loads application configuration from a JSON file.

    Tries to read the configuration from `CONFIG_FILE_NAME`. If the file
    is not found or if there's an error decoding the JSON, it falls
    back to a predefined default configuration. Always merges with defaults
    to ensure all required keys are present and validates data types.

    Returns:
        dict: A dictionary containing the application configuration.
    """
    defaults = get_default_config()

    try:
        with open(_CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
            loaded_config = json.load(f)
            # Merge loaded config with defaults, but validate data types
            validated_config = _validate_and_merge_config(defaults, loaded_config)
            return validated_config
    except FileNotFoundError:
        print(f"[INFO] ConfigManager::load_config - {_CONFIG_FILE_PATH} not found, using defaults.")
        return defaults
    except json.JSONDecodeError:
        print(f"[ERROR] ConfigManager::load_config - Error decoding {_CONFIG_FILE_PATH} Using defaults")
        return defaults


# Logger class definition (identical to the one in the original script)
class Logger:
    """
    A flexible logger for console, GUI, and file output with configurable levels.

    This logger supports different logging levels (DEBUG, INFO, WARNING, ERROR,
    CRITICAL), colored console output (on supported terminals), can route
    log messages to a GUI callback function, and can write logs to files with
    automatic rotation. Its behavior, such as log level, output suppression,
    and file logging settings, can be configured via a dictionary.
    """

    LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}
    COLOR_RED = "\033[91m"
    COLOR_YELLOW = "\033[93m"
    COLOR_GREY = "\033[90m"
    COLOR_WHITE = "\033[97m"
    COLOR_RESET = "\033[0m"

    def __init__(self, initial_config=None):
        """
        Initializes the Logger instance.

        Args:
            initial_config (dict, optional): A dictionary containing initial
                configuration for the logger, such as 'log_level',
                'suppress_console_output', 'suppress_gui_log_output',
                and file logging options including independent levels
                for console, GUI, and file outputs.
                Defaults to an empty dictionary if None.
        """
        self.gui_log_callback = None
        self.gui_callbacks = []  # Support for multiple GUI callbacks
        self.log_file = None
        # Use a copy of the initial_config for the logger
        # to avoid modifying the shared config dict directly by mistake
        self.config = initial_config.copy() if initial_config else {}
        self.set_level(self.config.get("log_level", "INFO"))
        self._setup_independent_levels()
        self._setup_file_logging()

    def set_gui_log_callback(self, callback):
        """
        Sets the callback function for routing log messages to a GUI.

        Args:
            callback (callable): A function that accepts two arguments:
                the log message string (str) and the log level string (str).
        """
        self.gui_log_callback = callback

    def add_gui_callback(self, callback):
        """
        Adds a GUI callback function for processing log messages.
        
        This allows multiple GUI components to receive log messages,
        enabling features like auto-show for critical messages.

        Args:
            callback (callable): A function that accepts five arguments:
                log_level (str), module (str), function (str), 
                message (str), formatted_message (str).
        """
        if callback not in self.gui_callbacks:
            self.gui_callbacks.append(callback)

    def remove_gui_callback(self, callback):
        """
        Removes a GUI callback function.

        Args:
            callback (callable): The callback function to remove.
        """
        if callback in self.gui_callbacks:
            self.gui_callbacks.remove(callback)

    def set_level(self, level_name):
        """
        Sets the minimum logging level for the logger (global fallback).

        This level is used as a fallback when independent levels are not set.
        Individual output levels (console, GUI, file) take precedence if configured.

        Args:
            level_name (str): The name of the log level (e.g., "INFO", "DEBUG").
                Case-insensitive. Defaults to "INFO" if invalid.
        """
        new_level_value = self.LEVELS.get(level_name.upper(), self.LEVELS["INFO"])
        current_level = getattr(self, "level", self.LEVELS["INFO"])
        self.level = new_level_value
        if new_level_value != current_level:  # Log only if level actually changed
            self._log(
                "info",
                "Logger",
                "set_level",
                f"Global log level set to {level_name.upper()}",
                force_level=self.LEVELS["INFO"],
            )

    def _setup_independent_levels(self):
        """
        Sets up independent log levels for console, GUI, and file outputs.
        Falls back to the global log_level if individual levels are not set.
        """
        fallback_level = self.config.get("log_level", "INFO")
        
        # Set individual levels, falling back to global level
        console_level_str = self.config.get("console_log_level", fallback_level)
        gui_level_str = self.config.get("gui_log_level", fallback_level)
        file_level_str = self.config.get("file_log_level", fallback_level)
        
        self.console_level = self.LEVELS.get(console_level_str.upper(), self.LEVELS["INFO"])
        self.gui_level = self.LEVELS.get(gui_level_str.upper(), self.LEVELS["INFO"])
        self.file_level = self.LEVELS.get(file_level_str.upper(), self.LEVELS["INFO"])
        
        # Log the configured levels
        self._log(
            "info",
            "Logger",
            "_setup_independent_levels",
            f"Independent levels - Console: {console_level_str.upper()}, GUI: {gui_level_str.upper()}, File: {file_level_str.upper()}",
            force_level=self.LEVELS["INFO"],
        )

    def _setup_file_logging(self):
        """
        Sets up file logging if enabled in configuration.
        """
        if not self.config.get("enable_file_logging", False):
            if self.log_file:
                self.log_file.close()
                self.log_file = None
            return

        log_file_path = self.config.get("log_file_path", "test_hidock.log")
        
        # Make path absolute if relative - place logs in the logs/ directory
        if not os.path.isabs(log_file_path):
            log_file_path = os.path.join(_APP_ROOT_DIR, "logs", log_file_path)
        
        # Rotate log file if it exists and exceeds max size
        self._rotate_log_file_if_needed(log_file_path)
        
        try:
            self.log_file = open(log_file_path, "a", encoding="utf-8")
            # Write a startup marker
            startup_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            self.log_file.write(f"\n=== Logger started at {startup_time} ===\n")
            self.log_file.flush()
        except IOError as e:
            # Fall back to console logging if file cannot be opened
            print(f"[ERROR] Logger::_setup_file_logging - Cannot open log file {log_file_path}: {e}")
            self.log_file = None

    def _rotate_log_file_if_needed(self, log_file_path):
        """
        Rotates log file if it exceeds maximum size.
        
        Args:
            log_file_path (str): Path to the log file
        """
        try:
            if not os.path.exists(log_file_path):
                return
            
            max_size_bytes = self.config.get("log_file_max_size_mb", 10) * 1024 * 1024
            backup_count = self.config.get("log_file_backup_count", 5)
            
            if os.path.getsize(log_file_path) >= max_size_bytes:
                # Close existing file handle if open
                if self.log_file:
                    self.log_file.close()
                    self.log_file = None
                
                # Rotate existing backup files
                for i in range(backup_count - 1, 0, -1):
                    old_file = f"{log_file_path}.{i}"
                    new_file = f"{log_file_path}.{i + 1}"
                    if os.path.exists(old_file):
                        if os.path.exists(new_file):
                            os.remove(new_file)
                        os.rename(old_file, new_file)
                
                # Move current log to .1
                backup_file = f"{log_file_path}.1"
                if os.path.exists(backup_file):
                    os.remove(backup_file)
                os.rename(log_file_path, backup_file)
        except OSError as e:
            print(f"[WARNING] Logger::_rotate_log_file_if_needed - Error rotating log file: {e}")

    def update_config(self, new_config_dict):
        """
        Updates the logger's internal configuration.

        Args:
            new_config_dict (dict): A dictionary with configuration keys
                to update (e.g., 'log_level', 'suppress_console_output',
                independent output levels).
        """
        # Ensure that the logger's internal config is updated carefully
        old_file_logging_enabled = self.config.get("enable_file_logging", False)
        self.config.update(new_config_dict)
        
        # Re-evaluate log levels if any level setting changed
        level_settings_changed = any(key in new_config_dict for key in [
            "log_level", "console_log_level", "gui_log_level", "file_log_level",
            "enable_console_logging", "enable_gui_logging"
        ])
        
        if level_settings_changed:
            if "log_level" in new_config_dict:
                self.set_level(new_config_dict["log_level"])
            self._setup_independent_levels()
            
        # Re-setup file logging if file logging settings changed
        new_file_logging_enabled = self.config.get("enable_file_logging", False)
        file_logging_settings_changed = any(key in new_config_dict for key in [
            "enable_file_logging", "log_file_path", "log_file_max_size_mb", "log_file_backup_count"
        ])
        
        if file_logging_settings_changed or old_file_logging_enabled != new_file_logging_enabled:
            self._setup_file_logging()

    def _log(self, level_str, module, procedure, message, force_level=None):
        """
        Internal logging method that handles message formatting and output.
        
        Now supports independent log levels for console, GUI, and file outputs.
        Each output type has its own threshold level that is checked independently.

        Args:
            level_str (str): The string representation of the log level (e.g., "info").
            module (str): The name of the module originating the log.
            procedure (str): The name of the function/method originating the log.
            message (str): The log message.
            force_level (int, optional): If provided, this level is used for the
                check instead of individual output levels. Useful for internal logger messages.
        """
        msg_level_val = self.LEVELS.get(level_str.upper())
        if msg_level_val is None:
            return

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        base_log_message = f"[{timestamp}][{level_str.upper()}] {str(module)}::{str(procedure)} - {message}"

        # Console output - check if enabled and meets level threshold
        console_threshold = force_level if force_level is not None else getattr(self, 'console_level', self.level)
        console_enabled = self.config.get("enable_console_logging", not self.config.get("suppress_console_output", False))
        if console_enabled and msg_level_val >= console_threshold:
            level_upper = level_str.upper()
            color_map = {
                "ERROR": self.COLOR_RED,
                "CRITICAL": self.COLOR_RED,
                "WARNING": self.COLOR_YELLOW,
                "INFO": self.COLOR_WHITE,
                "DEBUG": self.COLOR_GREY,
            }
            color = color_map.get(level_upper, self.COLOR_WHITE)
            console_message = f"{color}{base_log_message}{self.COLOR_RESET}"
            if level_upper in ["ERROR", "CRITICAL"]:
                sys.stderr.write(console_message + "\n")
                sys.stderr.flush()
            else:
                print(console_message)

        # GUI output - check if enabled and meets level threshold
        gui_threshold = force_level if force_level is not None else getattr(self, 'gui_level', self.level)
        gui_enabled = self.config.get("enable_gui_logging", not self.config.get("suppress_gui_log_output", False))
        if gui_enabled and msg_level_val >= gui_threshold:
            # Call the original GUI callback if set
            if self.gui_log_callback:
                self.gui_log_callback(base_log_message + "\n", level_str.upper())
            
            # Call all additional GUI callbacks (for auto-show functionality, etc.)
            for callback in self.gui_callbacks:
                try:
                    callback(level_str.upper(), module, procedure, message, base_log_message)
                except Exception as e:
                    # Avoid recursive logging issues by using print for callback errors
                    print(f"[WARNING] Logger::_log - Error in GUI callback: {e}")
        
        # File output - check individual file level or force_level
        file_threshold = force_level if force_level is not None else getattr(self, 'file_level', self.level)
        if (self.log_file and 
            self.config.get("enable_file_logging", False) and 
            msg_level_val >= file_threshold):
            try:
                self.log_file.write(base_log_message + "\n")
                self.log_file.flush()
            except IOError as e:
                # If file write fails, disable file logging to prevent spam
                print(f"[ERROR] Logger::_log - Failed to write to log file: {e}")
                if self.log_file:
                    self.log_file.close()
                    self.log_file = None

    def info(self, module, procedure, message):
        """Logs a message with INFO level."""
        self._log("info", module, procedure, message)

    def debug(self, module, procedure, message):
        """Logs a message with DEBUG level."""
        self._log("debug", module, procedure, message)

    def error(self, module, procedure, message):
        """Logs a message with ERROR level."""
        self._log("error", module, procedure, message)

    def warning(self, module, procedure, message):
        """Logs a message with WARNING level."""
        self._log("warning", module, procedure, message)

    def critical(self, module, procedure, message):
        """Logs a message with CRITICAL level."""
        self._log("critical", module, procedure, message)

    def close(self):
        """
        Closes the log file if it's open.
        """
        if self.log_file:
            try:
                self.log_file.close()
            except IOError:
                pass  # Ignore errors during cleanup
            finally:
                self.log_file = None

    def __del__(self):
        """
        Ensures log file is closed when logger is destroyed.
        """
        self.close()


# --- Global Logger Instance ---

# The logger needs the initial config to set its level and suppression flags.
# This config is loaded once here. Other modules will import the 'logger' instance.
_initial_app_config = load_config()  # pylint: disable=invalid-name
logger = Logger(initial_config=_initial_app_config)  # pylint: disable=invalid-name


# --- Save Configuration Functions ---
# save_config: Saves configuration data, merging with existing settings to preserve others
# update_config_settings: Alias for save_config (both now preserve existing settings)


def save_config(config_data_to_save):
    """
    Saves the provided configuration data to a JSON file.

    This function now merges the provided config with existing settings
    to prevent overwriting other settings that weren't included in the
    config_data_to_save parameter.

    Uses `CONFIG_FILE_NAME` for the output file. Logs success or errors
    using the global `logger` instance.

    Args:
        config_data_to_save (dict): The configuration dictionary to save.
    """
    try:
        # Load existing config to preserve all settings
        try:
            with open(_CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                existing_config = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            # If file doesn't exist or is corrupted, start with defaults
            existing_config = get_default_config()

        # Merge new settings with existing ones (new settings take precedence)
        merged_config = existing_config.copy()
        merged_config.update(config_data_to_save)

        # Save the merged configuration
        with open(_CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(merged_config, f, indent=4)

        # Log what specific settings were saved
        settings_list = ", ".join([f"{k}={v}" for k, v in config_data_to_save.items()])
        logger.info(
            "ConfigManager",
            "save_config",
            f"Saved {len(config_data_to_save)} setting(s): {settings_list}",
        )
    except IOError:
        logger.error("ConfigManager", "save_config", f"Error writing to {_CONFIG_FILE_PATH}.")
    except Exception as e:  # pylint: disable=broad-except
        logger.error("ConfigManager", "save_config", f"Unexpected error saving config: {e}")


def update_config_settings(settings_to_update):
    """
    Updates specific settings in the configuration file without overwriting other settings.
    
    This function saves the settings to the config file and also updates the global
    logger instance with the new configuration.

    Args:
        settings_to_update (dict): Dictionary containing only the settings to update.
    """
    save_config(settings_to_update)
    # Also update the global logger with the new settings
    logger.update_config(settings_to_update)
