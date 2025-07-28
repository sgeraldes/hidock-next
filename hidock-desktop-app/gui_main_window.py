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
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import tkinter
import traceback
from datetime import datetime
from tkinter import filedialog, messagebox, ttk

import customtkinter as ctk
import usb.core
from audio_player_enhanced import EnhancedAudioPlayer
from audio_processing_advanced import AudioEnhancer
from audio_visualization import AudioVisualizationWidget

# Import Logger class for type hints if any
from config_and_logger import Logger, load_config, logger, save_config

# Import from our other modules
from constants import DEFAULT_PRODUCT_ID, DEFAULT_VENDOR_ID
from ctk_custom_widgets import CTkBanner
from desktop_device_adapter import DesktopDeviceAdapter
from device_interface import DeviceManager
from file_operations_manager import FileOperationsManager
from gui_actions_device import DeviceActionsMixin
from gui_actions_file import FileActionsMixin
from gui_auxiliary import AuxiliaryMixin
from gui_event_handlers import EventHandlersMixin
from gui_treeview import TreeViewMixin
from PIL import Image, ImageTk, UnidentifiedImageError
from settings_window import SettingsDialog
from storage_management import StorageMonitor, StorageOptimizer
from transcription_module import process_audio_file_for_insights


class HiDockToolGUI(
    ctk.CTk,
    TreeViewMixin,
    DeviceActionsMixin,
    FileActionsMixin,
    AuxiliaryMixin,
    EventHandlersMixin,
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

        # Make the icon path relative to the script file's location
        script_dir = os.path.dirname(os.path.abspath(__file__))
        self.icon_base_path = os.path.join(script_dir, "icons")
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
            self.backend_init_error_message = (
                f"Unexpected Python error during USB backend init: {e_backend_startup}"
            )
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

        self.file_operations_manager = FileOperationsManager(
            self.device_manager,
            self.download_directory,
            os.path.join(os.path.expanduser("~"), ".hidock", "cache"),
            device_lock=self.device_lock,
        )
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
            "version": "Version",
            "status": "Status",
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

        self._menu_image_references = []
        self._load_icons()
        self.create_widgets()
        self._set_minimum_window_size()
        self.apply_theme_and_color()
        self.after(100, self.attempt_autoconnect_on_startup())

    def _validate_window_geometry(self, geometry_string):
        """
        Validates and corrects window geometry to ensure the window is visible on screen.

        Args:
            geometry_string (str): Geometry string in format "WIDTHxHEIGHT+X+Y"

        Returns:
            str: Validated geometry string that ensures window visibility
        """
        try:
            # Parse the geometry string
            import re

            match = re.match(r"(\d+)x(\d+)([-+]\d+)([-+]\d+)", geometry_string)
            if not match:
                logger.warning(
                    "GUI",
                    "_validate_window_geometry",
                    f"Invalid geometry format: {geometry_string}",
                )
                return "950x850+100+100"  # Default fallback

            width, height, x_str, y_str = match.groups()
            width, height = int(width), int(height)
            x, y = int(x_str), int(y_str)

            # Get screen dimensions
            screen_width = self.winfo_screenwidth()
            screen_height = self.winfo_screenheight()

            # Validate and correct coordinates
            # Ensure window is not positioned off-screen
            min_visible_pixels = 100  # Minimum pixels that should be visible

            if x < -width + min_visible_pixels:
                x = 0
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Corrected negative X coordinate from {x_str} to {x}",
                )
            elif x > screen_width - min_visible_pixels:
                x = screen_width - width
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Corrected off-screen X coordinate from {x_str} to {x}",
                )

            if y < 0:
                y = 0
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Corrected negative Y coordinate from {y_str} to {y}",
                )
            elif y > screen_height - min_visible_pixels:
                y = screen_height - height
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Corrected off-screen Y coordinate from {y_str} to {y}",
                )

            # Ensure reasonable window size
            min_width, min_height = 400, 300
            if width < min_width:
                width = min_width
            if height < min_height:
                height = min_height

            validated_geometry = f"{width}x{height}+{x}+{y}"
            if validated_geometry != geometry_string:
                logger.info(
                    "GUI",
                    "_validate_window_geometry",
                    f"Corrected geometry from '{geometry_string}' to '{validated_geometry}'",
                )

            return validated_geometry

        except Exception as e:
            logger.error(
                "GUI",
                "_validate_window_geometry",
                f"Error validating geometry '{geometry_string}': {e}",
            )
            return "950x850+100+100"  # Safe fallback

    def _initialize_vars_from_config(self):
        """
        Initializes customtkinter (CTk) Variables from the loaded configuration.

        This method sets up various `ctk.StringVar`, `ctk.BooleanVar`, etc.,
        based on values found in `self.config` or defaults if keys are missing.
        """

        def get_conf(key, default_val):
            return self.config.get(key, default_val)

        self.autoconnect_var = ctk.BooleanVar(value=get_conf("autoconnect", False))
        self.download_directory = get_conf("download_directory", os.getcwd())
        self.logger_processing_level_var = ctk.StringVar(
            value=get_conf("log_level", "INFO")
        )
        self.selected_vid_var = ctk.IntVar(
            value=get_conf("selected_vid", DEFAULT_VENDOR_ID)
        )
        self.selected_pid_var = ctk.IntVar(
            value=get_conf("selected_pid", DEFAULT_PRODUCT_ID)
        )
        self.target_interface_var = ctk.IntVar(value=get_conf("target_interface", 0))
        self.recording_check_interval_var = ctk.IntVar(
            value=get_conf("recording_check_interval_s", 3)
        )
        self.default_command_timeout_ms_var = ctk.IntVar(
            value=get_conf("default_command_timeout_ms", 5000)
        )
        self.file_stream_timeout_s_var = ctk.IntVar(
            value=get_conf("file_stream_timeout_s", 180)
        )
        self.auto_refresh_files_var = ctk.BooleanVar(
            value=get_conf("auto_refresh_files", False)
        )
        self.auto_refresh_interval_s_var = ctk.IntVar(
            value=get_conf("auto_refresh_interval_s", 30)
        )
        self.quit_without_prompt_var = ctk.BooleanVar(
            value=get_conf("quit_without_prompt_if_connected", False)
        )
        self.appearance_mode_var = ctk.StringVar(
            value=get_conf("appearance_mode", "System")
        )
        self.color_theme_var = ctk.StringVar(value=get_conf("color_theme", "blue"))
        self.suppress_console_output_var = ctk.BooleanVar(
            value=get_conf("suppress_console_output", False)
        )
        self.suppress_gui_log_output_var = ctk.BooleanVar(
            value=get_conf("suppress_gui_log_output", False)
        )
        self.gui_log_filter_level_var = ctk.StringVar(
            value=get_conf("gui_log_filter_level", "DEBUG")
        )
        self.device_setting_auto_record_var = ctk.BooleanVar()
        self.device_setting_auto_play_var = ctk.BooleanVar()
        self.device_setting_bluetooth_tone_var = ctk.BooleanVar()
        self.device_setting_notification_sound_var = ctk.BooleanVar()
        self.treeview_columns_display_order_str = get_conf(
            "treeview_columns_display_order",
            "num,name,datetime,size,duration,status",
        )
        self.logs_visible_var = ctk.BooleanVar(
            value=get_conf("logs_pane_visible", False)
        )
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
            colors = loaded_log_colors.get(
                level, default_log_colors_fallback.get(level, ["#000000", "#FFFFFF"])
            )
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
        theme_specific_color = (
            self.icon_pref_dark_color
            if current_mode_is_dark
            else self.icon_pref_light_color
        )

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
                tk_photo_image = ImageTk.PhotoImage(
                    pil_image.resize(self.icon_display_size)
                )
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
                self.connect_device()
                if self.file_menu.entrycget("Connect to HiDock", "state") == "normal"
                else None
            ),
        )
        self.bind_all(
            "<Control-d>",
            lambda e: (
                self.disconnect_device()
                if self.file_menu.entrycget("Disconnect", "state") == "normal"
                else None
            ),
        )
        self.bind_all("<Control-comma>", lambda e: self.open_settings_window())
        self.bind_all("<Control-s>", lambda e: self.stop_audio_playback_gui())
        self.bind_all("<space>", lambda e: self.pause_audio_playback_gui())
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
        self.tools_menu = tkinter.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Tools", menu=self.tools_menu)
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

    def _update_menubar_style(self):
        """
        Applies styling to the `tkinter.Menu` to better match the CustomTkinter theme.
        """
        if not (hasattr(self, "file_menu") and self.file_menu):
            return
        try:
            menu_bg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkFrame"]["fg_color"]
            )
            menu_fg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkLabel"]["text_color"]
            )
            active_menu_bg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkButton"]["hover_color"]
            )
            active_menu_fg_candidate = ctk.ThemeManager.theme["CTkButton"].get(
                "text_color_hover"
            )
            active_menu_fg = self.apply_appearance_mode_theme_color(
                active_menu_fg_candidate
                if active_menu_fg_candidate
                else ctk.ThemeManager.theme["CTkButton"]["text_color"]
            )
            disabled_fg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkLabel"].get(
                    "text_color_disabled", ("gray70", "gray30")
                )
            )
            for menu_widget in [
                self.file_menu,
                self.view_menu,
                self.actions_menu,
                self.device_menu,
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
            logger.debug(
                "GUI", "_update_menubar_style", "Attempted to apply theme to menubar."
            )
        except KeyError as e:
            logger.error(
                "GUI", "_update_menubar_style", f"Theme key missing for menubar: {e}."
            )
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
                            menu_widget.entryconfigure(
                                label, image=self.menu_icons.get(icon_name)
                            )
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
        self.toolbar_connect_button.pack(
            side="left", padx=toolbar_button_padx, pady=toolbar_button_pady
        )
        self.toolbar_refresh_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Refresh",
            command=self.refresh_file_list_gui,
            width=toolbar_button_width,
            image=self.icons.get("refresh"),
        )
        self.toolbar_refresh_button.pack(
            side="left", padx=toolbar_button_padx, pady=toolbar_button_pady
        )
        self.toolbar_download_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Download",
            command=self.download_selected_files_gui,
            width=toolbar_button_width,
            image=self.icons.get("download"),
        )
        self.toolbar_download_button.pack(
            side="left", padx=toolbar_button_padx, pady=toolbar_button_pady
        )
        self.toolbar_play_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Play",
            command=self.play_selected_audio_gui,
            width=toolbar_button_width,
            image=self.icons.get("play"),
        )
        self.toolbar_play_button.pack(
            side="left", padx=toolbar_button_padx, pady=toolbar_button_pady
        )
        self.toolbar_delete_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Delete",
            command=self.delete_selected_files_gui,
            width=toolbar_button_width,
            image=self.icons.get("delete"),
        )
        self.toolbar_delete_button.pack(
            side="left", padx=toolbar_button_padx, pady=toolbar_button_pady
        )
        self.toolbar_settings_button = ctk.CTkButton(
            self.toolbar_frame,
            text="Settings",
            command=self.open_settings_window,
            width=toolbar_button_width,
            image=self.icons.get("settings"),
        )
        self.toolbar_settings_button.pack(
            side="right", padx=(2, 5), pady=toolbar_button_pady
        )

    def _create_status_bar(self):
        """
        Creates the status bar at the bottom of the application window.
        """
        self.status_bar_frame = ctk.CTkFrame(self, height=30, corner_radius=0)
        self.status_bar_frame.pack(side="bottom", fill="x", padx=0, pady=(1, 0))
        self.status_connection_label = ctk.CTkLabel(
            self.status_bar_frame, text="Status: Disconnected", anchor="w"
        )
        self.status_connection_label.pack(side="left", padx=10, pady=2)
        self.status_progress_text_label = ctk.CTkLabel(
            self.status_bar_frame, text="", anchor="w"
        )
        self.status_progress_text_label.pack(
            side="left", padx=10, pady=2, fill="x", expand=True
        )
        self.status_file_progress_bar = ctk.CTkProgressBar(
            self.status_bar_frame, width=160, height=18
        )
        self.status_file_progress_bar.set(0)
        progress_bar_pady = (
            ((self.status_bar_frame.cget("height") - 18) // 2)
            if self.status_bar_frame.cget("height") > 18
            else 2
        )
        self.status_file_progress_bar.pack(side="left", padx=10, pady=progress_bar_pady)

    def update_status_bar(self, connection_status=None, progress_text=None):
        """
        Updates specific labels in the status bar.
        """
        if (
            hasattr(self, "status_connection_label")
            and self.status_connection_label.winfo_exists()
        ):
            if connection_status is not None:
                self.status_connection_label.configure(text=connection_status)
        if (
            hasattr(self, "status_progress_text_label")
            and self.status_progress_text_label.winfo_exists()
        ):
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
        threading.Thread(
            target=self._update_all_status_info_thread, daemon=True
        ).start()

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
                    device_info = asyncio.run(
                        self.device_manager.device_interface.get_device_info()
                    )
                    if device_info:
                        conn_status_text = (
                            f"Status: Connected ({device_info.model.value or 'HiDock'})"
                        )
                        if device_info.serial_number != "N/A":
                            conn_status_text += f" SN: {device_info.serial_number}"
                    # Avoid getting storage info during file list streaming to prevent command conflicts
                    if hasattr(self.device_manager.device_interface, 'jensen_device') and \
                       hasattr(self.device_manager.device_interface.jensen_device, 'is_file_list_streaming') and \
                       self.device_manager.device_interface.jensen_device.is_file_list_streaming():
                        card_info = None  # Skip during streaming
                    else:
                        card_info = asyncio.run(
                            self.device_manager.device_interface.get_storage_info()
                        )
                    if card_info and card_info.total_capacity > 0:
                        used_bytes, capacity_bytes = (
                            card_info.used_space,
                            card_info.total_capacity,
                        )
                        # Define constants for clarity
                        BYTES_PER_MB = 1024 * 1024
                        BYTES_PER_GB = BYTES_PER_MB * 1024

                        # Display in GB if capacity is over ~0.9 GB
                        if capacity_bytes > BYTES_PER_GB * 0.9:
                            used_gb = used_bytes / BYTES_PER_GB
                            capacity_gb = capacity_bytes / BYTES_PER_GB
                            storage_text = (
                                f"Storage: {used_gb:.2f}/{capacity_gb:.2f} GB"
                            )
                        else:
                            # Otherwise, display in MB
                            used_mb = used_bytes / BYTES_PER_MB
                            capacity_mb = capacity_bytes / BYTES_PER_MB
                            storage_text = (
                                f"Storage: {used_mb:.0f}/{capacity_mb:.0f} MB"
                            )
                        storage_text += f" (Status: {hex(card_info.status_raw)})"
                    else:
                        storage_text = "Storage: Fetching..."
            elif not self.backend_initialized_successfully:
                conn_status_text = "Status: USB Backend FAILED!"
            self.after(
                0, self._update_gui_with_status_info, conn_status_text, storage_text
            )
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
                len(self.file_tree.selection())
                if hasattr(self, "file_tree") and self.file_tree.winfo_exists()
                else 0
            )
            size_selected_bytes = 0
            if (
                selected_items_count > 0
                and hasattr(self, "file_tree")
                and self.file_tree.winfo_exists()
            ):
                for item_iid in self.file_tree.selection():
                    file_detail = next(
                        (
                            f
                            for f in self.displayed_files_details
                            if f["name"] == item_iid
                        ),
                        None,
                    )
                    if file_detail:
                        size_selected_bytes += file_detail.get("length", 0)
            file_counts_text = (
                f"Files: {total_items} total / {selected_items_count} "
                f"sel. ({size_selected_bytes / (1024*1024):.2f} MB)"
            )
        except (AttributeError, tkinter.TclError):
            file_counts_text = "Files: N/A"

        if (
            hasattr(self, "status_storage_label_header")
            and self.status_storage_label_header.winfo_exists()
        ):
            self.status_storage_label_header.configure(text=storage_text)
        if (
            hasattr(self, "status_file_counts_label_header")
            and self.status_file_counts_label_header.winfo_exists()
        ):
            self.status_file_counts_label_header.configure(text=file_counts_text)
        if (
            hasattr(self, "download_dir_button_header")
            and self.download_dir_button_header.winfo_exists()
        ):
            self.download_dir_button_header.configure(
                text=f"Dir: {os.path.basename(self.download_directory)}"
            )
        self.update_status_bar(connection_status=conn_status_text)

    def _update_menu_states(self):
        """
        Updates the state (enabled/disabled) of menu items and toolbar buttons.
        """
        is_connected = self.device_manager.device_interface.is_connected()
        has_selection = bool(
            hasattr(self, "file_tree")
            and self.file_tree.winfo_exists()
            and self.file_tree.selection()
        )
        num_selected = len(self.file_tree.selection()) if has_selection else 0
        if hasattr(self, "file_menu"):
            self.file_menu.entryconfig(
                "Connect to HiDock",
                state=(
                    "normal"
                    if not is_connected and self.backend_initialized_successfully
                    else "disabled"
                ),
            )
            self.file_menu.entryconfig(
                "Disconnect", state="normal" if is_connected else "disabled"
            )
        if hasattr(self, "view_menu"):
            self.view_menu.entryconfig(
                "Refresh File List", state="normal" if is_connected else "disabled"
            )
        can_play_selected = is_connected and num_selected == 1
        if can_play_selected:
            file_iid = self.file_tree.selection()[0]
            file_detail = next(
                (f for f in self.displayed_files_details if f["name"] == file_iid),
                None,
            )
            if not (
                file_detail
                and (
                    file_detail["name"].lower().endswith(".wav")
                    or file_detail["name"].lower().endswith(".hda")
                )
            ):
                can_play_selected = False
        if hasattr(self, "actions_menu"):
            self.actions_menu.entryconfig(
                "Download Selected",
                state="normal" if is_connected and has_selection else "disabled",
            )
            self.actions_menu.entryconfig(
                "Play Selected", state="normal" if can_play_selected else "disabled"
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
            self.actions_menu.entryconfig(
                "Select All", state="normal" if can_select_all else "disabled"
            )
            self.actions_menu.entryconfig(
                "Clear Selection", state="normal" if has_selection else "disabled"
            )

            # Check if there are active downloads to cancel
            active_downloads = [
                op
                for op in self.file_operations_manager.get_all_active_operations()
                if op.operation_type.value == "download"
                and op.status.value in ["pending", "in_progress"]
            ]

            # Check if selected files have active downloads
            selected_filenames = (
                [
                    self.file_tree.item(iid)["values"][1]
                    for iid in self.file_tree.selection()
                ]
                if has_selection
                else []
            )

            selected_active_downloads = [
                op for op in active_downloads if op.filename in selected_filenames
            ]

            self.actions_menu.entryconfig(
                "Cancel Selected Downloads",
                state="normal" if selected_active_downloads else "disabled",
            )
            self.actions_menu.entryconfig(
                "Cancel All Downloads",
                state="normal" if active_downloads else "disabled",
            )

            # Update playback controls based on audio player state
            is_playing = hasattr(
                self, "audio_player"
            ) and self.audio_player.state.value in ["playing", "paused"]
            self.actions_menu.entryconfig(
                "Stop Playback", state="normal" if is_playing else "disabled"
            )
        if hasattr(self, "device_menu"):
            self.device_menu.entryconfig(
                "Sync Device Time", state="normal" if is_connected else "disabled"
            )
            self.device_menu.entryconfig(
                "Format Storage", state="normal" if is_connected else "disabled"
            )
        if (
            hasattr(self, "toolbar_connect_button")
            and self.toolbar_connect_button.winfo_exists()
        ):
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
                    state=(
                        "normal"
                        if self.backend_initialized_successfully
                        else "disabled"
                    ),
                    image=self.icons.get("connect"),
                )
        if (
            hasattr(self, "toolbar_refresh_button")
            and self.toolbar_refresh_button.winfo_exists()
        ):
            self.toolbar_refresh_button.configure(
                state=(
                    "normal"
                    if is_connected
                    and not self._is_ui_refresh_in_progress
                    and not self.is_long_operation_active
                    else "disabled"
                )
            )
        if (
            hasattr(self, "toolbar_download_button")
            and self.toolbar_download_button.winfo_exists()
        ):
            if (
                self.is_long_operation_active
                and self.active_operation_name == "Download Queue"
            ):
                self.toolbar_download_button.configure(
                    text="Cancel DL",
                    command=self.request_cancel_operation,
                    state="normal",
                    image=self.icons.get("stop"),
                )
            else:
                self.toolbar_download_button.configure(
                    text="Download",
                    command=self.download_selected_files_gui,
                    state=(
                        "normal"
                        if is_connected
                        and has_selection
                        and not self.is_long_operation_active
                        and not self.is_audio_playing
                        else "disabled"
                    ),
                    image=self.icons.get("download"),
                )
        if (
            hasattr(self, "toolbar_play_button")
            and self.toolbar_play_button.winfo_exists()
        ):
            if self.is_audio_playing:
                self.toolbar_play_button.configure(
                    text="Stop",
                    command=self._stop_audio_playback,
                    state="normal",
                    image=self.icons.get("stop"),
                )
            elif (
                self.is_long_operation_active
                and self.active_operation_name == "Playback Preparation"
            ):
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
                    state=(
                        "normal"
                        if can_play_selected and not self.is_long_operation_active
                        else "disabled"
                    ),
                    image=self.icons.get("play"),
                )

        if (
            hasattr(self, "toolbar_delete_button")
            and self.toolbar_delete_button.winfo_exists()
        ):
            if (
                self.is_long_operation_active
                and self.active_operation_name == "Deletion"
            ):
                self.toolbar_delete_button.configure(
                    text="Cancel Del.",
                    command=self.request_cancel_operation,
                    state="normal",
                    image=self.icons.get("stop"),
                )
            else:
                self.toolbar_delete_button.configure(
                    text="Delete",
                    command=self.delete_selected_files_gui,
                    state=(
                        "normal"
                        if is_connected
                        and has_selection
                        and not self.is_long_operation_active
                        and not self.is_audio_playing
                        else "disabled"
                    ),
                    image=self.icons.get("delete"),
                )
        if (
            hasattr(self, "toolbar_settings_button")
            and self.toolbar_settings_button.winfo_exists()
        ):
            self.toolbar_settings_button.configure(state="normal")

    def _update_treeview_style(self):
        """
        Applies styling to the `ttk.Treeview` widget to match the CustomTkinter theme.
        """
        if not (hasattr(self, "file_tree") and self.file_tree.winfo_exists()):
            logger.debug(
                "GUI", "_update_treeview_style", "file_tree not found, skipping."
            )
            return
        style = ttk.Style()
        if not ctk.ThemeManager.theme:
            logger.warning(
                "GUI", "_update_treeview_style", "CTk ThemeManager.theme not populated."
            )
            return
        default_ctk_font = ctk.CTkFont()
        font_family, base_size = default_ctk_font.cget("family"), default_ctk_font.cget(
            "size"
        )
        tree_font_size = max(10, base_size - 1)
        tree_font = (font_family, tree_font_size)
        heading_font_size = base_size
        heading_font = (font_family, heading_font_size, "bold")
        current_mode = ctk.get_appearance_mode()
        try:
            frame_bg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkFrame"]["fg_color"]
            )
            label_text_color = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkLabel"]["text_color"]
            )
            button_fg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkButton"]["fg_color"]
            )
            button_hover = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkButton"]["hover_color"]
            )
            button_text = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkButton"]["text_color"]
            )
            heading_bg_candidate_1 = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkFrame"].get("top_fg_color", frame_bg)
            )
            heading_bg_candidate_2 = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkFrame"].get("border_color", frame_bg)
            )
            default_heading_bg = (
                heading_bg_candidate_1
                if heading_bg_candidate_1 != frame_bg
                else heading_bg_candidate_2
            )
            tree_body_bg_color, tree_body_text_color = frame_bg, label_text_color
            tree_selected_bg_color, tree_selected_text_color = button_fg, button_text
            default_heading_fg, active_heading_bg, active_heading_fg = (
                button_text,
                button_hover,
                button_text,
            )
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
                        self.apply_appearance_mode_theme_color(
                            ctk.ThemeManager.theme["CTkLabel"]["text_color"]
                        ),
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

    def apply_appearance_mode_theme_color(self, color_tuple_or_str):
        """
        Helper to get the correct color from a (light_mode_color, dark_mode_color) tuple
        or string based on the current CustomTkinter appearance mode.
        """
        if isinstance(color_tuple_or_str, (list, tuple)):
            return (
                color_tuple_or_str[1]
                if ctk.get_appearance_mode() == "Dark"
                else color_tuple_or_str[0]
            )
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
        self._create_log_panel(self.main_content_frame)
        self._create_audio_visualizer_panel(self.main_content_frame)
        self._update_log_text_area_tag_colors()

        # Check for missing dependencies after GUI is initialized
        self.after(1000, self._check_dependencies)

    def _create_main_panel_layout(self):
        """Creates the main content frame and configures its grid."""
        self.main_content_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.main_content_frame.pack(fill="both", expand=True, padx=5, pady=5)
        self.main_content_frame.grid_rowconfigure(0, weight=1)
        self.main_content_frame.grid_rowconfigure(1, weight=0)
        self.main_content_frame.grid_columnconfigure(0, weight=1)

    def _create_files_panel(self, _parent_frame):
        """Creates the file display panel including header and treeview."""
        files_frame = ctk.CTkFrame(self.main_content_frame)
        files_frame.grid(row=0, column=0, sticky="nsew", padx=0, pady=(0, 5))
        files_frame.grid_columnconfigure(0, weight=1)
        files_frame.grid_rowconfigure(0, weight=0)
        files_frame.grid_rowconfigure(1, weight=1)
        files_header_frame = ctk.CTkFrame(files_frame, fg_color="transparent")
        files_header_frame.grid(row=0, column=0, sticky="ew", padx=5, pady=(5, 2))
        self.status_storage_label_header = ctk.CTkLabel(
            files_header_frame, text="Storage: ---", anchor="w"
        )
        self.status_storage_label_header.pack(side="left", padx=10, pady=2)
        self.status_file_counts_label_header = ctk.CTkLabel(
            files_header_frame, text="Files: 0 / 0", anchor="w"
        )
        self.status_file_counts_label_header.pack(side="left", padx=10, pady=2)
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
        self.download_dir_button_header.bind(
            "<Button-3>", self._select_download_dir_from_header_button
        )
        self.download_dir_button_header.pack(side="right", padx=(10, 0), pady=2)
        self.clear_selection_button_header = ctk.CTkButton(
            files_header_frame,
            text="",
            image=self.icons.get("clear_selection_files"),
            width=30,
            height=24,
            command=self.clear_selection_action,
        )
        self.clear_selection_button_header.pack(side="right", padx=(2, 5), pady=2)
        self.select_all_button_header = ctk.CTkButton(
            files_header_frame,
            text="",
            image=self.icons.get("select_all_files"),
            width=30,
            height=24,
            command=self.select_all_files_action,
        )
        self.select_all_button_header.pack(side="right", padx=(2, 2), pady=2)
        self._create_file_tree_frame(files_frame)
        self.file_tree.bind("<Control-A>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Delete>", self._on_delete_key_press)
        self.file_tree.bind("<Return>", self._on_enter_key_press)
        self.file_tree.bind(
            "<Escape>", lambda event: self.cancel_selected_downloads_gui()
        )
        self.file_tree.bind("<ButtonPress-1>", self._on_file_button1_press)
        self.file_tree.bind("<B1-Motion>", self._on_file_b1_motion)
        self.file_tree.bind("<ButtonRelease-1>", self._on_file_button1_release)

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
        ctk.CTkLabel(log_controls_sub_frame, text="Level:").pack(
            side="left", padx=(0, 5)
        )
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
        self.log_text_area = ctk.CTkTextbox(
            self.log_frame, height=100, state="disabled", wrap="word", border_spacing=3
        )
        self.log_text_area.pack(fill="both", expand=True, padx=5, pady=(0, 5))
        self._update_log_text_area_tag_colors()

    def _create_audio_visualizer_panel(self, parent_frame):
        """Creates the audio visualizer panel."""
        self.audio_visualizer_frame = ctk.CTkFrame(parent_frame)
        self.audio_visualizer_frame.grid(
            row=2, column=0, sticky="nsew", padx=0, pady=(0, 5)
        )

        # Add collapse/expand button
        self.visualizer_header = ctk.CTkFrame(self.audio_visualizer_frame)
        self.visualizer_header.pack(fill="x", padx=5, pady=5)

        self.visualizer_toggle = ctk.CTkButton(
            self.visualizer_header,
            text="🎵 Show Audio Visualization",
            command=self._toggle_audio_visualizer,
            width=200,
            height=30,
        )
        self.visualizer_toggle.pack(side="left", padx=5)

        self.audio_visualizer_widget = AudioVisualizationWidget(
            self.audio_visualizer_frame
        )

        # Initially hide the visualization widget
        self.visualizer_expanded = False
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
            min_h = (
                self.toolbar_frame.winfo_reqheight()
                + self.status_bar_frame.winfo_reqheight()
                + 200
            )
        except (AttributeError, tkinter.TclError):
            pass
        self.minsize(min_w, min_h)

    def _check_dependencies(self):
        """Check for missing dependencies and show user-friendly warnings."""
        try:
            import shutil
            import subprocess
            from tkinter import messagebox

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
            logger.error(
                "MainWindow", "_check_dependencies", f"Error checking dependencies: {e}"
            )

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
                f"Position update: {position.current_time:.1f}s / {position.total_time:.1f}s ({position.percentage:.1f}%)",
            )

            if (
                hasattr(self, "audio_visualizer_widget")
                and self.audio_visualizer_widget
            ):
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
                                f"Skipping position update - visualizing {selected_filename} but playing {self.current_playing_filename_for_replay}",
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

            if (
                hasattr(self, "audio_visualizer_widget")
                and self.audio_visualizer_widget
            ):
                if state == PlaybackState.PLAYING:
                    # Auto-show visualization when audio starts playing
                    if (
                        hasattr(self, "visualizer_expanded")
                        and not self.visualizer_expanded
                    ):
                        self.visualizer_expanded = True
                        self._update_visualizer_visibility()

                    # Start spectrum analysis if available
                    current_track = self.audio_player.get_current_track()
                    if current_track:
                        # Get audio data for spectrum analysis
                        try:
                            from audio_player_enhanced import AudioProcessor

                            waveform_data, sample_rate = (
                                AudioProcessor.extract_waveform_data(
                                    current_track.filepath, max_points=1024
                                )
                            )
                            if len(waveform_data) > 0:
                                self.audio_visualizer_widget.start_spectrum_analysis(
                                    waveform_data, sample_rate
                                )
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
        except Exception as e:
            logger.error(
                "MainWindow",
                "_toggle_audio_visualizer",
                f"Error toggling visualizer: {e}",
            )

    def _update_visualizer_visibility(self):
        """Update the visibility of the audio visualizer."""
        try:
            if self.visualizer_expanded:
                self.audio_visualizer_widget.pack(
                    fill="both", expand=True, padx=5, pady=(0, 5)
                )
                self.visualizer_toggle.configure(text="🎵 Hide Audio Visualization")
            else:
                self.audio_visualizer_widget.pack_forget()
                self.visualizer_toggle.configure(text="🎵 Show Audio Visualization")
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
                # No file selected - hide visualization section
                if hasattr(self, "visualizer_expanded") and self.visualizer_expanded:
                    self.visualizer_expanded = False
                    self._update_visualizer_visibility()
                return

            # Get the last selected file (for multiple selection)
            last_selected_iid = selected_iids[-1]
            file_detail = next(
                (
                    f
                    for f in self.displayed_files_details
                    if f["name"] == last_selected_iid
                ),
                None,
            )

            if not file_detail:
                return

            filename = file_detail["name"]
            local_filepath = self._get_local_filepath(filename)

            # Only show visualization section if file is downloaded
            if os.path.exists(local_filepath):
                # File is downloaded - show visualization and load waveform
                if (
                    hasattr(self, "visualizer_expanded")
                    and not self.visualizer_expanded
                ):
                    self.visualizer_expanded = True
                    self._update_visualizer_visibility()

                if hasattr(self, "audio_visualizer_widget"):
                    self.audio_visualizer_widget.load_audio(local_filepath)
                    
                    # If this file is not currently playing, clear position indicators
                    if filename != self.current_playing_filename_for_replay:
                        # Clear position indicators for non-playing files
                        self.audio_visualizer_widget.clear_position_indicators()
            else:
                # File not downloaded - hide visualization section
                if hasattr(self, "visualizer_expanded") and self.visualizer_expanded:
                    self.visualizer_expanded = False
                    self._update_visualizer_visibility()

        except Exception as e:
            logger.error(
                "MainWindow",
                "_update_waveform_for_selection",
                f"Error updating waveform: {e}",
            )

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
            if (
                hasattr(self, "audio_visualizer_widget")
                and self.audio_visualizer_widget
            ):
                self.audio_visualizer_widget.clear_position_indicators()

            # Update the specific file's status in treeview without full refresh
            if self.current_playing_filename_for_replay:
                # Find the file detail to determine the correct status
                file_detail = next(
                    (
                        f
                        for f in self.displayed_files_details
                        if f["name"] == self.current_playing_filename_for_replay
                    ),
                    None,
                )

                if file_detail:
                    # Determine the appropriate status after stopping playback
                    new_status = (
                        "Downloaded" if file_detail.get("local_path") else "On Device"
                    )

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
            logger.error(
                "GUI", "stop_audio_playback_gui", f"Error stopping playback: {e}"
            )
            messagebox.showerror(
                "Playback Error", f"Error stopping playback: {e}", parent=self
            )

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
            messagebox.showerror(
                "Playback Error", f"Error pausing/resuming playback: {e}", parent=self
            )

    def _stop_audio_playback(self):
        """Internal method for stopping audio playback (used by toolbar button)."""
        self.stop_audio_playback_gui()

    def _download_for_playback_and_play(self, filename, local_filepath):
        """
        Downloads a single file and triggers playback upon successful completion.
        """
        # Show brief status message instead of interrupting dialog
        self.update_status_bar(
            progress_text=f"Downloading '{filename}' for playback..."
        )

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

        self.file_operations_manager.queue_batch_download(
            [filename], on_playback_download_complete
        )

    def play_selected_audio_gui(self):
        selected_iids = self.file_tree.selection()
        if len(selected_iids) != 1:
            messagebox.showinfo(
                "Playback", "Please select a single audio file to play.", parent=self
            )
            return

        file_iid = selected_iids[0]
        file_detail = next(
            (f for f in self.displayed_files_details if f["name"] == file_iid), None
        )
        if not file_detail:
            return

        filename = file_detail["name"]
        local_filepath = self._get_local_filepath(filename)
        if os.path.exists(local_filepath):
            self._play_local_file(local_filepath)
        else:
            self._download_for_playback_and_play(filename, local_filepath)

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
        self.config["window_geometry"] = self.geometry()
        self.config["autoconnect"] = self.autoconnect_var.get()
        self.config["download_directory"] = self.download_directory
        self.config["log_level"] = self.logger_processing_level_var.get()
        self.config["selected_vid"] = self.selected_vid_var.get()
        self.config["selected_pid"] = self.selected_pid_var.get()
        self.config["target_interface"] = self.target_interface_var.get()
        self.config["recording_check_interval_s"] = (
            self.recording_check_interval_var.get()
        )
        self.config["default_command_timeout_ms"] = (
            self.default_command_timeout_ms_var.get()
        )
        self.config["file_stream_timeout_s"] = self.file_stream_timeout_s_var.get()
        self.config["auto_refresh_files"] = self.auto_refresh_files_var.get()
        self.config["auto_refresh_interval_s"] = self.auto_refresh_interval_s_var.get()
        self.config["quit_without_prompt_if_connected"] = (
            self.quit_without_prompt_var.get()
        )
        self.config["appearance_mode"] = self.appearance_mode_var.get()
        self.config["color_theme"] = self.color_theme_var.get()
        self.config["suppress_console_output"] = self.suppress_console_output_var.get()
        self.config["suppress_gui_log_output"] = self.suppress_gui_log_output_var.get()
        self.config["gui_log_filter_level"] = self.gui_log_filter_level_var.get()
        self.config["treeview_columns_display_order"] = ",".join(
            self.file_tree["displaycolumns"]
        )
        self.config["logs_pane_visible"] = self.logs_visible_var.get()
        self.config["loop_playback"] = self.loop_playback_var.get()
        self.config["playback_volume"] = self.volume_var.get()
        self.config["treeview_sort_col_id"] = self.saved_treeview_sort_column
        self.config["treeview_sort_descending"] = self.saved_treeview_sort_reverse
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
        save_config(self.config)
        if self.device_manager.device_interface.is_connected():
            self.device_manager.device_interface.disconnect()
        if self.current_playing_temp_file and os.path.exists(
            self.current_playing_temp_file
        ):
            try:
                os.remove(self.current_playing_temp_file)
            except OSError as e:
                logger.warning(
                    "GUI",
                    "on_closing",
                    f"Could not remove temp playback file {self.current_playing_temp_file}: {e}",
                )
        self.destroy()
        logger.info("GUI", "on_closing", "Application shutdown complete.")
        sys.exit(0)

    def _process_selected_audio(self, file_iid):
        file_detail = next(
            (f for f in self.displayed_files_details if f["name"] == file_iid), None
        )
        if not file_detail:
            messagebox.showerror(
                "Audio Processing Error", "File details not found.", parent=self
            )
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
            enhancer = AudioEnhancer()
            # ... (call enhancer methods)

            dialog.destroy()

        process_button = ctk.CTkButton(dialog, text="Process", command=process_audio)
        process_button.pack(pady=20)

    def show_system_health(self):
        dialog = ctk.CTkToplevel(self)
        dialog.title("System Health")
        dialog.geometry("400x300")

        storage_monitor = StorageMonitor([self.download_directory])
        storage_info = storage_monitor.get_storage_info()

        # Display storage info in the dialog
        # ... (This will be implemented in a future step)

    def show_storage_optimizer(self):
        dialog = ctk.CTkToplevel(self)
        dialog.title("Storage Optimizer")
        dialog.geometry("600x400")

        storage_optimizer = StorageOptimizer([self.download_directory])
        optimization_suggestions = storage_optimizer.analyze_storage()

        # Display optimization suggestions in the dialog
        # ... (This will be implemented in a future step)
