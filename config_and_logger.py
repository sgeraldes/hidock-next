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
from constants import DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID, CONFIG_FILE_NAME


# --- Configuration Management ---
def load_config():
    """
    Loads application configuration from a JSON file.

    Tries to read the configuration from `CONFIG_FILE_NAME`. If the file
    is not found or if there's an error decoding the JSON, it falls
    back to a predefined default configuration.

    Returns:
        dict: A dictionary containing the application configuration.
    """
    try:
        with open(CONFIG_FILE_NAME, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[INFO] ConfigManager::load_config - {CONFIG_FILE_NAME} not found, using defaults.")
        # Default configuration, this is where many "variables" or default settings reside
        return {
            "autoconnect": False,
            "download_directory": os.getcwd(),
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
            "suppress_console_output": False,
            "suppress_gui_log_output": False,
            "window_geometry": "950x850+100+100",  # Default window size and position
            "treeview_columns_display_order": "name,size,duration,date,time,status",
            "logs_pane_visible": False,
            "gui_log_filter_level": "DEBUG",
            "loop_playback": False,
            "playback_volume": 0.5,
            "treeview_sort_col_id": "time",
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
        }
    except json.JSONDecodeError:
        print(
            f"[ERROR] ConfigManager::load_config - Error decoding {CONFIG_FILE_NAME} Using defaults"
        )
        # Return defaults on decode error as well
        # For simplicity, calling load_config() again will hit FileNotFoundError if file is corrupt
        # or just returning the default dict here.
        return {
            "autoconnect": False,
            "download_directory": os.getcwd(),
            "log_level": "INFO",
            "selected_vid": DEFAULT_VENDOR_ID,
            "selected_pid": DEFAULT_PRODUCT_ID,
            "target_interface": 0,
            "recording_check_interval_s": 3,
            "default_command_timeout_ms": 5000,
            "file_stream_timeout_s": 180,
            "auto_refresh_files": False,
            "auto_refresh_interval_s": 30,
            "quit_without_prompt_if_connected": False,
            "appearance_mode": "System",
            "color_theme": "blue",
            "suppress_console_output": False,
            "suppress_gui_log_output": False,
            "window_geometry": "950x850+100+100",
            "treeview_columns_display_order": "name,size,duration,date,time,status",
            "logs_pane_visible": False,
            "gui_log_filter_level": "DEBUG",
            "loop_playback": False,
            "playback_volume": 0.5,
            "treeview_sort_col_id": "time",
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
        }


# Logger class definition (identical to the one in the original script)
class Logger:
    """

    A flexible logger for console and GUI output with configurable levels.

    This logger supports different logging levels (DEBUG, INFO, WARNING, ERROR,
    CRITICAL), colored console output (on supported terminals), and can route
    log messages to a GUI callback function. Its behavior, such as log level
    and output suppression, can be configured via a dictionary.
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
                'suppress_console_output', and 'suppress_gui_log_output'.
                Defaults to an empty dictionary if None.
        """
        self.gui_log_callback = None
        # Use a copy of the initial_config for the logger
        # to avoid modifying the shared config dict directly by mistake
        self.config = initial_config.copy() if initial_config else {}
        self.set_level(self.config.get("log_level", "INFO"))

    def set_gui_log_callback(self, callback):
        """
        Sets the callback function for routing log messages to a GUI.

        Args:
            callback (callable): A function that accepts two arguments:
                the log message string (str) and the log level string (str).
        """
        self.gui_log_callback = callback

    def set_level(self, level_name):
        """
        Sets the minimum logging level for the logger.

        Messages with a level lower than this will be ignored.

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
                f"Log level set to {level_name.upper()}",
                force_level=self.LEVELS["INFO"],
            )

    def update_config(self, new_config_dict):
        """
        Updates the logger's internal configuration.

        Args:
            new_config_dict (dict): A dictionary with configuration keys
                to update (e.g., 'log_level', 'suppress_console_output').
        """
        # Ensure that the logger's internal config is updated carefully
        self.config.update(new_config_dict)
        # Potentially re-evaluate log level if "log_level" is in new_config_dict
        if "log_level" in new_config_dict:
            self.set_level(new_config_dict["log_level"])

    def _log(self, level_str, module, procedure, message, force_level=None):
        """
        Internal logging method that handles message formatting and output.

        Args:
            level_str (str): The string representation of the log level (e.g., "info").
            module (str): The name of the module originating the log.
            procedure (str): The name of the function/method originating the log.
            message (str): The log message.
            force_level (int, optional): If provided, this level is used for the
                check instead of `self.level`. Useful for internal logger messages.
        """
        msg_level_val = self.LEVELS.get(level_str.upper())
        effective_level_check = force_level if force_level is not None else self.level

        if msg_level_val is None or msg_level_val < effective_level_check:
            return

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        base_log_message = (
            f"[{timestamp}][{level_str.upper()}] {str(module)}::{str(procedure)} - {message}"
        )

        if not self.config.get("suppress_console_output", False):
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

        if self.gui_log_callback:
            # Check the suppress_gui_log_output flag from its own config
            if not self.config.get("suppress_gui_log_output", False):
                self.gui_log_callback(base_log_message + "\n", level_str.upper())

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


# --- Global Logger Instance ---

# The logger needs the initial config to set its level and suppression flags.
# This config is loaded once here. Other modules will import the 'logger' instance.
_initial_app_config = load_config()  # pylint: disable=invalid-name
logger = Logger(initial_config=_initial_app_config)  # pylint: disable=invalid-name


# --- Save Configuration Function ---
# This function will be called by the GUI or other parts to save the config.
# It should take the *current* application config dictionary as an argument.

def save_config(config_data_to_save):
    """
    Saves the provided configuration data to a JSON file.

    Uses `CONFIG_FILE_NAME` for the output file. Logs success or errors
    using the global `logger` instance.

    Args:
        config_data_to_save (dict): The configuration dictionary to save.
    """
    try:
        with open(CONFIG_FILE_NAME, "w", encoding="utf-8") as f:
            json.dump(config_data_to_save, f, indent=4)
        # Use the global logger instance to log this action
        logger.info("ConfigManager", "save_config", f"Configuration saved to {CONFIG_FILE_NAME}")
    except IOError:
        logger.error("ConfigManager", "save_config", f"Error writing to {CONFIG_FILE_NAME}.")
    except Exception as e:  # pylint: disable=broad-except
        logger.error("ConfigManager", "save_config", f"Unexpected error saving config: {e}")
