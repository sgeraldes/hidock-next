# gui_main_window.py
"""
Main GUI Window for the HiDock Explorer Tool.

This module defines the `HiDockToolGUI` class, which creates and manages
the main application window using customtkinter. It handles user interactions,
displays device information and files, and orchestrates operations like
file download, playback, and device settings management by interacting with
the `HiDockJensen` (device communication) and `SettingsDialog` classes,
as well as configuration and logging utilities.

The GUI provides a menubar, toolbar, file list (Treeview), status bar,
and optional log pane.
"""

import asyncio

# import json  # Commented out - not used in current implementation
import os
import subprocess
import sys

# import tempfile  # Commented out - not used in current implementation
import threading
import time
import tkinter
import traceback

# from datetime import datetime  # Currently unused - may be needed for future timestamp features
from tkinter import messagebox, ttk  # Removed filedialog - not used

import customtkinter as ctk
import numpy as np

# import usb.core  # Commented out - not used in current implementation
from PIL import Image, ImageTk, UnidentifiedImageError

from async_calendar_mixin import AsyncCalendarMixin
from audio_metadata_mixin import AudioMetadataMixin
from audio_player_enhanced import EnhancedAudioPlayer

# from audio_processing_advanced import AudioEnhancer  # Future: audio enhancement
from audio_visualization import AudioVisualizationWidget
from calendar_filter_engine import CalendarFilterEngine
from calendar_search_widget import CalendarSearchWidget

# Import Logger class for type hints if any
from config_and_logger import Logger, load_config, logger

# Import from our other modules
from constants import DEFAULT_PRODUCT_ID, DEFAULT_VENDOR_ID

# from ctk_custom_widgets import CTkBanner  # Commented out - not used
from desktop_device_adapter import DesktopDeviceAdapter
from device_interface import DeviceManager
from file_operations_manager import FileOperationsManager
from gui_actions_device import DeviceActionsMixin
from gui_actions_file import FileActionsMixin
from gui_auxiliary import AuxiliaryMixin
from gui_event_handlers import EventHandlersMixin
from gui_treeview import TreeViewMixin
from status_filter_widget import StatusFilterWidget
from toast_notification import ToastManager

# from settings_window import SettingsDialog  # Commented out - not used directly
# from storage_management import StorageMonitor, StorageOptimizer  # Future: storage features
from transcription_module import process_audio_file_for_insights
from unified_filter_widget import UnifiedFilterWidget


class HiDockToolGUI(
    ctk.CTk,
    TreeViewMixin,
    DeviceActionsMixin,
    FileActionsMixin,
    AuxiliaryMixin,
    EventHandlersMixin,
    AsyncCalendarMixin,
    AudioMetadataMixin,
):
    """
    Main application window for the HiDock Explorer Tool.

    This class initializes the main GUI, including widgets for device interaction,
    file management, audio playback, and application settings. It handles
    USB backend initialization, device connection/disconnection, and updates
    the UI based on device status and user actions.

    Attributes:
        config (dict): Application configuration loaded from file.
        dock (HiDockJensen): Instance for communicating with the HiDock device.
        icons (dict): Stores CTkImage objects for GUI elements.
        menu_icons (dict): Stores tkinter.PhotoImage objects for the menubar.
        various ctk.Variable instances: For managing GUI state and settings.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.config = load_config()

        self.title("HiDock Explorer Tool")
        try:
            saved_geometry = self.config.get("window_geometry", "950x850+100+100")
            validated_geometry = self._validate_window_geometry(saved_geometry)
            self.geometry(validated_geometry)
        except tkinter.TclError as e:
            logger.warning(
                "GUI",
                "__init__",
                f"Failed to apply saved geometry: {e}. Using default.",
            )
            self.geometry("950x850+100+100")

        # Make the icon path relative to the root directory (parent of src/)
        script_dir = os.path.dirname(os.path.abspath(__file__))
        root_dir = os.path.dirname(script_dir)  # Go up from src/ to root
        self.icon_base_path = os.path.join(root_dir, "icons")
        self.icon_display_size = (20, 20)

        self.usb_backend_instance = None
        self.backend_initialized_successfully = False
        self.backend_init_error_message = "USB backend not yet initialized."
        try:
            (
                self.backend_initialized_successfully,
                self.backend_init_error_message,
                self.usb_backend_instance,
            ) = self._initialize_backend_early()
            if not self.backend_initialized_successfully:
                logger.error(
                    "GUI",
                    "__init__",
                    f"CRITICAL: USB backend init failed: {self.backend_init_error_message}",
                )
        except Exception as e_backend_startup:
            self.backend_initialized_successfully = False
            self.backend_init_error_message = f"Unexpected Python error during USB backend init: {e_backend_startup}"
            logger.error(
                "GUI",
                "__init__",
                f"CRITICAL: {self.backend_init_error_message}\n{traceback.format_exc()}",
            )

        self._initialize_vars_from_config()

        self.device_adapter = DesktopDeviceAdapter(self.usb_backend_instance)
        self.device_manager = DeviceManager(self.device_adapter)

        # Initialize device lock before file operations manager
        self.device_lock = threading.Lock()
        self._abort_file_operations = False  # Flag to abort file operations on disconnect

        self.file_operations_manager = FileOperationsManager(
            self.device_manager,
            self.download_directory,
            os.path.join(os.path.expanduser("~"), ".hidock", "cache"),
            device_lock=self.device_lock,
        )

        # Initialize offline mode manager
        from offline_mode_manager import OfflineModeManager

        self.offline_mode_manager = OfflineModeManager(self.file_operations_manager, self.download_directory)

        self.audio_player = EnhancedAudioPlayer(self)

        self.available_usb_devices = []
        self.displayed_files_details = []
        self.treeview_sort_column = self.saved_treeview_sort_column
        self.treeview_sort_reverse = self.saved_treeview_sort_reverse
        self._recording_check_timer_id = None
        self._auto_file_refresh_timer_id = None
        self._is_ui_refresh_in_progress = False
        self._previous_recording_filename = None
        self.is_long_operation_active = False
        self.cancel_operation_event = None
        self.active_operation_name = None
        self.is_audio_playing = False
        self.current_playing_temp_file = None
        self.current_playing_filename_for_replay = None
        self.playback_update_timer_id = None
        self._user_is_dragging_slider = False
        self.playback_total_duration = 0.0
        self.playback_controls_frame = None
        self._is_button1_pressed_on_item = None
        self.download_queue = []
        self.total_files_in_batch = 0
        self.completed_files_in_batch = 0
        self.batch_start_time = None
        self._connection_error_banner = None
        self._last_dragged_over_iid = None
        self._drag_action_is_deselect = False
        self.default_progressbar_fg_color = None
        self._status_update_in_progress = False
        self.default_progressbar_progress_color = None
        self.original_tree_headings = {
            "num": "#",
            "name": "Name",
            "size": "Size (MB)",
            "duration": "Duration",
            "datetime": "Date/Time",
            "meeting": "Meeting",
            "version": "Version",
            "status": "Status",
            "transcription": "Transcription",
        }
        self.icons = {}
        self.menu_icons = {}
        self._last_appearance_mode = self.appearance_mode_var.get()
        self.file_menu = None
        self.view_menu = None
        self.actions_menu = None
        self.device_menu = None
        self.toolbar_frame = None
        self.toolbar_connect_button = None
        self.toolbar_refresh_button = None
        self.toolbar_download_button = None
        self.toolbar_play_button = None
        self.toolbar_insights_button = None
        self.toolbar_delete_button = None
        self.toolbar_settings_button = None
        self.status_bar_frame = None
        self.status_connection_label = None
        self.status_progress_text_label = None
        self.status_file_progress_bar = None
        self.main_content_frame = None
        self.status_storage_label_header = None
        self.status_file_counts_label_header = None
        self.download_dir_button_header = None
        self._settings_dialog_instance = None
        self.current_time_label = None
        self.playback_slider = None
        self.total_duration_label = None
        self.volume_slider_widget = None
        self.loop_checkbox = None
        self.clear_selection_button_header = None
        self.clear_log_button = None
        self.log_section_level_combo = None
        self.select_all_button_header = None
        self.file_tree = None
        self.log_frame = None
        self.download_logs_button = None
        self.log_text_area = None
        self._selection_update_timer = None
        self._last_loaded_waveform_file = None
        self._waveform_loading = False
        self._cached_device_info = None
        self._device_info_cache_time = 0
        self._cached_storage_info = None
        self._storage_info_cache_time = 0
        self._cached_storage_text = None

        self._menu_image_references = []
        self._load_icons()

        # Initialize toast notification manager
        self.toast_manager = ToastManager(self)
        self.create_widgets()
        self._set_minimum_window_size()
        self.apply_theme_and_color()

        # Initialize async calendar system early
        self.after(25, self._ensure_async_calendar_initialized)

        # Show cached files immediately if available (offline mode)
        self.after(50, self._show_cached_files_on_startup)
        # Update menu states to show correct initial button states (orange Connect button when disconnected)
        self.after(75, self._update_menu_states)
        self.after(100, self.attempt_autoconnect_on_startup)

    def _get_monitor_info(self):
        """
        Get information about all available monitors.
        Returns a list of dictionaries with monitor bounds.
        """
        monitors = []
        try:
            import platform

            system = platform.system().lower()

            if system == "windows":
                try:
                    import win32api

                    # Try multiple approaches for monitor enumeration
                    try:
                        # Method 1: Try GetSystemMetrics for multi-monitor support
                        import win32con

                        # Get virtual screen bounds
                        left = win32api.GetSystemMetrics(win32con.SM_XVIRTUALSCREEN)
                        top = win32api.GetSystemMetrics(win32con.SM_YVIRTUALSCREEN)
                        width = win32api.GetSystemMetrics(win32con.SM_CXVIRTUALSCREEN)
                        height = win32api.GetSystemMetrics(win32con.SM_CYVIRTUALSCREEN)

                        # Add virtual desktop as one large monitor
                        monitors.append(
                            {
                                "left": left,
                                "top": top,
                                "right": left + width,
                                "bottom": top + height,
                                "width": width,
                                "height": height,
                            }
                        )

                        logger.debug("GUI", "_get_monitor_info", f"Virtual desktop: {left}, {top}, {width}x{height}")

                    except Exception as e2:
                        logger.debug("GUI", "_get_monitor_info", f"GetSystemMetrics failed: {e2}, using fallback")
                        raise e2

                except ImportError:
                    logger.debug("GUI", "_get_monitor_info", "win32api not available, using tkinter fallback")
                    # Fallback to tkinter basic info
                    monitors.append(
                        {
                            "left": 0,
                            "top": 0,
                            "right": self.winfo_screenwidth(),
                            "bottom": self.winfo_screenheight(),
                            "width": self.winfo_screenwidth(),
                            "height": self.winfo_screenheight(),
                        }
                    )

            else:
                # For macOS and Linux, use tkinter basic info as fallback
                # TODO: Add proper multi-monitor support for macOS/Linux if needed
                monitors.append(
                    {
                        "left": 0,
                        "top": 0,
                        "right": self.winfo_screenwidth(),
                        "bottom": self.winfo_screenheight(),
                        "width": self.winfo_screenwidth(),
                        "height": self.winfo_screenheight(),
                    }
                )

        except Exception as e:
            logger.error("GUI", "_get_monitor_info", f"Error getting monitor info: {e}")
            # Safe fallback
            monitors.append({"left": 0, "top": 0, "right": 1920, "bottom": 1080, "width": 1920, "height": 1080})

        return monitors

    def _validate_window_geometry(self, geometry_string):
        """
        Validates and corrects window geometry to ensure the window is visible on screen.
        Enhanced to support multi-monitor setups properly.

        Args:
            geometry_string (str): Geometry string in format "WIDTHxHEIGHT+X+Y"

        Returns:
            str: Validated geometry string that ensures window visibility
        """
        try:
            # Log initial state
            logger.debug(
                "GUI",
                "_validate_window_geometry",
                f"Initial geometry string: {geometry_string}",
            )

            # Parse the geometry string
            import re

            # Handle the special tkinter format like "798x305+-1062+424"
            # Split on 'x' first, then extract positions
            parts = geometry_string.split("x")
            if len(parts) != 2:
                logger.warning(
                    "GUI",
                    "_validate_window_geometry",
                    f"Invalid geometry format: {geometry_string}. Using default.",
                )
                return "950x850+100+100"  # Default fallback

            try:
                width = int(parts[0])

                # Extract height and position part
                height_and_pos = parts[1]
                height_match = re.match(r"(\d+)(.*)", height_and_pos)
                if not height_match:
                    raise ValueError("Could not parse height")

                height = int(height_match.group(1))
                positions_str = height_match.group(2)

                # Extract x and y positions
                pos_matches = re.findall(r"([-+]\d+)", positions_str)
                if len(pos_matches) != 2:
                    raise ValueError(f"Expected 2 position values, got {len(pos_matches)}")

                x = int(pos_matches[0])
                y = int(pos_matches[1])

            except (ValueError, IndexError) as e:
                logger.warning(
                    "GUI",
                    "_validate_window_geometry",
                    f"Invalid geometry format: {geometry_string} - {e}. Using default.",
                )
                return "950x850+100+100"  # Default fallback
            logger.debug(
                "GUI",
                "_validate_window_geometry",
                f"Parsed geometry: w={width}, h={height}, x={x}, y={y}",
            )

            # Get multi-monitor information
            monitors = self._get_monitor_info()
            logger.debug(
                "GUI",
                "_validate_window_geometry",
                f"Detected {len(monitors)} monitor(s): {monitors}",
            )

            # Check if window intersects with any monitor
            window_rect = {"left": x, "top": y, "right": x + width, "bottom": y + height}
            min_visible_pixels = 100  # Minimum pixels that should be visible

            is_visible_on_any_monitor = False
            for monitor in monitors:
                # Calculate intersection area
                intersection_left = max(window_rect["left"], monitor["left"])
                intersection_top = max(window_rect["top"], monitor["top"])
                intersection_right = min(window_rect["right"], monitor["right"])
                intersection_bottom = min(window_rect["bottom"], monitor["bottom"])

                # Check if there's a meaningful intersection
                if (
                    intersection_right - intersection_left >= min_visible_pixels
                    and intersection_bottom - intersection_top >= min_visible_pixels
                ):
                    is_visible_on_any_monitor = True
                    logger.debug(
                        "GUI",
                        "_validate_window_geometry",
                        f"Window is visible on monitor: {monitor}",
                    )
                    break

            # Only correct position if window is not visible on ANY monitor
            if not is_visible_on_any_monitor:
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Window at {x}, {y} is not visible on any monitor. Repositioning.",
                )

                # Find the primary monitor (usually the one containing 0,0)
                primary_monitor = next(
                    (m for m in monitors if m["left"] <= 0 <= m["right"] and m["top"] <= 0 <= m["bottom"]),
                    monitors[0] if monitors else None,
                )

                if primary_monitor:
                    # Position window on primary monitor with some offset from edges
                    x = max(
                        primary_monitor["left"] + 50,
                        min(primary_monitor["right"] - width - 50, primary_monitor["left"] + 100),
                    )
                    y = max(
                        primary_monitor["top"] + 50,
                        min(primary_monitor["bottom"] - height - 50, primary_monitor["top"] + 100),
                    )
                    logger.info(
                        "GUI",
                        "_validate_window_geometry",
                        f"Repositioned to primary monitor: x={x}, y={y}",
                    )
                else:
                    # Fallback to safe coordinates
                    x, y = 100, 100
                    logger.warning(
                        "GUI",
                        "_validate_window_geometry",
                        "No monitors detected, using fallback position",
                    )
            else:
                logger.debug(
                    "GUI",
                    "_validate_window_geometry",
                    "Window position is valid - visible on at least one monitor",
                )

            # Ensure reasonable window size
            min_width, min_height = 400, 300
            if width < min_width:
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Width {width} is too small, setting to {min_width}",
                )
                width = min_width
            if height < min_height:
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Height {height} is too small, setting to {min_height}",
                )
                height = min_height

            validated_geometry = f"{width}x{height}+{x}+{y}"
            if validated_geometry != geometry_string:
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Final corrected geometry: '{validated_geometry}'",
                )

            return validated_geometry

        except Exception as e:
            logger.error(
                "GUI",
                "_validate_window_geometry",
                f"Error validating geometry '{geometry_string}': {e}",
            )
            return "950x850+100+100"  # Safe fallback

    def _get_calendar_tolerance_minutes(self):
        """Get calendar tolerance minutes from configuration."""
        config = load_config()
        return config.get("calendar_tolerance_minutes", 20)  # Default to 20 minutes

    def _initialize_vars_from_config(self):
        """
        Initializes customtkinter (CTk) Variables from the loaded configuration.

        This method sets up various `ctk.StringVar`, `ctk.BooleanVar`, etc.,
        based on values found in `self.config` or defaults if keys are missing.
        """

        def get_conf(key, default_val):
            return self.config.get(key, default_val)

        self.autoconnect_var = ctk.BooleanVar(value=get_conf("autoconnect", False))
        # Handle relative paths for download directory
        download_dir = get_conf("download_directory", os.getcwd())
        if not os.path.isabs(download_dir):
            # If it's a relative path, resolve it relative to the app root directory
            script_dir = os.path.dirname(os.path.abspath(__file__))
            app_root = os.path.dirname(script_dir)  # Go up from src/ to app root
            download_dir = os.path.abspath(os.path.join(app_root, download_dir))
        self.download_directory = download_dir
        self.logger_processing_level_var = ctk.StringVar(value=get_conf("log_level", "INFO"))
        self.selected_vid_var = ctk.IntVar(value=get_conf("selected_vid", DEFAULT_VENDOR_ID))
        self.selected_pid_var = ctk.IntVar(value=get_conf("selected_pid", DEFAULT_PRODUCT_ID))
        self.target_interface_var = ctk.IntVar(value=get_conf("target_interface", 0))
        self.recording_check_interval_var = ctk.IntVar(value=get_conf("recording_check_interval_s", 3))
        self.default_command_timeout_ms_var = ctk.IntVar(value=get_conf("default_command_timeout_ms", 5000))
        self.file_stream_timeout_s_var = ctk.IntVar(value=get_conf("file_stream_timeout_s", 180))
        self.auto_refresh_files_var = ctk.BooleanVar(value=get_conf("auto_refresh_files", False))
        self.auto_refresh_interval_s_var = ctk.IntVar(value=get_conf("auto_refresh_interval_s", 30))
        self.quit_without_prompt_var = ctk.BooleanVar(value=get_conf("quit_without_prompt_if_connected", False))
        self.appearance_mode_var = ctk.StringVar(value=get_conf("appearance_mode", "System"))
        self.color_theme_var = ctk.StringVar(value=get_conf("color_theme", "blue"))
        self.suppress_console_output_var = ctk.BooleanVar(value=get_conf("suppress_console_output", False))
        self.suppress_gui_log_output_var = ctk.BooleanVar(value=get_conf("suppress_gui_log_output", False))
        self.gui_log_filter_level_var = ctk.StringVar(value=get_conf("gui_log_filter_level", "DEBUG"))

        # File logging variables
        self.enable_file_logging_var = ctk.BooleanVar(value=get_conf("enable_file_logging", False))
        self.enable_console_logging_var = ctk.BooleanVar(value=get_conf("enable_console_logging", True))
        self.enable_gui_logging_var = ctk.BooleanVar(value=get_conf("enable_gui_logging", True))
        self.log_file_path_var = ctk.StringVar(value=get_conf("log_file_path", "hidock.log"))
        self.log_file_max_size_mb_var = ctk.IntVar(value=get_conf("log_file_max_size_mb", 10))
        self.log_file_backup_count_var = ctk.IntVar(value=get_conf("log_file_backup_count", 5))
        self.console_log_level_var = ctk.StringVar(value=get_conf("console_log_level", "INFO"))
        self.gui_log_level_var = ctk.StringVar(value=get_conf("gui_log_level", "ERROR"))
        self.file_log_level_var = ctk.StringVar(value=get_conf("file_log_level", "DEBUG"))
        self.device_setting_auto_record_var = ctk.BooleanVar()
        self.device_setting_auto_play_var = ctk.BooleanVar()
        self.device_setting_bluetooth_tone_var = ctk.BooleanVar()
        self.device_setting_notification_sound_var = ctk.BooleanVar()
        self.treeview_columns_display_order_str = get_conf(
            "treeview_columns_display_order",
            "num,name,datetime,size,duration,status",
        )
        self.logs_visible_var = ctk.BooleanVar(value=get_conf("logs_pane_visible", False))
        self.loop_playback_var = ctk.BooleanVar(value=get_conf("loop_playback", False))
        self.volume_var = ctk.DoubleVar(value=get_conf("playback_volume", 0.5))
        self.saved_treeview_sort_column = get_conf("treeview_sort_col_id", "datetime")
        self.saved_treeview_sort_reverse = get_conf("treeview_sort_descending", True)
        default_log_colors_fallback = {
            "ERROR": ["#FF6347", "#FF4747"],
            "WARNING": ["#FFA500", "#FFB732"],
            "INFO": ["#606060", "#A0A0A0"],
            "DEBUG": ["#202020", "#D0D0D0"],
            "CRITICAL": ["#DC143C", "#FF0000"],
        }
        loaded_log_colors = get_conf("log_colors", default_log_colors_fallback)
        for level in Logger.LEVELS:
            colors = loaded_log_colors.get(level, default_log_colors_fallback.get(level, ["#000000", "#FFFFFF"]))
            setattr(
                self,
                f"log_color_{level.lower()}_light_var",
                ctk.StringVar(value=colors[0]),
            )
            setattr(
                self,
                f"log_color_{level.lower()}_dark_var",
                ctk.StringVar(value=colors[1]),
            )
        self.icon_pref_light_color = get_conf("icon_theme_color_light", "black")
        self.icon_pref_dark_color = get_conf("icon_theme_color_dark", "white")
        self.icon_fallback_color_1 = get_conf("icon_fallback_color_1", "blue")
        self.icon_fallback_color_2 = get_conf("icon_fallback_color_2", "default")
        self.icon_size_str = get_conf("icon_size_str", "32")

        # AI Transcription settings
        self.ai_api_provider_var = ctk.StringVar(value=get_conf("ai_api_provider", "gemini"))
        self.ai_model_var = ctk.StringVar(value=get_conf("ai_model", "gemini-2.5-flash"))
        self.ai_temperature_var = ctk.DoubleVar(value=get_conf("ai_temperature", 0.3))
        self.ai_max_tokens_var = ctk.IntVar(value=get_conf("ai_max_tokens", 4000))
        self.ai_language_var = ctk.StringVar(value=get_conf("ai_language", "auto"))
        # Provider-specific configuration
        self.ai_openrouter_base_url_var = ctk.StringVar(
            value=get_conf("ai_openrouter_base_url", "https://openrouter.ai/api/v1")
        )
        self.ai_amazon_region_var = ctk.StringVar(value=get_conf("ai_amazon_region", "us-east-1"))
        self.ai_qwen_base_url_var = ctk.StringVar(
            value=get_conf("ai_qwen_base_url", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        )
        self.ai_deepseek_base_url_var = ctk.StringVar(
            value=get_conf("ai_deepseek_base_url", "https://api.deepseek.com")
        )
        self.ai_ollama_base_url_var = ctk.StringVar(value=get_conf("ai_ollama_base_url", "http://localhost:11434"))
        self.ai_lmstudio_base_url_var = ctk.StringVar(
            value=get_conf("ai_lmstudio_base_url", "http://localhost:1234/v1")
        )
        # API key is stored encrypted and handled separately

        # Visualizer pin state
        self.visualizer_pinned_var = ctk.BooleanVar(value=get_conf("visualizer_pinned", False))
        self.visualizer_pinned = self.visualizer_pinned_var.get()  # Initialize from config

        # Selection mode (default to single selection)
        self.single_selection_mode_var = ctk.BooleanVar(value=get_conf("single_selection_mode", True))

        # Calendar performance settings
        self.calendar_chunking_period_var = ctk.StringVar(value=get_conf("calendar_chunking_period", "1 Week"))

        # Initialize calendar search and filtering components
        self._initialize_calendar_search()

    def _initialize_calendar_search(self):
        """Initialize calendar search and filtering components."""
        try:
            # Initialize the filter engine
            self.calendar_filter_engine = CalendarFilterEngine()

            # Initialize TreeView filtering (will be set up after TreeView is created)
            self.calendar_search_widget = None  # Will be created in _create_files_panel
            self.status_filter_widget = None  # Will be created in _create_files_panel
            self.unified_filter_widget = None  # Will replace separate widgets

            logger.info("GUI", "init_calendar_search", "Calendar search components initialized")

        except Exception as e:
            logger.error("GUI", "init_calendar_search", f"Error initializing calendar search: {e}")
            # Set to None on error to prevent further issues
            self.calendar_filter_engine = None

    def _create_calendar_search_widget(self, parent_frame):
        """Create the calendar search widget and integrate it with filtering."""
        try:
            # Create the search widget
            self.calendar_search_widget = CalendarSearchWidget(
                parent_frame, search_callback=self._on_calendar_search, fg_color="transparent", border_width=0
            )
            self.calendar_search_widget.grid(row=1, column=0, sticky="ew", padx=5, pady=(0, 5))

            logger.debug("GUI", "create_search_widget", "Calendar search widget created")

        except Exception as e:
            logger.error("GUI", "create_search_widget", f"Error creating calendar search widget: {e}")

    def _create_status_filter_widget(self, parent_frame):
        """Create the status filter widget and integrate it with filtering."""
        try:
            # Create the status filter widget
            self.status_filter_widget = StatusFilterWidget(
                parent_frame, filter_callback=self._on_status_filter_changed, fg_color="transparent", border_width=0
            )
            self.status_filter_widget.grid(row=2, column=0, sticky="ew", padx=5, pady=(0, 5))

            logger.debug("GUI", "create_status_filter_widget", "Status filter widget created")

        except Exception as e:
            logger.error("GUI", "create_status_filter_widget", f"Error creating status filter widget: {e}")

    def _create_unified_filter_widget(self, parent_frame):
        """Create the unified filter widget to replace separate search and status filters."""
        try:
            # Create the unified widget
            self.unified_filter_widget = UnifiedFilterWidget(
                parent_frame,
                calendar_callback=self._on_calendar_search,
                status_callback=self._on_status_filter_changed,
                fg_color="transparent",
                border_width=0,
            )
            self.unified_filter_widget.grid(row=1, column=0, sticky="ew", padx=5, pady=(0, 5))

            logger.debug("GUI", "create_unified_filter_widget", "Unified filter widget created")

        except Exception as e:
            logger.error("GUI", "create_unified_filter_widget", f"Error creating unified filter widget: {e}")

    def _on_calendar_search(self, filters):
        """Handle calendar search/filter changes."""
        try:
            logger.debug("GUI", "calendar_search", f"Search filters changed: {filters}")

            # Apply the filters using TreeView mixin
            self.apply_calendar_filters(filters)

        except Exception as e:
            logger.error("GUI", "calendar_search", f"Error handling calendar search: {e}")

    def _on_status_filter_changed(self, filter_criteria):
        """Handle status filter changes."""
        try:
            logger.debug("GUI", "status_filter", f"Status filter changed: {filter_criteria}")

            # Apply the status filter to the TreeView
            self.apply_status_filter(filter_criteria)

        except Exception as e:
            logger.error("GUI", "status_filter", f"Error handling status filter change: {e}")

    def _create_file_tree_frame_with_search_support(self, parent_frame):
        """Create the file tree frame and set up search integration."""
        try:
            # Create the normal tree frame (row=2 because of unified filter widget)
            self._create_file_tree_frame_at_row(parent_frame, row=2)

            # Initialize calendar filtering in TreeView
            self.initialize_calendar_filtering()

            # Set the filter engine in TreeView
            self.set_calendar_filter_engine(self.calendar_filter_engine)

            logger.debug("GUI", "create_tree_with_search", "File tree with search support created")

        except Exception as e:
            logger.error("GUI", "create_tree_with_search", f"Error creating tree with search: {e}")

    def _create_file_tree_frame_at_row(self, parent_frame, row=1):
        """Create file tree frame at specified row (modified version of _create_file_tree_frame)."""
        tree_frame = ctk.CTkFrame(parent_frame, fg_color="transparent", border_width=0)
        tree_frame.grid(row=row, column=0, sticky="nsew", padx=5, pady=5)
        tree_frame.grid_columnconfigure(0, weight=1)
        tree_frame.grid_rowconfigure(0, weight=1)
        columns = ("num", "name", "datetime", "size", "duration", "meeting", "version", "status", "transcription")
        # Set initial selectmode based on configuration
        initial_selectmode = "browse" if self.single_selection_mode_var.get() else "extended"
        self.file_tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode=initial_selectmode)
        self.file_tree.tag_configure("downloaded", foreground="blue")
        self.file_tree.tag_configure("recording", foreground="red", font=("Arial", 10, "bold"))
        self.file_tree.tag_configure("size_mismatch", foreground="orange")
        self.file_tree.tag_configure("downloaded_ok", foreground="green")
        self.file_tree.tag_configure("downloading", foreground="dark orange")
        self.file_tree.tag_configure("download", foreground="dark orange")  # For download operations
        self.file_tree.tag_configure("deleting", foreground="red")
        self.file_tree.tag_configure("delete", foreground="red")  # For delete operations
        self.file_tree.tag_configure("queued", foreground="gray50")
        self.file_tree.tag_configure("cancelled", foreground="firebrick3")
        self.file_tree.tag_configure("playing", foreground="purple")
        if self.treeview_columns_display_order_str:
            loaded_column_order = self.treeview_columns_display_order_str.split(",")
            valid_loaded_order = [c for c in loaded_column_order if c in columns]
            if len(valid_loaded_order) == len(columns) and set(valid_loaded_order) == set(columns):
                try:
                    self.file_tree["displaycolumns"] = valid_loaded_order
                except tkinter.TclError as e:
                    logger.warning(
                        "GUI",
                        "create_widgets",
                        f"Failed to apply saved column order '{valid_loaded_order}' (TclError): {e}. Using default.",
                    )
                    self.file_tree["displaycolumns"] = columns
            else:
                self.file_tree["displaycolumns"] = columns
        else:
            self.file_tree["displaycolumns"] = columns
        for col in columns:
            if col in self.original_tree_headings:
                text = self.original_tree_headings[col]
                is_numeric = col in ["size", "duration"]
                self.file_tree.heading(
                    col,
                    text=text,
                    command=lambda c=col, n=is_numeric: self.sort_treeview_column(c, n),
                )
            if col == "num":
                self.file_tree.column(col, width=40, minwidth=40, stretch=False)
            elif col == "name":
                self.file_tree.column(col, width=250, minwidth=150, stretch=True)
            elif col in ["size", "duration"]:
                self.file_tree.column(col, width=80, minwidth=60, anchor="e")
            elif col == "datetime":
                self.file_tree.column(col, width=150, minwidth=120, anchor="center")
            elif col == "meeting":
                self.file_tree.column(col, width=200, minwidth=150, anchor="w")
            elif col == "version":
                self.file_tree.column(col, width=70, minwidth=50, anchor="center")
            elif col == "transcription":
                self.file_tree.column(col, width=100, minwidth=80, anchor="w")
            else:
                self.file_tree.column(col, width=100, minwidth=80, anchor="w")
        self.file_tree.grid(row=0, column=0, sticky="nsew")

        # Create and configure scrollbar - simplest possible approach
        self.tree_scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.file_tree.yview)
        self.tree_scrollbar.grid(row=0, column=1, sticky="ns")
        self.file_tree.configure(yscrollcommand=self.tree_scrollbar.set)

        # Configure frame columns
        tree_frame.grid_columnconfigure(0, weight=1)
        tree_frame.grid_columnconfigure(1, weight=0)
        self.file_tree.bind("<<TreeviewSelect>>", self.on_file_selection_change)
        self.file_tree.bind("<Double-1>", self._on_file_double_click_filtered)
        self.file_tree.bind("<Button-3>", self._on_file_right_click)
        self.file_tree.bind("<Control-a>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Control-A>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Delete>", self._on_delete_key_press)
        self.file_tree.bind("<Return>", self._on_enter_key_press)
        self.file_tree.bind("<ButtonPress-1>", self._on_file_button1_press)
        self.file_tree.bind("<B1-Motion>", self._on_file_b1_motion)
        self.file_tree.bind("<ButtonRelease-1>", self._on_file_button1_release)

        # Set up keyboard shortcuts for search
        self._setup_calendar_search_shortcuts()

    def _setup_calendar_search_shortcuts(self):
        """Set up keyboard shortcuts for calendar search functionality."""
        try:
            # Ctrl+F to focus search
            self.bind("<Control-f>", lambda event: self._focus_calendar_search())
            self.bind("<Control-F>", lambda event: self._focus_calendar_search())

            # Escape to clear search when search widget is focused
            self.bind("<Escape>", lambda event: self._clear_calendar_search_if_focused())

            logger.debug("GUI", "setup_search_shortcuts", "Calendar search keyboard shortcuts set up")

        except Exception as e:
            logger.error("GUI", "setup_search_shortcuts", f"Error setting up search shortcuts: {e}")

    def _focus_calendar_search(self):
        """Focus the calendar search entry."""
        try:
            if hasattr(self, "calendar_search_widget") and self.calendar_search_widget:
                self.calendar_search_widget.focus_search()
                return "break"  # Prevent default behavior
        except Exception as e:
            logger.error("GUI", "focus_search", f"Error focusing search: {e}")
        return None

    def _clear_calendar_search_if_focused(self):
        """Clear calendar search if the search widget is currently focused."""
        try:
            if (
                hasattr(self, "calendar_search_widget")
                and self.calendar_search_widget
                and self.calendar_search_widget.search_entry.winfo_exists()
                and str(self.focus_get()) == str(self.calendar_search_widget.search_entry)
            ):
                # Only clear if search widget is focused
                self.calendar_search_widget._clear_search()
                return "break"  # Prevent default behavior

        except Exception as e:
            logger.error("GUI", "clear_search_if_focused", f"Error in search clear: {e}")
        return None

    def get_decrypted_api_key(self, provider=None):
        """Get the decrypted API key for the specified provider."""
        if provider is None:
            provider = self.ai_api_provider_var.get()

        encrypted_key = self.config.get(f"ai_api_key_{provider}_encrypted", "")
        if not encrypted_key:
            return ""

        try:
            # Import encryption here to avoid dependency issues
            import base64

            try:
                from cryptography.fernet import Fernet
            except ImportError:
                logger.error("GUI", "get_decrypted_api_key", "cryptography package not installed")
                return ""

            # Try to load existing key from config directory
            config_dir = os.path.dirname(self.config.get("config_file_path", ""))
            key_file = os.path.join(config_dir, ".hidock_key.dat")

            if os.path.exists(key_file):
                with open(key_file, "rb") as f:
                    key = f.read()

                f = Fernet(key)
                encrypted_bytes = base64.b64decode(encrypted_key.encode())
                decrypted = f.decrypt(encrypted_bytes)
                return decrypted.decode()

        except Exception as e:
            logger.error("GUI", "get_decrypted_api_key", f"Error decrypting API key: {e}")

        return ""

    def _load_icons(self):
        """
        Loads icons for the GUI from the filesystem.
        """
        icon_definitions = {
            "connect": "link.png",
            "disconnect": "unlink.png",
            "refresh": "refresh.png",
            "download": "download.png",
            "play": "play-circle-o.png",
            "stop": "stop.png",
            "delete": "trash-o.png",
            "settings": "cog.png",
            "folder": "folder-open-o.png",
            "sync_time": "clock-o.png",
            "format_sd": "hdd-o.png",
            "select_all_files": "check-square.png",
            "clear_selection_files": "minus-square.png",
            "show_logs": "list-alt.png",
            "exit_app": "power-off.png",
            "clear_log_button": "eraser.png",
            "download_log_button": "save.png",
            "scan_usb": "search.png",
            "playback_play": "play.png",
            "playback_pause": "pause.png",
            "volume_up": "volume-up.png",
            "volume_down": "volume-down.png",
            "volume_off": "volume-off.png",
        }
        current_mode_is_dark = ctk.get_appearance_mode() == "Dark"
        theme_specific_color = self.icon_pref_dark_color if current_mode_is_dark else self.icon_pref_light_color

        for name, filename in icon_definitions.items():
            pil_image = None
            paths_to_try = [
                os.path.join(
                    self.icon_base_path,
                    theme_specific_color,
                    self.icon_size_str,
                    filename,
                ),
                os.path.join(
                    self.icon_base_path,
                    self.icon_fallback_color_1,
                    self.icon_size_str,
                    filename,
                ),
                os.path.join(
                    self.icon_base_path,
                    self.icon_fallback_color_2,
                    self.icon_size_str,
                    filename,
                ),
                os.path.join(self.icon_base_path, self.icon_size_str, filename),
            ]
            for icon_path_try in paths_to_try:
                if os.path.exists(icon_path_try):
                    try:
                        pil_image = Image.open(icon_path_try)
                        break
                    except (IOError, UnidentifiedImageError) as e_img:
                        logger.warning(
                            "GUI",
                            "_load_icons",
                            f"Found icon {filename} at {icon_path_try} but failed to open: {e_img}",
                        )
                        pil_image = None

            if pil_image:
                self.icons[name] = ctk.CTkImage(
                    light_image=pil_image,
                    dark_image=pil_image,
                    size=self.icon_display_size,
                )
                tk_photo_image = ImageTk.PhotoImage(pil_image.resize(self.icon_display_size))
                self.menu_icons[name] = tk_photo_image
                self._menu_image_references.append(tk_photo_image)
            else:
                self.icons[name] = None
                self.menu_icons[name] = None
                logger.warning(
                    "GUI",
                    "_load_icons",
                    f"Icon '{filename}' for '{name}' not found in any specified path.",
                )

    def _create_menubar(self):
        """
        Creates the main application menubar using `tkinter.Menu`.
        """
        menubar = tkinter.Menu(self)
        self.configure(menu=menubar)
        self.file_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="File", menu=self.file_menu)
        self.file_menu.add_command(
            label="Connect to HiDock",
            command=self.connect_device,
            accelerator="Ctrl+O",
            image=self.menu_icons.get("connect"),
            compound="left",
        )
        self.file_menu.add_command(
            label="Disconnect",
            command=self.disconnect_device,
            state="disabled",
            accelerator="Ctrl+D",
            image=self.menu_icons.get("disconnect"),
            compound="left",
        )
        self.file_menu.add_separator()
        self.file_menu.add_command(
            label="Settings",
            command=self.open_settings_window,
            accelerator="Ctrl+",
            image=self.menu_icons.get("settings"),
            compound="left",
        )
        self.file_menu.add_separator()
        self.file_menu.add_command(
            label="Exit",
            command=self.on_closing,
            accelerator="Alt+F4",
            image=self.menu_icons.get("exit_app"),
            compound="left",
        )
        self.bind_all(
            "<Control-o>",
            lambda e: (
                self.connect_device() if self.file_menu.entrycget("Connect to HiDock", "state") == "normal" else None
            ),
        )
        self.bind_all(
            "<Control-d>",
            lambda e: (
                self.disconnect_device() if self.file_menu.entrycget("Disconnect", "state") == "normal" else None
            ),
        )
        self.bind_all("<Control-comma>", lambda e: self.open_settings_window())
        self.bind_all("<Control-s>", lambda e: self.stop_audio_playback_gui())
        self.bind_all("<space>", lambda e: self.pause_audio_playback_gui())

        # Window geometry auto-save
        self.bind("<Configure>", self._on_window_configure)
        self._geometry_save_timer = None
        self.view_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="View", menu=self.view_menu)
        self.view_menu.add_command(
            label="Refresh File List",
            command=self.refresh_file_list_gui,
            state="disabled",
            accelerator="F5",
            image=self.menu_icons.get("refresh"),
            compound="left",
        )
        self.view_menu.add_separator()
        self.view_menu.add_checkbutton(
            label="Show Logs",
            onvalue=True,
            offvalue=False,
            variable=self.logs_visible_var,
            command=self.toggle_logs,
            image=self.menu_icons.get("show_logs"),
            compound="left",
        )
        self.view_menu.add_command(
            label="System Health",
            command=self.show_system_health,
            image=self.menu_icons.get("info"),
            compound="left",
        )
        self.view_menu.add_separator()
        self.view_menu.add_command(
            label="Force Refresh Calendar",
            command=self.force_refresh_calendar_gui,
            image=self.menu_icons.get("refresh"),
            compound="left",
        )
        self.view_menu.add_command(
            label="Check Selected Files for Meetings",
            command=self.check_selected_files_for_meetings_gui,
            state="disabled",
            image=self.menu_icons.get("refresh"),
            compound="left",
        )
        self.view_menu.add_separator()
        # Column visibility submenu
        self.columns_menu = tkinter.Menu(self.view_menu, tearoff=0)
        self.view_menu.add_cascade(label="Columns", menu=self.columns_menu)

        # Initialize column visibility variables and add column visibility toggles
        self.column_visibility_vars = {}
        for col_id, col_name in self.original_tree_headings.items():
            if col_id != "num":  # Don't allow hiding the # column
                # Determine if column is currently visible - strip whitespace from split
                displayed_cols = [col.strip() for col in self.treeview_columns_display_order_str.split(",")]
                is_visible = col_id in displayed_cols

                # Create variable to track column visibility
                var = tkinter.BooleanVar(value=is_visible)
                self.column_visibility_vars[col_id] = var

                # Fix lambda closure bug by using default parameter to capture current value
                def make_toggle_command(column_id):
                    return lambda: self._toggle_column_visibility(column_id)

                self.columns_menu.add_checkbutton(
                    label=col_name,
                    variable=var,
                    command=make_toggle_command(col_id),
                )
        self.actions_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Actions", menu=self.actions_menu)
        self.actions_menu.add_command(
            label="Download Selected",
            command=self.download_selected_files_gui,
            state="disabled",
            image=self.menu_icons.get("download"),
            compound="left",
        )
        self.actions_menu.add_command(
            label="Play Selected",
            command=self.play_selected_audio_gui,
            state="disabled",
            image=self.menu_icons.get("play"),
            compound="left",
        )
        self.actions_menu.add_command(
            label="Get Insights",
            command=self.get_insights_selected_file_gui,
            state="disabled",
            image=self.menu_icons.get("insights", self.menu_icons.get("play")),
            compound="left",
        )
        self.actions_menu.add_command(
            label="Stop Playback",
            command=self.stop_audio_playback_gui,
            state="disabled",
            accelerator="Ctrl+S",
            image=self.menu_icons.get("stop"),
            compound="left",
        )
        self.actions_menu.add_command(
            label="Delete Selected",
            command=self.delete_selected_files_gui,
            state="disabled",
            image=self.menu_icons.get("delete"),
            compound="left",
        )
        self.actions_menu.add_separator()
        self.actions_menu.add_command(
            label="Cancel Selected Downloads",
            command=self.cancel_selected_downloads_gui,
            state="disabled",
            accelerator="Esc",
            image=self.menu_icons.get("cancel"),
            compound="left",
        )
        self.actions_menu.add_command(
            label="Cancel All Downloads",
            command=self.cancel_all_downloads_gui,
            state="disabled",
            image=self.menu_icons.get("cancel"),
            compound="left",
        )
        self.actions_menu.add_command(
            label="Cancel Active Deletions",
            command=self.cancel_active_deletions_gui,
            state="disabled",
            image=self.menu_icons.get("cancel"),
            compound="left",
        )
        self.actions_menu.add_separator()
        self.actions_menu.add_command(
            label="🛑 Cancel ALL Operations",
            command=self.cancel_all_operations_gui,
            state="disabled",
            accelerator="Ctrl+Shift+C",
            image=self.menu_icons.get("stop"),
            compound="left",
        )
        self.actions_menu.add_separator()
        self.actions_menu.add_command(
            label="Select All",
            command=self.select_all_files_action,
            state="disabled",
            accelerator="Ctrl+A",
            image=self.menu_icons.get("select_all_files"),
            compound="left",
        )
        self.actions_menu.add_command(
            label="Clear Selection",
            command=self.clear_selection_action,
            state="disabled",
            image=self.menu_icons.get("clear_selection_files"),
            compound="left",
        )
        self.device_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Device", menu=self.device_menu)
        self.device_menu.add_command(
            label="Sync Device Time",
            command=self.sync_device_time_gui,
            state="disabled",
            image=self.menu_icons.get("sync_time"),
            compound="left",
        )
        self.device_menu.add_command(
            label="Format Storage",
            command=self.format_sd_card_gui,
            state="disabled",
            image=self.menu_icons.get("format_sd"),
            compound="left",
        )

        self.tools_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Tools", menu=self.tools_menu)
        self.tools_menu.add_command(
            label="Storage Optimizer",
            command=self.show_storage_optimizer,
            image=self.menu_icons.get("info"),
            compound="left",
        )
        self.tools_menu.add_separator()
        self.tools_menu.add_command(
            label="Refresh Files Without Meetings",
            command=self.refresh_unlinked_files_only,
            image=self.menu_icons.get("refresh"),
            compound="left",
        )

    def _update_menubar_style(self):
        """
        Applies styling to the `tkinter.Menu` to better match the CustomTkinter theme.
        """
        if not (hasattr(self, "file_menu") and self.file_menu):
            return
        try:
            menu_bg = self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkFrame"]["fg_color"])
            menu_fg = self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"]["text_color"])
            active_menu_bg = self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["hover_color"])
            active_menu_fg_candidate = ctk.ThemeManager.theme["CTkButton"].get("text_color_hover")
            active_menu_fg = self.apply_appearance_mode_theme_color(
                active_menu_fg_candidate
                if active_menu_fg_candidate
                else ctk.ThemeManager.theme["CTkButton"]["text_color"]
            )
            disabled_fg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkLabel"].get("text_color_disabled", ("gray70", "gray30"))
            )
            for menu_widget in [
                self.file_menu,
                self.view_menu,
                self.actions_menu,
                self.device_menu,
                self.tools_menu,
            ]:
                if menu_widget:
                    menu_widget.configure(
                        background=menu_bg,
                        foreground=menu_fg,
                        activebackground=active_menu_bg,
                        activeforeground=active_menu_fg,
                        disabledforeground=disabled_fg,
                        relief="flat",
                        borderwidth=0,
                    )
            logger.debug("GUI", "_update_menubar_style", "Attempted to apply theme to menubar.")
        except KeyError as e:
            logger.error("GUI", "_update_menubar_style", f"Theme key missing for menubar: {e}.")
        except tkinter.TclError as e:
            logger.error("GUI", "_update_menubar_style", f"Error styling menubar: {e}")

    def _update_menu_command_images(self):
        """
        Updates the images for all menu commands.
        """
        if not hasattr(self, "file_menu") or not self.file_menu:
            logger.debug(
                "GUI",
                "_update_menu_command_images",
                "Menubar not yet created. Skipping image update.",
            )
            return

        logger.debug(
            "GUI",
            "_update_menu_command_images",
            "Updating menu command images after icon reload.",
        )

        menu_map = {
            self.file_menu: {
                "Connect to HiDock": "connect",
                "Disconnect": "disconnect",
                "Settings": "settings",
                "Exit": "exit_app",
            },
            self.view_menu: {"Refresh File List": "refresh", "Show Logs": "show_logs"},
            self.actions_menu: {
                "Download Selected": "download",
                "Play Selected": "play",
                "Delete Selected": "delete",
                "Select All": "select_all_files",
                "Clear Selection": "clear_selection_files",
            },
            self.device_menu: {
                "Sync Device Time": "sync_time",
                "Format Storage": "format_sd",
            },
        }

        for menu_widget, commands in menu_map.items():
            if hasattr(menu_widget, "entryconfigure"):
                for label, icon_name in commands.items():
                    try:
                        if icon_name:
                            menu_widget.entryconfigure(label, image=self.menu_icons.get(icon_name))
                    except tkinter.TclError as e:
                        logger.warning(
                            "GUI",
                            "_update_menu_command_images",
                            f"Error updating image for '{label}' in menu: {e}. Icon: {icon_name}",
                        )
                    except (AttributeError, TypeError) as e_gen:
                        logger.error(
                            "GUI",
                            "_update_menu_command_images",
                            f"Generic error updating image for '{label}': {e_gen}",
                        )

    def _create_toolbar(self):
        """
        Creates the main application toolbar with `ctk.CTkButton` widgets.
        """
        toolbar_button_padx = (5, 2)
        toolbar_button_pady = 5
        toolbar_button_width = 100
        self.toolbar_frame = ctk.CTkFrame(self, corner_radius=0, height=40)
        self.toolbar_frame.pack(side="top", fill="x", pady=(0, 1), padx=0)
        self.toolbar_connect_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Connect",
            command=self.connect_device,
            width=toolbar_button_width,
            image=self.icons.get("connect"),
        )
        self.toolbar_connect_button.pack(side="left", padx=toolbar_button_padx, pady=toolbar_button_pady)
        self.toolbar_refresh_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Refresh",
            command=self.refresh_file_list_gui,
            width=toolbar_button_width,
            image=self.icons.get("refresh"),
        )
        self.toolbar_refresh_button.pack(side="left", padx=toolbar_button_padx, pady=toolbar_button_pady)
        self.toolbar_download_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Download",
            command=self.download_selected_files_gui,
            width=toolbar_button_width,
            image=self.icons.get("download"),
        )
        self.toolbar_download_button.pack(side="left", padx=toolbar_button_padx, pady=toolbar_button_pady)
        self.toolbar_play_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Play",
            command=self.play_selected_audio_gui,
            width=toolbar_button_width,
            image=self.icons.get("play"),
        )
        self.toolbar_play_button.pack(side="left", padx=toolbar_button_padx, pady=toolbar_button_pady)
        self.toolbar_insights_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Get Insights",
            command=self.get_insights_selected_file_gui,
            width=toolbar_button_width,
            image=self.icons.get("insights", self.icons.get("play")),  # Use insights icon or fallback to play
        )
        self.toolbar_insights_button.pack(side="left", padx=toolbar_button_padx, pady=toolbar_button_pady)
        self.toolbar_delete_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Delete",
            command=self.delete_selected_files_gui,
            width=toolbar_button_width,
            image=self.icons.get("delete"),
        )
        self.toolbar_delete_button.pack(side="left", padx=toolbar_button_padx, pady=toolbar_button_pady)

        # Add Cancel Operations button
        self.toolbar_cancel_button = ctk.CTkButton(
            self.toolbar_frame,
            text="🛑 Cancel",
            command=self.cancel_all_operations_gui,
            width=toolbar_button_width,
            image=self.icons.get("stop", self.icons.get("cancel")),
            fg_color="darkred",
            hover_color="red",
        )
        self.toolbar_cancel_button.pack(side="left", padx=(20, 2), pady=toolbar_button_pady)

        self.toolbar_settings_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Settings",
            command=self.open_settings_window,
            width=toolbar_button_width,
            image=self.icons.get("settings"),
        )
        self.toolbar_settings_button.pack(side="right", padx=(2, 5), pady=toolbar_button_pady)

    def _create_status_bar(self):
        """
        Creates the status bar at the bottom of the application window.
        """
        self.status_bar_frame = ctk.CTkFrame(self, height=30, corner_radius=0)
        self.status_bar_frame.pack(side="bottom", fill="x", padx=0, pady=(1, 0))
        self.status_connection_label = ctk.CTkLabel(self.status_bar_frame, text="Status: Disconnected", anchor="w")
        self.status_connection_label.pack(side="left", padx=10, pady=2)
        self.status_progress_text_label = ctk.CTkLabel(self.status_bar_frame, text="", anchor="w")
        self.status_progress_text_label.pack(side="left", padx=10, pady=2, fill="x", expand=True)
        self.status_file_progress_bar = ctk.CTkProgressBar(self.status_bar_frame, width=160, height=18)
        self.status_file_progress_bar.set(0)
        progress_bar_pady = (
            ((self.status_bar_frame.cget("height") - 18) // 2) if self.status_bar_frame.cget("height") > 18 else 2
        )
        self.status_file_progress_bar.pack(side="left", padx=10, pady=progress_bar_pady)

    def update_status_bar(self, connection_status=None, progress_text=None):
        """
        Updates specific labels in the status bar.
        """
        if hasattr(self, "status_connection_label") and self.status_connection_label.winfo_exists():
            if connection_status is not None:
                self.status_connection_label.configure(text=connection_status)
        if hasattr(self, "status_progress_text_label") and self.status_progress_text_label.winfo_exists():
            if progress_text is not None:
                self.status_progress_text_label.configure(text=progress_text)

    def update_all_status_info(self):
        """
        Kicks off a background thread to update all informational labels in the GUI
        without blocking the main thread.
        """
        if self._status_update_in_progress:
            return
        self._status_update_in_progress = True
        threading.Thread(target=self._update_all_status_info_thread, daemon=True).start()

    def _update_all_status_info_thread(self):
        """
        Worker thread that fetches device info and then schedules a GUI update.
        This runs in the background and should not touch GUI elements directly.
        """
        try:
            conn_status_text = "Status: Disconnected"
            storage_text = "Storage: ---"
            is_connected = self.device_manager.device_interface.is_connected()
            if is_connected:
                with self.device_lock:
                    # Use cached device info if available and recent
                    current_time = time.time()
                    if (
                        hasattr(self, "_cached_device_info")
                        and hasattr(self, "_device_info_cache_time")
                        and current_time - self._device_info_cache_time < 30.0
                    ):  # 30 second cache
                        device_info = self._cached_device_info
                    else:
                        # Check if still connected before getting device info
                        if self.device_manager.device_interface.is_connected():
                            try:
                                device_info = asyncio.run(self.device_manager.device_interface.get_device_info())
                                self._cached_device_info = device_info
                                self._device_info_cache_time = current_time
                            except (ConnectionError, Exception) as e:
                                logger.debug("GUI", "_update_all_status_info_thread", f"Device info error: {e}")
                                device_info = None
                        else:
                            device_info = None

                    if device_info:
                        conn_status_text = f"Status: Connected ({device_info.model.value or 'HiDock'})"
                        if device_info.serial_number != "N/A":
                            conn_status_text += f" SN: {device_info.serial_number}"

                    # Avoid getting storage info during file list streaming to prevent command conflicts
                    if (
                        hasattr(self.device_manager.device_interface, "jensen_device")
                        and hasattr(
                            self.device_manager.device_interface.jensen_device,
                            "is_file_list_streaming",
                        )
                        and self.device_manager.device_interface.jensen_device.is_file_list_streaming()
                    ):
                        # Use cached storage info if available
                        if hasattr(self, "_cached_storage_text"):
                            storage_text = self._cached_storage_text
                        else:
                            storage_text = "Storage: Fetching..."
                    else:
                        # Use cached storage info if recent
                        if (
                            hasattr(self, "_cached_storage_info")
                            and hasattr(self, "_storage_info_cache_time")
                            and current_time - self._storage_info_cache_time < 60.0
                        ):  # 60 second cache
                            card_info = self._cached_storage_info
                        else:
                            card_info = asyncio.run(self.device_manager.device_interface.get_storage_info())
                            self._cached_storage_info = card_info
                            self._storage_info_cache_time = current_time

                        if card_info and card_info.total_capacity > 0:
                            used_bytes, capacity_bytes = (
                                card_info.used_space,
                                card_info.total_capacity,
                            )
                            # Define constants for clarity - use decimal GB (1000-based) not binary GiB (1024-based)
                            BYTES_PER_MB_DECIMAL = 1000 * 1000
                            BYTES_PER_GB_DECIMAL = BYTES_PER_MB_DECIMAL * 1000
                            BYTES_PER_MB_BINARY = 1024 * 1024
                            BYTES_PER_GB_BINARY = BYTES_PER_MB_BINARY * 1024

                            # Display in GB if capacity is over ~0.9 GB (using decimal GB for proper "GB" labeling)
                            if capacity_bytes > BYTES_PER_GB_DECIMAL * 0.9:
                                used_gb = used_bytes / BYTES_PER_GB_DECIMAL
                                capacity_gb = capacity_bytes / BYTES_PER_GB_DECIMAL
                                storage_text = f"Storage: {used_gb:.2f}/{capacity_gb:.2f} GB"
                            else:
                                # Otherwise, display in MB (decimal)
                                used_mb = used_bytes / BYTES_PER_MB_DECIMAL
                                capacity_mb = capacity_bytes / BYTES_PER_MB_DECIMAL
                                storage_text = f"Storage: {used_mb:.0f}/{capacity_mb:.0f} MB"
                            storage_text += f" (Status: {hex(card_info.status_raw)})"
                            self._cached_storage_text = storage_text
                        else:
                            storage_text = "Storage: Fetching..."
            elif not self.backend_initialized_successfully:
                conn_status_text = "Status: USB Backend FAILED!"
            self.after(0, self._update_gui_with_status_info, conn_status_text, storage_text)
        finally:
            self._status_update_in_progress = False

    def _update_gui_with_status_info(self, conn_status_text, storage_text):
        """
        Updates the GUI labels with info fetched from the background thread.
        This method MUST be called from the main GUI thread (e.g., using `self.after`).
        """
        try:
            total_items = (
                len(self.file_tree.get_children())
                if hasattr(self, "file_tree") and self.file_tree.winfo_exists()
                else 0
            )
            selected_items_count = (
                len(self.file_tree.selection()) if hasattr(self, "file_tree") and self.file_tree.winfo_exists() else 0
            )
            size_selected_bytes = 0
            if selected_items_count > 0 and hasattr(self, "file_tree") and self.file_tree.winfo_exists():
                for item_iid in self.file_tree.selection():
                    file_detail = next(
                        (f for f in self.displayed_files_details if f["name"] == item_iid),
                        None,
                    )
                    if file_detail:
                        size_selected_bytes += file_detail.get("length", 0)
            file_counts_text = (
                f"Files: {total_items} total / {selected_items_count} "
                f"sel. ({size_selected_bytes / (1024 * 1024):.2f} MB)"
            )
        except (AttributeError, tkinter.TclError):
            file_counts_text = "Files: N/A"

        # Get calendar status text - check both async calendar and live Outlook integration
        calendar_status_text = "Calendar: Not Available"
        try:
            # Try to get status from simple_outlook_integration (live calendar)
            try:
                from simple_outlook_integration import create_simple_outlook_integration

                calendar_integration = create_simple_outlook_integration()
                if calendar_integration.is_available():
                    methods_list = ", ".join(calendar_integration.available_methods)
                    calendar_status_text = f"Calendar: Ready ({methods_list})"
                else:
                    error_msg = calendar_integration.last_error or "No methods available"
                    calendar_status_text = f"Calendar: Not Available - {error_msg}"
            except ImportError:
                # Fall back to async calendar status if simple_outlook_integration is not available
                if hasattr(self, "get_calendar_status_text_for_gui"):
                    calendar_status_text = self.get_calendar_status_text_for_gui()
        except Exception as e:
            logger.debug("GUI", "_update_gui_with_status_info", f"Error getting calendar status: {e}")

        if hasattr(self, "status_storage_label_header") and self.status_storage_label_header.winfo_exists():
            self.status_storage_label_header.configure(text=storage_text)
        if hasattr(self, "status_file_counts_label_header") and self.status_file_counts_label_header.winfo_exists():
            self.status_file_counts_label_header.configure(text=file_counts_text)

        # Update calendar status indicator
        if hasattr(self, "calendar_status_label_header") and self.calendar_status_label_header.winfo_exists():
            self.calendar_status_label_header.configure(text=calendar_status_text)

        if hasattr(self, "download_dir_button_header") and self.download_dir_button_header.winfo_exists():
            self.download_dir_button_header.configure(text=f"Dir: {os.path.basename(self.download_directory)}")

        # Show/hide disconnected indicator
        is_connected = self.device_manager.device_interface.is_connected()
        if hasattr(self, "disconnected_indicator") and self.disconnected_indicator.winfo_exists():
            if not is_connected:
                self.disconnected_indicator.pack(side="left", padx=10, pady=2)
            else:
                self.disconnected_indicator.pack_forget()

        self.update_status_bar(connection_status=conn_status_text)

    def _update_menu_states(self):
        """
        Updates the state (enabled/disabled) of menu items and toolbar buttons.
        """
        is_connected = self.device_manager.device_interface.is_connected()
        has_selection = bool(
            hasattr(self, "file_tree") and self.file_tree.winfo_exists() and self.file_tree.selection()
        )
        num_selected = len(self.file_tree.selection()) if has_selection else 0
        if hasattr(self, "file_menu"):
            self.file_menu.entryconfig(
                "Connect to HiDock",
                state=("normal" if not is_connected and self.backend_initialized_successfully else "disabled"),
            )
            self.file_menu.entryconfig("Disconnect", state="normal" if is_connected else "disabled")
        if hasattr(self, "view_menu"):
            self.view_menu.entryconfig("Refresh File List", state="normal" if is_connected else "disabled")
            # Enable "Check Selected Files for Meetings" if files are selected and calendar is available
            can_check_selected = (
                has_selection and hasattr(self, "_calendar_cache_manager") and self._calendar_cache_manager
            )
            self.view_menu.entryconfig(
                "Check Selected Files for Meetings", state="normal" if can_check_selected else "disabled"
            )
        can_play_selected = num_selected == 1
        if can_play_selected:
            file_iid = self.file_tree.selection()[0]
            file_detail = next(
                (f for f in self.displayed_files_details if f["name"] == file_iid),
                None,
            )
            if file_detail:
                is_audio_file = file_detail["name"].lower().endswith(".wav") or file_detail["name"].lower().endswith(
                    ".hda"
                )
                if not is_connected:
                    # When not connected, can only play downloaded files
                    local_path = self._get_local_filepath(file_detail["name"])
                    can_play_selected = is_audio_file and os.path.exists(local_path)
                else:
                    # When connected, can play any audio file (will download if needed)
                    can_play_selected = is_audio_file
            else:
                can_play_selected = False
        if hasattr(self, "actions_menu"):
            # Download available when connected and has selection (audio playback doesn't block downloads)
            self.actions_menu.entryconfig(
                "Download Selected",
                state="normal" if is_connected and has_selection and not self.is_long_operation_active else "disabled",
            )
            # Play available in both connected and offline modes (if file is downloaded)
            self.actions_menu.entryconfig("Play Selected", state="normal" if can_play_selected else "disabled")
            # Get Insights should work offline for downloaded files
            can_get_insights = (
                has_selection and num_selected == 1 and not self.is_long_operation_active and not self.is_audio_playing
            )
            if can_get_insights and not is_connected:
                # When not connected, only allow insights for downloaded files
                file_iid = self.file_tree.selection()[0]
                local_path = self._get_local_filepath(file_iid)
                can_get_insights = os.path.exists(local_path)

            self.actions_menu.entryconfig(
                "Get Insights",
                state="normal" if can_get_insights else "disabled",
            )
            self.actions_menu.entryconfig(
                "Delete Selected",
                state="normal" if is_connected and has_selection else "disabled",
            )
            can_select_all = (
                hasattr(self, "file_tree")
                and self.file_tree.winfo_exists()
                and len(self.file_tree.get_children()) > 0
                and num_selected < len(self.file_tree.get_children())
            )
            self.actions_menu.entryconfig("Select All", state="normal" if can_select_all else "disabled")
            self.actions_menu.entryconfig("Clear Selection", state="normal" if has_selection else "disabled")

            # Check if there are active operations to cancel
            all_active_operations = self.file_operations_manager.get_all_active_operations()
            active_operations = [op for op in all_active_operations if op.status.value in ["pending", "in_progress"]]

            # Separate by operation type
            active_downloads = [op for op in active_operations if op.operation_type.value == "download"]
            active_deletions = [op for op in active_operations if op.operation_type.value == "delete"]

            # Check if selected files have active downloads
            selected_filenames = (
                [self.file_tree.item(iid)["values"][1] for iid in self.file_tree.selection()] if has_selection else []
            )

            selected_active_downloads = [op for op in active_downloads if op.filename in selected_filenames]

            self.actions_menu.entryconfig(
                "Cancel Selected Downloads",
                state="normal" if selected_active_downloads else "disabled",
            )
            self.actions_menu.entryconfig(
                "Cancel All Downloads",
                state="normal" if active_downloads else "disabled",
            )
            self.actions_menu.entryconfig(
                "Cancel Active Deletions",
                state="normal" if active_deletions else "disabled",
            )
            self.actions_menu.entryconfig(
                "🛑 Cancel ALL Operations",
                state="normal" if active_operations else "disabled",
            )

            # Update Cancel toolbar button
            if hasattr(self, "toolbar_cancel_button"):
                self.toolbar_cancel_button.configure(state="normal" if active_operations else "disabled")

            # Update playback controls based on audio player state
            is_playing = hasattr(self, "audio_player") and self.audio_player.state.value in ["playing", "paused"]
            self.actions_menu.entryconfig("Stop Playback", state="normal" if is_playing else "disabled")
        if hasattr(self, "device_menu"):
            self.device_menu.entryconfig("Sync Device Time", state="normal" if is_connected else "disabled")
            self.device_menu.entryconfig("Format Storage", state="normal" if is_connected else "disabled")
        if hasattr(self, "toolbar_connect_button") and self.toolbar_connect_button.winfo_exists():
            if is_connected:
                self.toolbar_connect_button.configure(
                    text="Disconnect",
                    command=self.disconnect_device,
                    state="normal",
                    image=self.icons.get("disconnect"),
                )
            else:
                self.toolbar_connect_button.configure(
                    text="Connect",
                    command=self.connect_device,
                    state=("normal" if self.backend_initialized_successfully else "disabled"),
                    image=self.icons.get("connect"),
                    fg_color="orange",  # Orange to indicate disconnected
                )
        if hasattr(self, "toolbar_refresh_button") and self.toolbar_refresh_button.winfo_exists():
            if is_connected:
                self.toolbar_refresh_button.configure(
                    text="Refresh",
                    state=(
                        "normal"
                        if not self._is_ui_refresh_in_progress and not self.is_long_operation_active
                        else "disabled"
                    ),
                )
            else:
                self.toolbar_refresh_button.configure(
                    text="Offline",
                    state="disabled",
                    fg_color="gray",  # Gray to indicate offline
                )
        if hasattr(self, "toolbar_download_button") and self.toolbar_download_button.winfo_exists():
            if self.is_long_operation_active and self.active_operation_name == "Download Queue":
                self.toolbar_download_button.configure(
                    text="Cancel DL",
                    command=self.request_cancel_operation,
                    state="normal",
                    image=self.icons.get("stop"),
                )
            else:
                if is_connected:
                    self.toolbar_download_button.configure(
                        text="Download",
                        command=self.download_selected_files_gui,
                        state=(
                            "normal"
                            if has_selection and not self.is_long_operation_active
                            # Removed: and not self.is_audio_playing - downloads should be allowed during playback
                            else "disabled"
                        ),
                        image=self.icons.get("download"),
                    )
                else:
                    self.toolbar_download_button.configure(
                        text="Offline",
                        command=None,
                        state="disabled",
                        image=self.icons.get("download"),
                        fg_color="gray",  # Gray to indicate offline
                    )
        if hasattr(self, "toolbar_play_button") and self.toolbar_play_button.winfo_exists():
            if self.is_audio_playing:
                self.toolbar_play_button.configure(
                    text="Stop",
                    command=self._stop_audio_playback,
                    state="normal",
                    image=self.icons.get("stop"),
                )
            elif self.is_long_operation_active and self.active_operation_name == "Playback Preparation":
                self.toolbar_play_button.configure(
                    text="Cancel Prep",
                    command=self.request_cancel_operation,
                    state="normal",
                    image=self.icons.get("stop"),
                )
            else:
                self.toolbar_play_button.configure(
                    text="Play",
                    command=self.play_selected_audio_gui,
                    state=("normal" if can_play_selected and not self.is_long_operation_active else "disabled"),
                    image=self.icons.get("play"),
                )
        if hasattr(self, "toolbar_insights_button") and self.toolbar_insights_button.winfo_exists():
            if self.is_long_operation_active and self.active_operation_name == "Transcription":
                self.toolbar_insights_button.configure(
                    text="Cancel Insights",
                    command=self.request_cancel_operation,
                    state="normal",
                    image=self.icons.get("stop"),
                )
            else:
                # Insights require downloaded files, so check if file is playable (downloaded)
                can_get_insights = (
                    has_selection
                    and num_selected == 1
                    and not self.is_long_operation_active
                    and not self.is_audio_playing
                )
                if can_get_insights and not is_connected:
                    # When not connected, only allow insights for downloaded files
                    file_iid = self.file_tree.selection()[0]
                    local_path = self._get_local_filepath(file_iid)
                    can_get_insights = os.path.exists(local_path)
                elif can_get_insights:
                    # When connected, allow insights for any selected file
                    can_get_insights = True

                self.toolbar_insights_button.configure(
                    text="Get Insights",
                    command=self.get_insights_selected_file_gui,
                    state="normal" if can_get_insights else "disabled",
                    image=self.icons.get("insights", self.icons.get("play")),
                )
        if hasattr(self, "toolbar_delete_button") and self.toolbar_delete_button.winfo_exists():
            if self.is_long_operation_active and self.active_operation_name == "Deletion":
                self.toolbar_delete_button.configure(
                    text="Cancel Del.",
                    command=self.request_cancel_operation,
                    state="normal",
                    image=self.icons.get("stop"),
                )
            else:
                if is_connected:
                    # Check if any selected files are currently playing
                    can_delete = has_selection and not self.is_long_operation_active
                    if can_delete and self.is_audio_playing and self.current_playing_filename_for_replay:
                        # Check if any selected files are currently playing
                        selected_filenames = [
                            self.file_tree.item(iid)["values"][1] for iid in self.file_tree.selection()
                        ]
                        if self.current_playing_filename_for_replay in selected_filenames:
                            can_delete = False  # Can't delete currently playing file

                    self.toolbar_delete_button.configure(
                        text="Delete",
                        command=self.delete_selected_files_gui,
                        state="normal" if can_delete else "disabled",
                        image=self.icons.get("delete"),
                    )
                else:
                    self.toolbar_delete_button.configure(
                        text="Offline",
                        command=None,
                        state="disabled",
                        image=self.icons.get("delete"),
                        fg_color="gray",  # Gray to indicate offline
                    )
        if hasattr(self, "toolbar_settings_button") and self.toolbar_settings_button.winfo_exists():
            self.toolbar_settings_button.configure(state="normal")

    def _update_treeview_style(self):
        """
        Applies styling to the `ttk.Treeview` widget to match the CustomTkinter theme.
        """
        if not (hasattr(self, "file_tree") and self.file_tree.winfo_exists()):
            logger.debug("GUI", "_update_treeview_style", "file_tree not found, skipping.")
            return
        style = ttk.Style()
        if not ctk.ThemeManager.theme:
            logger.warning("GUI", "_update_treeview_style", "CTk ThemeManager.theme not populated.")
            return
        default_ctk_font = ctk.CTkFont()
        font_family, base_size = default_ctk_font.cget("family"), default_ctk_font.cget("size")
        tree_font_size = max(10, base_size - 1)
        tree_font = (font_family, tree_font_size)
        heading_font_size = base_size
        heading_font = (font_family, heading_font_size, "bold")
        current_mode = ctk.get_appearance_mode()
        try:
            frame_bg = self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkFrame"]["fg_color"])
            label_text_color = self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"]["text_color"])
            button_fg = self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["fg_color"])
            button_hover = self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["hover_color"])
            button_text = self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkButton"]["text_color"])
            heading_bg_candidate_1 = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkFrame"].get("top_fg_color", frame_bg)
            )
            heading_bg_candidate_2 = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkFrame"].get("border_color", frame_bg)
            )

            # Fix for light theme: Ensure heading has proper contrast
            if current_mode == "Light":
                # Use a darker gray for light mode headers
                default_heading_bg = "#d0d0d0"
                default_heading_fg = "#000000"
                active_heading_bg = "#b8b8b8"
                active_heading_fg = "#000000"
            else:
                # Dark mode logic remains the same
                default_heading_bg = (
                    heading_bg_candidate_1 if heading_bg_candidate_1 != frame_bg else heading_bg_candidate_2
                )
                default_heading_fg = button_text
                active_heading_bg = button_hover
                active_heading_fg = button_text

            tree_body_bg_color, tree_body_text_color = frame_bg, label_text_color
            tree_selected_bg_color, tree_selected_text_color = button_fg, button_text
        except KeyError as e:
            logger.error(
                "GUI",
                "_update_treeview_style",
                f"Theme key missing: {e}. Using fallbacks.",
            )
            tree_body_bg_color = "#ebebeb" if current_mode == "Light" else "#2b2b2b"
            tree_body_text_color = "black" if current_mode == "Light" else "white"
            tree_selected_bg_color = "#325882"
            tree_selected_text_color = "white"
            default_heading_bg = "#dbdbdb" if current_mode == "Light" else "#3b3b3b"
            default_heading_fg = tree_body_text_color
            active_heading_bg = "#c8c8c8" if current_mode == "Light" else "#4f4f4f"
            active_heading_fg = tree_body_text_color
        style.theme_use("clam")
        logger.debug("GUI", "_update_treeview_style", "Set ttk theme to 'clam'.")
        try:
            # Fix: Don't use "transparent" trough color - use visible colors instead
            scrollbar_trough = "#2b2b2b"  # Dark gray instead of transparent
            scrollbar_thumb = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkScrollbar"]["button_color"]
            )
            scrollbar_arrow = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkScrollbar"]["button_hover_color"]
            )
            style.configure(
                "Vertical.TScrollbar",
                troughcolor=scrollbar_trough,
                background=scrollbar_thumb,
                arrowcolor=scrollbar_arrow,
                borderwidth=1,  # Add border for visibility
                relief="solid",  # Solid relief instead of flat
            )
            style.map(
                "Vertical.TScrollbar",
                background=[
                    (
                        "active",
                        self.apply_appearance_mode_theme_color(
                            ctk.ThemeManager.theme["CTkScrollbar"]["button_hover_color"]
                        ),
                    )
                ],
                arrowcolor=[
                    (
                        "active",
                        self.apply_appearance_mode_theme_color(ctk.ThemeManager.theme["CTkLabel"]["text_color"]),
                    )
                ],
            )
            self.file_tree.configure(style="Treeview")
        except (tkinter.TclError, KeyError) as e_scroll:
            logger.warning(
                "GUI",
                "_update_treeview_style",
                f"Treeview/Scrollbar style error: {e_scroll}\n{traceback.format_exc()}",
            )
        style.configure(
            "Treeview",
            background=tree_body_bg_color,
            foreground=tree_body_text_color,
            fieldbackground=tree_body_bg_color,
            font=tree_font,
            rowheight=25,
        )
        style.map(
            "Treeview",
            background=[("selected", tree_selected_bg_color)],
            foreground=[("selected", tree_selected_text_color)],
        )
        style.configure(
            "Treeview.Heading",
            background=default_heading_bg,
            foreground=default_heading_fg,
            relief="flat",
            font=heading_font,
            padding=(5, 3),
        )
        style.map(
            "Treeview.Heading",
            background=[
                ("active", active_heading_bg),
                ("pressed", tree_selected_bg_color),
            ],
            foreground=[
                ("active", active_heading_fg),
                ("pressed", tree_selected_text_color),
            ],
            relief=[("active", "groove"), ("pressed", "sunken")],
        )
        tag_font_bold = (font_family, max(9, base_size - 2), "bold")
        self.file_tree.tag_configure("recording", font=tag_font_bold)

    def apply_theme_and_color(self):
        """
        Applies the selected CustomTkinter appearance mode and color theme.
        """
        mode = self.appearance_mode_var.get()
        theme_name = self.color_theme_var.get()
        ctk.set_appearance_mode(mode)
        try:
            ctk.set_default_color_theme(theme_name)
        except (RuntimeError, tkinter.TclError) as e:
            logger.error(
                "GUI",
                "apply_theme_and_color",
                f"Failed to set theme '{theme_name}': {e}. Using 'blue'.",
            )
            ctk.set_default_color_theme("blue")
            self.color_theme_var.set("blue")
            self.config["color_theme"] = "blue"
        new_mode_is_dark = ctk.get_appearance_mode() == "Dark"
        if new_mode_is_dark != (self._last_appearance_mode == "Dark") or not self.icons:
            self._load_icons()
        self._last_appearance_mode = ctk.get_appearance_mode()
        self.after(50, self._update_treeview_style)
        self.after(55, self._update_menubar_style)
        self.after(60, self._update_default_progressbar_colors)
        self.after(65, self._update_log_text_area_tag_colors)

    def _show_cached_files_on_startup(self):
        """Show cached files immediately on startup for better user experience."""
        try:
            # Enter offline mode since we're not connected
            self.offline_mode_manager.enter_offline_mode()

            cached_files = self.file_operations_manager.metadata_cache.get_all_metadata()
            if cached_files:
                logger.info(
                    "GUI",
                    "_show_cached_files_on_startup",
                    f"Showing {len(cached_files)} cached files on startup",
                )

                # Convert cached files to GUI format
                files_dict = self._convert_cached_files_to_gui_format(cached_files)

                # Enhance files with meeting metadata from calendar integration (synchronous for cached files)
                try:
                    files_dict = self.enhance_files_with_meeting_data_sync(files_dict)
                    logger.debug(
                        "GUI",
                        "_show_cached_files_on_startup",
                        f"Enhanced {len(files_dict)} cached files with meeting data",
                    )
                except Exception as e:
                    logger.warning(
                        "GUI", "_show_cached_files_on_startup", f"Failed to enhance cached files with meeting data: {e}"
                    )

                # Enhance files with audio metadata (transcription, AI analysis, user edits)
                try:
                    files_dict = self.enhance_files_with_audio_metadata(files_dict)
                    logger.debug(
                        "GUI",
                        "_show_cached_files_on_startup",
                        f"Enhanced {len(files_dict)} cached files with audio metadata",
                    )
                except Exception as e:
                    logger.warning(
                        "GUI",
                        "_show_cached_files_on_startup",
                        f"Failed to enhance cached files with audio metadata: {e}",
                    )

                # Sort and display with filtering support
                sorted_files = self._apply_saved_sort_state_to_tree_and_ui(files_dict)

                # Use filtering-aware update method if available
                if hasattr(self, "update_files_data_for_filtering"):
                    self.update_files_data_for_filtering(sorted_files)
                else:
                    self._populate_treeview_from_data(sorted_files)

                # Update status to show cached mode with offline statistics
                offline_stats = self.offline_mode_manager.get_offline_statistics()
                downloaded_count = offline_stats["downloaded_files"]
                availability_percent = offline_stats["offline_availability_percent"]

                self.update_status_bar(
                    connection_status="Status: Disconnected",
                    progress_text=f"Showing {len(cached_files)} cached files ({downloaded_count} playable, {availability_percent:.0f}% available offline)",
                )

        except Exception as e:
            logger.warning(
                "GUI",
                "_show_cached_files_on_startup",
                f"Error showing cached files: {e}",
            )

    def _convert_cached_files_to_gui_format(self, cached_files):
        """Convert cached FileMetadata objects to GUI display format."""
        files_dict = []
        for i, f_info in enumerate(cached_files):
            # Use offline mode manager to determine proper local file path
            local_path = self.offline_mode_manager.get_offline_file_path(f_info.filename)

            # Determine status: Downloaded if local file exists, On Device if cached but not downloaded
            if local_path and os.path.exists(local_path):
                gui_status = "Downloaded"
            else:
                gui_status = "On Device"

            files_dict.append(
                {
                    "name": f_info.filename,
                    "length": f_info.size,
                    "duration": f_info.duration,
                    "createDate": (f_info.date_created.strftime("%Y-%m-%d") if f_info.date_created else "---"),
                    "createTime": (f_info.date_created.strftime("%H:%M:%S") if f_info.date_created else "---"),
                    "time": f_info.date_created,
                    "version": "0",  # Version 0 for cached files when not connected
                    "original_index": i + 1,
                    "gui_status": gui_status,
                    "local_path": local_path,
                    "checksum": f_info.checksum,
                }
            )

        # Use offline mode manager to update status indicators properly
        files_dict = self.offline_mode_manager.update_offline_status_indicators(files_dict)
        return files_dict

    def apply_appearance_mode_theme_color(self, color_tuple_or_str):
        """
        Helper to get the correct color from a (light_mode_color, dark_mode_color) tuple
        or string based on the current CustomTkinter appearance mode.
        """
        if isinstance(color_tuple_or_str, (list, tuple)):
            return color_tuple_or_str[1] if ctk.get_appearance_mode() == "Dark" else color_tuple_or_str[0]
        return color_tuple_or_str

    def create_widgets(self):
        """Creates and lays out all the main widgets of the application window."""
        self._create_menubar()
        self._create_toolbar()
        self._create_status_bar()
        self._update_default_progressbar_colors()
        self._update_default_progressbar_colors()

        self._create_main_panel_layout()
        self._create_files_panel(self.main_content_frame)
        self._create_panels_toolbar(self.main_content_frame)
        self._create_transcription_panel(self.main_content_frame)
        self._create_log_panel(self.main_content_frame)
        self._create_audio_visualizer_panel(self.main_content_frame)
        self._update_log_text_area_tag_colors()

        # Set up GUI log callback for auto-show functionality
        self._setup_gui_log_callback()

        # Check for missing dependencies after GUI is initialized
        self.after(1000, self._check_dependencies)

    def _setup_gui_log_callback(self):
        """Set up GUI log callback to auto-show log panel on ERROR/CRITICAL messages."""
        try:
            if hasattr(logger, "add_gui_callback"):
                # Register callback with the logger to auto-show on high-severity messages
                logger.add_gui_callback(self._on_gui_log_message_callback)
                logger.info("GUI", "_setup_gui_log_callback", "GUI log auto-show callback registered")
            else:
                logger.warning("GUI", "_setup_gui_log_callback", "Logger does not support GUI callbacks")
        except Exception as e:
            logger.error("GUI", "_setup_gui_log_callback", f"Failed to setup GUI log callback: {e}")

    def _on_gui_log_message_callback(self, log_level, module, function, message, formatted_message):
        """Callback triggered when a log message is emitted to GUI.

        This callback auto-shows the log panel when ERROR or CRITICAL messages appear,
        providing emergency visibility without cluttering normal UI.

        Args:
            log_level (str): Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
            module (str): Module name where log originated
            function (str): Function name where log originated
            message (str): Original log message
            formatted_message (str): Formatted message for display
        """
        try:
            # Auto-show log panel for high-severity messages
            if log_level in ["ERROR", "CRITICAL"]:
                # Ensure we're on the main thread for GUI operations
                def auto_show_logs():
                    try:
                        # Only show if logs are currently hidden
                        if not self.logs_visible_var.get():
                            logger.info(
                                "GUI",
                                "_on_gui_log_message_callback",
                                f"Auto-showing log panel due to {log_level} message",
                            )
                            self.logs_visible_var.set(True)
                            self.toggle_logs()
                    except Exception as e:
                        # Avoid recursive logging errors by using basic print
                        print(f"Error auto-showing logs: {e}")

                # Schedule on main thread if we're not already on it
                if hasattr(self, "after"):
                    self.after(0, auto_show_logs)
                else:
                    auto_show_logs()

        except Exception as e:
            # Avoid recursive logging errors during callback handling
            print(f"Error in GUI log callback: {e}")

    def _create_main_panel_layout(self):
        """Creates the main content frame and configures its grid."""
        self.main_content_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.main_content_frame.pack(fill="both", expand=True, padx=5, pady=5)
        self.main_content_frame.grid_rowconfigure(0, weight=1)  # Files panel
        self.main_content_frame.grid_rowconfigure(1, weight=0)  # Panels toolbar
        self.main_content_frame.grid_rowconfigure(2, weight=0)  # Transcription panel
        self.main_content_frame.grid_rowconfigure(3, weight=0)  # Log panel
        self.main_content_frame.grid_rowconfigure(4, weight=0)  # Audio visualizer panel
        self.main_content_frame.grid_columnconfigure(0, weight=1)

    def _create_files_panel(self, _parent_frame):
        """Creates the file display panel including header and treeview."""
        files_frame = ctk.CTkFrame(self.main_content_frame)
        files_frame.grid(row=0, column=0, sticky="nsew", padx=0, pady=(0, 5))
        files_frame.grid_columnconfigure(0, weight=1)
        files_frame.grid_rowconfigure(0, weight=0)  # Header
        files_frame.grid_rowconfigure(1, weight=0)  # Unified filter widget
        files_frame.grid_rowconfigure(2, weight=1)  # TreeView
        files_header_frame = ctk.CTkFrame(files_frame, fg_color="transparent")
        files_header_frame.grid(row=0, column=0, sticky="ew", padx=5, pady=(5, 2))
        self.status_storage_label_header = ctk.CTkLabel(files_header_frame, text="Storage: ---", anchor="w")
        self.status_storage_label_header.pack(side="left", padx=10, pady=2)

        # Add disconnected indicator
        self.disconnected_indicator = ctk.CTkLabel(
            files_header_frame, text="🔌 DISCONNECTED", anchor="w", text_color="orange", font=("Arial", 12, "bold")
        )
        # Initially hidden, will be shown when disconnected
        # self.disconnected_indicator.pack(side="left", padx=10, pady=2)
        self.status_file_counts_label_header = ctk.CTkLabel(files_header_frame, text="Files: 0 / 0", anchor="w")
        self.status_file_counts_label_header.pack(side="left", padx=10, pady=2)

        # Calendar status indicator
        self.calendar_status_label_header = ctk.CTkLabel(files_header_frame, text="Calendar: Not Available", anchor="w")
        self.calendar_status_label_header.pack(side="left", padx=10, pady=2)
        self.download_dir_button_header = ctk.CTkButton(
            files_header_frame,
            text=f"Dir: {os.path.basename(self.download_directory)}",
            image=self.icons.get("folder"),
            compound="left",
            anchor="center",
            width=130,
            height=24,
            command=self._open_download_dir_in_explorer,
        )
        self.download_dir_button_header.bind("<Button-3>", self._select_download_dir_from_header_button)
        self.download_dir_button_header.pack(side="right", padx=(10, 0), pady=2)
        self.clear_selection_button_header = ctk.CTkButton(
            files_header_frame,
            text="",
            image=self.icons.get("clear_selection_files"),
            width=30,
            height=24,
            command=self.clear_selection_action,
        )
        self.clear_selection_button_header.pack(side="right", padx=(2, 2), pady=2)
        self.select_all_button_header = ctk.CTkButton(
            files_header_frame,
            text="",
            image=self.icons.get("select_all_files"),
            width=30,
            height=24,
            command=self.select_all_files_action,
        )
        self.select_all_button_header.pack(side="right", padx=(2, 2), pady=2)

        # Selection mode toggle button
        self.selection_mode_toggle_button = ctk.CTkButton(
            files_header_frame,
            text="Single" if self.single_selection_mode_var.get() else "Multi",
            width=50,
            height=24,
            command=self._toggle_selection_mode,
            fg_color="green" if self.single_selection_mode_var.get() else "blue",
        )
        self.selection_mode_toggle_button.pack(side="right", padx=(2, 2), pady=2)

        # Create unified filter widget instead of separate widgets
        self._create_unified_filter_widget(files_frame)

        # Note: Keep the old methods for backward compatibility, but don't call them
        # self._create_calendar_search_widget(files_frame)
        # self._create_status_filter_widget(files_frame)

        self._create_file_tree_frame_with_search_support(files_frame)
        # Apply initial selection mode and button visibility
        self._update_selection_buttons_visibility()
        self.file_tree.bind("<Control-A>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Delete>", self._on_delete_key_press)
        self.file_tree.bind("<Return>", self._on_enter_key_press)
        self.file_tree.bind("<Escape>", lambda event: self.cancel_selected_downloads_gui())
        self.file_tree.bind("<ButtonPress-1>", self._on_file_button1_press)
        self.file_tree.bind("<B1-Motion>", self._on_file_b1_motion)
        self.file_tree.bind("<ButtonRelease-1>", self._on_file_button1_release)

    def _toggle_selection_mode(self):
        """Toggle between single and multi selection modes."""
        current_mode = self.single_selection_mode_var.get()
        new_mode = not current_mode
        self.single_selection_mode_var.set(new_mode)

        # Update treeview selectmode
        self._update_treeview_selectmode()

        # Update toggle button appearance
        if hasattr(self, "selection_mode_toggle_button") and self.selection_mode_toggle_button.winfo_exists():
            self.selection_mode_toggle_button.configure(
                text="Single" if new_mode else "Multi", fg_color="green" if new_mode else "blue"
            )

        # Auto-save selection mode preference
        from config_and_logger import update_config_settings

        update_config_settings({"single_selection_mode": new_mode})

        # Update menu states
        self._update_menu_states()

    def _create_transcription_panel(self, parent_frame):
        """Creates the transcription and insights panel."""
        self.transcription_frame = ctk.CTkFrame(parent_frame)
        # Don't grid initially - will be shown when panel is toggled

        # Content container (scrollable) - initially hidden
        self.transcription_content = ctk.CTkScrollableFrame(self.transcription_frame)
        # Don't pack initially - will be shown when panel is toggled

        # Status header with cancel button
        status_frame = ctk.CTkFrame(self.transcription_content)
        status_frame.pack(fill="x", padx=10, pady=10)

        self.transcription_status_label = ctk.CTkLabel(
            status_frame,
            text="Select a file and click 'Get Insights' to see transcription and AI analysis.",
            anchor="w",
            font=("Arial", 12),
        )
        self.transcription_status_label.pack(side="left", fill="x", expand=True, padx=(0, 10))

        self.cancel_transcription_button = ctk.CTkButton(
            status_frame,
            text="Cancel",
            width=80,
            height=24,
            command=self._cancel_transcription,
            fg_color="red",
            hover_color="darkred",
        )
        # Initially hidden
        self.cancel_transcription_button.pack_forget()

        # Progress bar
        self.transcription_progress = ctk.CTkProgressBar(self.transcription_content)
        self.transcription_progress.pack(fill="x", padx=10, pady=(0, 10))
        self.transcription_progress.pack_forget()  # Initially hidden

        # Transcription section
        self.transcription_section = ctk.CTkFrame(self.transcription_content)
        self.transcription_section.pack(fill="both", expand=True, padx=5, pady=5)

        transcription_label = ctk.CTkLabel(
            self.transcription_section,
            text="📝 Transcription",
            font=("Arial", 14, "bold"),
        )
        transcription_label.pack(anchor="w", padx=10, pady=(10, 5))

        self.transcription_textbox = ctk.CTkTextbox(
            self.transcription_section, height=150, wrap="word", font=("Arial", 11)
        )
        self.transcription_textbox.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        # Insights section
        self.insights_section = ctk.CTkFrame(self.transcription_content)
        self.insights_section.pack(fill="both", expand=True, padx=5, pady=5)

        insights_label = ctk.CTkLabel(self.insights_section, text="🧠 AI Insights", font=("Arial", 14, "bold"))
        insights_label.pack(anchor="w", padx=10, pady=(10, 5))

        self.insights_textbox = ctk.CTkTextbox(self.insights_section, height=150, wrap="word", font=("Arial", 11))
        self.insights_textbox.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        # Initially hide the content sections
        self.transcription_section.pack_forget()
        self.insights_section.pack_forget()

        # Track panel state (start both panels hidden)
        self.transcription_panel_visible = False
        self.transcription_content_loaded = False
        self.visualizer_expanded = False

        # Background processing control
        self.transcription_cancelled = False
        self.current_transcription_thread = None

    def _toggle_transcription_panel(self):
        """Toggle visibility of the transcription panel."""
        if self.transcription_panel_visible:
            # Hide the entire frame
            self.transcription_frame.grid_forget()
            self.transcription_toolbar_toggle.configure(
                text="Show Transcription & Insights",
                image=self.icons.get("toggle_down", None),
            )
            self.transcription_panel_visible = False
        else:
            # Show the frame and content
            self.transcription_frame.grid(row=2, column=0, sticky="nsew", padx=0, pady=(0, 5))
            self.transcription_content.pack(fill="both", expand=True, padx=5, pady=(0, 5))
            # Also ensure the sections within the content are visible if content is loaded
            if self.transcription_content_loaded:
                self.transcription_section.pack(fill="both", expand=True, padx=5, pady=5)
                self.insights_section.pack(fill="both", expand=True, padx=5, pady=5)
            self.transcription_toolbar_toggle.configure(
                text="Hide Transcription & Insights",
                image=self.icons.get("toggle_up", None),
            )
            self.transcription_panel_visible = True

        # Update toolbar visibility
        self._update_panels_toolbar_visibility()

    def _toggle_visualizer_pin(self):
        """Toggle the pinned state of the audio visualizer."""
        self.visualizer_pinned = not self.visualizer_pinned

        # Update config variable and save efficiently
        self.visualizer_pinned_var.set(self.visualizer_pinned)
        from config_and_logger import update_config_settings

        update_config_settings({"visualizer_pinned": self.visualizer_pinned})

        # Update pin button appearance
        if self.visualizer_pinned:
            self.visualizer_pin_button.configure(text="Unpin", fg_color="green", hover_color="darkgreen")
        else:
            self.visualizer_pin_button.configure(text="Pin", fg_color="gray50", hover_color="gray40")

        # Update visibility logic
        self._update_visualizer_visibility()
        self._update_panels_toolbar_visibility()

        logger.info(
            "GUI",
            "_toggle_visualizer_pin",
            f"Visualizer pinned: {self.visualizer_pinned}",
        )

    def _show_pinned_placeholder(self):
        """Show placeholder content when visualizer is pinned but no file is selected."""
        try:
            if hasattr(self, "audio_visualizer_widget"):
                # Clear current visualization and show placeholder
                self.audio_visualizer_widget.clear()

                # Show placeholder message in the waveform visualizer
                waveform_viz = self.audio_visualizer_widget.waveform_visualizer
                waveform_viz.ax.clear()
                waveform_viz.ax.text(
                    0.5,
                    0.5,
                    "📌 Visualizer Pinned\nSelect a file to view waveform",
                    ha="center",
                    va="center",
                    color="#666666",
                    fontsize=14,
                    transform=waveform_viz.ax.transAxes,
                )
                waveform_viz.ax.set_xlim(0, 1)
                waveform_viz.ax.set_ylim(-1, 1)
                waveform_viz.ax.set_facecolor(waveform_viz.background_color)
                waveform_viz.canvas.draw()

        except Exception as e:
            logger.error("GUI", "_show_pinned_placeholder", f"Error showing placeholder: {e}")

    def _create_panels_toolbar(self, parent_frame):
        """Creates a unified toolbar for controlling transcription and audio visualization panels."""
        self.panels_toolbar_frame = ctk.CTkFrame(parent_frame)
        self.panels_toolbar_frame.grid(row=1, column=0, sticky="ew", padx=0, pady=(0, 2))

        # Create buttons with icons
        self._load_panel_icons()

        # Transcription panel toggle
        self.transcription_toolbar_toggle = ctk.CTkButton(
            self.panels_toolbar_frame,
            text="Show Transcription & Insights",
            image=self.icons.get("toggle_down", None),
            compound="left",
            command=self._toggle_transcription_panel,
            width=180,
            height=28,
        )
        self.transcription_toolbar_toggle.pack(side="left", padx=5, pady=2)

        # Audio visualization toggle
        self.visualizer_toolbar_toggle = ctk.CTkButton(
            self.panels_toolbar_frame,
            text="Show Audio Visualization",
            image=self.icons.get("toggle_down", None),
            compound="left",
            command=self._toggle_audio_visualizer,
            width=150,
            height=28,
        )
        self.visualizer_toolbar_toggle.pack(side="left", padx=5, pady=2)

        # Audio visualization pin button
        self.visualizer_pin_button = ctk.CTkButton(
            self.panels_toolbar_frame,
            text="Pin",
            image=self.icons.get("pin", None),
            compound="left",
            command=self._toggle_visualizer_pin,
            width=60,
            height=28,
            fg_color="gray50",
            hover_color="gray40",
        )
        self.visualizer_pin_button.pack(side="left", padx=2, pady=2)

        # Update pin button state based on config
        if self.visualizer_pinned:
            self.visualizer_pin_button.configure(text="Unpin", fg_color="green", hover_color="darkgreen")

        # Show the toolbar initially so users can access toggle buttons
        # The toolbar will be hidden only if both panels are hidden AND visualizer is not pinned
        self._update_panels_toolbar_visibility()

    def _load_panel_icons(self):
        """Load icons for panel controls."""
        try:
            icon_size = (16, 16)
            icons_dir = os.path.join(self.icon_base_path, "black", "16")

            # Info circle icon for transcription
            info_circle_path = os.path.join(icons_dir, "info-circle.png")
            if os.path.exists(info_circle_path):
                info_image = Image.open(info_circle_path)
                self.icons["info_circle"] = ctk.CTkImage(light_image=info_image, dark_image=info_image, size=icon_size)

            # Toggle icons for panels
            toggle_down_path = os.path.join(icons_dir, "toggle-down.png")
            if os.path.exists(toggle_down_path):
                toggle_down_image = Image.open(toggle_down_path)
                self.icons["toggle_down"] = ctk.CTkImage(
                    light_image=toggle_down_image,
                    dark_image=toggle_down_image,
                    size=icon_size,
                )

            toggle_up_path = os.path.join(icons_dir, "toggle-up.png")
            if os.path.exists(toggle_up_path):
                toggle_up_image = Image.open(toggle_up_path)
                self.icons["toggle_up"] = ctk.CTkImage(
                    light_image=toggle_up_image,
                    dark_image=toggle_up_image,
                    size=icon_size,
                )

            # Pin icon for pinning visualizer
            pin_path = os.path.join(icons_dir, "pin.png")
            if os.path.exists(pin_path):
                pin_image = Image.open(pin_path)
                self.icons["pin"] = ctk.CTkImage(light_image=pin_image, dark_image=pin_image, size=icon_size)

        except Exception as e:
            logger.warning("GUI", "_load_panel_icons", f"Error loading panel icons: {e}")

    def _update_panels_toolbar_visibility(self):
        """Show or hide the panels toolbar based on whether any panels are visible."""
        try:
            # Always show the toolbar so users can access toggle buttons
            # Only hide if explicitly requested (which we don't do currently)
            self.panels_toolbar_frame.grid(row=1, column=0, sticky="ew", padx=0, pady=(0, 2))
        except Exception as e:
            logger.error(
                "GUI",
                "_update_panels_toolbar_visibility",
                f"Error updating toolbar visibility: {e}",
            )

    def get_insights_selected_file_gui(self):
        """Get insights for the selected file and display in the integrated panel."""
        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo("No Selection", "Please select a file to analyze.", parent=self)
            return

        if len(selected_iids) > 1:
            messagebox.showinfo(
                "Multiple Selection",
                "Please select only one file for transcription.",
                parent=self,
            )
            return

        # Get the selected file details
        file_iid = selected_iids[0]
        file_detail = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)
        if not file_detail:
            messagebox.showerror("File Error", "Selected file details not found.", parent=self)
            return

        # Call the existing transcription method but capture results for UI display
        self._transcribe_selected_audio_gemini_for_panel(file_iid)

    def _transcribe_selected_audio_gemini_for_panel(self, file_iid):
        """Transcribe selected audio and display results in the integrated panel."""
        import os
        import threading

        # from transcription_module import process_audio_file_for_insights  # Future: for audio insights feature

        file_detail = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)
        if not file_detail:
            messagebox.showerror("Transcription Error", "File details not found.", parent=self)
            return

        local_filepath = self._get_local_filepath(file_detail["name"])
        if not os.path.isfile(local_filepath):
            messagebox.showerror(
                "File Not Found",
                f"Local file not found: {local_filepath}\nPlease download the file first.",
                parent=self,
            )
            return

        # Get API key from encrypted settings
        gemini_api_key = self.get_decrypted_api_key()
        if not gemini_api_key:
            messagebox.showerror(
                "API Key Missing",
                "AI API Key not configured. Please set your API key in Settings > AI Transcription.",
                parent=self,
            )
            return

        # Update UI to show processing state
        self._show_transcription_processing_state(file_detail["name"])

        # Show the toolbar since we're about to show transcription content
        self._update_panels_toolbar_visibility()

        # Cancel any existing transcription
        if self.current_transcription_thread and self.current_transcription_thread.is_alive():
            self._cancel_transcription()

        # Start transcription in background thread
        self._set_long_operation_active_state(True, "Transcription")
        self.update_status_bar(progress_text=f"Transcribing {file_detail['name']} with Gemini...")

        # Reset cancellation flag
        self.transcription_cancelled = False

        self.current_transcription_thread = threading.Thread(
            target=self._transcription_worker_for_panel,
            args=(local_filepath, gemini_api_key, file_detail["name"]),
            daemon=True,
        )
        self.current_transcription_thread.start()

    def _show_transcription_processing_state(self, filename):
        """Update the transcription panel to show processing state."""
        # Ensure panel is visible
        if not self.transcription_panel_visible:
            self._toggle_transcription_panel()

        # Show processing status with cancel button
        self.transcription_status_label.configure(
            text=f"🔄 Processing '{filename}' with AI transcription and insights..."
        )
        self.cancel_transcription_button.pack(side="right", padx=(10, 0))

        # Show progress bar with indeterminate mode
        self.transcription_progress.pack(fill="x", padx=10, pady=(0, 10))
        self.transcription_progress.configure(mode="indeterminate")
        self.transcription_progress.start()

        # Clear previous content and show placeholders
        self.transcription_textbox.delete("1.0", "end")
        self.transcription_textbox.insert("1.0", "🎵 Transcribing audio... Please wait.")
        self.transcription_textbox.configure(state="disabled")

        self.insights_textbox.delete("1.0", "end")
        self.insights_textbox.insert("1.0", "🧠 Extracting insights... Please wait.")
        self.insights_textbox.configure(state="disabled")

        # Show the content sections
        self.transcription_section.pack(fill="both", expand=True, padx=5, pady=5)
        self.insights_section.pack(fill="both", expand=True, padx=5, pady=5)

    def _cancel_transcription(self):
        """Cancel the current transcription process."""
        self.transcription_cancelled = True
        if self.current_transcription_thread and self.current_transcription_thread.is_alive():
            logger.info("GUI", "_cancel_transcription", "Transcription cancellation requested")
            # Update UI immediately
            self.after(0, self._on_transcription_cancelled)

    def _on_transcription_cancelled(self):
        """Handle transcription cancellation in main thread."""
        self._set_long_operation_active_state(False, "Transcription")
        self.update_status_bar(progress_text="Transcription cancelled")

        # Update UI
        self.transcription_status_label.configure(text="❌ Transcription cancelled by user")
        self.cancel_transcription_button.pack_forget()
        self.transcription_progress.stop()
        self.transcription_progress.pack_forget()

        # Reset content
        self.transcription_textbox.configure(state="normal")
        self.transcription_textbox.delete("1.0", "end")
        self.transcription_textbox.insert("1.0", "Transcription was cancelled.")
        self.transcription_textbox.configure(state="disabled")

        self.insights_textbox.configure(state="normal")
        self.insights_textbox.delete("1.0", "end")
        self.insights_textbox.insert("1.0", "Insights extraction was cancelled.")
        self.insights_textbox.configure(state="disabled")

    def _transcription_worker_for_panel(self, file_path, api_key, original_filename):
        """Background worker that processes transcription for the panel display."""
        try:
            # Check for cancellation before starting
            if self.transcription_cancelled:
                return

            import asyncio

            # Get AI provider configuration
            provider = self.ai_api_provider_var.get()
            config = {
                "model": self.ai_model_var.get(),
                "temperature": self.ai_temperature_var.get(),
                "max_tokens": self.ai_max_tokens_var.get(),
                "base_url": getattr(self, f"ai_{provider}_base_url_var", None),
                "region": getattr(self, f"ai_{provider}_region_var", None),
            }
            # Clean up None values
            config = {k: v.get() if hasattr(v, "get") else v for k, v in config.items() if v is not None}
            language = self.ai_language_var.get()

            # Since process_audio_file_for_insights is async, we need to run it in an event loop
            results = asyncio.run(process_audio_file_for_insights(file_path, provider, api_key, config, language))

            # Check for cancellation before updating UI
            if self.transcription_cancelled:
                return

            self.after(0, self._on_transcription_complete_for_panel, results, original_filename)
        except Exception as e:
            if not self.transcription_cancelled:
                logger.error(
                    "GUI",
                    "_transcription_worker_for_panel",
                    f"Error during transcription: {e}",
                )
                self.after(
                    0,
                    self._on_transcription_complete_for_panel,
                    {"error": str(e)},
                    original_filename,
                )

    def _on_transcription_complete_for_panel(self, results, original_filename):
        """Handle completion of transcription and update the panel."""
        self._set_long_operation_active_state(False, "Transcription")

        # Hide progress controls
        self.cancel_transcription_button.pack_forget()
        self.transcription_progress.stop()
        self.transcription_progress.pack_forget()

        if "error" in results:
            # Show error in panel
            self.transcription_status_label.configure(
                text=f"❌ Error transcribing '{original_filename}': {results['error']}"
            )
            self.transcription_textbox.configure(state="normal")
            self.transcription_textbox.delete("1.0", "end")
            self.transcription_textbox.insert("1.0", f"Error: {results['error']}")
            self.transcription_textbox.configure(state="disabled")

            self.insights_textbox.configure(state="normal")
            self.insights_textbox.delete("1.0", "end")
            self.insights_textbox.insert("1.0", "Insights unavailable due to transcription error.")
            self.insights_textbox.configure(state="disabled")

            self.update_status_bar(progress_text=f"Transcription failed for {original_filename}.")
        else:
            # Show successful results
            transcription_text = results.get("transcription", "No transcription found.")
            insights = results.get("insights", {})

            # Update status
            self.transcription_status_label.configure(
                text=f"✅ Transcription and insights completed for '{original_filename}'"
            )

            # Update transcription text
            self.transcription_textbox.configure(state="normal")
            self.transcription_textbox.delete("1.0", "end")
            self.transcription_textbox.insert("1.0", transcription_text)
            self.transcription_textbox.configure(state="disabled")

            # Format and display insights
            insights_formatted = self._format_insights_for_display(insights)
            self.insights_textbox.configure(state="normal")
            self.insights_textbox.delete("1.0", "end")
            self.insights_textbox.insert("1.0", insights_formatted)
            self.insights_textbox.configure(state="disabled")

            self.update_status_bar(progress_text=f"Transcription complete for {original_filename}.")

            # Mark content as loaded
            self.transcription_content_loaded = True

    def _format_insights_for_display(self, insights):
        """Format the insights dictionary for readable display."""
        if not insights:
            return "No insights available."

        formatted = ""

        # Summary
        if insights.get("summary", "N/A") != "N/A":
            formatted += f"📋 SUMMARY:\n{insights.get('summary', 'N/A')}\n\n"

        # Category
        if insights.get("category", "N/A") != "N/A":
            formatted += f"🏷️ CATEGORY: {insights.get('category', 'N/A')}\n\n"

        # Meeting Details
        meeting_details = insights.get("meeting_details", {})
        if meeting_details and any(v != "N/A" and v != 0 for v in meeting_details.values()):
            formatted += "📅 MEETING DETAILS:\n"
            if meeting_details.get("date", "N/A") != "N/A":
                formatted += f"  Date: {meeting_details.get('date', 'N/A')}\n"
            if meeting_details.get("time", "N/A") != "N/A":
                formatted += f"  Time: {meeting_details.get('time', 'N/A')}\n"
            if meeting_details.get("location", "N/A") != "N/A":
                formatted += f"  Location: {meeting_details.get('location', 'N/A')}\n"
            if meeting_details.get("duration_minutes", 0) > 0:
                formatted += f"  Duration: {meeting_details.get('duration_minutes', 0)} minutes\n"
            formatted += "\n"

        # Sentiment
        if insights.get("overall_sentiment_meeting", "N/A") != "N/A":
            formatted += f"😊 SENTIMENT: {insights.get('overall_sentiment_meeting', 'N/A')}\n\n"

        # Action Items
        action_items = insights.get("action_items", [])
        if action_items:
            formatted += "✅ ACTION ITEMS:\n"
            for i, item in enumerate(action_items, 1):
                formatted += f"  {i}. {item}\n"
            formatted += "\n"

        # Project Context
        if insights.get("project_context", "N/A") != "N/A":
            formatted += f"🔗 PROJECT CONTEXT:\n{insights.get('project_context', 'N/A')}\n"

        return formatted if formatted else "No detailed insights available."

    def _create_log_panel(self, _parent_frame):
        """Creates the logging panel with controls and text area."""
        self.log_frame = ctk.CTkFrame(self.main_content_frame)
        log_controls_sub_frame = ctk.CTkFrame(self.log_frame, fg_color="transparent")
        log_controls_sub_frame.pack(fill="x", pady=(5, 5), padx=5)
        self.clear_log_button = ctk.CTkButton(
            log_controls_sub_frame,
            text="Clear",
            image=self.icons.get("clear_log_button"),
            command=self.clear_log_gui,
            width=90,
        )
        self.clear_log_button.pack(side="left", padx=(0, 10))
        ctk.CTkLabel(log_controls_sub_frame, text="Level:").pack(side="left", padx=(0, 5))
        self.log_section_level_combo = ctk.CTkComboBox(
            log_controls_sub_frame,
            variable=self.gui_log_filter_level_var,
            values=list(Logger.LEVELS.keys()),
            state="readonly",
            width=110,
            command=self.on_gui_log_filter_change,
        )
        self.log_section_level_combo.pack(side="left", padx=(0, 10))
        self.download_logs_button = ctk.CTkButton(
            log_controls_sub_frame,
            text="Save Log",
            image=self.icons.get("download_log_button"),
            command=self.download_gui_logs,
            width=110,
        )
        self.download_logs_button.pack(side="left", padx=(0, 0))
        self.log_text_area = ctk.CTkTextbox(self.log_frame, height=100, state="disabled", wrap="word", border_spacing=3)
        self.log_text_area.pack(fill="both", expand=True, padx=5, pady=(0, 5))
        self._update_log_text_area_tag_colors()

    def _create_audio_visualizer_panel(self, parent_frame):
        """Creates the audio visualizer panel."""
        self.audio_visualizer_frame = ctk.CTkFrame(parent_frame)
        # Don't grid initially - will be shown when panel is toggled

        self.audio_visualizer_widget = AudioVisualizationWidget(self.audio_visualizer_frame, height=150)

        # Connect audio player to visualization widget for speed controls
        self.audio_visualizer_widget.set_audio_player(self.audio_player)

        # Initially hide the visualization widget
        self._update_visualizer_visibility()

        # Setup audio player callbacks for visualization
        self._setup_audio_visualization_callbacks()

    def _set_minimum_window_size(self):
        """Sets the minimum size of the main window to ensure all widgets are visible."""
        self.update_idletasks()
        min_w = 800
        min_h = 600
        try:
            min_w = self.toolbar_frame.winfo_reqwidth() + 100
            min_h = self.toolbar_frame.winfo_reqheight() + self.status_bar_frame.winfo_reqheight() + 200
        except (AttributeError, tkinter.TclError):
            pass
        self.minsize(min_w, min_h)

    def _check_dependencies(self):
        """Check for missing dependencies and show user-friendly warnings."""
        try:
            import shutil

            # subprocess already imported at module level - no need to import again
            # from tkinter import messagebox  # Already imported at module level
            # Check for ffmpeg
            ffmpeg_available = False
            try:
                # Try to find ffmpeg in PATH
                if shutil.which("ffmpeg"):
                    ffmpeg_available = True
                else:
                    # Try to run ffmpeg to see if it's available
                    subprocess.run(
                        ["ffmpeg", "-version"],
                        capture_output=True,
                        check=True,
                        timeout=5,
                    )
                    ffmpeg_available = True
            except (
                subprocess.CalledProcessError,
                subprocess.TimeoutExpired,
                FileNotFoundError,
            ):
                ffmpeg_available = False

            if not ffmpeg_available:
                logger.warning(
                    "MainWindow",
                    "_check_dependencies",
                    "FFmpeg not found - audio conversion features will be limited",
                )

                # Show user-friendly warning
                self._show_ffmpeg_warning()

        except Exception as e:
            logger.error("MainWindow", "_check_dependencies", f"Error checking dependencies: {e}")

    def _show_ffmpeg_warning(self):
        """Show a user-friendly warning about missing ffmpeg dependency."""
        try:
            import platform
            from tkinter import messagebox

            system = platform.system().lower()

            if system == "windows":
                install_msg = """To install FFmpeg on Windows:
1. Download from: https://ffmpeg.org/download.html#build-windows
2. Extract to a folder (e.g., C:\\ffmpeg)
3. Add C:\\ffmpeg\\bin to your PATH environment variable
4. Restart the application

Alternative: Install via Chocolatey: choco install ffmpeg"""
            elif system == "darwin":  # macOS
                install_msg = """To install FFmpeg on macOS:
1. Install Homebrew: https://brew.sh
2. Run: brew install ffmpeg
3. Restart the application

Alternative: Download from https://ffmpeg.org/download.html#build-mac"""
            else:  # Linux
                install_msg = """To install FFmpeg on Linux:
Ubuntu/Debian: sudo apt update && sudo apt install ffmpeg
CentOS/RHEL: sudo yum install ffmpeg
Fedora: sudo dnf install ffmpeg
Arch: sudo pacman -S ffmpeg

Alternative: Download from https://ffmpeg.org/download.html#build-linux"""

            message = f"""FFmpeg Not Found

Advanced audio format conversion features are currently unavailable.
Basic audio playback will still work normally.

{install_msg}

You can dismiss this warning and continue using the application with limited audio conversion capabilities."""

            messagebox.showwarning("Missing Dependency - FFmpeg", message, parent=self)

        except Exception as e:
            logger.error(
                "MainWindow",
                "_show_ffmpeg_warning",
                f"Error showing ffmpeg warning: {e}",
            )

    def _setup_audio_visualization_callbacks(self):
        """Setup callbacks to connect audio player with visualization widget."""
        try:
            logger.info(
                "MainWindow",
                "_setup_audio_visualization_callbacks",
                "Setting up audio visualization callbacks...",
            )

            # Connect position updates to visualization
            self.audio_player.on_position_changed = self._on_audio_position_changed
            logger.info(
                "MainWindow",
                "_setup_audio_visualization_callbacks",
                "Position callback connected",
            )

            # Connect state changes to visualization
            self.audio_player.on_state_changed = self._on_audio_state_changed
            logger.info(
                "MainWindow",
                "_setup_audio_visualization_callbacks",
                "State callback connected",
            )

            logger.info(
                "MainWindow",
                "_setup_audio_visualization_callbacks",
                "Audio visualization callbacks setup successfully",
            )

        except Exception as e:
            logger.error(
                "MainWindow",
                "_setup_audio_visualization_callbacks",
                f"Error setting up visualization callbacks: {e}",
            )

    def _on_audio_position_changed(self, position):
        """Handle audio position changes and update visualization."""
        try:
            logger.debug(
                "MainWindow",
                "_on_audio_position_changed",
                f"Position update: {position.current_time:.1f}s / "
                f"{position.total_time:.1f}s ({position.percentage:.1f}%)",
            )

            if hasattr(self, "audio_visualizer_widget") and self.audio_visualizer_widget:
                # Only update position if the currently selected file matches the playing file
                current_track = self.audio_player.get_current_track()
                if current_track and self.current_playing_filename_for_replay:
                    # Check if the currently visualized file matches the playing file
                    selected_iids = self.file_tree.selection()
                    if selected_iids:
                        selected_filename = selected_iids[-1]  # Get last selected file
                        if selected_filename == self.current_playing_filename_for_replay:
                            # Only update position if visualizing the currently playing file
                            self.audio_visualizer_widget.update_position(position)
                        else:
                            # Different file is selected - don't show position updates
                            logger.debug(
                                "MainWindow",
                                "_on_audio_position_changed",
                                f"Skipping position update - visualizing {selected_filename} "
                                f"but playing {self.current_playing_filename_for_replay}",
                            )

        except Exception as e:
            logger.error(
                "MainWindow",
                "_on_audio_position_changed",
                f"Error updating visualization position: {e}",
            )

    def _on_audio_state_changed(self, state):
        """Handle audio state changes and update visualization accordingly."""
        try:
            from audio_player_enhanced import PlaybackState

            if hasattr(self, "audio_visualizer_widget") and self.audio_visualizer_widget:
                if state == PlaybackState.PLAYING:
                    # Auto-show visualization when audio starts playing
                    if hasattr(self, "visualizer_expanded") and not self.visualizer_expanded:
                        self.visualizer_expanded = True
                        self._update_visualizer_visibility()

                    # Start spectrum analysis if available
                    current_track = self.audio_player.get_current_track()
                    if current_track:
                        # Get audio data for spectrum analysis
                        try:
                            from audio_player_enhanced import AudioProcessor

                            (
                                waveform_data,
                                sample_rate,
                            ) = AudioProcessor.extract_waveform_data(current_track.filepath, max_points=1024)
                            if len(waveform_data) > 0:
                                self.audio_visualizer_widget.start_spectrum_analysis(waveform_data, sample_rate)
                        except Exception as spectrum_error:
                            logger.warning(
                                "MainWindow",
                                "_on_audio_state_changed",
                                f"Could not start spectrum analysis: {spectrum_error}",
                            )

                elif state in [PlaybackState.STOPPED, PlaybackState.PAUSED]:
                    # Stop spectrum analysis
                    self.audio_visualizer_widget.stop_spectrum_analysis()

        except Exception as e:
            logger.error(
                "MainWindow",
                "_on_audio_state_changed",
                f"Error handling audio state change: {e}",
            )

    def _toggle_audio_visualizer(self):
        """Toggle the audio visualizer visibility."""
        try:
            self.visualizer_expanded = not self.visualizer_expanded
            self._update_visualizer_visibility()
            self._update_panels_toolbar_visibility()
        except Exception as e:
            logger.error(
                "MainWindow",
                "_toggle_audio_visualizer",
                f"Error toggling visualizer: {e}",
            )

    def _update_visualizer_visibility(self):
        """Update the visibility of the audio visualizer."""
        try:
            if self.visualizer_expanded or self.visualizer_pinned:
                # Show the frame and widget
                self.audio_visualizer_frame.grid(row=4, column=0, sticky="ew", padx=0, pady=(0, 5))
                self.audio_visualizer_widget.pack(fill="x", expand=False, padx=5, pady=(0, 5))
                if hasattr(self, "visualizer_toolbar_toggle"):
                    self.visualizer_toolbar_toggle.configure(
                        text="Hide Audio Visualization",
                        image=self.icons.get("toggle_up", None),
                    )
            else:
                # Hide the entire frame
                self.audio_visualizer_frame.grid_forget()
                if hasattr(self, "visualizer_toolbar_toggle"):
                    self.visualizer_toolbar_toggle.configure(
                        text="Show Audio Visualization",
                        image=self.icons.get("toggle_down", None),
                    )
        except Exception as e:
            logger.error(
                "MainWindow",
                "_update_visualizer_visibility",
                f"Error updating visibility: {e}",
            )

    def _update_waveform_for_selection(self):
        """Update waveform visualization based on current file selection."""
        try:
            selected_iids = self.file_tree.selection()

            if not selected_iids:
                # No file selected - hide visualization section unless pinned
                if hasattr(self, "visualizer_expanded") and self.visualizer_expanded and not self.visualizer_pinned:
                    self.visualizer_expanded = False
                    self._update_visualizer_visibility()
                elif self.visualizer_pinned and not self.visualizer_expanded:
                    # Show pinned visualizer with placeholder
                    self.visualizer_expanded = True
                    self._update_visualizer_visibility()
                    self._show_pinned_placeholder()
                return

            # Only process single selection to avoid loading multiple waveforms
            if len(selected_iids) != 1:
                return

            # Get the selected file
            selected_iid = selected_iids[0]
            file_detail = next(
                (f for f in self.displayed_files_details if f["name"] == selected_iid),
                None,
            )

            if not file_detail:
                return

            filename = file_detail["name"]
            local_filepath = self._get_local_filepath(filename)

            # Only show visualization section if file is downloaded
            if os.path.exists(local_filepath):
                # File is downloaded - show visualization and load waveform if not pinned
                if hasattr(self, "visualizer_expanded") and not self.visualizer_expanded and not self.visualizer_pinned:
                    self.visualizer_expanded = True
                    self._update_visualizer_visibility()

                if hasattr(self, "audio_visualizer_widget"):
                    # Only load if it's a different file to avoid redundant loading
                    if not hasattr(self, "_last_loaded_waveform_file") or self._last_loaded_waveform_file != filename:
                        # Show immediate loading feedback
                        self._show_waveform_loading_state(filename)

                        # Load waveform in background thread for better performance
                        import threading

                        threading.Thread(
                            target=self._load_waveform_background, args=(local_filepath, filename), daemon=True
                        ).start()

                        self._last_loaded_waveform_file = filename

                    # If this file is not currently playing, clear position indicators
                    if filename != self.current_playing_filename_for_replay:
                        # Clear position indicators for non-playing files
                        self.audio_visualizer_widget.clear_position_indicators()
            else:
                # File not downloaded - hide visualization section unless pinned
                if hasattr(self, "visualizer_expanded") and self.visualizer_expanded and not self.visualizer_pinned:
                    self.visualizer_expanded = False
                    self._update_visualizer_visibility()
                elif self.visualizer_pinned:
                    # Show pinned placeholder
                    self._show_pinned_placeholder()

        except Exception as e:
            logger.error(
                "MainWindow",
                "_update_waveform_for_selection",
                f"Error updating waveform: {e}",
            )

    def _show_waveform_loading_state(self, filename):
        """Show immediate loading feedback in the waveform visualizer."""
        try:
            if hasattr(self, "audio_visualizer_widget") and hasattr(
                self.audio_visualizer_widget, "waveform_visualizer"
            ):
                # Show loading message in the waveform visualizer
                waveform_viz = self.audio_visualizer_widget.waveform_visualizer
                waveform_viz.ax.clear()
                waveform_viz.ax.text(
                    0.5,
                    0.5,
                    f"Loading waveform...\n{os.path.basename(filename)}",
                    ha="center",
                    va="center",
                    color="#4A90E2",
                    fontsize=12,
                    transform=waveform_viz.ax.transAxes,
                )
                waveform_viz.ax.set_xlim(0, 1)
                waveform_viz.ax.set_ylim(-1, 1)
                waveform_viz.ax.set_facecolor(waveform_viz.background_color)
                waveform_viz.canvas.draw()
                logger.debug("WaveformLoader", "_show_waveform_loading_state", f"Loading message shown for {filename}")
        except Exception as e:
            logger.error("MainWindow", "_show_waveform_loading_state", f"Error showing loading state: {e}")

    def _load_waveform_background(self, filepath, filename):
        """Load waveform in background thread and update UI when complete."""
        try:
            # This runs in background thread - don't touch GUI directly
            logger.info("WaveformLoader", "_load_waveform_background", f"Loading waveform for {filename}")

            # Use the fixed AudioProcessor method instead of librosa directly
            from audio_player_enhanced import AudioProcessor

            # Load audio data in background (this is the slow part)
            try:
                y, sr = AudioProcessor.extract_waveform_data(filepath, max_points=2000)

                if len(y) == 0:
                    raise Exception("No waveform data extracted")

                # Schedule GUI update on main thread with pre-processed data
                self.after(0, self._update_waveform_with_data, y, sr, filename)

            except Exception as load_error:
                logger.debug(
                    "WaveformLoader", "_load_waveform_background", f"Error loading audio waveform: {load_error}"
                )
                self.after(0, self._handle_waveform_load_error, filename, str(load_error))

        except Exception as e:
            logger.error("MainWindow", "_load_waveform_background", f"Error in background loading: {e}")
            # Schedule error handling on main thread
            self.after(0, self._handle_waveform_load_error, filename, str(e))

    def _update_waveform_with_data(self, audio_data, sample_rate, filename):
        """Update waveform visualization with pre-loaded data (called on main thread)."""
        try:
            if hasattr(self, "audio_visualizer_widget") and hasattr(
                self.audio_visualizer_widget, "waveform_visualizer"
            ):
                # Check if this is still the selected file
                current_selection = self.file_tree.selection()
                if len(current_selection) == 1 and current_selection[0] == filename:
                    # Update visualization with pre-processed data
                    waveform_viz = self.audio_visualizer_widget.waveform_visualizer
                    waveform_viz.ax.clear()

                    # Create time axis
                    time_axis = np.linspace(0, len(audio_data) / sample_rate, len(audio_data))

                    # Plot waveform
                    waveform_viz.ax.plot(time_axis, audio_data, color="#4A90E2", linewidth=0.5)
                    waveform_viz.ax.set_xlim(0, time_axis[-1])
                    waveform_viz.ax.set_ylim(-1, 1)
                    waveform_viz.ax.set_xlabel("Time (s)")
                    waveform_viz.ax.set_ylabel("Amplitude")
                    waveform_viz.ax.set_facecolor(waveform_viz.background_color)
                    waveform_viz.canvas.draw()

                    logger.info("WaveformLoader", "_update_waveform_with_data", f"Waveform updated for {filename}")
                else:
                    logger.debug(
                        "WaveformLoader",
                        "_update_waveform_with_data",
                        f"Skipping update - selection changed from {filename}",
                    )
        except Exception as e:
            logger.error("MainWindow", "_update_waveform_with_data", f"Error updating waveform: {e}")
            self._handle_waveform_load_error(filename, str(e))

    def _handle_waveform_load_error(self, filename, error_msg):
        """Handle waveform loading errors."""
        try:
            if hasattr(self, "audio_visualizer_widget") and hasattr(
                self.audio_visualizer_widget, "waveform_visualizer"
            ):
                waveform_viz = self.audio_visualizer_widget.waveform_visualizer
                waveform_viz.ax.clear()
                waveform_viz.ax.text(
                    0.5,
                    0.5,
                    f"Error loading waveform\n{os.path.basename(filename)}\n{error_msg[:50]}...",
                    ha="center",
                    va="center",
                    color="#E74C3C",
                    fontsize=10,
                    transform=waveform_viz.ax.transAxes,
                )
                waveform_viz.ax.set_xlim(0, 1)
                waveform_viz.ax.set_ylim(-1, 1)
                waveform_viz.ax.set_facecolor(waveform_viz.background_color)
                waveform_viz.canvas.draw()
        except Exception as e:
            logger.error("MainWindow", "_handle_waveform_load_error", f"Error handling waveform error: {e}")

    def _play_local_file(self, local_filepath):
        """Loads and plays a local file, and updates the visualizer."""
        self.audio_player.load_track(local_filepath)

        # Ensure the visualization is showing the file we're about to play
        self.audio_visualizer_widget.load_audio(local_filepath)

        # Clear any previous position indicators before starting new playback
        self.audio_visualizer_widget.clear_position_indicators()

        self.audio_player.play()

        # Update UI state to reflect playback
        self.is_audio_playing = True
        self.current_playing_filename_for_replay = os.path.basename(local_filepath)
        self._update_menu_states()

    def stop_audio_playback_gui(self):
        """Stops audio playback and updates the UI."""
        try:
            self.audio_player.stop()
            self.is_audio_playing = False

            # Clear position indicators in visualization when stopping playback
            if hasattr(self, "audio_visualizer_widget") and self.audio_visualizer_widget:
                self.audio_visualizer_widget.clear_position_indicators()

            # Update the specific file's status in treeview without full refresh
            if self.current_playing_filename_for_replay:
                # Find the file detail to determine the correct status
                file_detail = next(
                    (f for f in self.displayed_files_details if f["name"] == self.current_playing_filename_for_replay),
                    None,
                )

                if file_detail:
                    # Determine the appropriate status after stopping playback
                    new_status = "Downloaded" if file_detail.get("local_path") else "On Device"

                    # Determine appropriate tags (remove "playing" tag)
                    tags = []
                    if new_status == "Downloaded":
                        tags.append("downloaded_ok")

                    # Update only this specific file in the treeview
                    self._update_file_status_in_treeview(
                        self.current_playing_filename_for_replay,
                        new_status,
                        tuple(tags),
                    )

            self.current_playing_filename_for_replay = None
            self.update_status_bar(progress_text="Playback stopped.")
            self._update_menu_states()

        except Exception as e:
            logger.error("GUI", "stop_audio_playback_gui", f"Error stopping playback: {e}")
            messagebox.showerror("Playback Error", f"Error stopping playback: {e}", parent=self)

    def pause_audio_playback_gui(self):
        """Pauses/resumes audio playback."""
        try:
            if self.audio_player.state.value == "playing":
                self.audio_player.pause()
                self.update_status_bar(progress_text="Playback paused.")
            elif self.audio_player.state.value == "paused":
                self.audio_player.play()
                self.update_status_bar(progress_text="Playback resumed.")

            self._update_menu_states()

        except Exception as e:
            logger.error(
                "GUI",
                "pause_audio_playback_gui",
                f"Error pausing/resuming playback: {e}",
            )
            messagebox.showerror("Playback Error", f"Error pausing/resuming playback: {e}", parent=self)

    def _stop_audio_playback(self):
        """Internal method for stopping audio playback (used by toolbar button)."""
        self.stop_audio_playback_gui()

    def _download_for_playback_and_play(self, filename, local_filepath):
        """
        Downloads a single file and triggers playback upon successful completion.
        """
        # Show brief status message instead of interrupting dialog
        self.update_status_bar(progress_text=f"Downloading '{filename}' for playback...")

        def on_playback_download_complete(operation):
            """Callback for the file operation manager."""
            from file_operations_manager import FileOperationStatus

            # Operations are on a worker thread, so GUI updates must be scheduled on the main thread.
            self.after(0, self._update_operation_progress, operation)

            if operation.status == FileOperationStatus.COMPLETED:
                self.after(0, self._play_local_file, local_filepath)
            elif operation.status in (
                FileOperationStatus.FAILED,
                FileOperationStatus.CANCELLED,
            ):
                error_msg = operation.error_message or "Operation was cancelled."
                self.after(
                    0,
                    lambda: messagebox.showerror(
                        "Playback Error",
                        f"Could not download file for playback: {error_msg}",
                        parent=self,
                    ),
                )

        self.file_operations_manager.queue_batch_download([filename], on_playback_download_complete)

    def play_selected_audio_gui(self):
        selected_iids = self.file_tree.selection()
        if len(selected_iids) != 1:
            messagebox.showinfo("Playback", "Please select a single audio file to play.", parent=self)
            return

        file_iid = selected_iids[0]
        file_detail = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)
        if not file_detail:
            return

        filename = file_detail["name"]
        local_filepath = self._get_local_filepath(filename)
        if os.path.exists(local_filepath):
            self._play_local_file(local_filepath)
        else:
            # Check if device is connected for download
            is_connected = self.device_manager.device_interface.is_connected()
            if is_connected:
                self._download_for_playback_and_play(filename, local_filepath)
            else:
                messagebox.showinfo(
                    "File Not Available",
                    f"'{filename}' is not downloaded and device is disconnected.\n\n"
                    "Please connect the device to download the file, or select a downloaded file.",
                    parent=self,
                )

    def _on_async_calendar_update_complete(self, enhanced_files):
        """Called when async calendar enhancement completes to update the GUI.

        Args:
            enhanced_files: List of file dictionaries with updated meeting_display_text
        """
        try:
            logger.info(
                "CalendarSync",
                "_on_async_calendar_update_complete",
                f"Updating GUI with {len(enhanced_files)} enhanced files",
            )

            # Update displayed_files_details with new meeting data
            files_updated = 0
            for enhanced_file in enhanced_files:
                filename = enhanced_file.get("name")
                if not filename:
                    continue

                # Find matching file in displayed_files_details
                for i, displayed_file in enumerate(self.displayed_files_details):
                    if displayed_file.get("name") == filename:
                        # Update the meeting_display_text field
                        old_text = displayed_file.get("meeting_display_text", "None")
                        new_text = enhanced_file.get("meeting_display_text", "None")

                        # Don't update with temporary sync statuses - only update with actual meeting data or empty string
                        if new_text in ["Syncing...", "Refreshing...", "Processing..."]:
                            logger.debug(
                                "CalendarSync",
                                "_on_async_calendar_update_complete",
                                f"Skipping temporary sync status '{new_text}' for {filename}",
                            )
                            continue

                        if old_text != new_text:
                            self.displayed_files_details[i]["meeting_display_text"] = new_text
                            files_updated += 1

                            # Update the GUI TreeView for this specific file
                            try:
                                if self.file_tree.exists(filename):
                                    # Update the Meeting column in the TreeView
                                    self.file_tree.set(filename, "meeting", new_text)
                                    logger.debug(
                                        "CalendarSync",
                                        "_on_async_calendar_update_complete",
                                        f"Updated TreeView for {filename}: '{old_text}' -> '{new_text}'",
                                    )
                            except Exception as tree_error:
                                logger.warning(
                                    "CalendarSync",
                                    "_on_async_calendar_update_complete",
                                    f"Failed to update TreeView for {filename}: {tree_error}",
                                )
                        break

            if files_updated > 0:
                logger.info(
                    "CalendarSync",
                    "_on_async_calendar_update_complete",
                    f"Successfully updated {files_updated} files with new meeting data",
                )
                # Optionally update status bar to show completion
                self.update_status_bar(progress_text=f"Updated {files_updated} files with meeting data")
            else:
                logger.debug(
                    "CalendarSync", "_on_async_calendar_update_complete", "No files needed meeting data updates"
                )

        except Exception as e:
            logger.error(
                "CalendarSync", "_on_async_calendar_update_complete", f"Error updating GUI with calendar data: {e}"
            )

    def on_closing(self):
        """
        Handles the window closing event.
        """
        logger.info("GUI", "on_closing", "Window closing event triggered.")
        if (
            self.device_manager.device_interface.is_connected()
            and not self.quit_without_prompt_var.get()
            and not messagebox.askyesno(
                "Confirm Exit",
                "Device is connected. Are you sure you want to quit?",
                parent=self,
            )
        ):
            logger.info("GUI", "on_closing", "Quit cancelled by user.")
            return
        # Window geometry is now saved automatically during resize/move events
        # No need to save it again on close
        self.config["autoconnect"] = self.autoconnect_var.get()
        self.config["download_directory"] = self.download_directory
        self.config["log_level"] = self.logger_processing_level_var.get()
        self.config["selected_vid"] = self.selected_vid_var.get()
        self.config["selected_pid"] = self.selected_pid_var.get()
        self.config["target_interface"] = self.target_interface_var.get()
        self.config["recording_check_interval_s"] = self.recording_check_interval_var.get()
        self.config["default_command_timeout_ms"] = self.default_command_timeout_ms_var.get()
        self.config["file_stream_timeout_s"] = self.file_stream_timeout_s_var.get()
        self.config["auto_refresh_files"] = self.auto_refresh_files_var.get()
        self.config["auto_refresh_interval_s"] = self.auto_refresh_interval_s_var.get()
        self.config["quit_without_prompt_if_connected"] = self.quit_without_prompt_var.get()
        self.config["appearance_mode"] = self.appearance_mode_var.get()
        self.config["color_theme"] = self.color_theme_var.get()
        self.config["suppress_console_output"] = self.suppress_console_output_var.get()
        self.config["suppress_gui_log_output"] = self.suppress_gui_log_output_var.get()
        self.config["gui_log_filter_level"] = self.gui_log_filter_level_var.get()
        self.config["treeview_columns_display_order"] = ",".join(self.file_tree["displaycolumns"])
        self.config["logs_pane_visible"] = self.logs_visible_var.get()
        self.config["loop_playback"] = self.loop_playback_var.get()
        self.config["playback_volume"] = self.volume_var.get()
        self.config["treeview_sort_col_id"] = self.treeview_sort_column or self.saved_treeview_sort_column
        self.config["treeview_sort_descending"] = self.treeview_sort_reverse
        log_colors_to_save = {}
        for level in Logger.LEVELS:
            light_var = getattr(self, f"log_color_{level.lower()}_light_var", None)
            dark_var = getattr(self, f"log_color_{level.lower()}_dark_var", None)
            if light_var and dark_var:
                log_colors_to_save[level] = [light_var.get(), dark_var.get()]
        self.config["log_colors"] = log_colors_to_save
        self.config["icon_theme_color_light"] = self.icon_pref_light_color
        self.config["icon_theme_color_dark"] = self.icon_pref_dark_color
        self.config["icon_fallback_color_1"] = self.icon_fallback_color_1
        self.config["icon_fallback_color_2"] = self.icon_fallback_color_2
        self.config["icon_size_str"] = self.icon_size_str
        self.config["single_selection_mode"] = self.single_selection_mode_var.get()
        # Only save session-specific settings on shutdown
        # User preferences should already be saved when changed
        from config_and_logger import update_config_settings

        update_config_settings(
            {
                "treeview_columns_display_order": (
                    ",".join(self.file_tree["displaycolumns"])
                    if hasattr(self, "file_tree") and self.file_tree.winfo_exists()
                    else self.config.get("treeview_columns_display_order", "name,size,duration,date,time,status")
                ),
                "treeview_sort_col_id": self.treeview_sort_column or self.saved_treeview_sort_column,
                "treeview_sort_descending": self.treeview_sort_reverse,
            }
        )
        if self.device_manager.device_interface.is_connected():
            self.device_manager.device_interface.disconnect()

        # Shutdown calendar system to save cache
        try:
            if hasattr(self, "shutdown_async_calendar"):
                self.shutdown_async_calendar()
                logger.info("GUI", "on_closing", "Calendar system shutdown complete")
        except Exception as e:
            logger.warning("GUI", "on_closing", f"Error during calendar shutdown: {e}")

        if self.current_playing_temp_file and os.path.exists(self.current_playing_temp_file):
            try:
                os.remove(self.current_playing_temp_file)
            except OSError as e:
                logger.warning(
                    "GUI",
                    "on_closing",
                    f"Could not remove temp playback file {self.current_playing_temp_file}: {e}",
                )
        # Dismiss any active toast notifications
        try:
            if hasattr(self, "toast_manager"):
                self.toast_manager.dismiss_all()
        except Exception:
            pass  # Ignore errors during cleanup

        # Stop all pending callbacks and updates before destroying
        try:
            self.update_idletasks()  # Process any pending events
            self.quit()  # Stop the mainloop
        except Exception:
            pass  # Ignore errors during cleanup

        self.destroy()
        logger.info("GUI", "on_closing", "Application shutdown complete.")
        sys.exit(0)

    def _on_window_configure(self, event):
        """Handle window resize/move events and save geometry."""
        # Only handle events for the main window (not child widgets)
        if event.widget == self:
            # Cancel any existing timer to avoid excessive saves
            if self._geometry_save_timer:
                self.after_cancel(self._geometry_save_timer)

            # Schedule geometry save after a short delay to batch multiple events
            self._geometry_save_timer = self.after(500, self._save_window_geometry)

    def _save_window_geometry(self):
        """Save the current window geometry to configuration."""
        try:
            current_geometry = self.geometry()
            from config_and_logger import update_config_settings

            update_config_settings({"window_geometry": current_geometry})
            logger.debug(
                "GUI",
                "_save_window_geometry",
                f"Window geometry saved: {current_geometry}",
            )
        except Exception as e:
            logger.error(
                "GUI",
                "_save_window_geometry",
                f"Error saving window geometry: {e}",
            )
        finally:
            # Clear the timer reference
            self._geometry_save_timer = None

    def _enhance_selected_files_with_live_calendar_data(self, selected_files, calendar_integration):
        """Enhanced selected files using live calendar integration instead of cache only.

        Args:
            selected_files: List of file details to enhance
            calendar_integration: Live calendar integration instance

        Returns:
            List of enhanced files with live meeting data
        """
        try:
            enhanced_files = []
            meetings_found = 0

            logger.info(
                "GUI",
                "_enhance_selected_files_with_live_calendar_data",
                f"Starting live calendar enhancement for {len(selected_files)} files",
            )

            for file_data in selected_files:
                try:
                    enhanced_file = file_data.copy()
                    filename = file_data["name"]

                    # Parse file creation datetime
                    file_datetime = self._parse_file_datetime_from_gui(file_data)
                    if not file_datetime:
                        logger.debug(
                            "GUI",
                            "_enhance_selected_files_with_live_calendar_data",
                            f"Could not parse datetime for {filename}",
                        )
                        enhanced_file.update(self._create_empty_meeting_fields_gui())
                        enhanced_files.append(enhanced_file)
                        continue

                    logger.debug(
                        "GUI",
                        "_enhance_selected_files_with_live_calendar_data",
                        f"Checking {filename} with datetime {file_datetime} for meetings",
                    )

                    # Get meetings for this specific date using live calendar
                    meetings = calendar_integration.get_meetings_for_date(file_datetime)

                    # Find best match using the calendar integration
                    meeting = calendar_integration.find_meeting_for_recording(
                        file_datetime, tolerance_minutes=self._get_calendar_tolerance_minutes()
                    )

                    if meeting:
                        logger.info(
                            "GUI",
                            "_enhance_selected_files_with_live_calendar_data",
                            f"Found meeting '{meeting.subject}' for {filename} at {file_datetime}",
                        )
                        enhanced_file.update(self._create_meeting_fields_from_simple_meeting(meeting))
                        meetings_found += 1
                    else:
                        logger.debug(
                            "GUI",
                            "_enhance_selected_files_with_live_calendar_data",
                            f"No meeting found for {filename} at {file_datetime}",
                        )
                        enhanced_file.update(self._create_empty_meeting_fields_gui())

                    enhanced_files.append(enhanced_file)

                except Exception as e:
                    logger.warning(
                        "GUI",
                        "_enhance_selected_files_with_live_calendar_data",
                        f"Error enhancing {file_data.get('name', 'unknown')}: {e}",
                    )
                    # Add file without meeting data on error
                    enhanced_file = file_data.copy()
                    enhanced_file.update(self._create_empty_meeting_fields_gui())
                    enhanced_files.append(enhanced_file)

            logger.info(
                "GUI",
                "_enhance_selected_files_with_live_calendar_data",
                f"Completed live enhancement: {meetings_found} files with meetings out of {len(enhanced_files)} total",
            )

            return enhanced_files

        except Exception as e:
            logger.error(
                "GUI", "_enhance_selected_files_with_live_calendar_data", f"Error in live calendar enhancement: {e}"
            )
            # Return files with empty meeting fields on error
            enhanced_files = []
            for file_data in selected_files:
                enhanced_file = file_data.copy()
                enhanced_file.update(self._create_empty_meeting_fields_gui())
                enhanced_files.append(enhanced_file)
            return enhanced_files

    def _parse_file_datetime_from_gui(self, file_data):
        """Parse datetime from GUI file data format."""
        try:
            from datetime import datetime

            # Try the 'time' field first (datetime object)
            if "time" in file_data and file_data["time"]:
                if isinstance(file_data["time"], datetime):
                    return file_data["time"]

            # Fall back to combining createDate and createTime
            create_date = file_data.get("createDate", "")
            create_time = file_data.get("createTime", "")

            if create_date and create_time and create_date != "---" and create_time != "---":
                datetime_str = f"{create_date} {create_time}"
                # Handle different date formats
                for fmt in ["%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"]:
                    try:
                        return datetime.strptime(datetime_str, fmt)
                    except ValueError:
                        continue

            return None

        except Exception as e:
            logger.debug(
                "GUI",
                "_parse_file_datetime_from_gui",
                f"Error parsing datetime for {file_data.get('name', 'unknown')}: {e}",
            )
            return None

    def _create_meeting_fields_from_simple_meeting(self, meeting):
        """Create meeting fields from a SimpleMeeting object."""
        try:
            # Clean and format subject and organizer for display
            subject = meeting.subject if meeting.subject else "No Subject"
            organizer = meeting.organizer if meeting.organizer else "Unknown Organizer"

            # Clean up organizer (remove email domain and format name)
            if "@" in organizer:
                organizer = organizer.split("@")[0].replace(".", " ").title()

            # Create combined display text: "Subject - Organizer"
            meeting_display_text = subject
            if organizer and organizer != "Unknown Organizer":
                meeting_display_text += f" - {organizer}"

            # Truncate for display if too long
            if len(meeting_display_text) > 60:
                meeting_display_text = meeting_display_text[:57] + "..."

            # Format attendees
            attendee_count = len(meeting.attendees)
            if attendee_count > 1:
                attendees_display = f"{attendee_count} attendees"
            elif attendee_count == 1:
                attendees_display = "1 attendee"
            else:
                attendees_display = "No attendees"

            # Determine meeting type
            meeting_type = "In-person" if meeting.location else "Virtual"
            if meeting.location:
                location_lower = meeting.location.lower()
                # Use proper URL parsing for security
                from urllib.parse import urlparse

                try:
                    # Check if location contains URLs and parse them
                    import re

                    urls = re.findall(r'https?://[^\s<>"\']+', location_lower)
                    for url in urls:
                        parsed = urlparse(url)
                        hostname = parsed.hostname
                        if hostname and hostname.endswith("teams.microsoft.com"):
                            meeting_type = "Teams"
                            break
                        elif hostname and hostname.endswith("zoom.us"):
                            meeting_type = "Zoom"
                            break
                    else:
                        # Fallback for simple text matching (non-URL context)
                        if "teams meeting" in location_lower or "microsoft teams" in location_lower:
                            meeting_type = "Teams"
                        elif "zoom meeting" in location_lower:
                            meeting_type = "Zoom"
                except Exception:
                    # Fallback for parsing errors
                    if "teams meeting" in location_lower or "microsoft teams" in location_lower:
                        meeting_type = "Teams"
                    elif "zoom meeting" in location_lower:
                        meeting_type = "Zoom"

            return {
                "has_meeting": True,
                "meeting_subject": subject,
                "meeting_organizer": organizer,
                "meeting_attendees_display": attendees_display,
                "meeting_attendees_count": attendee_count,
                "meeting_location": meeting.location or "",
                "meeting_type": meeting_type,
                "meeting_start_time": meeting.start_time,
                "meeting_end_time": meeting.end_time,
                "meeting_duration_minutes": meeting.duration_minutes,
                "meeting_time_display": meeting.start_time.strftime("%H:%M") if meeting.start_time else "",
                "meeting_date_display": meeting.start_time.strftime("%Y-%m-%d") if meeting.start_time else "",
                "meeting_display_text": meeting_display_text,  # For treeview column display
                "meeting_confidence_score": 1.0,  # Live data has high confidence
            }
        except Exception as e:
            logger.warning("GUI", "_create_meeting_fields_from_simple_meeting", f"Error creating meeting fields: {e}")
            return self._create_empty_meeting_fields_gui()

    def _enhance_files_with_batch_calendar_data_sync(self, selected_files):
        """Synchronous batch calendar enhancement for selected files.

        This bridges the gap between the GUI selection logic and the AsyncCalendarMixin
        batch processing functionality.
        """
        try:
            # Ensure async calendar is initialized
            if hasattr(self, "_ensure_async_calendar_initialized"):
                self._ensure_async_calendar_initialized()

            # Use the batch processing from AsyncCalendarMixin if available
            if hasattr(self, "_enhance_files_with_batch_calendar_data"):
                logger.info(
                    "GUI",
                    "_enhance_files_with_batch_calendar_data_sync",
                    f"Using AsyncCalendarMixin batch processing for {len(selected_files)} files",
                )
                return self._enhance_files_with_batch_calendar_data(selected_files)
            else:
                logger.warning(
                    "GUI",
                    "_enhance_files_with_batch_calendar_data_sync",
                    "Batch processing not available, returning files with empty meeting fields",
                )
                # Fallback: return files with empty meeting fields
                enhanced_files = []
                for file_data in selected_files:
                    enhanced_file = file_data.copy()
                    enhanced_file.update(self._create_empty_meeting_fields_gui())
                    enhanced_files.append(enhanced_file)
                return enhanced_files

        except Exception as e:
            logger.error(
                "GUI", "_enhance_files_with_batch_calendar_data_sync", f"Error in batch calendar enhancement: {e}"
            )
            # Return files with empty meeting fields on error
            enhanced_files = []
            for file_data in selected_files:
                enhanced_file = file_data.copy()
                enhanced_file.update(self._create_empty_meeting_fields_gui())
                enhanced_files.append(enhanced_file)
            return enhanced_files

    def _create_empty_meeting_fields_gui(self):
        """Create empty meeting fields for GUI display."""
        return {
            "has_meeting": False,
            "meeting_subject": "",
            "meeting_organizer": "",
            "meeting_attendees_display": "",
            "meeting_attendees_count": 0,
            "meeting_location": "",
            "meeting_type": "",
            "meeting_start_time": None,
            "meeting_end_time": None,
            "meeting_duration_minutes": 0,
            "meeting_time_display": "",
            "meeting_date_display": "",
            "meeting_display_text": "",  # Empty instead of "No Meeting" for clean display
            "meeting_confidence_score": 0.0,
        }

    def _process_selected_audio(self, file_iid):
        file_detail = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)
        if not file_detail:
            messagebox.showerror("Audio Processing Error", "File details not found.", parent=self)
            return

        local_filepath = self._get_local_filepath(file_detail["name"])
        if not os.path.exists(local_filepath):
            messagebox.showwarning(
                "Audio Processing",
                "File not downloaded. Please download it first.",
                parent=self,
            )
            return

        dialog = ctk.CTkToplevel(self)
        dialog.title("Audio Processing")
        dialog.geometry("400x300")

        # Add processing options to the dialog
        # ... (This will be implemented in a future step)

        def process_audio():
            # Get selected options
            # ...

            # Run the audio enhancer
            # Future: implement audio enhancement features
            # _enhancer = AudioEnhancer()
            # ... (call enhancer methods)

            dialog.destroy()

        process_button = ctk.CTkButton(dialog, text="Process", command=process_audio)
        process_button.pack(pady=20)

    def show_system_health(self):
        dialog = ctk.CTkToplevel(self)
        dialog.title("System Health")
        dialog.geometry("400x300")

        # Future: display storage info in health dialog
        # storage_monitor = StorageMonitor([self.download_directory])
        # Future: display in health dialog
        # _storage_info = storage_monitor.get_storage_info()

        # Display storage info in the dialog
        # ... (This will be implemented in a future step)

    def show_storage_optimizer(self):
        dialog = ctk.CTkToplevel(self)
        dialog.title("Storage Optimizer")
        dialog.geometry("600x400")

        # Future: display optimization suggestions
        # storage_optimizer = StorageOptimizer([self.download_directory])
        # Future: display suggestions
        # _optimization_suggestions = storage_optimizer.analyze_storage()

        # Display optimization suggestions in the dialog
        # ... (This will be implemented in a future step)

    def refresh_unlinked_files_only(self):
        """Refresh calendar data for files that have no linked meetings."""
        if not hasattr(self, "displayed_files_details") or not self.displayed_files_details:
            messagebox.showinfo(
                "No Files", "No files are currently displayed. Please connect to device and load files first."
            )
            return

        # Find files that have no meeting linked by checking both GUI display AND cache
        unlinked_files = []
        for file_detail in self.displayed_files_details:
            meeting_text = file_detail.get("meeting_display_text", "")

            # First check GUI display
            if meeting_text and meeting_text.strip() not in ["", "None", "—", "-"]:
                continue  # File has meeting in GUI, skip it

            # For files that appear unlinked in GUI, double-check the cache
            filename = file_detail.get("name")
            if filename and hasattr(self, "_calendar_cache_manager") and self._calendar_cache_manager:
                try:
                    # Parse file datetime for cache lookup
                    file_datetime = self._parse_file_datetime_for_calendar(file_detail)
                    if file_datetime:
                        cached_meeting = self._calendar_cache_manager.get_cached_meeting_for_file(
                            filename, file_datetime
                        )
                        if cached_meeting and cached_meeting.subject:
                            # File has cached meeting but GUI is out of sync - skip bulk refresh
                            logger.debug(
                                "GUI",
                                "refresh_unlinked_files",
                                f"Skipping {filename} - has cached meeting: {cached_meeting.subject}",
                            )
                            continue
                except Exception as e:
                    logger.debug("GUI", "refresh_unlinked_files", f"Error checking cache for {filename}: {e}")

            # File is truly unlinked (no GUI display AND no cache)
            unlinked_files.append(file_detail)

        if not unlinked_files:
            messagebox.showinfo(
                "No Unlinked Files",
                f"All {len(self.displayed_files_details)} files already have meeting data linked. No files need refreshing.",
            )
            return

        # Ask for confirmation
        response = messagebox.askyesno(
            "Refresh Unlinked Files",
            f"Found {len(unlinked_files)} files without linked meetings out of {len(self.displayed_files_details)} total files.\n\n"
            "This will search the calendar for meetings that match these files. This may take a few minutes.\n\n"
            "Do you want to proceed?",
        )

        if not response:
            return

        logger.info(
            "GUI", "refresh_unlinked_files", f"Starting calendar refresh for {len(unlinked_files)} unlinked files"
        )

        # Use the same LIVE calendar processing as individual refresh for better results
        try:
            # Show progress overlay
            self._show_calendar_refresh_overlay(
                len(unlinked_files), f"Refreshing {len(unlinked_files)} Files Without Meetings"
            )

            # Process unlinked files using the same method as individual file checking
            # This uses live calendar data instead of cached data for better accuracy
            def process_unlinked_files():
                try:
                    # Skip cache clearing - SimpleOutlookIntegration doesn't have cache methods
                    # and attempting to clear non-existent cache was preventing meetings from being found
                    logger.debug(
                        "GUI", "refresh_unlinked_files", "Skipping cache clearing to maintain meeting detection"
                    )

                    enhanced_files = []
                    files_processed = 0
                    meetings_found = 0

                    logger.info(
                        "GUI",
                        "refresh_unlinked_files",
                        f"Starting to process {len(unlinked_files)} unlinked files in background thread",
                    )

                    # Update initial progress
                    self.after(0, self._update_refresh_progress, f"Starting to process {len(unlinked_files)} files...")

                    for i, file_detail in enumerate(unlinked_files):
                        try:
                            filename = file_detail.get("name", "unknown")
                            logger.debug(
                                "GUI",
                                "refresh_unlinked_files",
                                f"Processing file {i+1}/{len(unlinked_files)}: {filename}",
                            )

                            # Use the same datetime parsing and meeting lookup as individual refresh
                            file_datetime = self._parse_file_datetime_for_calendar(file_detail)
                            if file_datetime:
                                logger.debug(
                                    "GUI", "refresh_unlinked_files", f"Parsed datetime for {filename}: {file_datetime}"
                                )

                                # Use live calendar lookup (same as individual refresh)
                                meeting = self._find_meeting_for_file_live(filename, file_datetime)

                                enhanced_file = file_detail.copy()
                                if meeting:
                                    enhanced_file["meeting_display_text"] = meeting
                                    meetings_found += 1
                                    logger.info(
                                        "GUI", "refresh_unlinked_files", f"Found meeting for {filename}: {meeting}"
                                    )

                                    # Cache the meeting (same as individual refresh does)
                                    try:
                                        if hasattr(self, "_calendar_integration") and self._calendar_integration:
                                            # Get the meeting object again to cache it properly
                                            meeting_obj = self._calendar_integration.find_meeting_for_recording(
                                                file_datetime, tolerance_minutes=self._get_calendar_tolerance_minutes()
                                            )
                                            if (
                                                meeting_obj
                                                and hasattr(self, "_calendar_cache_manager")
                                                and self._calendar_cache_manager
                                            ):
                                                self._calendar_cache_manager.cache_meeting_for_file(
                                                    filename, file_datetime, meeting_obj
                                                )
                                                logger.debug(
                                                    "GUI", "refresh_unlinked_files", f"Cached meeting for {filename}"
                                                )
                                    except Exception as cache_error:
                                        logger.warning(
                                            "GUI",
                                            "refresh_unlinked_files",
                                            f"Failed to cache meeting for {filename}: {cache_error}",
                                        )
                                else:
                                    enhanced_file["meeting_display_text"] = ""
                                    logger.debug("GUI", "refresh_unlinked_files", f"No meeting found for {filename}")

                                    # Cache the "no meeting" result (same as individual refresh does)
                                    try:
                                        if hasattr(self, "_calendar_cache_manager") and self._calendar_cache_manager:
                                            self._calendar_cache_manager.cache_no_meeting_for_file(
                                                filename, file_datetime
                                            )
                                            logger.debug(
                                                "GUI", "refresh_unlinked_files", f"Cached 'no meeting' for {filename}"
                                            )
                                    except Exception as cache_error:
                                        logger.warning(
                                            "GUI",
                                            "refresh_unlinked_files",
                                            f"Failed to cache 'no meeting' for {filename}: {cache_error}",
                                        )

                                enhanced_files.append(enhanced_file)
                            else:
                                logger.warning(
                                    "GUI", "refresh_unlinked_files", f"Could not parse datetime for {filename}"
                                )
                                enhanced_file = file_detail.copy()
                                enhanced_file["meeting_display_text"] = ""
                                enhanced_files.append(enhanced_file)

                            files_processed += 1

                            # Log and update GUI progress every 5 files for more responsive feedback
                            if (i + 1) % 5 == 0:
                                logger.info(
                                    "GUI",
                                    "refresh_unlinked_files",
                                    f"Progress: {i+1}/{len(unlinked_files)} files processed, {meetings_found} meetings found so far",
                                )

                                # Update GUI progress on main thread
                                progress_text = (
                                    f"Processed {i+1}/{len(unlinked_files)} files... Found {meetings_found} meetings"
                                )
                                self.after(0, self._update_refresh_progress, progress_text)

                        except Exception as e:
                            logger.error(
                                "GUI",
                                "refresh_unlinked_files",
                                f"Error processing {file_detail.get('name', 'unknown')}: {e}",
                            )
                            enhanced_file = file_detail.copy()
                            enhanced_file["meeting_display_text"] = ""
                            enhanced_files.append(enhanced_file)

                    logger.info(
                        "GUI",
                        "refresh_unlinked_files",
                        f"Completed processing {files_processed} files, found {meetings_found} meetings",
                    )

                    # Final progress update
                    final_progress = f"Completed! Processed {files_processed} files, found {meetings_found} meetings"
                    self.after(0, self._update_refresh_progress, final_progress)

                    # Force save cache to disk to ensure persistence
                    try:
                        if hasattr(self, "_calendar_cache_manager") and self._calendar_cache_manager:
                            self._calendar_cache_manager._save_caches()
                            logger.info("GUI", "refresh_unlinked_files", f"Saved {meetings_found} meetings to cache")
                    except Exception as e:
                        logger.warning("GUI", "refresh_unlinked_files", f"Failed to save cache: {e}")

                    # Call completion callback on main thread
                    self.after(0, self._on_unlinked_files_refresh_complete, enhanced_files)

                except Exception as e:
                    logger.error("GUI", "refresh_unlinked_files", f"Error in background processing: {e}")
                    self.after(0, self._on_unlinked_files_refresh_error, str(e))

            # Run processing in background thread to avoid blocking GUI
            import threading

            processing_thread = threading.Thread(target=process_unlinked_files, daemon=True)
            processing_thread.start()

        except Exception as e:
            logger.error("GUI", "refresh_unlinked_files", f"Failed to start calendar refresh: {e}")
            messagebox.showerror("Refresh Error", f"Failed to start calendar refresh: {e}")

    def _parse_file_datetime_for_calendar(self, file_detail):
        """Parse datetime from file detail using the same logic as individual refresh."""
        try:
            # Try to use the existing 'time' field first (same as individual processing)
            if "time" in file_detail and file_detail["time"]:
                if isinstance(file_detail["time"], datetime):
                    return file_detail["time"]

            # Fallback: parse from createDate and createTime
            create_date = file_detail.get("createDate", "")
            create_time = file_detail.get("createTime", "")

            if create_date and create_time and create_date != "---" and create_time != "---":
                datetime_str = f"{create_date} {create_time}"
                try:
                    parsed_dt = datetime.strptime(datetime_str, "%Y/%m/%d %H:%M:%S")
                    return parsed_dt
                except ValueError:
                    pass

            # Last resort: try to parse from filename
            filename = file_detail.get("name", "")
            if filename:
                import re

                # Parse format: 2025Aug13-132542-Rec11.hda
                match = re.match(r"(\d{4})(\w{3})(\d{2})-(\d{2})(\d{2})(\d{2})", filename)
                if match:
                    year, month_name, day, hour, minute, second = match.groups()
                    month_map = {
                        "Jan": 1,
                        "Feb": 2,
                        "Mar": 3,
                        "Apr": 4,
                        "May": 5,
                        "Jun": 6,
                        "Jul": 7,
                        "Aug": 8,
                        "Sep": 9,
                        "Oct": 10,
                        "Nov": 11,
                        "Dec": 12,
                    }
                    if month_name in month_map:
                        return datetime(int(year), month_map[month_name], int(day), int(hour), int(minute), int(second))

            return None

        except Exception as e:
            logger.warning(
                "GUI", "_parse_file_datetime_for_calendar", f"Error parsing datetime for {file_detail.get('name')}: {e}"
            )
            return None

    def _find_meeting_for_file_live(self, filename, file_datetime):
        """Find meeting for file using live calendar data (same method as individual refresh)."""
        try:
            # Use the same calendar integration as the individual file check
            if hasattr(self, "_calendar_integration") and self._calendar_integration:
                calendar_integration = self._calendar_integration
                logger.debug(
                    "GUI", "_find_meeting_for_file_live", f"Looking for meeting for {filename} at {file_datetime}"
                )

                if hasattr(calendar_integration, "find_meeting_for_recording"):
                    # Use the same parameters as individual refresh (using config tolerance)
                    meeting = calendar_integration.find_meeting_for_recording(
                        file_datetime, tolerance_minutes=self._get_calendar_tolerance_minutes()
                    )

                    logger.debug(
                        "GUI",
                        "_find_meeting_for_file_live",
                        f"Meeting result for {filename}: {meeting.subject if meeting else 'None'}",
                    )

                    if meeting and hasattr(meeting, "subject"):
                        # Return the meeting subject (same as individual processing)
                        return meeting.subject
                else:
                    logger.warning(
                        "GUI",
                        "_find_meeting_for_file_live",
                        "Calendar integration has no find_meeting_for_recording method",
                    )
            else:
                logger.warning(
                    "GUI", "_find_meeting_for_file_live", f"No calendar integration available for {filename}"
                )

            return None

        except Exception as e:
            logger.error("GUI", "_find_meeting_for_file_live", f"Error finding meeting for {filename}: {e}")
            return None

    def _normalize_meeting_title(self, meeting_title):
        """Normalize meeting title to provide consistent formatting between different calendar methods."""
        if not meeting_title:
            return meeting_title

        # The individual refresh seems to return cleaner titles like "Sync Sebastián:Daniela"
        # while cached data might include attendee info like "Sync Sebastián:Daniela - Daniela del Pilar..."
        # For consistency, we'll keep the cleaner format but log when we detect differences

        try:
            title = str(meeting_title).strip()

            # If title contains " - " followed by what looks like attendee names,
            # consider using just the first part for consistency
            if " - " in title:
                main_part = title.split(" - ")[0].strip()
                attendee_part = title.split(" - ", 1)[1].strip()

                # Log this for debugging the format differences
                logger.debug(
                    "GUI",
                    "_normalize_meeting_title",
                    f"Meeting title contains attendee info: '{title}' -> main: '{main_part}', attendees: '{attendee_part}'",
                )

                # For now, return the full title to maintain existing behavior
                # but this method can be enhanced later for more consistent formatting
                return title

            return title

        except Exception as e:
            logger.warning("GUI", "_normalize_meeting_title", f"Error normalizing meeting title '{meeting_title}': {e}")
            return str(meeting_title)

    def _on_unlinked_files_refresh_error(self, error_message):
        """Handle errors during unlinked files refresh."""
        self._hide_calendar_refresh_overlay()
        messagebox.showerror("Refresh Error", f"An error occurred while refreshing unlinked files:\n\n{error_message}")

    def _on_unlinked_files_refresh_complete(self, enhanced_files):
        """Callback when unlinked files calendar refresh completes."""
        try:
            logger.info(
                "GUI",
                "_on_unlinked_files_refresh_complete",
                f"Completed calendar refresh for {len(enhanced_files)} unlinked files",
            )

            # Update the displayed files with new meeting data
            files_updated = 0
            for enhanced_file in enhanced_files:
                filename = enhanced_file.get("name")
                if not filename:
                    continue

                # Find matching file in displayed_files_details
                for i, displayed_file in enumerate(self.displayed_files_details):
                    if displayed_file.get("name") == filename:
                        old_text = displayed_file.get("meeting_display_text", "")
                        new_text = enhanced_file.get("meeting_display_text", "")

                        # Only update if we found new meeting data
                        if new_text and new_text not in ["", "None", "—", "-"] and old_text != new_text:
                            self.displayed_files_details[i]["meeting_display_text"] = new_text
                            files_updated += 1

                            # Update the GUI TreeView for this specific file
                            try:
                                if hasattr(self, "file_tree") and self.file_tree.exists(filename):
                                    self.file_tree.set(filename, "meeting", new_text)
                                    logger.debug(
                                        "GUI",
                                        "_on_unlinked_files_refresh_complete",
                                        f"Updated TreeView for {filename}: '{old_text}' -> '{new_text}'",
                                    )
                            except Exception as tree_error:
                                logger.warning(
                                    "GUI",
                                    "_on_unlinked_files_refresh_complete",
                                    f"Failed to update TreeView for {filename}: {tree_error}",
                                )
                        break

            # Hide the overlay and show results
            self._hide_calendar_refresh_overlay()

            if files_updated > 0:
                messagebox.showinfo(
                    "Refresh Complete",
                    f"Successfully found meetings for {files_updated} files that were previously unlinked.\n\n"
                    f"Updated {files_updated} out of {len(enhanced_files)} files checked.",
                )
                logger.info(
                    "GUI",
                    "_on_unlinked_files_refresh_complete",
                    f"Successfully updated {files_updated} files with new meeting data",
                )
            else:
                messagebox.showinfo(
                    "Refresh Complete",
                    f"Checked {len(enhanced_files)} files but no new meeting matches were found.\n\n"
                    "This could mean:\n"
                    "• The files don't have corresponding calendar meetings\n"
                    "• The meeting times don't match file timestamps\n"
                    "• Calendar integration needs configuration",
                )
                logger.info(
                    "GUI",
                    "_on_unlinked_files_refresh_complete",
                    "Calendar refresh completed but no new meetings were found",
                )

        except Exception as e:
            logger.error(
                "GUI",
                "_on_unlinked_files_refresh_complete",
                f"Error updating GUI with unlinked files calendar data: {e}",
            )
            messagebox.showerror("Update Error", f"Error updating files with calendar data: {e}")

    def _toggle_column_visibility(self, column_id):
        """Toggle the visibility of a specific column."""
        if column_id == "num":  # Don't allow hiding the # column
            return

        # Get current displayed columns
        current_columns = list(self.file_tree["displaycolumns"])
        is_visible = column_id in current_columns

        if is_visible:
            # Hide column
            current_columns.remove(column_id)
        else:
            # Show column - insert in proper order based on original_tree_headings
            all_columns = list(self.original_tree_headings.keys())
            insert_index = len(current_columns)  # Default to end

            # Find proper insertion position to maintain order
            for i, col in enumerate(all_columns):
                if col == column_id:
                    # Count how many columns before this one are currently displayed
                    preceding_displayed = [c for c in all_columns[:i] if c in current_columns]
                    insert_index = len(preceding_displayed)
                    break

            current_columns.insert(insert_index, column_id)

        # Update tree displaycolumns
        self.file_tree.configure(displaycolumns=current_columns)

        # Update the checkbox variable to reflect the new state
        if column_id in self.column_visibility_vars:
            self.column_visibility_vars[column_id].set(not is_visible)

        # Save column configuration
        from config_and_logger import update_config_settings

        update_config_settings({"treeview_columns_display_order": ",".join(current_columns)})

        logger.info("GUI", "_toggle_column_visibility", f"Column '{column_id}' visibility toggled to {not is_visible}")

    def force_refresh_calendar_gui(self):
        """Force refresh calendar data from the GUI with visual feedback."""
        try:
            # Check if async calendar is available
            if not hasattr(self, "_calendar_cache_manager") or not self._calendar_cache_manager:
                messagebox.showinfo(
                    "Calendar Not Available",
                    "Calendar integration is not available or not properly configured.",
                    parent=self,
                )
                return

            # Get current files before starting refresh
            current_files = []
            if hasattr(self, "displayed_files_details") and self.displayed_files_details:
                current_files = list(self.displayed_files_details)

            if not current_files:
                messagebox.showinfo(
                    "No Files to Refresh", "No files are currently displayed to refresh calendar data for.", parent=self
                )
                return

            # Show visual overlay and disable the refresh button
            self._show_calendar_refresh_overlay(len(current_files))

            # Prepare files for refresh (remove calendar data but preserve audio metadata)
            clean_files = []
            for f in current_files:
                clean_file = f.copy()
                # Remove only calendar meeting fields to force fresh lookup
                # but preserve audio metadata fields (audio_*)
                for key in list(clean_file.keys()):
                    if (key.startswith("meeting_") or key == "has_meeting") and not key.startswith("audio_"):
                        del clean_file[key]
                clean_files.append(clean_file)

            # Immediately show "Refreshing..." in the Meeting column for all files
            self._set_calendar_refresh_status_for_all_files("Refreshing...")

            # Show initial status
            self.update_status_bar(progress_text=f"Starting calendar refresh for {len(current_files)} files...")

            # Use the correct method from AsyncCalendarMixin
            def refresh_callback(enhanced_files=None):
                """Called when calendar refresh is complete."""
                try:
                    # Always hide the overlay first
                    self._hide_calendar_refresh_overlay()

                    if enhanced_files:
                        # Use the enhanced files returned from the async operation
                        self.update_status_bar(progress_text="Finalizing calendar refresh...")

                        # CRITICAL: Clear any "Syncing..." or "Refreshing..." status for files without meetings
                        for file_data in enhanced_files:
                            # If no meeting found, ensure display text is empty, not "Syncing..."
                            if not file_data.get("has_meeting", False):
                                display_text = file_data.get("meeting_display_text", "")
                                if display_text in ["Syncing...", "Refreshing...", "Processing..."]:
                                    file_data["meeting_display_text"] = ""
                                    logger.debug(
                                        "GUI",
                                        "force_refresh_callback",
                                        f"Cleared '{display_text}' for {file_data.get('name', 'unknown')}",
                                    )

                        # Re-apply audio metadata after calendar enhancement
                        if hasattr(self, "enhance_files_with_audio_metadata"):
                            try:
                                enhanced_files = self.enhance_files_with_audio_metadata(enhanced_files)
                                logger.debug(
                                    "GUI",
                                    "force_refresh_calendar_gui",
                                    "Re-applied audio metadata after calendar refresh",
                                )
                            except Exception as e:
                                logger.warning(
                                    "GUI", "force_refresh_calendar_gui", f"Could not re-apply audio metadata: {e}"
                                )

                        # Update the TreeView with refreshed data (filtering-aware)
                        if hasattr(self, "update_files_data_for_filtering"):
                            self.update_files_data_for_filtering(enhanced_files)
                        else:
                            self._populate_treeview_from_data(enhanced_files)

                        # Also update the stored displayed_files_details for consistency
                        self.displayed_files_details = enhanced_files

                        # Count files with meetings found
                        files_with_meetings = sum(1 for f in enhanced_files if f.get("has_meeting", False))

                        self.update_status_bar(
                            progress_text=f"Calendar refresh completed - {files_with_meetings} files with meetings found"
                        )

                        # Show success message after a brief delay to let user see the results
                        self.after(
                            500,
                            lambda: messagebox.showinfo(
                                "Calendar Refresh Complete",
                                f"Calendar data refreshed successfully!\n\nFound meetings for {files_with_meetings} out of {len(enhanced_files)} displayed files.",
                                parent=self,
                            ),
                        )

                        logger.info(
                            "GUI",
                            "force_refresh_calendar_gui",
                            f"Updated {len(enhanced_files)} displayed files after calendar refresh, {files_with_meetings} with meetings",
                        )
                    else:
                        # No files returned - clear any remaining "Refreshing..." status
                        self._clear_calendar_refresh_status_for_all_files()
                        self.update_status_bar(progress_text="Calendar refresh completed")
                        messagebox.showinfo(
                            "Calendar Refresh", "Calendar refresh has been completed successfully.", parent=self
                        )

                except Exception as e:
                    # Always hide overlay on error too
                    self._hide_calendar_refresh_overlay()
                    self._clear_calendar_refresh_status_for_all_files()

                    logger.error("GUI", "force_refresh_calendar_gui", f"Error in refresh callback: {e}")
                    self.update_status_bar(progress_text="Calendar refresh completed with errors")
                    messagebox.showwarning(
                        "Calendar Refresh Error", f"Calendar data refresh encountered an error: {str(e)}", parent=self
                    )

            # Pass the clean files to the refresh function!
            success = self.refresh_calendar_data_async(callback=refresh_callback, current_files=clean_files)

            if not success:
                # Hide overlay and show error if refresh couldn't be started
                self._hide_calendar_refresh_overlay()
                self._clear_calendar_refresh_status_for_all_files()
                messagebox.showerror(
                    "Calendar Refresh Error",
                    "Failed to queue calendar refresh. Calendar system may not be available.",
                    parent=self,
                )

        except Exception as e:
            # Handle any unexpected errors
            try:
                self._hide_calendar_refresh_overlay()
                self._clear_calendar_refresh_status_for_all_files()
            except:
                pass  # Ignore errors during cleanup

            logger.error("GUI", "force_refresh_calendar_gui", f"Unexpected error during calendar refresh: {e}")
            messagebox.showerror(
                "Calendar Refresh Error", f"An unexpected error occurred during calendar refresh: {str(e)}", parent=self
            )

        logger.info("GUI", "force_refresh_calendar_gui", "Manual calendar refresh requested")

    def _parse_file_datetime_for_calendar(self, file_data):
        """Parse file datetime from file data for calendar operations."""
        try:
            from datetime import datetime

            # The device already provides a proper 'time' datetime object
            if "time" in file_data and file_data["time"]:
                if isinstance(file_data["time"], datetime):
                    return file_data["time"]

            # Fallback: combine createDate and createTime
            create_date = file_data.get("createDate", "")
            create_time = file_data.get("createTime", "")

            if create_date and create_time and create_date != "---" and create_time != "---":
                datetime_str = f"{create_date} {create_time}"
                try:
                    return datetime.strptime(datetime_str, "%Y/%m/%d %H:%M:%S")
                except ValueError:
                    pass

            return None
        except Exception as e:
            logger.warning("GUI", "_parse_file_datetime_for_calendar", f"Error parsing datetime: {e}")
            return None

    def _show_calendar_refresh_overlay(self, file_count, title="Refreshing Calendar Data"):
        """Show visual overlay during calendar refresh."""
        try:
            import tkinter as tk

            # Create overlay frame
            self.calendar_refresh_overlay = tk.Frame(self, bg="#000000")
            self.calendar_refresh_overlay.place(x=0, y=0, relwidth=1, relheight=1)

            # Create content frame
            content_frame = tk.Frame(self.calendar_refresh_overlay, bg="#2b2b2b", relief="raised", bd=2)
            content_frame.place(relx=0.5, rely=0.5, anchor="center")

            # Title
            title_label = tk.Label(content_frame, text=title, font=("Arial", 16, "bold"), fg="white", bg="#2b2b2b")
            title_label.pack(pady=20, padx=40)

            # Progress info
            self.refresh_progress_label = tk.Label(
                content_frame, text=f"Processing {file_count} files...", font=("Arial", 12), fg="#cccccc", bg="#2b2b2b"
            )
            self.refresh_progress_label.pack(pady=(0, 10))

            # Animated dots
            self.refresh_dots_label = tk.Label(
                content_frame, text="...", font=("Arial", 12), fg="#4CAF50", bg="#2b2b2b"
            )
            self.refresh_dots_label.pack(pady=(0, 20))

            # Start dots animation
            self._animate_refresh_dots()

            # Disable the Force Refresh menu item to prevent multiple refreshes
            try:
                for menu_item in self.menu_view_list:
                    if hasattr(menu_item, "entryconfig"):
                        # Find the Force Refresh Calendar menu item
                        try:
                            menu_item.entryconfig("Force Refresh Calendar", state="disabled")
                        except:
                            pass
            except:
                pass

            # Bring overlay to front and update display
            self.calendar_refresh_overlay.lift()
            self.calendar_refresh_overlay.tkraise()
            self.update()

            logger.debug(
                "GUI", "_show_calendar_refresh_overlay", f"Overlay shown for {file_count} files with title: {title}"
            )

        except Exception as e:
            logger.error("GUI", "_show_calendar_refresh_overlay", f"Error showing overlay: {e}")
            import traceback

            traceback.print_exc()

    def _hide_calendar_refresh_overlay(self):
        """Hide the calendar refresh overlay."""
        try:
            if hasattr(self, "calendar_refresh_overlay"):
                self.calendar_refresh_overlay.destroy()
                delattr(self, "calendar_refresh_overlay")

            # Re-enable the Force Refresh menu item
            try:
                for menu_item in self.menu_view_list:
                    if hasattr(menu_item, "entryconfig"):
                        try:
                            menu_item.entryconfig("Force Refresh Calendar", state="normal")
                        except:
                            pass
            except:
                pass

        except Exception as e:
            logger.error("GUI", "_hide_calendar_refresh_overlay", f"Error hiding overlay: {e}")

        # Ensure overlay is gone
        if hasattr(self, "calendar_refresh_overlay"):
            try:
                delattr(self, "calendar_refresh_overlay")
            except:
                pass

    def _update_refresh_progress(self, progress_text):
        """Update the progress text in the calendar refresh overlay."""
        try:
            if hasattr(self, "refresh_progress_label") and self.refresh_progress_label:
                self.refresh_progress_label.configure(text=progress_text)
                self.refresh_progress_label.update()
        except Exception as e:
            logger.debug("GUI", "_update_refresh_progress", f"Error updating progress: {e}")

    def _animate_refresh_dots(self):
        """Animate the dots in the refresh overlay."""
        try:
            if hasattr(self, "refresh_dots_label") and self.refresh_dots_label.winfo_exists():
                current_text = self.refresh_dots_label.cget("text")
                if current_text == "...":
                    new_text = "   "
                elif current_text == "   ":
                    new_text = ".  "
                elif current_text == ".  ":
                    new_text = ".. "
                else:
                    new_text = "..."

                self.refresh_dots_label.config(text=new_text)

                # Schedule next animation frame
                self.after(500, self._animate_refresh_dots)
        except:
            pass  # Animation will stop if overlay is destroyed

    def _set_calendar_refresh_status_for_all_files(self, status_text):
        """Set refresh status in Meeting column for all displayed files."""
        try:
            if not hasattr(self, "displayed_files_details") or not self.displayed_files_details:
                return

            # Update the data
            for file_data in self.displayed_files_details:
                file_data["meeting_display_text"] = status_text
                file_data["has_meeting"] = False

            # Refresh the TreeView to show the status (filtering-aware)
            if hasattr(self, "update_files_data_for_filtering"):
                self.update_files_data_for_filtering(self.displayed_files_details)
            else:
                self._populate_treeview_from_data(self.displayed_files_details)

        except Exception as e:
            logger.error("GUI", "_set_calendar_refresh_status_for_all_files", f"Error setting refresh status: {e}")

    def _clear_calendar_refresh_status_for_all_files(self):
        """Clear any remaining 'Refreshing...' or 'Syncing...' status from files."""
        try:
            if not hasattr(self, "displayed_files_details") or not self.displayed_files_details:
                return

            # Clear any refresh-related status
            for file_data in self.displayed_files_details:
                display_text = file_data.get("meeting_display_text", "")
                if display_text in ["Refreshing...", "Syncing...", "Processing..."]:
                    file_data["meeting_display_text"] = ""
                    file_data["has_meeting"] = False

            # Refresh the TreeView (filtering-aware)
            if hasattr(self, "update_files_data_for_filtering"):
                self.update_files_data_for_filtering(self.displayed_files_details)
            else:
                self._populate_treeview_from_data(self.displayed_files_details)

        except Exception as e:
            logger.error("GUI", "_clear_calendar_refresh_status_for_all_files", f"Error clearing refresh status: {e}")

    def check_selected_files_for_meetings_gui(self):
        """Check only the selected files for calendar meetings using LIVE calendar data."""
        try:
            # Get selected files
            selected_iids = self.file_tree.selection()
            if not selected_iids:
                messagebox.showinfo(
                    "No Selection", "Please select one or more files to check for meetings.", parent=self
                )
                return

            # Try to use live calendar integration
            try:
                from simple_outlook_integration import create_simple_outlook_integration

                calendar_integration = create_simple_outlook_integration()

                if not calendar_integration.is_available():
                    messagebox.showinfo(
                        "Calendar Not Available",
                        f"Calendar integration is not available: {calendar_integration.last_error or 'No calendar methods found'}\n\n"
                        f"Please ensure:\n"
                        f"• Outlook is installed and running\n"
                        f"• You are connected to your mail server\n"
                        f"• Calendar permissions are enabled",
                        parent=self,
                    )
                    return

                logger.info(
                    "GUI",
                    "check_selected_files_for_meetings_gui",
                    f"Using calendar integration methods: {calendar_integration.available_methods}",
                )

            except ImportError as e:
                messagebox.showinfo(
                    "Calendar Not Available",
                    f"Calendar integration module not available: {e}\n\n" f"This feature requires Outlook integration.",
                    parent=self,
                )
                return

            # Get file details for selected files
            selected_files = []
            for iid in selected_iids:
                file_detail = next((f for f in self.displayed_files_details if f["name"] == iid), None)
                if file_detail:
                    selected_files.append(file_detail.copy())

            if not selected_files:
                messagebox.showwarning("Selection Error", "Could not find details for the selected files.", parent=self)
                return

            # Show visual overlay for selected files
            self._show_calendar_refresh_overlay(len(selected_files), "Checking Selected Files for Meetings")

            # Set "Checking..." status for selected files
            for selected_file in selected_files:
                filename = selected_file.get("name")
                if filename and self.file_tree.exists(filename):
                    self.file_tree.set(filename, "meeting", "Checking...")

            # Update display
            self.update()

            # Show progress
            self.update_status_bar(
                progress_text=f"Checking {len(selected_files)} selected files for meetings using live calendar data..."
            )

            # Enhance selected files with LIVE meeting data - FORCE fresh lookup
            try:
                logger.info(
                    "GUI",
                    "check_selected_files_for_meetings_gui",
                    f"Performing LIVE calendar check for {len(selected_files)} selected files",
                )

                # Clear the calendar integration's internal cache to ensure fresh lookups
                try:
                    calendar_integration.cached_meetings.clear()
                    logger.debug("GUI", "check_selected_files_live", "Cleared calendar integration internal cache")
                except:
                    pass

                # Clear any existing calendar data to force fresh lookup
                clean_files = []
                for f in selected_files:
                    clean_file = f.copy()
                    # Remove ALL calendar meeting fields to force fresh lookup from COM
                    for key in list(clean_file.keys()):
                        if key.startswith("meeting_") or key == "has_meeting":
                            del clean_file[key]
                    clean_files.append(clean_file)

                # Use individual file processing to ensure we hit COM directly
                enhanced_files = []
                meetings_found = 0
                for i, clean_file in enumerate(clean_files):
                    try:
                        # Update progress
                        filename = clean_file.get("name", f"File {i+1}")
                        self.update_status_bar(progress_text=f"Checking {filename} ({i+1}/{len(clean_files)})...")

                        # Update the progress label in overlay if it exists with meeting count
                        if hasattr(self, "refresh_progress_label"):
                            try:
                                self.refresh_progress_label.config(
                                    text=f"Checking {filename}... ({i+1}/{len(clean_files)}) - {meetings_found} meetings found"
                                )
                                self.update()
                            except:
                                pass

                        # Small delay to make progress visible and allow COM operations
                        import time

                        time.sleep(0.1)

                        # Get meeting data directly from calendar integration (bypasses cache)
                        file_datetime = self._parse_file_datetime_for_calendar(clean_file)
                        logger.debug(
                            "GUI", "check_selected_files_live", f"Parsed datetime for {filename}: {file_datetime}"
                        )

                        if file_datetime:
                            logger.debug(
                                "GUI",
                                "check_selected_files_live",
                                f"Calling find_meeting_for_recording for {filename} at {file_datetime}",
                            )
                            meeting = calendar_integration.find_meeting_for_recording(
                                file_datetime, tolerance_minutes=self._get_calendar_tolerance_minutes()
                            )
                            logger.debug(
                                "GUI",
                                "check_selected_files_live",
                                f"Meeting result for {filename}: {meeting.subject if meeting else 'None'}",
                            )

                            if meeting:
                                meetings_found += 1
                                clean_file.update(
                                    {
                                        "has_meeting": True,
                                        "meeting_subject": meeting.subject,
                                        "meeting_display_text": meeting.subject,
                                        "meeting_start_time": meeting.start_time,
                                        "meeting_end_time": meeting.end_time,
                                        "meeting_organizer": meeting.organizer or "",
                                        "meeting_location": meeting.location or "",
                                    }
                                )
                            else:
                                clean_file.update(
                                    {
                                        "has_meeting": False,
                                        "meeting_display_text": "",
                                        "meeting_subject": "",
                                    }
                                )
                        else:
                            clean_file.update(
                                {
                                    "has_meeting": False,
                                    "meeting_display_text": "",
                                    "meeting_subject": "",
                                }
                            )

                        enhanced_files.append(clean_file)

                    except Exception as file_error:
                        logger.warning(
                            "GUI",
                            "check_selected_files_for_meetings_gui",
                            f"Error checking {clean_file.get('name', 'unknown')}: {file_error}",
                        )
                        # Add file with empty meeting data
                        clean_file.update(
                            {
                                "has_meeting": False,
                                "meeting_display_text": "",
                                "meeting_subject": "",
                            }
                        )
                        enhanced_files.append(clean_file)

                # Hide the overlay first
                self._hide_calendar_refresh_overlay()

                # CRITICAL FIX: Save the live meeting data to cache so it persists after restart
                if hasattr(self, "_calendar_cache_manager") and self._calendar_cache_manager:
                    for enhanced_file in enhanced_files:
                        filename = enhanced_file.get("name")
                        has_meeting = enhanced_file.get("has_meeting", False)

                        if has_meeting:
                            # Create a simple meeting object to cache
                            try:
                                from simple_outlook_integration import SimpleMeeting

                                simple_meeting = SimpleMeeting(
                                    subject=enhanced_file.get("meeting_subject", ""),
                                    organizer=enhanced_file.get("meeting_organizer", ""),
                                    start_time=enhanced_file.get("meeting_start_time"),
                                    end_time=enhanced_file.get("meeting_end_time"),
                                    location=enhanced_file.get("meeting_location", ""),
                                    attendees=[],  # Could be enhanced in future
                                )

                                # Get file datetime for caching
                                file_datetime = self._parse_file_datetime_for_calendar(enhanced_file)
                                if file_datetime:
                                    # Cache the meeting data
                                    self._calendar_cache_manager.cache_meeting_for_file(
                                        filename, file_datetime, simple_meeting
                                    )
                                    logger.debug(
                                        "GUI",
                                        "check_selected_files_live",
                                        f"Cached meeting data for {filename}: {simple_meeting.subject}",
                                    )

                            except Exception as cache_error:
                                logger.warning(
                                    "GUI",
                                    "check_selected_files_live",
                                    f"Failed to cache meeting for {filename}: {cache_error}",
                                )
                        else:
                            # Cache "no meeting" result
                            try:
                                file_datetime = self._parse_file_datetime_for_calendar(enhanced_file)
                                if file_datetime:
                                    self._calendar_cache_manager.cache_no_meeting_for_file(filename, file_datetime)
                                    logger.debug(
                                        "GUI", "check_selected_files_live", f"Cached 'no meeting' result for {filename}"
                                    )
                            except Exception as cache_error:
                                logger.warning(
                                    "GUI",
                                    "check_selected_files_live",
                                    f"Failed to cache 'no meeting' for {filename}: {cache_error}",
                                )

                # Update only the selected files in the TreeView
                files_with_meetings = 0
                for enhanced_file in enhanced_files:
                    filename = enhanced_file.get("name")
                    meeting_text = enhanced_file.get("meeting_display_text", "")
                    has_meeting = enhanced_file.get("has_meeting", False)

                    if has_meeting:
                        files_with_meetings += 1

                    # Update the specific file in the TreeView
                    if filename and self.file_tree.exists(filename):
                        self.file_tree.set(filename, "meeting", meeting_text)

                        # Also update the displayed_files_details for consistency
                        for i, displayed_file in enumerate(self.displayed_files_details):
                            if displayed_file.get("name") == filename:
                                # Copy all meeting fields from enhanced file
                                for key, value in enhanced_file.items():
                                    if key.startswith("meeting_") or key == "has_meeting":
                                        self.displayed_files_details[i][key] = value
                                break

                # Show results
                self.update_status_bar(
                    progress_text=f"Meeting check completed - {files_with_meetings} of {len(selected_files)} files have meetings"
                )

                # Show success message after a brief delay
                self.after(
                    300,
                    lambda: messagebox.showinfo(
                        "Meeting Check Complete",
                        f"Checked {len(selected_files)} selected files using live calendar data.\n\n"
                        f"Found meetings for {files_with_meetings} files.",
                        parent=self,
                    ),
                )

                logger.info(
                    "GUI",
                    "check_selected_files_for_meetings_gui",
                    f"Checked {len(selected_files)} files, found {files_with_meetings} with meetings",
                )

            except Exception as e:
                # Always hide overlay on error
                self._hide_calendar_refresh_overlay()

                logger.error("GUI", "check_selected_files_for_meetings_gui", f"Error checking files for meetings: {e}")
                messagebox.showerror(
                    "Meeting Check Error", f"Failed to check selected files for meetings: {str(e)}", parent=self
                )

        except Exception as e:
            # Always hide overlay on error
            try:
                self._hide_calendar_refresh_overlay()
            except:
                pass

            logger.error("GUI", "check_selected_files_for_meetings_gui", f"Error in meeting check: {e}")
            messagebox.showerror(
                "Meeting Check Error", f"Failed to check selected files for meetings: {str(e)}", parent=self
            )
