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

import os
import tkinter  # For Menu
from tkinter import filedialog, messagebox, ttk  # ttk for Treeview
import threading
import traceback  # For detailed error logging
import tempfile  # For temporary audio files
import subprocess  # For opening directories
import sys  # For platform detection
from datetime import datetime
import time  # For time.strftime in playback and ETR calculations44444444444
import customtkinter as ctk
import usb.backend.libusb1  # Added for _initialize_backend_early
from PIL import Image  # For loading icons with CTkImage
from PIL import ImageTk  # For tkinter.Menu images
from PIL import UnidentifiedImageError  # For more specific exception handling

# Import from our other modules
from constants import DEFAULT_VENDOR_ID, DEFAULT_PRODUCT_ID  # Used in _initialize_vars_from_config

# Import Logger class for type hints if any
from config_and_logger import logger, load_config, save_config, Logger
from hidock_device import HiDockJensen
from settings_window import SettingsDialog
from ctk_custom_widgets import CTkBanner  # ADDED: Import the banner

try:
    import pygame
    # import pygame.error # This line is removed as it causes Pylance issues and is not needed.
except ImportError:
    pygame = None
    # logger might not be fully available at module load time for other modules,
    # but the GUI __init__ will log this warning properly.
    print("[WARNING] Pygame module not found. Audio playback will be disabled.")


class HiDockToolGUI(ctk.CTk):
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

        global pygame  # pylint: disable=global-statement # Necessary to modify global pygame on mixer init failure
        self.title("HiDock Explorer Tool")
        try:
            self.geometry(self.config.get("window_geometry", "950x850+100+100"))
        except tkinter.TclError as e:
            logger.warning(
                "GUI", "__init__", f"Failed to apply saved geometry: {e}. Using default."
            )
            self.geometry("950x850+100+100")

        self.icon_base_path = "icons"
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
        except Exception as e_backend_startup:  # pylint: disable=broad-except
            # This is a final fallback for truly unexpected errors during the critical
            # USB backend initialization. _initialize_backend_early() handles common
            # specific exceptions (USBError, OSError, RuntimeError etc.).
            self.backend_initialized_successfully = False
            self.backend_init_error_message = (
                f"Unexpected Python error during USB backend init: {e_backend_startup}"
            )
            logger.error(
                "GUI",
                "__init__",
                f"CRITICAL: {self.backend_init_error_message}\n{traceback.format_exc()}",
            )

        self.dock = HiDockJensen(self.usb_backend_instance)

        self._initialize_vars_from_config()

        self.available_usb_devices = (
            []
        )  # Used by SettingsDialog, populated by scan_usb_devices_for_settings
        self.displayed_files_details = []
        self.treeview_sort_column = self.saved_treeview_sort_column
        self.treeview_sort_reverse = self.saved_treeview_sort_reverse
        self._recording_check_timer_id = None
        self._auto_file_refresh_timer_id = None
        self._is_ui_refresh_in_progress = False
        self._previous_recording_filename = None
        # self._fetched_device_settings_for_dialog is managed by SettingsDialog now
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
        self._connection_error_banner = None  # ADDED: Initialize banner attribute
        self._last_dragged_over_iid = None
        self._drag_action_is_deselect = False
        self.default_progressbar_fg_color = None
        self.default_progressbar_progress_color = None
        self.original_tree_headings = {
            "name": "Name",
            "size": "Size (KB)",
            "duration": "Duration (s)",
            "date": "Date",
            "time": "Time",
            "status": "Status",
        }
        self.icons = {}  # For CTkImage objects
        self.menu_icons = {}  # For tkinter.PhotoImage objects for menus
        self._last_appearance_mode = self.appearance_mode_var.get()
        # Initialize menu attributes to None
        self.file_menu = None
        self.view_menu = None
        self.actions_menu = None
        self.device_menu = None
        # Initialize toolbar attributes to None
        self.toolbar_frame = None
        self.toolbar_connect_button = None
        self.toolbar_refresh_button = None
        self.toolbar_download_button = None
        self.toolbar_play_button = None
        self.toolbar_delete_button = None
        self.toolbar_settings_button = None
        # Initialize status bar attributes to None
        self.status_bar_frame = None
        self.status_connection_label = None
        self.status_progress_text_label = None
        self.status_file_progress_bar = None
        self.main_content_frame = None
        self.status_storage_label_header = (
            None  # Already present in thought process, but good to double check
        )
        self.status_file_counts_label_header = None
        self.download_dir_button_header = None  # Already present in thought process
        # Initialize attributes flagged by Pylint
        self._settings_dialog_instance = None
        self.current_time_label = None
        self.playback_slider = None
        self.total_duration_label = None  # Added as it's created with playback_slider
        self.volume_slider_widget = None  # Added as it's created with playback_slider
        self.loop_checkbox = None
        self.clear_selection_button_header = None
        self.clear_log_button = None
        self.log_section_level_combo = None
        self.select_all_button_header = None
        self.file_tree = None
        self.log_frame = None
        self.download_logs_button = None
        self.log_text_area = None

        if pygame:
            try:
                pygame.mixer.init()
                logger.info("GUI", "__init__", "Pygame mixer initialized.")  # pylint: disable=no-member
            except pygame.error as e:  # Be more specific for Pygame errors # pylint: disable=no-member
                logger.error("GUI", "__init__", f"Pygame mixer init failed: {e}")
                pygame = None

        self._menu_image_references = []  # Ensure this is initialized before _load_icons
        self._load_icons()
        self.create_widgets()

        logger.set_gui_log_callback(self.log_to_gui_widget)

        self.apply_theme_and_color()

        if not self.backend_initialized_successfully:
            self.update_status_bar(connection_status="USB Backend Error! Check logs.")
            if hasattr(self, "file_menu") and self.file_menu:
                self.file_menu.entryconfig("Connect to HiDock", state="disabled")
            if hasattr(self, "toolbar_connect_button") and self.toolbar_connect_button:
                self.toolbar_connect_button.configure(state="disabled")

        self.update_all_status_info()
        self._update_optional_panes_visibility()
        self._update_menu_states()

        self.bind("<F5>", self._on_f5_key_press)
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
        self._set_minimum_window_size()

        if self.autoconnect_var.get():
            self.after(500, self.attempt_autoconnect_on_startup)

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
        self.logger_processing_level_var = ctk.StringVar(value=get_conf("log_level", "INFO"))
        self.selected_vid_var = ctk.IntVar(value=get_conf("selected_vid", DEFAULT_VENDOR_ID))
        self.selected_pid_var = ctk.IntVar(value=get_conf("selected_pid", DEFAULT_PRODUCT_ID))
        self.target_interface_var = ctk.IntVar(value=get_conf("target_interface", 0))
        self.recording_check_interval_var = ctk.IntVar(
            value=get_conf("recording_check_interval_s", 3)
        )
        self.default_command_timeout_ms_var = ctk.IntVar(
            value=get_conf("default_command_timeout_ms", 5000)
        )
        self.file_stream_timeout_s_var = ctk.IntVar(value=get_conf("file_stream_timeout_s", 180))
        self.auto_refresh_files_var = ctk.BooleanVar(value=get_conf("auto_refresh_files", False))
        self.auto_refresh_interval_s_var = ctk.IntVar(value=get_conf("auto_refresh_interval_s", 30))
        self.quit_without_prompt_var = ctk.BooleanVar(
            value=get_conf("quit_without_prompt_if_connected", False)
        )
        self.appearance_mode_var = ctk.StringVar(value=get_conf("appearance_mode", "System"))
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
            "treeview_columns_display_order", "name,size,duration,date,time,status"
        )
        self.logs_visible_var = ctk.BooleanVar(value=get_conf("logs_pane_visible", False))
        self.loop_playback_var = ctk.BooleanVar(value=get_conf("loop_playback", False))
        self.volume_var = ctk.DoubleVar(value=get_conf("playback_volume", 0.5))
        self.saved_treeview_sort_column = get_conf("treeview_sort_col_id", "time")
        self.saved_treeview_sort_reverse = get_conf("treeview_sort_descending", True)
        default_log_colors_fallback = {
            "ERROR": ["#FF6347", "#FF4747"],
            "WARNING": ["#FFA500", "#FFB732"],
            "INFO": ["#606060", "#A0A0A0"],
            "DEBUG": ["#202020", "#D0D0D0"],
            "CRITICAL": ["#DC143C", "#FF0000"],
        }
        loaded_log_colors = get_conf("log_colors", default_log_colors_fallback)
        for level in Logger.LEVELS:  # Iterate directly over dictionary keys
            colors = loaded_log_colors.get(
                level, default_log_colors_fallback.get(level, ["#000000", "#FFFFFF"])
            )
            setattr(self, f"log_color_{level.lower()}_light_var", ctk.StringVar(value=colors[0]))
            setattr(self, f"log_color_{level.lower()}_dark_var", ctk.StringVar(value=colors[1]))
        self.icon_pref_light_color = get_conf("icon_theme_color_light", "black")
        self.icon_pref_dark_color = get_conf("icon_theme_color_dark", "white")
        self.icon_fallback_color_1 = get_conf("icon_fallback_color_1", "blue")
        self.icon_fallback_color_2 = get_conf("icon_fallback_color_2", "default")
        self.icon_size_str = get_conf("icon_size_str", "32")

    def _load_icons(self):
        """
        Loads icons for the GUI from the filesystem.

        Icons are expected to be in subdirectories of `self.icon_base_path`
        (e.g., "icons/black/32/link.png"). It attempts to load icons based on
        the current theme (light/dark) and configured fallback colors.
        Both `ctk.CTkImage` (for CustomTkinter widgets) and `tkinter.PhotoImage`
        (for the tkinter.Menu) are created and stored.
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
            self.icon_pref_dark_color if current_mode_is_dark else self.icon_pref_light_color
        )

        for name, filename in icon_definitions.items():
            pil_image = None
            paths_to_try = [
                os.path.join(
                    self.icon_base_path, theme_specific_color, self.icon_size_str, filename
                ),
                os.path.join(
                    self.icon_base_path, self.icon_fallback_color_1, self.icon_size_str, filename
                ),
                os.path.join(
                    self.icon_base_path, self.icon_fallback_color_2, self.icon_size_str, filename
                ),
                os.path.join(self.icon_base_path, self.icon_size_str, filename),
            ]
            for icon_path_try in paths_to_try:
                if os.path.exists(icon_path_try):
                    try:
                        pil_image = Image.open(icon_path_try)
                        break  # Found and opened successfully
                    except (IOError, UnidentifiedImageError) as e_img:
                        logger.warning(
                            "GUI",
                            "_load_icons",
                            f"Found icon {filename} at {icon_path_try} but failed to open: {e_img}",
                        )
                        pil_image = None

            if pil_image:
                self.icons[name] = ctk.CTkImage(
                    light_image=pil_image, dark_image=pil_image, size=self.icon_display_size
                )
                # Create and store PhotoImage for Tkinter menus
                # Resize the PIL image if necessary for the menu icon size, (20,20) is self.icon_display_size
                tk_photo_image = ImageTk.PhotoImage(pil_image.resize(self.icon_display_size))
                self.menu_icons[name] = tk_photo_image
                self._menu_image_references.append(tk_photo_image)  # Explicitly keep reference
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

        The menubar includes File, View, Actions, and Device menus with
        their respective commands and accelerators. Icons are assigned
        to menu items from `self.menu_icons`.
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
            accelerator="Ctrl+,",
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
            label="Delete Selected",
            command=self.delete_selected_files_gui,
            state="disabled",
            image=self.menu_icons.get("delete"),
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

    def _update_menubar_style(self):
        """
        Applies styling to the `tkinter.Menu` to better match the CustomTkinter theme.

        Attempts to set background, foreground, active colors, and relief
        for the menu widgets based on the current CTk theme.
        """
        if not (hasattr(self, "file_menu") and self.file_menu):
            return
        try:  # MODIFIED
            menu_bg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkFrame"]["fg_color"]
            )
            menu_fg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkLabel"]["text_color"]
            )
            active_menu_bg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkButton"]["hover_color"]
            )
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

        This is typically called after icons might have been reloaded (e.g., due to
        an appearance mode change) to ensure the `tkinter.Menu` items display the correct icons.
        """
        if not hasattr(self, "file_menu") or not self.file_menu:
            logger.debug(
                "GUI",
                "_update_menu_command_images",
                "Menubar not yet created. Skipping image update.",
            )
            return

        logger.debug(
            "GUI", "_update_menu_command_images", "Updating menu command images after icon reload."
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
            self.device_menu: {"Sync Device Time": "sync_time", "Format Storage": "format_sd"},
        }

        for menu_widget, commands in menu_map.items():
            if hasattr(menu_widget, "entryconfigure"):
                for label, icon_name in commands.items():
                    try:
                        # Check if the entry exists before trying to configure it
                        # Menu.index(label) raises TclError if not found.
                        # A more robust way is to iterate through entry types if indices are not stable.
                        # For now, assume labels are stable identifiers for add_command.
                        if icon_name:  # Only update if there's an icon name defined
                            menu_widget.entryconfigure(label, image=self.menu_icons.get(icon_name))
                    except tkinter.TclError as e:
                        # This can happen if the menu item with 'label' doesn't exist
                        # (e.g., if it was dynamically removed)
                        # or if the image itself is problematic (though self.menu_icons.get should handle None)
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

        The toolbar provides quick access to common actions like connect/disconnect,
        refresh, download, play, delete, and settings. Icons are assigned from `self.icons`.
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
        self.toolbar_settings_button.pack(side="right", padx=(2, 5), pady=toolbar_button_pady)

    def _create_status_bar(self):
        """
        Creates the status bar at the bottom of the application window.

        The status bar displays connection status, progress text for operations,
        and a progress bar for file transfers or other long-running tasks.
        """
        self.status_bar_frame = ctk.CTkFrame(self, height=30, corner_radius=0)
        self.status_bar_frame.pack(side="bottom", fill="x", padx=0, pady=(1, 0))
        self.status_connection_label = ctk.CTkLabel(
            self.status_bar_frame, text="Status: Disconnected", anchor="w"
        )
        self.status_connection_label.pack(side="left", padx=10, pady=2)
        self.status_progress_text_label = ctk.CTkLabel(self.status_bar_frame, text="", anchor="w")
        self.status_progress_text_label.pack(side="left", padx=10, pady=2, fill="x", expand=True)
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
        self._update_default_progressbar_colors()

    def _open_download_dir_in_explorer(self, _event=None):
        """
        Opens the configured download directory in the system's file explorer.

        Handles different platforms (Windows, macOS, Linux). Shows a warning
        if the directory is not set or does not exist.

        Args:
            event: The event object (optional, typically from a bind).
        """
        if not self.download_directory or not os.path.isdir(self.download_directory):
            messagebox.showwarning(
                "Open Directory",
                f"Download directory is not set or does not exist:\n{self.download_directory}",
                parent=self,
            )
            logger.warning(
                "GUI",
                "_open_download_dir_in_explorer",
                f"Download directory '{self.download_directory}' not valid or not set.",
            )
            return
        try:
            logger.info(
                "GUI",
                "_open_download_dir_in_explorer",
                f"Opening download directory: {self.download_directory}",
            )
            if sys.platform == "win32":
                os.startfile(os.path.realpath(self.download_directory))
            elif sys.platform == "darwin":
                subprocess.call(["open", self.download_directory])
            else:
                subprocess.call(["xdg-open", self.download_directory])
        except FileNotFoundError:
            messagebox.showerror(
                "Open Directory",
                f"Could not open directory. Associated command not found for your system ('{sys.platform}').",
                parent=self,
            )
            logger.error(
                "GUI",
                "_open_download_dir_in_explorer",
                f"File explorer command not found for {sys.platform}.",
            )
        except OSError as e:
            messagebox.showerror(
                "Open Directory",
                f"Failed to open directory:\n{self.download_directory}\nError: {e}",
                parent=self,
            )
            logger.error(
                "GUI",
                "_open_download_dir_in_explorer",
                f"Failed to open directory '{self.download_directory}': {e}",
            )

    def _select_download_dir_from_header_button(self, _event=None):
        """
        Handles selecting the download directory via a button, typically in the header.

        Prompts the user to select a directory, updates the configuration,
        and refreshes relevant UI elements.

        Args:
            event: The event object (optional, typically from a bind).
        """
        new_dir = self._prompt_for_directory(
            initial_dir=self.download_directory, parent_window_for_dialog=self
        )
        if new_dir and new_dir != self.download_directory:
            self.download_directory = new_dir  # pylint: disable=attribute-defined-outside-init
            self.config["download_directory"] = new_dir
            save_config(self.config)
            if (
                hasattr(self, "download_dir_button_header")
                and self.download_dir_button_header.winfo_exists()
            ):
                self.download_dir_button_header.configure(
                    text=f"Dir: {os.path.basename(self.download_directory)}"
                )
            logger.info(
                "GUI",
                "_select_download_dir_from_header_button",
                f"Download directory changed to: {new_dir}",
            )
            self.update_all_status_info()

    def _prompt_for_directory(self, initial_dir, parent_window_for_dialog):
        """
        Prompts the user to select a directory using a standard dialog.

        Args:
            initial_dir (str): The directory to initially display in the dialog.
            parent_window_for_dialog (tkinter.Tk or tkinter.Toplevel): The parent window for the dialog.

        Returns:
            str or None: The path to the selected directory, or None if cancelled.
        """
        new_dir = filedialog.askdirectory(
            initialdir=initial_dir,
            title="Select Download Directory",
            parent=parent_window_for_dialog,
        )
        return new_dir

    def update_status_bar(self, connection_status=None, progress_text=None):
        """
        Updates specific labels in the status bar.

        Args:
            connection_status (str, optional): Text for the connection status label.
            progress_text (str, optional): Text for the progress operation label.
        """
        if hasattr(self, "status_connection_label") and self.status_connection_label.winfo_exists():
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
        Updates all informational labels in the GUI, including the status bar
        and file header section, based on the current application state.

        This includes connection status, device model, SN, storage info, and file counts.
        """
        conn_status_text = "Status: Disconnected"
        if self.dock.is_connected():
            conn_status_text = f"Status: Connected ({self.dock.model or 'HiDock'})"
            if (
                self.dock.device_info
                and "sn" in self.dock.device_info
                and self.dock.device_info["sn"] != "N/A"
            ):
                conn_status_text += f" SN: {self.dock.device_info['sn']}"
        elif not self.backend_initialized_successfully:
            conn_status_text = "Status: USB Backend FAILED!"
        storage_text = "Storage: ---"
        if self.dock.is_connected():
            card_info = self.dock.device_info.get("_cached_card_info")
            if card_info and card_info.get("capacity", 0) > 0:
                used_mb, capacity_mb = card_info["used"], card_info["capacity"]
                if capacity_mb > 1024 * 0.9:
                    storage_text = f"Storage: {used_mb / 1024:.2f}/{capacity_mb / 1024:.2f} GB"
                else:
                    storage_text = f"Storage: {used_mb:.0f}/{capacity_mb:.0f} MB"
                storage_text += f" (Status: {hex(card_info['status_raw'])})"
            else:
                storage_text = "Storage: Fetching..."
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
                    (f for f in self.displayed_files_details if f["name"] == item_iid), None
                )
                if file_detail:
                    size_selected_bytes += file_detail.get("length", 0)
        file_counts_text = (f"Files: {total_items} total / {selected_items_count} "
                            f"sel. ({size_selected_bytes / (1024*1024):.2f} MB)")
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

        This method is called whenever the application state changes (e.g.,
        connection status, file selection) to ensure UI elements are appropriately
        interactive.
        """
        is_connected = self.dock.is_connected()
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
            self.file_menu.entryconfig("Disconnect", state="normal" if is_connected else "disabled")
        if hasattr(self, "view_menu"):
            self.view_menu.entryconfig(
                "Refresh File List", state="normal" if is_connected else "disabled"
            )
        can_play_selected = is_connected and num_selected == 1
        if can_play_selected:
            file_iid = self.file_tree.selection()[0]
            file_detail = next(
                (f for f in self.displayed_files_details if f["name"] == file_iid), None
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
                "Delete Selected", state="normal" if is_connected and has_selection else "disabled"
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
        if hasattr(self, "device_menu"):
            self.device_menu.entryconfig(
                "Sync Device Time", state="normal" if is_connected else "disabled"
            )
            self.device_menu.entryconfig(
                "Format Storage", state="normal" if is_connected else "disabled"
            )
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
                    state="normal" if self.backend_initialized_successfully else "disabled",
                    image=self.icons.get("connect"),
                )
        if hasattr(self, "toolbar_refresh_button") and self.toolbar_refresh_button.winfo_exists():
            self.toolbar_refresh_button.configure(
                state=(
                    "normal"
                    if is_connected
                    and not self._is_ui_refresh_in_progress
                    and not self.is_long_operation_active
                    else "disabled"
                )
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
        if hasattr(self, "toolbar_play_button") and self.toolbar_play_button.winfo_exists():
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
        if hasattr(self, "toolbar_delete_button") and self.toolbar_delete_button.winfo_exists():
            if self.is_long_operation_active and self.active_operation_name == "Deletion":
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
        if hasattr(self, "toolbar_settings_button") and self.toolbar_settings_button.winfo_exists():
            self.toolbar_settings_button.configure(state="normal")

    def _update_treeview_style(self):
        """
        Applies styling to the `ttk.Treeview` widget to match the CustomTkinter theme.

        Configures fonts, colors (body, selection, heading), and scrollbar appearance
        based on the active CTk theme and appearance mode.
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
                "GUI", "_update_treeview_style", f"Theme key missing: {e}. Using fallbacks."
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
            scrollbar_trough = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkScrollbar"]["fg_color"]
            )
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
                borderwidth=0,
                relief="flat",
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
        except (tkinter.TclError, KeyError) as e_scroll:  # More specific
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
            background=[("active", active_heading_bg), ("pressed", tree_selected_bg_color)],
            foreground=[("active", active_heading_fg), ("pressed", tree_selected_text_color)],
            relief=[("active", "groove"), ("pressed", "sunken")],
        )
        tag_font_bold = (font_family, max(9, base_size - 2), "bold")
        self.file_tree.tag_configure("recording", font=tag_font_bold)

    def apply_theme_and_color(self):
        """
        Applies the selected CustomTkinter appearance mode and color theme.

        Also triggers updates for dependent styles like Treeview, menubar,
        and progress bar colors, and reloads icons if the appearance mode changed.
        """
        mode = self.appearance_mode_var.get()
        theme_name = self.color_theme_var.get()
        ctk.set_appearance_mode(mode)
        try:
            ctk.set_default_color_theme(theme_name)
        except (
            RuntimeError,
            tkinter.TclError,
        ) as e:  # CTk might raise RuntimeError for invalid theme logic
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

        Args:
            color_tuple_or_str (tuple or str): A tuple of (light_color, dark_color)
                                               or a single color string.

        Returns:
            str: The appropriate color string for the current appearance mode.
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

        self._create_main_panel_layout()
        self._create_files_panel(self.main_content_frame)
        self._create_log_panel(self.main_content_frame)

    def _create_main_panel_layout(self):
        """Creates the main content frame and configures its grid."""
        self.main_content_frame = ctk.CTkFrame(self, fg_color="transparent")  # type: ignore
        self.main_content_frame.pack(fill="both", expand=True, padx=5, pady=5)  # type: ignore
        self.main_content_frame.grid_rowconfigure(0, weight=1)  # type: ignore # files_frame, initially takes all space
        self.main_content_frame.grid_rowconfigure(1, weight=0)  # type: ignore # log_frame, initially no space
        self.main_content_frame.grid_columnconfigure(0, weight=1)  # type: ignore

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
            files_header_frame, text="Storage: ---", anchor="w")  # type: ignore
        self.status_storage_label_header.pack(side="left", padx=10, pady=2)
        self.status_file_counts_label_header = ctk.CTkLabel(
            files_header_frame, text="Files: 0 / 0", anchor="w")  # type: ignore
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
        self.download_dir_button_header.bind(  # type: ignore
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
        self.clear_selection_button_header.pack(side="right", padx=(2, 5), pady=2)  # type: ignore
        self.select_all_button_header = ctk.CTkButton(
            files_header_frame,
            text="",
            image=self.icons.get("select_all_files"),
            width=30,
            height=24,
            command=self.select_all_files_action,
        )
        self.select_all_button_header.pack(side="right", padx=(2, 2), pady=2)  # type: ignore
        tree_frame = ctk.CTkFrame(files_frame, fg_color="transparent", border_width=0)
        tree_frame.grid(row=1, column=0, sticky="nsew", padx=5, pady=5)
        tree_frame.grid_columnconfigure(0, weight=1)
        tree_frame.grid_rowconfigure(0, weight=1)
        columns = ("name", "size", "duration", "date", "time", "status")
        self.file_tree = ttk.Treeview(tree_frame, columns=columns, show="headings",
                                      selectmode="extended")  # type: ignore
        self.file_tree.tag_configure("downloaded", foreground="blue")
        self.file_tree.tag_configure("recording", foreground="red", font=("Arial", 10, "bold"))
        self.file_tree.tag_configure("size_mismatch", foreground="orange")
        self.file_tree.tag_configure("downloaded_ok", foreground="green")
        self.file_tree.tag_configure("downloading", foreground="dark orange")
        self.file_tree.tag_configure("queued", foreground="gray50")
        self.file_tree.tag_configure("cancelled", foreground="firebrick3")
        self.file_tree.tag_configure("playing", foreground="purple")
        if self.treeview_columns_display_order_str:
            loaded_column_order = self.treeview_columns_display_order_str.split(",")
            valid_loaded_order = [c for c in loaded_column_order if c in columns]
            if len(valid_loaded_order) == len(columns) and set(valid_loaded_order) == set(columns):
                try:
                    self.file_tree["displaycolumns"] = valid_loaded_order  # type: ignore
                except tkinter.TclError as e:  # More specific
                    logger.warning(
                        "GUI",
                        "create_widgets",
                        f"Failed to apply saved column order '{valid_loaded_order}' (TclError): {e}. Using default.",
                    )
                    self.file_tree["displaycolumns"] = columns
            else:  # type: ignore
                self.file_tree["displaycolumns"] = columns  # type: ignore
        else:  # type: ignore
            self.file_tree["displaycolumns"] = columns  # type: ignore
        for col, text in self.original_tree_headings.items():
            is_numeric = col in ["size", "duration"]
            self.file_tree.heading(
                col, text=text, command=lambda c=col, n=is_numeric: self.sort_treeview_column(c, n)
            )
            if col == "name":
                self.file_tree.column(col, width=250, minwidth=150, stretch=True)
            elif col in ["size", "duration"]:
                self.file_tree.column(col, width=80, minwidth=60, anchor="e")
            elif col in ["date", "time"]:
                self.file_tree.column(col, width=100, minwidth=80, anchor="center")
            else:
                self.file_tree.column(col, width=100, minwidth=80, anchor="w")
        self.file_tree.grid(row=0, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.file_tree.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.file_tree.configure(yscrollcommand=scrollbar.set)
        self.file_tree.bind("<<TreeviewSelect>>", self.on_file_selection_change)
        self.file_tree.bind("<Double-1>", self._on_file_double_click)
        self.file_tree.bind("<Button-3>", self._on_file_right_click)
        self.file_tree.bind("<Control-a>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Control-A>", lambda event: self.select_all_files_action())
        self.file_tree.bind("<Delete>", self._on_delete_key_press)
        self.file_tree.bind("<Return>", self._on_enter_key_press)
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
        self.clear_log_button.pack(side="left", padx=(0, 10))  # type: ignore
        ctk.CTkLabel(log_controls_sub_frame, text="Level:").pack(side="left", padx=(0, 5))
        self.log_section_level_combo = ctk.CTkComboBox(
            log_controls_sub_frame,
            variable=self.gui_log_filter_level_var,
            values=list(Logger.LEVELS.keys()),
            state="readonly",
            width=110,
            command=self.on_gui_log_filter_change,
        )
        self.log_section_level_combo.pack(side="left", padx=(0, 10))  # type: ignore
        self.download_logs_button = ctk.CTkButton(
            log_controls_sub_frame,
            text="Save Log",
            image=self.icons.get("download_log_button"),
            command=self.download_gui_logs,
            width=110,
        )
        self.download_logs_button.pack(side="left", padx=(0, 0))  # type: ignore
        self.log_text_area = ctk.CTkTextbox(
            self.log_frame, height=100, state="disabled", wrap="word", border_spacing=3
        )  # type: ignore
        self.log_text_area.pack(fill="both", expand=True, padx=5, pady=(0, 5))
        self._update_log_text_area_tag_colors()

    def _on_file_button1_press(self, event):  # Identical to original logic
        """
        Handles the Button-1 press event on the file Treeview.

        Manages item selection, deselection, and sets up for potential drag-selection.
        Handles Ctrl and Shift modifiers for selection behavior.
        """
        item_iid = self.file_tree.identify_row(event.y)
        self._is_button1_pressed_on_item = item_iid
        self._last_dragged_over_iid = item_iid
        self._drag_action_is_deselect = False
        if not item_iid:
            self._is_button1_pressed_on_item = None
            logger.debug("GUI", "_on_file_button1_press", "Button 1 pressed on empty space.")
            return
        current_selection = self.file_tree.selection()
        is_currently_selected_before_toggle = item_iid in current_selection
        if is_currently_selected_before_toggle:
            self._drag_action_is_deselect = True
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Drag will DESELECT. Anchor '{item_iid}' was selected.",
            )
        else:
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Drag will SELECT. Anchor '{item_iid}' was not selected.",
            )
        ctrl_pressed = (event.state & 0x0004) != 0
        shift_pressed = (event.state & 0x0001) != 0
        if shift_pressed:
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Shift+Click on item: {item_iid}. Allowing default range selection.",
            )
            return
        if is_currently_selected_before_toggle:
            self.file_tree.selection_remove(item_iid)
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Toggled OFF item: {item_iid} (Modifier: {'Ctrl' if ctrl_pressed else 'None'})",
            )
        else:
            self.file_tree.selection_add(item_iid)
            logger.debug(
                "GUI",
                "_on_file_button1_press",
                f"Toggled ON item: {item_iid} (Modifier: {'Ctrl' if ctrl_pressed else 'None'})",
            )
        return "break"

    def _on_file_b1_motion(self, event):  # Identical to original logic
        """
        Handles the Button-1 motion (drag) event on the file Treeview.

        Performs drag-selection or drag-deselection of items based on the
        initial state of the anchor item when the drag started.
        """
        if not hasattr(self, "_is_button1_pressed_on_item") or not self._is_button1_pressed_on_item:
            return
        item_iid_under_cursor = self.file_tree.identify_row(event.y)
        if item_iid_under_cursor != self._last_dragged_over_iid:
            self._last_dragged_over_iid = item_iid_under_cursor
            if self._is_button1_pressed_on_item:
                all_children = self.file_tree.get_children("")
                try:
                    anchor_index = all_children.index(self._is_button1_pressed_on_item)
                    current_motion_index = -1
                    if item_iid_under_cursor and item_iid_under_cursor in all_children:
                        current_motion_index = all_children.index(item_iid_under_cursor)
                    else:
                        if not item_iid_under_cursor:
                            return
                    start_range_idx = min(anchor_index, current_motion_index)
                    end_range_idx = max(anchor_index, current_motion_index)
                    items_in_current_drag_sweep = all_children[start_range_idx: end_range_idx + 1]
                    if self._drag_action_is_deselect:
                        logger.debug(
                            "GUI",
                            "_on_file_b1_motion",
                            f"Drag-DESELECTING items in sweep: {items_in_current_drag_sweep}",
                        )
                        for item_to_process in items_in_current_drag_sweep:
                            self.file_tree.selection_remove(item_to_process)
                    else:
                        logger.debug(
                            "GUI",
                            "_on_file_b1_motion",
                            f"Drag-SELECTING items in sweep: {items_in_current_drag_sweep}",
                        )
                        for item_to_process in items_in_current_drag_sweep:
                            self.file_tree.selection_add(item_to_process)
                except ValueError:
                    logger.warning(
                        "GUI",
                        "_on_file_b1_motion",
                        "Anchor or current item not found in tree children during drag.",
                    )

    def _on_file_button1_release(self, _event):  # Identical to original logic
        """
        Handles the Button-1 release event on the file Treeview.

        Finalizes any drag-selection operation and resets drag state variables.
        Updates menu states based on the new selection.
        """
        logger.debug(
            "GUI",
            "_on_file_button1_release",
            f"Button 1 released. Final selection: {self.file_tree.selection()}",
        )
        self._is_button1_pressed_on_item = None
        self._last_dragged_over_iid = None
        self._drag_action_is_deselect = False
        self._update_menu_states()

    def _update_optional_panes_visibility(self):  # Identical to original logic
        """
        Updates the visibility of optional panes (e.g., Logs pane).

        Manages the grid layout and row weights to show or hide panes as configured.
        """

        if not hasattr(self, "main_content_frame") or not self.main_content_frame.winfo_exists():
            logger.error(
                "GUI", "_update_optional_panes_visibility", "main_content_frame not found."
            )
            return
        if not hasattr(self, "log_frame") or not self.log_frame.winfo_exists():
            logger.error("GUI", "_update_optional_panes_visibility", "log_frame not found.")
            return
        logs_are_visible = self.logs_visible_var.get()
        if logs_are_visible:
            if not self.log_frame.winfo_ismapped():
                self.log_frame.grid(row=1, column=0, sticky="nsew", padx=5, pady=(5, 0))
            self.main_content_frame.grid_rowconfigure(0, weight=3)
            self.main_content_frame.grid_rowconfigure(1, weight=1)
        else:
            if self.log_frame.winfo_ismapped():
                self.log_frame.grid_forget()
            self.main_content_frame.grid_rowconfigure(0, weight=1)
            self.main_content_frame.grid_rowconfigure(1, weight=0)

    def toggle_logs(self):  # Identical to original logic
        """
        Toggles the visibility of the Logs pane.

        Reads the state from `self.logs_visible_var` and calls
        `_update_optional_panes_visibility` to apply the change.
        """
        # self.logs_visible = self.logs_visible_var.get() # This line was redundant in original
        self._update_optional_panes_visibility()

    def _update_log_text_area_tag_colors(
        self,
    ):  # Identical to original logic, uses self._apply_appearance_mode_theme_color
        """Updates the foreground colors for different log levels in the GUI log text area."""
        if not hasattr(self, "log_text_area") or not self.log_text_area.winfo_exists():
            return
        log_levels_to_configure = ["ERROR", "WARNING", "INFO", "DEBUG", "CRITICAL"]
        for level_name_upper in log_levels_to_configure:
            level_name_lower = level_name_upper.lower()
            light_var = getattr(self, f"log_color_{level_name_lower}_light_var", None)
            dark_var = getattr(self, f"log_color_{level_name_lower}_dark_var", None)
            if light_var and dark_var:
                color_tuple = (light_var.get(), dark_var.get())
                try:
                    self.log_text_area.tag_config(  # MODIFIED
                        level_name_upper,
                        foreground=self.apply_appearance_mode_theme_color(color_tuple),  # type: ignore
                    )
                except tkinter.TclError as e:
                    logger.error(
                        "GUI",
                        "_update_log_text_area_tag_colors",
                        f"Error applying color for {level_name_upper} with {color_tuple}: {e}",
                    )
            else:
                logger.warning(
                    "GUI",
                    "_update_log_text_area_tag_colors",
                    f"Color StringVars for log level {level_name_upper} not found.",
                )
        logger.debug("GUI", "_update_log_text_area_tag_colors", "Log text area tag colors updated.")

    def open_settings_window(self):
        """Opens the application settings dialog window.

        Ensures only one settings dialog is open at a time and focuses it
        if it already exists. Passes a snapshot of the current configuration
        and the HiDockJensen instance to the dialog.
        """

        # Ensure the dialog is not already open
        if (
            hasattr(self, "_settings_dialog_instance")
            and self._settings_dialog_instance
            and self._settings_dialog_instance.winfo_exists()
        ):
            self._settings_dialog_instance.focus()  # If already open, focus it

        # Pass a copy of the current config for the dialog to work with
        # The dialog will handle its own state and apply changes back to self.config and self (GUI vars)
        current_config_snapshot = self.config.copy()

        # Pass necessary CTk Variables (or their names/accessors) that SettingsDialog needs to read/write
        # For simplicity, pass self (parent_gui) and let SettingsDialog access vars like self.parent_gui.autoconnect_var
        if (
            hasattr(self, "_settings_dialog_instance")
            and self._settings_dialog_instance
            and self._settings_dialog_instance.winfo_exists()
        ):
            self._settings_dialog_instance.focus()  # If already open, focus it
            return

        self._settings_dialog_instance = SettingsDialog(
            parent_gui=self, initial_config=current_config_snapshot, hidock_instance=self.dock
        )
        self._settings_dialog_instance.protocol(
            "WM_DELETE_WINDOW",
            lambda: self._on_settings_dialog_close(self._settings_dialog_instance),
        )

    def _on_settings_dialog_close(self, dialog_instance):
        """Logic for when settings dialog is closed with 'x' (behaves like cancel)
        The SettingsDialog's _cancel_close_action handles reset if changes were made."""
        if dialog_instance and dialog_instance.winfo_exists():
            dialog_instance.destroy()
        self._settings_dialog_instance = None

    # scan_usb_devices_for_settings is called by SettingsDialog,
    # but defined here as it relates to main app's available_usb_devices
    def scan_usb_devices_for_settings(
        self, parent_window_for_dialogs, initial_load=False, change_callback=None
    ):  # pylint: disable=too-many-locals, too-many-branches, too-many-statements
        """This method is called by the SettingsDialog. It updates self.available_usb_devices
        and then configures the combobox *in the SettingsDialog*.
        The parent_window_for_dialogs will be the SettingsDialog instance."""
        try:
            logger.info(
                "GUI",
                "scan_usb_devices_for_settings",
                "Scanning for USB devices (for settings dialog)...",
            )
            self.available_usb_devices.clear()
            if not self.backend_initialized_successfully:
                if parent_window_for_dialogs and parent_window_for_dialogs.winfo_exists():
                    messagebox.showerror(
                        "USB Error",
                        "Libusb backend not initialized.",
                        parent=parent_window_for_dialogs,
                    )  # type: ignore
                if (
                    hasattr(parent_window_for_dialogs, "settings_device_combobox")
                    and parent_window_for_dialogs.settings_device_combobox.winfo_exists()
                ):
                    parent_window_for_dialogs.settings_device_combobox.configure(
                        values=["USB Backend Error"]
                    )  # type: ignore
                    parent_window_for_dialogs.settings_device_combobox.set("USB Backend Error")
                return

            with self.dock.get_usb_lock():  # Acquire lock before any PyUSB calls
                found_devices = usb.core.find(find_all=True, backend=self.usb_backend_instance)
                if not found_devices:
                    if (
                        hasattr(parent_window_for_dialogs, "settings_device_combobox")
                        and parent_window_for_dialogs.settings_device_combobox.winfo_exists()
                    ):
                        parent_window_for_dialogs.settings_device_combobox.configure(
                            values=["No devices found"]
                        )  # type: ignore
                        parent_window_for_dialogs.settings_device_combobox.set("No devices found")
                    return

                good_devs, problem_devs = [], []
                for dev in found_devices:
                    is_target = (
                        dev.idVendor == self.selected_vid_var.get()
                        and dev.idProduct == self.selected_pid_var.get()
                    )
                    is_active = (
                        self.dock.is_connected()
                        and self.dock.device
                        and dev.idVendor == self.dock.device.idVendor
                        and dev.idProduct == self.dock.device.idProduct
                    )
                    try:
                        # Add timeout to get_string calls
                        mfg = (
                            usb.util.get_string(dev, dev.iManufacturer, 1000)
                            if dev.iManufacturer
                            else "N/A"
                        )
                        prod = (
                            usb.util.get_string(dev, dev.iProduct, 1000) if dev.iProduct else "N/A"
                        )
                        desc = (
                            f"{mfg} - {prod} (VID: {hex(dev.idVendor)}, PID: {hex(dev.idProduct)})"
                        )
                        good_devs.append(
                            (desc, dev.idVendor, dev.idProduct)
                        )  # pylint: disable=undefined-loop-variable # dev is defined in the loop
                    except (usb.core.USBError, NotImplementedError, ValueError) as e_str_fetch:
                        logger.warning(
                            "GUI",
                            "scan_usb_devices",  # Logger context within scan_usb_devices_for_settings
                            (f"Error getting string for VID={hex(dev.idVendor)} PID={hex(dev.idProduct)} "
                             f"({type(e_str_fetch).__name__}): {e_str_fetch}"),
                        )
                        name_disp = (
                            self.dock.model if self.dock.model != "unknown" else "HiDock Device"
                        )
                        # Provide more specific error in the description
                        error_type_name = type(e_str_fetch).__name__
                        desc = (
                            f"Currently Connected: {name_disp} (VID={hex(dev.idVendor)}, PID={hex(dev.idProduct)})"
                            if is_target and is_active
                            else (f"[Error Reading Info ({error_type_name})] (VID={hex(dev.idVendor)}, "
                                  f"PID={hex(dev.idProduct)})")
                        )
                        (good_devs if is_target and is_active else problem_devs).insert(
                            0 if is_target and is_active else len(problem_devs),
                            (desc, dev.idVendor, dev.idProduct),
                        )

            if good_devs and "Currently Connected" in good_devs[0][0]:
                good_devs = [good_devs[0]] + sorted(good_devs[1:], key=lambda x: x[0])
            else:
                good_devs.sort(key=lambda x: x[0])
            problem_devs.sort(key=lambda x: x[0])
            self.available_usb_devices.extend(good_devs + problem_devs)

            combo_list = [t[0] for t in good_devs]
            if problem_devs:
                if combo_list:
                    combo_list.append("--- Devices with Issues ---")
                combo_list.extend([t[0] for t in problem_devs])

            # Use local_vars from settings dialog if called from there
            settings_vid_var = (
                parent_window_for_dialogs.local_vars["selected_vid_var"]
                if hasattr(parent_window_for_dialogs, "local_vars")
                else self.selected_vid_var
            )
            settings_pid_var = (
                parent_window_for_dialogs.local_vars["selected_pid_var"]
                if hasattr(parent_window_for_dialogs, "local_vars")
                else self.selected_pid_var
            )

            current_sel_str = next(
                (
                    d
                    for d, v, p in self.available_usb_devices
                    if v == settings_vid_var.get() and p == settings_pid_var.get()
                ),
                None,
            )

            if (
                hasattr(parent_window_for_dialogs, "settings_device_combobox")
                and parent_window_for_dialogs.settings_device_combobox.winfo_exists()
            ):
                parent_window_for_dialogs.settings_device_combobox.configure(
                    values=combo_list if combo_list else ["No devices accessible"]
                )
                if current_sel_str and current_sel_str in combo_list:  # type: ignore
                    parent_window_for_dialogs.settings_device_combobox.set(current_sel_str)
                elif combo_list and combo_list[0] != "--- Devices with Issues ---":
                    if not initial_load:
                        parent_window_for_dialogs.settings_device_combobox.set(combo_list[0])
                        sel_info = next(
                            (dt for dt in self.available_usb_devices if dt[0] == combo_list[0]),
                            None,
                        )
                        if sel_info:
                            settings_vid_var.set(sel_info[1])
                            settings_pid_var.set(sel_info[2])
                        if change_callback:
                            change_callback()
                elif not combo_list:
                    parent_window_for_dialogs.settings_device_combobox.set("No devices accessible")  # type: ignore
            logger.info(
                "GUI",
                "scan_usb_devices",
                f"Found {len(good_devs)} good, {len(problem_devs)} problem devices.",
            )  # pylint: disable=broad-except
        except (usb.core.USBError, AttributeError, TypeError, tkinter.TclError) as e:
            logger.error(
                "GUI",
                "scan_usb_devices_for_settings",
                f"Unhandled exception: {e}\n{traceback.format_exc()}",
            )
            if parent_window_for_dialogs and parent_window_for_dialogs.winfo_exists():
                messagebox.showerror(
                    "Scan Error", f"Error during USB scan: {e}", parent=parent_window_for_dialogs
                )

    def _apply_saved_sort_state_to_tree_and_ui(self, files_data_list):  # Identical to original
        if (
            self.saved_treeview_sort_column
            and self.saved_treeview_sort_column in self.original_tree_headings
        ):
            logger.info(
                "GUI",
                "_apply_saved_sort_state",
                (f"Applying saved sort: Col='{self.saved_treeview_sort_column}', "
                 f"Reverse={self.saved_treeview_sort_reverse}"),
            )
            self.treeview_sort_column = self.saved_treeview_sort_column
            self.treeview_sort_reverse = self.saved_treeview_sort_reverse
            files_data_list = self._sort_files_data(
                files_data_list, self.treeview_sort_column, self.treeview_sort_reverse
            )
            self.after(0, self._update_treeview_sort_indicator_ui_only)
            self.saved_treeview_sort_column = None  # pylint: disable=attribute-defined-outside-init
        return files_data_list

    def _update_treeview_sort_indicator_ui_only(self):  # Identical to original
        if not hasattr(self, "file_tree") or not self.file_tree.winfo_exists():
            return
        if not self.treeview_sort_column:
            for col_id, original_text in self.original_tree_headings.items():
                self.file_tree.heading(col_id, text=original_text)
            return
        for col_id, original_text in self.original_tree_headings.items():
            arrow = ""
            if col_id == self.treeview_sort_column:
                arrow = " ▼" if self.treeview_sort_reverse else " ▲"
            try:
                if self.file_tree.winfo_exists():
                    self.file_tree.heading(col_id, text=original_text + arrow)
            except tkinter.TclError as e:
                logger.warning(
                    "GUI",
                    "_update_treeview_sort_indicator",
                    f"Error updating heading for {col_id}: {e}",
                )

    def _apply_device_settings_thread(self, settings_to_apply):  # This is called by SettingsDialog
        if not settings_to_apply:
            logger.info(
                "GUI", "_apply_device_settings_thread", "No device behavior settings changed."
            )
            return
        all_successful = True
        for name, value in settings_to_apply.items():
            result = self.dock.set_device_setting(name, value)
            if not result or result.get("result") != "success":
                all_successful = False
                logger.error(
                    "GUI", "_apply_device_settings_thread", f"Failed to set '{name}' to {value}."
                )
                self.after(
                    0,
                    lambda n=name: messagebox.showwarning(
                        "Settings Error", f"Failed to apply setting: {n}", parent=self
                    ),
                )
        if all_successful:
            logger.info(
                "GUI", "_apply_device_settings_thread", "All changed device settings applied."
            )

    def update_log_colors_gui(self):
        """Public wrapper to trigger updating the log text area tag colors."""
        # This method exists to provide a public interface for other modules
        # (like the SettingsDialog) to request a log color update without
        # accessing the protected _update_log_text_area_tag_colors method directly.
        logger.debug("GUI", "update_log_colors_gui", "Public request to update log colors.")
        self._update_log_text_area_tag_colors()

    def apply_device_settings_from_dialog(self, settings_to_apply):
        """Public wrapper to apply device settings from the settings dialog.

        Args:
        settings_to_apply (dict): A dictionary of settings to apply to the device.
        """
        # This method provides a public interface for the SettingsDialog
        # to request device settings application.
        self._apply_device_settings_thread(settings_to_apply)

    def log_to_gui_widget(self, message, level_name="INFO"):  # Identical to original
        '''Logs a message to the GUI log text area.
        Args:
            message (str): The log message to display.
            level_name (str): The log level (e.g., "INFO", "DEBUG", "ERROR").
        '''
        def _update_log_task(msg, lvl):
            if not (hasattr(self, "log_text_area") and self.log_text_area.winfo_exists()):
                return
            gui_filter_val = Logger.LEVELS.get(
                self.gui_log_filter_level_var.get().upper(), Logger.LEVELS["DEBUG"]
            )
            msg_level_val = Logger.LEVELS.get(lvl.upper(), 0)
            if msg_level_val < gui_filter_val:
                return
            self.log_text_area.configure(state="normal")
            self.log_text_area.insert("end", msg, lvl)
            self.log_text_area.see("end")
            self.log_text_area.configure(state="disabled")

        if self.winfo_exists():
            self.after(0, _update_log_task, message, level_name)

    def clear_log_gui(self):  # Identical to original
        '''Clears the log display in the GUI.
        '''
        logger.info("GUI", "clear_log_gui", "Clearing log display.")
        if hasattr(self, "log_text_area") and self.log_text_area.winfo_exists():
            self.log_text_area.configure(state="normal")
            self.log_text_area.delete(1.0, "end")
            self.log_text_area.configure(state="disabled")
            logger.info("GUI", "clear_log_gui", "Log display cleared.")

    def on_gui_log_filter_change(self, _):  # Argument passed by CTkComboBox, not used
        """Handles changes to the GUI log filter level.
        Updates the log text area to reflect the new filter level.
        """
        logger.info(
            "GUI",
            "on_gui_log_filter_change",
            f"GUI log display filter to {self.gui_log_filter_level_var.get()}.",
        )

    def download_gui_logs(self):  # Identical to original, parent=self for dialogs
        """Downloads the GUI logs to a file."""
        if not (hasattr(self, "log_text_area") and self.log_text_area.winfo_exists()):
            return
        log_content = self.log_text_area.get(1.0, "end")
        if not log_content.strip():
            messagebox.showinfo("Download Logs", "Log display is empty.", parent=self)
            return
        filepath = filedialog.asksaveasfilename(
            defaultextension=".log",
            filetypes=[("Log files", "*.log"), ("Text", "*.txt")],
            title="Save GUI Logs",
            parent=self,
        )
        if filepath:
            try:
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(log_content)
                logger.info("GUI", "download_gui_logs", f"GUI logs saved to {filepath}")
                messagebox.showinfo("Download Logs", f"Logs saved to:\n{filepath}", parent=self)  # type: ignore
            except (IOError, OSError, tkinter.TclError) as e:
                logger.error("GUI", "download_gui_logs", f"Error saving logs: {e}")
                messagebox.showerror(
                    "Download Logs Error", f"Failed to save logs: {e}", parent=self
                )

    def _initialize_backend_early(self):  # Identical to original
        error_to_report, local_backend_instance = None, None
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            dll_paths_to_try = (
                [os.path.join(script_dir, name) for name in ["libusb-1.0.dll"]]
                + [os.path.join(script_dir, "MS64", "dll", name) for name in ["libusb-1.0.dll"]]
                + [os.path.join(script_dir, "MS32", "dll", name) for name in ["libusb-1.0.dll"]]
            )
            dll_path = next((p for p in dll_paths_to_try if os.path.exists(p)), None)
            if not dll_path:
                logger.warning(
                    "GUI",
                    "_initialize_backend_early",
                    "libusb-1.0.dll not found locally. Trying system paths.",
                )
                local_backend_instance = usb.backend.libusb1.get_backend()
                if not local_backend_instance:
                    error_to_report = "Libusb backend failed from system paths."
            else:
                logger.info(
                    "GUI", "_initialize_backend_early", f"Attempting backend with DLL: {dll_path}"
                )
                local_backend_instance = usb.backend.libusb1.get_backend(
                    find_library=lambda x: dll_path
                )
                if not local_backend_instance:
                    error_to_report = f"Failed with DLL: {dll_path}. Check 32/64 bit."
            if error_to_report:
                logger.error("GUI", "_initialize_backend_early", error_to_report)
                return False, error_to_report, None
            logger.info(
                "GUI", "_initialize_backend_early", f"Backend initialized: {local_backend_instance}"
            )
            return True, None, local_backend_instance
        except (OSError, usb.core.USBError, RuntimeError, AttributeError, ImportError) as e:
            error_to_report = f"Unexpected error initializing libusb: {e}"
            logger.error(
                "GUI", "_initialize_backend_early", f"{error_to_report}\n{traceback.format_exc()}"
            )
            return False, error_to_report, None

    def attempt_autoconnect_on_startup(self):  # Identical to original
        """Attempts to autoconnect to the HiDock device on startup if autoconnect is enabled."""
        if not self.backend_initialized_successfully:
            logger.warning("GUI", "attempt_autoconnect", "Skipping autoconnect, USB backend error.")
            return
        if self.autoconnect_var.get() and not self.dock.is_connected():
            logger.info("GUI", "attempt_autoconnect", "Attempting autoconnect...")
            self.connect_device()

    def connect_device(self):  # Identical to original, parent=self for dialogs
        """Connects to the HiDock device using the selected VID, PID, and interface."""
        if not self.backend_initialized_successfully:
            logger.error("GUI", "connect_device", "Cannot connect: USB backend not initialized.")
            self.update_status_bar(connection_status="Status: USB Backend FAILED!")
            if self.backend_init_error_message:
                messagebox.showerror(
                    "USB Backend Error", self.backend_init_error_message, parent=self
                )
            self._update_menu_states()
            return
        if not self.winfo_exists():
            logger.warning("GUI", "connect_device", "Master window gone, aborting.")
            return
        self.update_status_bar(connection_status="Status: Connecting...")
        self._update_menu_states()
        threading.Thread(target=self._connect_device_thread, daemon=True).start()

    def _connect_device_thread(self):  # Identical to original logic, uses self.after
        """Threaded method to connect to the HiDock device."""
        try:
            vid, pid, interface = (
                self.selected_vid_var.get(),
                self.selected_pid_var.get(),
                self.target_interface_var.get(),
            )
            connect_successful, error_message = self.dock.connect(
                target_interface_number=interface, vid=vid, pid=pid
            )

            if connect_successful:
                device_info = self.dock.get_device_info()
                self.dock.device_info["_cached_card_info"] = self.dock.get_card_info()
                self.after(0, self.update_all_status_info)
                self.after(0, self._update_menu_states)
                if device_info:
                    self.after(0, self.refresh_file_list_gui)
                    self.start_recording_status_check()
                    if self.auto_refresh_files_var.get():
                        self.start_auto_file_refresh_periodic_check()
                else:
                    self.after(
                        0,
                        lambda: self.update_status_bar(
                            connection_status="Status: Connected, but failed to get device info."
                        ),
                    )
                    self.stop_recording_status_check()
                    self.stop_auto_file_refresh_periodic_check()
            else:
                logger.info(
                    "GUI",
                    "_connect_device_thread",
                    f"Connection attempt failed. Reason: {error_message}",
                )
                if self.winfo_exists():
                    # Remove previous banner if it exists
                    if (
                        hasattr(self, "_connection_error_banner")
                        and self._connection_error_banner
                        and self._connection_error_banner.winfo_exists()
                    ):
                        self._connection_error_banner.dismiss()

                    # Use the error_message from dock.connect() for the banner
                    banner_message = error_message or \
                        (f"HiDock device (VID={hex(self.selected_vid_var.get())}, "
                         f"PID={hex(self.selected_pid_var.get())}) not found or connection failed. "
                         "Ensure it's connected, powered on, and you have permissions.")

                    self._connection_error_banner = CTkBanner(
                        master=self,
                        state="warning",  # "error" or "info" could also be used
                        title=banner_message,
                        # btn1 removed as banner now only has 'X'
                        side="bottom_right",
                        auto_dismiss_after_ms=10000,  # Increased for potentially longer messages
                        width=550,  # Adjusted width
                    )
                    self._connection_error_banner.show()
                self.after(
                    0, lambda: self.handle_auto_disconnect_ui() if self.winfo_exists() else None
                )
        except (usb.core.USBError, ConnectionError, OSError, RuntimeError) as e:
            logger.error(
                "GUI", "_connect_device_thread", f"Connection error: {e}\n{traceback.format_exc()}"
            )
            if self.winfo_exists():
                self.after(
                    0,
                    lambda: self.update_status_bar(
                        connection_status=f"Status: Connection Error ({type(e).__name__})"
                    ),
                )
                if not self.dock.is_connected():
                    self.after(
                        0, lambda: self.handle_auto_disconnect_ui() if self.winfo_exists() else None
                    )
        finally:
            if self.winfo_exists():
                self.after(0, self._update_menu_states)

    def handle_auto_disconnect_ui(self):  # Identical to original
        """Handles the UI updates when the device is auto-disconnected or connection is lost."""
        logger.warning(
            "GUI", "handle_auto_disconnect_ui", "Device auto-disconnected or connection lost."
        )
        self.update_status_bar(connection_status="Status: Disconnected (Error/Lost)")
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children():
                self.file_tree.delete(item)
        self.displayed_files_details.clear()
        self.update_all_status_info()
        self.stop_auto_file_refresh_periodic_check()
        self.stop_recording_status_check()
        if self.dock.is_connected():
            self.dock.disconnect()
        self._update_menu_states()

    def disconnect_device(self):  # Identical to original
        """Disconnects the HiDock device and updates the UI accordingly."""
        self.dock.disconnect()
        self.update_status_bar(connection_status="Status: Disconnected")
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children():
                self.file_tree.delete(item)
        self.displayed_files_details.clear()
        self.stop_auto_file_refresh_periodic_check()
        self.stop_recording_status_check()
        self.update_all_status_info()
        self._update_menu_states()

    def refresh_file_list_gui(self):  # Identical to original, parent=self for dialogs
        """Refreshes the file list in the GUI by fetching it from the HiDock device."""
        if not self.backend_initialized_successfully:
            logger.warning("GUI", "refresh_file_list_gui", "Backend not init.")
            return
        if not self.dock.is_connected():
            messagebox.showerror("Error", "Not connected.", parent=self)
            self._update_menu_states()
            return
        if self._is_ui_refresh_in_progress:
            logger.debug("GUI", "refresh_file_list_gui", "Refresh in progress.")
            return
        if self.is_long_operation_active:
            logger.debug("GUI", "refresh_file_list_gui", "Long operation active, refresh deferred.")
            return
        self._is_ui_refresh_in_progress = True
        self.update_status_bar(progress_text="Fetching file list...")
        self._update_menu_states()
        threading.Thread(target=self._refresh_file_list_thread, daemon=True).start()

    def _refresh_file_list_thread(self):  # Identical to original logic, uses self.after
        """Threaded method to refresh the file list in the GUI."""
        try:
            list_result = self.dock.list_files(
                timeout_s=self.default_command_timeout_ms_var.get() / 1000
            )
            if not self.dock.is_connected():
                self.after(0, self.handle_auto_disconnect_ui)
                return
            files = list_result.get("files", [])
            self.dock.device_info["_cached_card_info"] = self.dock.get_card_info()
            self.after(0, self.update_all_status_info)
            if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
                for item in self.file_tree.get_children():
                    self.after(
                        0,
                        lambda i=item: (
                            self.file_tree.delete(i) if self.file_tree.exists(i) else None
                        ),
                    )
            self.after(0, self.displayed_files_details.clear)
            all_files_to_display = list(files)
            recording_info = self.dock.get_recording_file()
            if (
                recording_info
                and recording_info.get("name")
                and not any(f.get("name") == recording_info["name"] for f in files)
            ):
                all_files_to_display.insert(
                    0,
                    {
                        "name": recording_info["name"],
                        "length": 0,
                        "duration": "Recording...",
                        "createDate": "In Progress",
                        "createTime": "",
                        "time": datetime.now(),
                        "is_recording": True,
                    },
                )
            if all_files_to_display:
                if (
                    self.saved_treeview_sort_column
                    and self.saved_treeview_sort_column in self.original_tree_headings
                ):
                    all_files_to_display = self._apply_saved_sort_state_to_tree_and_ui(
                        all_files_to_display
                    )
                elif self.treeview_sort_column:
                    all_files_to_display = self._sort_files_data(
                        all_files_to_display, self.treeview_sort_column, self.treeview_sort_reverse
                    )
                    self.after(0, self._update_treeview_sort_indicator_ui_only)
                for f_info in all_files_to_display:
                    status_text, tags = f_info.get("gui_status"), f_info.get("gui_tags")
                    if status_text is None:
                        if f_info.get("is_recording"):
                            status_text, tags = "Recording", ("recording",)
                        else:
                            local_path = self._get_local_filepath(f_info["name"])
                            if os.path.exists(local_path):
                                try:
                                    status_text, tags = (
                                        ("Mismatch", ("size_mismatch",))
                                        if os.path.getsize(local_path) != f_info["length"]
                                        else ("Downloaded", ("downloaded_ok",))
                                    )
                                except OSError:
                                    status_text, tags = "Error Checking Size", ("size_mismatch",)
                            else:
                                status_text, tags = "On Device", ()
                        f_info["gui_status"], f_info["gui_tags"] = status_text, tags
                    vals = (
                        (
                            f_info["name"],
                            "-",
                            f_info["duration"],
                            f_info.get("createDate", ""),
                            f_info.get("createTime", ""),
                            status_text,
                        )
                        if f_info.get("is_recording")
                        else (
                            f_info["name"],
                            f"{f_info['length']/1024:.2f}",
                            f"{f_info['duration']:.2f}",
                            f_info.get("createDate", ""),
                            f_info.get("createTime", ""),
                            status_text,
                        )
                    )
                    self.after(
                        0,
                        lambda fi=f_info, v=vals, t=tags: (
                            self.file_tree.insert("", "end", values=v, iid=fi["name"], tags=t)
                            if self.file_tree.winfo_exists()
                            else None
                        ),
                    )
                    self.after(0, lambda fi=f_info: self.displayed_files_details.append(fi))
            else:
                self.after(
                    0,
                    lambda: self.update_status_bar(
                        progress_text=(
                            f"Error: {list_result.get('error','Unknown')}"
                            if list_result.get("error")
                            else "No files found."
                        )
                    ),
                )
        except ConnectionError as ce:
            logger.error("GUI", "_refresh_thread", f"ConnErr: {ce}")
            self.after(0, self.handle_auto_disconnect_ui)
        except (usb.core.USBError, tkinter.TclError) as e:
            logger.error("GUI", "_refresh_thread", f"Error: {e}\n{traceback.format_exc()}")
            self.after(0, lambda: self.update_status_bar(progress_text="Error loading files."))
        finally:
            self.after(0, lambda: setattr(self, "_is_ui_refresh_in_progress", False))
            self.after(0, self._update_menu_states)
            self.after(
                0,
                lambda: self.update_status_bar(
                    progress_text="Ready." if self.dock.is_connected() else "Disconnected."
                ),
            )
            self.after(0, self.update_all_status_info)

    def _on_file_double_click(self, event):  # Identical to original
        if not self.dock.is_connected() and not self.is_audio_playing:
            return
        item_iid = self.file_tree.identify_row(event.y)
        if not item_iid:
            return
        self.file_tree.selection_set(item_iid)
        file_detail = next((f for f in self.displayed_files_details if f["name"] == item_iid), None)
        if not file_detail:
            return
        status = file_detail.get("gui_status", "On Device")
        if self.is_audio_playing and self.current_playing_filename_for_replay == item_iid:
            self._stop_audio_playback()
            return
        elif status in ["Downloaded", "Downloaded OK", "downloaded_ok"]:
            self.play_selected_audio_gui()
        elif status in ["On Device", "Mismatch", "Cancelled"] or "Error" in status:
            if not file_detail.get("is_recording"):
                self.download_selected_files_gui()

    def _on_file_right_click(
        self, event
    ):  # Identical to original, uses self._apply_appearance_mode_theme_color
        clicked_item_iid = self.file_tree.identify_row(event.y)
        current_selection = self.file_tree.selection()
        if clicked_item_iid and clicked_item_iid not in current_selection:
            self.file_tree.selection_set(clicked_item_iid)
            current_selection = (clicked_item_iid,)
        self._update_menu_states()
        context_menu = tkinter.Menu(self, tearoff=0)
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
            active_menu_fg_candidate = ctk.ThemeManager.theme["CTkButton"].get("text_color_hover")
            active_menu_fg = self.apply_appearance_mode_theme_color(
                active_menu_fg_candidate
                if active_menu_fg_candidate
                else ctk.ThemeManager.theme["CTkButton"]["text_color"]
            )
            disabled_fg = self.apply_appearance_mode_theme_color(
                ctk.ThemeManager.theme["CTkLabel"].get("text_color_disabled", ("gray70", "gray30"))
            )
            context_menu.configure(
                background=menu_bg,
                foreground=menu_fg,
                activebackground=active_menu_bg,
                activeforeground=active_menu_fg,
                disabledforeground=disabled_fg,
                relief="flat",
                borderwidth=0,
            )
        except (tkinter.TclError, KeyError) as e:  # More specific
            logger.warning(
                "GUI",
                "_on_file_right_click",
                f"Could not style context menu (TclError/KeyError): {e}",
            )
        num_selected = len(current_selection)
        if num_selected == 1:
            item_iid = current_selection[0]
            file_detail = next(
                (f for f in self.displayed_files_details if f["name"] == item_iid), None
            )
            if file_detail:
                status = file_detail.get("gui_status", "On Device")
                is_playable = file_detail["name"].lower().endswith((".wav", ".hda"))
                if self.is_audio_playing and self.current_playing_filename_for_replay == item_iid:
                    context_menu.add_command(
                        label="Stop Playback",
                        command=self._stop_audio_playback,
                        image=self.icons.get("stop"),
                        compound="left",
                    )

                elif is_playable and status not in ["Recording", "Downloading", "Queued"]:
                    context_menu.add_command(
                        label="Play",
                        command=self.play_selected_audio_gui,
                        image=self.icons.get("play"),
                        compound="left",
                    )
                if status in ["On Device", "Mismatch", "Cancelled"] or "Error" in status:
                    if not file_detail.get("is_recording"):
                        context_menu.add_command(
                            label="Download",
                            command=self.download_selected_files_gui,
                            image=self.icons.get("download"),
                            compound="left",
                        )
                elif (
                    status == "Downloaded" or status == "Downloaded OK" or status == "downloaded_ok"
                ):
                    context_menu.add_command(
                        label="Re-download",
                        command=self.download_selected_files_gui,
                        image=self.icons.get("download"),
                        compound="left",
                    )

                if (
                    status in ["Downloading", "Queued"]
                    or "Preparing Playback" in status
                    or self.active_operation_name
                ):
                    context_menu.add_command(
                        label="Cancel Operation",
                        command=self.request_cancel_operation,
                        image=self.icons.get("stop"),
                        compound="left",
                    )

                    context_menu.add_command(
                        label="Delete",
                        command=self.delete_selected_files_gui,
                        image=self.icons.get("delete"),
                        compound="left",
                    )

        elif num_selected > 1:
            context_menu.add_command(
                label=f"Download Selected ({num_selected})",
                command=self.download_selected_files_gui,
                image=self.icons.get("download"),
                compound="left",
            )
            if not any(
                next((f for f in self.displayed_files_details if f["name"] == iid), {}).get(
                    "is_recording"
                )
                for iid in current_selection
            ):
                context_menu.add_command(
                    label=f"Delete Selected ({num_selected})",
                    command=self.delete_selected_files_gui,
                    image=self.icons.get("delete"),
                    compound="left",
                )
        if context_menu.index("end") is not None:
            context_menu.add_separator()
        context_menu.add_command(
            label="Refresh List",
            command=self.refresh_file_list_gui,
            state="normal" if self.dock.is_connected() else "disabled",
            image=self.icons.get("refresh"),
            compound="left",
        )
        if context_menu.index("end") is None:
            return
        try:
            context_menu.tk_popup(event.x_root, event.y_root)
        finally:
            context_menu.grab_release()

    def _update_file_status_in_treeview(
        self, filename_iid, new_status_text, new_tags_tuple=()
    ):  # Identical to original
        """Updates the status of a file in the treeview.
        Args:
            filename_iid (str): The item ID of the file in the treeview.
            new_status_text (str): The new status text to set.
            new_tags_tuple (tuple): A tuple of tags to apply to the item.
        """
        if not (
            self.winfo_exists()
            and hasattr(self, "file_tree")
            and self.file_tree.winfo_exists()
            and self.file_tree.exists(filename_iid)
        ):
            return
        try:
            current_values = list(self.file_tree.item(filename_iid, "values"))
            status_col_idx = self.file_tree["columns"].index("status")
            if status_col_idx < len(current_values):
                current_values[status_col_idx] = new_status_text
                self.file_tree.item(filename_iid, values=tuple(current_values), tags=new_tags_tuple)
                for detail in self.displayed_files_details:
                    if detail["name"] == filename_iid:
                        detail["gui_status"], detail["gui_tags"] = new_status_text, new_tags_tuple
                        break
        except tkinter.TclError as e:
            logger.error(
                "GUI",
                "_update_file_status_in_treeview",
                f"Error for {filename_iid}: {e}\n{traceback.format_exc()}",
            )

    def _get_local_filepath(self, device_filename):  # Identical to original
        """Generates a safe local file path for the given device filename.
        Args:
            device_filename (str): The filename from the device.
        Returns:
            str: A safe local file path.
        """
        safe_filename = (
            device_filename.replace(":", "-").replace(" ", "_").replace("\\", "_").replace("/", "_")
        )
        return os.path.join(self.download_directory, safe_filename)

    def _sort_files_data(self, files_data, column_key, reverse_order):  # Identical to original
        """Sorts the files data based on the specified column key and order.
        Args:
            files_data (list): The list of file data dictionaries to sort.
            column_key (str): The key to sort by (e.g., "name", "size", "duration", "date", "time").
            reverse_order (bool): Whether to sort in reverse order.
        Returns:
            list: The sorted list of file data dictionaries.
        """
        def get_sort_key(item):
            val = item.get(column_key)
            if column_key == "name":
                return item.get("name", "").lower()
            if column_key == "size":
                return item.get("length", 0)
            if column_key == "duration":
                return (
                    (0, item.get("duration", "").lower())
                    if isinstance(item.get("duration"), str)
                    else (1, item.get("duration", 0))
                )
            if column_key in ["date", "time"]:
                return item.get("time", datetime.min)
            if column_key == "status":
                return item.get("gui_status", "").lower()
            return val if val is not None else ""

        return sorted(files_data, key=get_sort_key, reverse=reverse_order)

    def sort_treeview_column(
        self, column_name_map_key, _is_numeric_string_unused
    ):  # Identical to original logic
        """Sorts the treeview by the specified column name map key.
        Args:
            column_name_map_key (str): The key of the column name map to sort by.
            _is_numeric_string_unused (bool): Unused parameter.
        """
        if not self.winfo_exists():
            return
        column_data_key = column_name_map_key
        if self.treeview_sort_column == column_data_key:
            self.treeview_sort_reverse = not self.treeview_sort_reverse
        else:
            self.treeview_sort_column = column_data_key
            self.treeview_sort_reverse = False
        self.saved_treeview_sort_column = None  # pylint: disable=attribute-defined-outside-init
        self.saved_treeview_sort_reverse = False  # pylint: disable=attribute-defined-outside-init
        self._update_treeview_sort_indicator_ui_only()
        self.displayed_files_details = self._sort_files_data(
            self.displayed_files_details, self.treeview_sort_column, self.treeview_sort_reverse
        )
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            for item in self.file_tree.get_children():
                self.file_tree.delete(item)
            for f_info in self.displayed_files_details:
                status, tags = f_info.get("gui_status", "On Device"), f_info.get("gui_tags", ())
                vals = (
                    (
                        f_info["name"],
                        "-",
                        status,
                        f_info.get("createDate", ""),
                        f_info.get("createTime", ""),
                        status,
                    )
                    if f_info.get("is_recording")
                    else (
                        f_info["name"],
                        f"{f_info['length']/1024:.2f}",
                        f"{f_info['duration']:.2f}",
                        f_info.get("createDate", ""),
                        f_info.get("createTime", ""),
                        status,
                    )
                )
                self.file_tree.insert("", "end", values=vals, iid=f_info["name"], tags=tags)
        self.on_file_selection_change(None)

    def start_recording_status_check(self):  # Identical to original
        """Starts periodic checking of the recording status."""
        interval_s = self.recording_check_interval_var.get()
        if interval_s <= 0:
            logger.info("GUI", "start_rec_check", "Rec check interval <= 0, disabled.")
            self.stop_recording_status_check()
            return
        self.stop_recording_status_check()
        self._check_recording_status_periodically()

    def request_cancel_operation(self):  # Identical to original
        """Requests cancellation of the current long operation."""
        if self.cancel_operation_event:
            logger.info("GUI", "request_cancel_operation", "Cancellation requested.")
            self.cancel_operation_event.set()
            self._set_long_operation_active_state(False, "Operation Cancelled")
            self.update_status_bar(progress_text="Operation cancelling...")

    def stop_recording_status_check(self):  # Identical to original
        """Stops periodic checking of the recording status."""
        if self._recording_check_timer_id:
            self.after_cancel(self._recording_check_timer_id)
            self._recording_check_timer_id = None

    def _check_recording_status_periodically(self):  # Identical to original logic, uses self.after
        """Periodically checks the recording status and updates the GUI."""
        try:
            if not self.dock.is_connected():
                self.stop_recording_status_check()
                return
            if self.is_long_operation_active:
                return
            recording_info = self.dock.get_recording_file(
                timeout_s=self.default_command_timeout_ms_var.get() / 1000
            )
            if not self.dock.is_connected():
                self.stop_recording_status_check()
                return
            current_recording_filename = recording_info.get("name") if recording_info else None
            if current_recording_filename != self._previous_recording_filename:
                self._previous_recording_filename = current_recording_filename
                self.refresh_file_list_gui()
        except (ConnectionError, usb.core.USBError, tkinter.TclError) as e:
            logger.error("GUI", "_check_rec_status", f"Unhandled: {e}\n{traceback.format_exc()}")
        finally:
            if self.winfo_exists():  # Check if window still exists
                interval_ms = self.recording_check_interval_var.get() * 1000
                if interval_ms <= 0:
                    self.stop_recording_status_check()
                else:
                    self._recording_check_timer_id = self.after(
                        interval_ms, self._check_recording_status_periodically
                    )

    def start_auto_file_refresh_periodic_check(self):  # Identical to original
        """Starts periodic checking for file list refresh based on the auto-refresh settings."""
        self.stop_auto_file_refresh_periodic_check()
        if self.auto_refresh_files_var.get() and self.dock.is_connected():
            interval_s = self.auto_refresh_interval_s_var.get()
            if interval_s <= 0:
                logger.info("GUI", "start_auto_refresh", "Interval <=0, disabled.")
                return
            self._check_auto_file_refresh_periodically()

    def stop_auto_file_refresh_periodic_check(self):  # Identical to original
        """Stops periodic checking for file list refresh."""
        if self._auto_file_refresh_timer_id:
            self.after_cancel(self._auto_file_refresh_timer_id)
            self._auto_file_refresh_timer_id = None

    def _check_auto_file_refresh_periodically(self):  # Identical to original logic, uses self.after
        """Periodically checks if the file list needs to be refreshed."""
        try:
            if not self.dock.is_connected() or not self.auto_refresh_files_var.get():
                self.stop_auto_file_refresh_periodic_check()
                return
            if self.is_long_operation_active:
                return
            self.refresh_file_list_gui()
        except (ConnectionError, usb.core.USBError, tkinter.TclError) as e:
            logger.error("GUI", "_check_auto_refresh", f"Unhandled: {e}\n{traceback.format_exc()}")
        finally:
            if self.winfo_exists():
                interval_ms = self.auto_refresh_interval_s_var.get() * 1000
                if interval_ms <= 0:
                    self.stop_auto_file_refresh_periodic_check()
                else:
                    self._auto_file_refresh_timer_id = self.after(
                        interval_ms, self._check_auto_file_refresh_periodically
                    )

    def _set_long_operation_active_state(
        self, active: bool, operation_name: str = ""
    ):  # Identical to original
        """Sets the state of a long operation and updates the status bar accordingly.
        Args:
            active (bool): Whether the long operation is active.
            operation_name (str): The name of the operation, used for status updates.
        """
        self.is_long_operation_active = active
        if active:
            self.update_status_bar(progress_text=f"{operation_name} in progress...")
            self.cancel_operation_event = threading.Event()
            self.active_operation_name = operation_name
        else:
            self.update_status_bar(
                progress_text=f"{operation_name} finished." if operation_name else "Ready."
            )
            self.cancel_operation_event = None
            self.active_operation_name = None
        self._update_menu_states()
        self.on_file_selection_change(None)

    def play_selected_audio_gui(self):  # Identical to original, parent=self for dialogs
        """Handles the playback of the selected audio file in the GUI."""
        if not pygame:
            messagebox.showerror(
                "Playback Error", "Pygame not installed or mixer failed to initialize.", parent=self
            )
            return
        selected_iids = self.file_tree.selection()
        if not selected_iids or len(selected_iids) > 1:
            return
        file_iid = selected_iids[0]
        file_detail = next((f for f in self.displayed_files_details if f["name"] == file_iid), None)
        if not file_detail or not file_detail["name"].lower().endswith((".wav", ".hda")):
            return
        if self.is_long_operation_active and not self.is_audio_playing:
            messagebox.showwarning("Busy", "Another operation in progress.", parent=self)
            return
        if self.is_audio_playing:
            self._stop_audio_playback(mode="user_stop_via_button")
            return
        local_filepath = self._get_local_filepath(file_detail["name"])
        if os.path.exists(local_filepath) and file_detail.get("gui_status") not in [
            "Mismatch",
            "Error (Download)",
        ]:
            self._cleanup_temp_playback_file()
            self.current_playing_temp_file = None
            self._start_playback_local_file(local_filepath, file_detail)
        else:
            self._update_file_status_in_treeview(
                file_detail["name"], "Preparing Playback...", ("queued",)
            )
            self._set_long_operation_active_state(True, "Playback Preparation")
            self.update_status_bar(progress_text=f"Preparing to play {file_detail['name']}...")
            self._cleanup_temp_playback_file()
            try:
                temp_fd, self.current_playing_temp_file = tempfile.mkstemp(
                    suffix=".wav" if file_detail["name"].lower().endswith(".wav") else ".hda"
                )
                os.close(temp_fd)
                threading.Thread(
                    target=self._download_for_playback_thread, args=(file_detail,), daemon=True
                ).start()
            except (IOError, OSError) as e:  # More specific for tempfile creation
                logger.error("GUI", "play_selected_audio_gui", f"Temp file error: {e}")
                messagebox.showerror("Playback Error", f"Temp file error: {e}", parent=self)
                self._set_long_operation_active_state(False, "Playback Preparation")
                self._update_file_status_in_treeview(
                    file_detail["name"], "Error (Playback Prep)", ("size_mismatch",)
                )

    def _download_for_playback_thread(
        self, file_info
    ):  # Identical to original logic, uses self.after, parent=self for dialogs
        """Threaded method to download a file for playback."""
        try:
            with open(self.current_playing_temp_file, "wb") as outfile:

                def data_cb(chunk):
                    outfile.write(chunk)

                def progress_cb(rcvd, total):
                    self.after(
                        0, self.update_file_progress, rcvd, total, f"(Playback) {file_info['name']}"
                    )
                    self.after(
                        0,
                        self._update_file_status_in_treeview,
                        file_info["name"],
                        "Downloading (Play)",
                        ("downloading",),
                    )

                status = self.dock.stream_file(
                    file_info["name"],
                    file_info["length"],
                    data_cb,
                    progress_cb,
                    timeout_s=self.file_stream_timeout_s_var.get(),
                    cancel_event=self.cancel_operation_event,
                )
            if status == "OK":
                self.after(
                    0, self._start_playback_local_file, self.current_playing_temp_file, file_info
                )
            elif status == "cancelled":
                self.after(
                    0,
                    self._update_file_status_in_treeview,
                    file_info["name"],
                    "Cancelled",
                    ("cancelled",),
                )
                self._cleanup_temp_playback_file()
            elif status == "fail_disconnected":
                self.after(0, self.handle_auto_disconnect_ui)
                self._cleanup_temp_playback_file()
            else:
                self.after(
                    0,
                    lambda: messagebox.showerror(
                        "Playback Error", f"Download failed: {status}", parent=self
                    ),
                )
                self.after(
                    0,
                    self._update_file_status_in_treeview,
                    file_info["name"],
                    "Error (Download)",
                    ("size_mismatch",),
                )
                self._cleanup_temp_playback_file()
        except (
            IOError,
            OSError,
            ConnectionError,
            usb.core.USBError,
            tkinter.TclError,
        ) as e:  # More specific
            if not self.dock.is_connected():
                self.after(0, self.handle_auto_disconnect_ui)
            logger.error(
                "GUI", "_download_for_playback_thread", f"Error: {e}\n{traceback.format_exc()}"
            )
            self.after(
                0, lambda: messagebox.showerror("Playback Error", f"Error: {e}", parent=self)
            )
            self._cleanup_temp_playback_file()
            self.after(
                0,
                self._update_file_status_in_treeview,
                file_info["name"],
                "Error (Playback Prep)",
                ("size_mismatch",),
            )
        finally:
            self.after(0, self._set_long_operation_active_state, False, "Playback Preparation")
            self.after(0, self.start_auto_file_refresh_periodic_check)

    def _start_playback_local_file(
        self, filepath, original_file_info
    ):  # Identical to original, parent=self for dialogs
        """Starts playback of a local audio file."""
        try:
            if not pygame or not pygame.mixer.get_init():
                messagebox.showerror("Playback Error", "Pygame not initialized.", parent=self)
                return
            pygame.mixer.music.load(filepath)
            sound = pygame.mixer.Sound(filepath)
            self.playback_total_duration = sound.get_length()
            del sound
            self.is_audio_playing = True
            if (
                not hasattr(self, "playback_controls_frame")
                or not self.playback_controls_frame
                or not self.playback_controls_frame.winfo_exists()
            ):
                self._create_playback_controls_frame()
            self.total_duration_label.configure(
                text=time.strftime("%M:%S", time.gmtime(self.playback_total_duration))
            )
            self.playback_slider.configure(to=self.playback_total_duration)
            self.playback_slider.set(0)
            pygame.mixer.music.play(loops=(-1 if self.loop_playback_var.get() else 0))
            if self.playback_controls_frame.winfo_ismapped():
                self.playback_controls_frame.pack_forget()
            self.playback_controls_frame.pack(
                fill="x", side="bottom", pady=5, before=self.status_bar_frame
            )
            self._update_playback_progress()
            self.update_status_bar(progress_text=f"Playing: {os.path.basename(filepath)}")
            self.current_playing_filename_for_replay = original_file_info["name"]
            self._update_file_status_in_treeview(
                original_file_info["name"], "Playing", ("playing",)
            )
            self._update_menu_states()
        except pygame.error as e:  # type: ignore # pylint: disable=no-member
            logger.error(
                "GUI", "_start_playback_local_file", f"Error: {e}\n{traceback.format_exc()}"
            )
            messagebox.showerror("Playback Error", f"Could not play: {e}", parent=self)
            self._cleanup_temp_playback_file()
            self.is_audio_playing = False
            self._update_menu_states()

    def _create_playback_controls_frame(self):  # Identical to original, uses CTk widgets
        """Creates the playback controls frame with playback slider, volume control, and loop checkbox."""
        if (
            hasattr(self, "playback_controls_frame")
            and self.playback_controls_frame is not None
            and self.playback_controls_frame.winfo_exists()
        ):
            self.playback_controls_frame.destroy()
        self.playback_controls_frame = ctk.CTkFrame(self, height=40)
        self.current_time_label = ctk.CTkLabel(self.playback_controls_frame, text="00:00", width=45)
        self.current_time_label.pack(side="left", padx=5, pady=5)
        self.playback_slider = ctk.CTkSlider(
            self.playback_controls_frame,
            from_=0,
            to=100,
            command=self._on_slider_value_changed_by_command,
        )
        self.playback_slider.pack(side="left", fill="x", expand=True, padx=5, pady=5)
        self.playback_slider.bind("<ButtonPress-1>", self._on_slider_press)
        self.playback_slider.bind("<ButtonRelease-1>", self._on_slider_release)
        self.total_duration_label = ctk.CTkLabel(
            self.playback_controls_frame, text="00:00", width=45
        )
        self.total_duration_label.pack(side="left", padx=5, pady=5)
        ctk.CTkLabel(self.playback_controls_frame, text="Vol:").pack(
            side="left", padx=(10, 0), pady=5
        )
        self.volume_slider_widget = ctk.CTkSlider(
            self.playback_controls_frame,
            from_=0,
            to=1,
            variable=self.volume_var,
            command=self._on_volume_change,
            width=100,
        )
        self.volume_slider_widget.pack(side="left", padx=(0, 5), pady=5)
        if pygame and pygame.mixer.get_init():
            pygame.mixer.music.set_volume(self.volume_var.get())
        self.loop_checkbox = ctk.CTkCheckBox(
            self.playback_controls_frame,
            text="Loop",
            variable=self.loop_playback_var,
            command=self._on_loop_toggle,
        )
        self.loop_checkbox.pack(side="left", padx=5, pady=5)

    def _update_playback_progress(self):  # Identical to original logic, uses self.after
        """Updates the playback progress slider and current time label."""
        if (
            self.is_audio_playing
            and pygame
            and pygame.mixer.get_init()
            and pygame.mixer.music.get_busy()
        ):
            current_pos_sec = min(
                pygame.mixer.music.get_pos() / 1000.0, self.playback_total_duration
            )
            if (
                not self._user_is_dragging_slider
                and hasattr(self, "playback_slider")
                and self.playback_slider.winfo_exists()
                and abs(self.playback_slider.get() - current_pos_sec) > 0.5
            ):
                self.playback_slider.set(current_pos_sec)
            if hasattr(self, "current_time_label") and self.current_time_label.winfo_exists():
                self.current_time_label.configure(
                    text=time.strftime("%M:%S", time.gmtime(current_pos_sec))
                )
            self.playback_update_timer_id = self.after(250, self._update_playback_progress)
        elif self.is_audio_playing:
            self._stop_audio_playback(mode="natural_end")

    def _on_slider_press(self, _event):
        """Handles the slider press event to start dragging."""
        self._user_is_dragging_slider = True  # pylint: disable=attribute-defined-outside-init # This is a state flag, not a new attribute definition.
        if self.playback_update_timer_id:
            self.after_cancel(self.playback_update_timer_id)

    def _on_slider_release(self, _event):  # Identical to original
        """Handles the slider release event to seek to the new position."""
        seek_pos_sec = self.playback_slider.get()
        self._user_is_dragging_slider = False
        if self.is_audio_playing and pygame and pygame.mixer.get_init():
            try:
                pygame.mixer.music.stop()
                pygame.mixer.music.play(
                    loops=(-1 if self.loop_playback_var.get() else 0), start=seek_pos_sec
                )
                if hasattr(self, "current_time_label") and self.current_time_label.winfo_exists():
                    self.current_time_label.configure(
                        text=time.strftime("%M:%S", time.gmtime(seek_pos_sec))
                    )
                if pygame.mixer.music.get_busy():
                    self._update_playback_progress()
            except pygame.error as e:  # pylint: disable=no-member
                logger.error("GUI", "_on_slider_release_seek", f"Error seeking: {e}")  # pylint: disable=no-member

    def _on_slider_value_changed_by_command(self, value_str):  # Identical to original
        """Handles slider value changes by command, updating the current time label."""
        if hasattr(self, "current_time_label") and self.current_time_label.winfo_exists():
            self.current_time_label.configure(
                text=time.strftime("%M:%S", time.gmtime(float(value_str)))
            )

    def _on_volume_change(self, value_str):  # Identical to original
        """Handles volume changes from the volume slider."""
        if pygame and pygame.mixer.get_init():
            try:
                pygame.mixer.music.set_volume(float(value_str))
            except pygame.error as e:  # pylint: disable=no-member
                logger.error("GUI", "_on_volume_change", f"Error setting volume: {e}")

    def _on_loop_toggle(self):  # Identical to original
        """Handles the loop toggle checkbox state change."""
        if (
            self.is_audio_playing
            and pygame
            and pygame.mixer.get_init()
            and pygame.mixer.music.get_busy()
        ):
            pygame.mixer.music.play(
                loops=(-1 if self.loop_playback_var.get() else 0),
                start=pygame.mixer.music.get_pos() / 1000.0,
            )

    def on_file_selection_change(self, _event=None):  # Identical to original
        """Handles changes in file selection in the treeview."""
        try:
            self.update_all_status_info()
            self._update_menu_states()
        except tkinter.TclError as e:
            logger.error(
                "GUI", "on_file_selection_change", f"Unhandled: {e}\n{traceback.format_exc()}"
            )

    def _on_delete_key_press(self, _event):  # Identical to original
        """Handles the delete key press event in the file treeview."""
        if (
            self.dock.is_connected()
            and self.file_tree.selection()
            and self.actions_menu.entrycget("Delete Selected", "state") == "normal"
        ):
            self.delete_selected_files_gui()
        return "break"

    def _on_enter_key_press(self, _event):  # Identical to original
        """Handles the Enter key press event in the file treeview."""
        if not self.dock.is_connected() or len(self.file_tree.selection()) != 1:
            return "break"
        try:

            class DummyEvent:
                """A dummy event class to simulate double-click events."""
                y = 0

            dummy_event = DummyEvent()
            bbox = self.file_tree.bbox(self.file_tree.selection()[0])
            if bbox:
                dummy_event.y = bbox[1] + bbox[3] // 2
                self._on_file_double_click(dummy_event)
        except tkinter.TclError as e:
            logger.warning("GUI", "_on_enter_key_press", f"Could not simulate double click: {e}")
        return "break"

    def _on_f5_key_press(self, _event=None):  # Identical to original
        """Handles the F5 key press event to refresh the file list."""
        if (
            self.dock.is_connected()
            and self.view_menu.entrycget("Refresh File List", "state") == "normal"
        ):
            self.refresh_file_list_gui()

    def _stop_audio_playback(
        self, mode="user_stop"
    ):  # Identical to original logic, uses self.after
        """Stops the audio playback and cleans up resources.
        Args:
            mode (str): The reason for stopping playback, e.g., "user_stop", "natural_end".
        """
        was_playing_filename = self.current_playing_filename_for_replay
        if pygame and pygame.mixer.get_init():
            pygame.mixer.music.stop()
            try:
                pygame.mixer.music.unload()  # pylint: disable=no-member
            except pygame.error as e:  # type: ignore # pylint: disable=no-member
                logger.warning("GUI", "_stop_audio_playback", f"Unload error: {e}")
        self.is_audio_playing = False
        if self.playback_update_timer_id:
            self.after_cancel(self.playback_update_timer_id)
            self.playback_update_timer_id = None
        if (
            hasattr(self, "playback_controls_frame")
            and self.playback_controls_frame
            and self.playback_controls_frame.winfo_exists()
        ):
            self.playback_controls_frame.pack_forget()
        self._cleanup_temp_playback_file()
        self.on_file_selection_change(None)
        if was_playing_filename:
            file_detail = next(
                (f for f in self.displayed_files_details if f["name"] == was_playing_filename), None
            )
            if file_detail:
                new_status, new_tags = "On Device", ()
                local_path = self._get_local_filepath(was_playing_filename)
                if os.path.exists(local_path):
                    try:
                        new_status, new_tags = (
                            ("Mismatch", ("size_mismatch",))
                            if os.path.getsize(local_path) != file_detail.get("length")
                            else ("Downloaded", ("downloaded_ok",))
                        )
                    except OSError:
                        new_status, new_tags = "Error Checking Size", ("size_mismatch",)
                self._update_file_status_in_treeview(was_playing_filename, new_status, new_tags)
        if mode != "natural_end":
            self.update_status_bar(progress_text="Playback stopped.")
        self._update_menu_states()

    def _cleanup_temp_playback_file(self):  # Identical to original
        if self.current_playing_temp_file and os.path.exists(self.current_playing_temp_file):
            try:
                os.remove(self.current_playing_temp_file)
                logger.info(
                    "GUI", "_cleanup_temp", f"Deleted temp: {self.current_playing_temp_file}"
                )
            except OSError as e:  # More specific for os.remove
                logger.error("GUI", "_cleanup_temp", f"Error deleting temp: {e}")
        self.current_playing_temp_file = None
        self.current_playing_filename_for_replay = None

    def download_selected_files_gui(self):  # Identical to original, parent=self for dialogs
        """Handles the download of selected files in the GUI."""
        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo("No Selection", "Please select files to download.", parent=self)
            return
        if not self.download_directory or not os.path.isdir(self.download_directory):
            messagebox.showerror("Error", "Invalid download directory.", parent=self)
            return
        if self.is_long_operation_active:
            messagebox.showwarning("Busy", "Another operation in progress.", parent=self)
            return
        files_to_download_info = [
            f
            for iid in selected_iids
            if (f := next((fd for fd in self.displayed_files_details if fd["name"] == iid), None))
        ]
        self._set_long_operation_active_state(True, "Download Queue")
        threading.Thread(
            target=self._process_download_queue_thread, args=(files_to_download_info,), daemon=True
        ).start()

    def _process_download_queue_thread(
        self, files_to_download_info
    ):  # Identical to original logic, uses self.after
        """Processes the download queue in a separate thread.
        Args:
            files_to_download_info (list): List of file info dictionaries to download.
        """
        total_files = len(files_to_download_info)
        self.after(
            0,
            lambda: self.update_status_bar(
                progress_text=f"Batch Download: Initializing {total_files} file(s)..."
            ),
        )
        for i, file_info in enumerate(files_to_download_info):
            self.after(
                0,
                self._update_file_status_in_treeview,
                file_info["name"],
                f"Queued ({i+1}/{total_files})",
                ("queued",),
            )
        batch_start_time, completed_count, operation_aborted = time.time(), 0, False
        for i, file_info in enumerate(files_to_download_info):
            if not self.dock.is_connected():
                logger.error("GUI", "_process_dl_q", "Disconnected.")
                self.after(0, self.handle_auto_disconnect_ui)
                operation_aborted = True
                break
            if self.cancel_operation_event and self.cancel_operation_event.is_set():
                logger.info("GUI", "_process_dl_q", "Cancelled.")
                operation_aborted = True
                break
            if self._execute_single_download(file_info, i + 1, total_files):
                completed_count += 1
            if not self.dock.is_connected() or (
                self.cancel_operation_event and self.cancel_operation_event.is_set()
            ):
                operation_aborted = True
                break
        duration = time.time() - batch_start_time
        if not operation_aborted:
            status_message = f"Batch: {completed_count}/{total_files} completed in {duration:.2f}s."
        else:
            cancel_reason = (
                "cancelled"
                if self.cancel_operation_event and self.cancel_operation_event.is_set()
                else "aborted"
            )
            status_message = f"Download queue {cancel_reason} after {duration:.2f}s."
        final_msg = status_message
        self.after(0, lambda: self.update_status_bar(progress_text=final_msg))
        self.after(0, self._set_long_operation_active_state, False, "Download Queue")
        self.after(0, self.start_auto_file_refresh_periodic_check)
        self.after(
            0,
            lambda: (
                self.update_file_progress(0, 1, final_msg)
                if hasattr(self, "status_file_progress_bar")
                and self.status_file_progress_bar.winfo_exists()
                else None
            ),
        )

    def delete_selected_files_gui(self):  # Identical to original, parent=self for dialogs
        """Handles the deletion of selected files in the GUI."""
        selected_iids = self.file_tree.selection()
        if not selected_iids:
            messagebox.showinfo("No Selection", "Please select files to delete.", parent=self)
            return
        if not messagebox.askyesno(
            "Confirm Delete",
            f"Permanently delete {len(selected_iids)} selected file(s)? This cannot be undone.",
            parent=self,
        ):
            return
        self._set_long_operation_active_state(True, "Deletion")
        threading.Thread(
            target=self._delete_files_thread, args=([iid for iid in selected_iids],), daemon=True
        ).start()

    def _delete_files_thread(self, filenames):  # Identical to original logic, uses self.after
        """Deletes the selected files in a separate thread.
        Args:
            filenames (list): List of filenames to delete.
        """
        success, fail = 0, 0
        for i, filename in enumerate(filenames):
            if not self.dock.is_connected():
                logger.error("GUI", "_delete_thread", "Disconnected.")
                self.after(0, self.handle_auto_disconnect_ui)
                break
            self.after(
                0,
                lambda fn=filename, cur=i + 1, tot=len(filenames): self.update_status_bar(
                    progress_text=f"Deleting {fn} ({cur}/{tot})..."
                ),
            )
            status = self.dock.delete_file(
                filename, timeout_s=self.default_command_timeout_ms_var.get() / 1000
            )
            if status and status.get("result") == "success":
                success += 1
            else:
                fail += 1
                logger.error(
                    "GUI",
                    "_delete_thread",
                    f"Failed to delete {filename}: {status.get('error', status.get('result'))}",
                )
        self.after(
            0,
            lambda s=success, f=fail: self.update_status_bar(
                progress_text=f"Deletion complete. Succeeded: {s}, Failed: {f}"
            ),
        )
        self.after(0, self.refresh_file_list_gui)
        self.after(0, self._set_long_operation_active_state, False, "Deletion")

    def select_all_files_action(self):  # Identical to original
        """Selects all files in the file treeview."""
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            self.file_tree.selection_set(self.file_tree.get_children())

    def clear_selection_action(self):  # Identical to original
        """Clears the current selection in the file treeview."""
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            self.file_tree.selection_set([])

    def format_sd_card_gui(self):  # Uses CTkInputDialog, parent=self for dialogs
        """Handles the formatting of the SD card in the GUI."""
        if not self.dock.is_connected():
            messagebox.showerror("Error", "Not connected.", parent=self)
            return
        if not messagebox.askyesno(
            "Confirm Format", "WARNING: This will erase ALL data. Continue?", parent=self
        ) or not messagebox.askyesno(
            "Final Confirmation",
            "FINAL WARNING: Formatting will erase everything. Continue?",
            parent=self,
        ):
            return
        dialog = ctk.CTkInputDialog(
            text="Type 'FORMAT' to confirm formatting.", title="Type Confirmation"
        )
        confirm_text = dialog.get_input()  # This will show the dialog and return input
        if confirm_text is None or confirm_text.upper() != "FORMAT":
            messagebox.showwarning("Format Cancelled", "Confirmation text mismatch.", parent=self)
            return
        self._set_long_operation_active_state(True, "Formatting Storage")
        threading.Thread(target=self._format_sd_card_thread, daemon=True).start()

    def _format_sd_card_thread(
        self,
    ):  # Identical to original logic, uses self.after, parent=self for dialogs
        """Formats the SD card in a separate thread."""
        self.after(
            0, lambda: self.update_status_bar(progress_text="Formatting Storage... Please wait.")
        )
        status = self.dock.format_card(
            timeout_s=max(60, self.default_command_timeout_ms_var.get() / 1000)
        )
        if status and status.get("result") == "success":
            self.after(
                0,
                lambda: messagebox.showinfo(
                    "Format Success", "Storage formatted successfully.", parent=self
                ),
            )
        else:
            self.after(
                0,
                lambda s=status: messagebox.showerror(
                    "Format Failed",
                    f"Failed to format storage: {s.get('error', s.get('result', 'Unknown'))}",
                    parent=self,
                ),
            )
        self.after(0, lambda: self.update_status_bar(progress_text="Format operation finished."))
        self.after(0, self.refresh_file_list_gui)
        self.after(0, self._set_long_operation_active_state, False, "Formatting Storage")

    def sync_device_time_gui(self):  # Identical to original, parent=self for dialogs
        """Synchronizes the device time with the computer's current time."""
        if not self.dock.is_connected():
            messagebox.showerror("Error", "Not connected.", parent=self)
            return
        if not messagebox.askyesno(
            "Confirm Sync Time", "Set device time to computer's current time?", parent=self
        ):
            return
        self._set_long_operation_active_state(True, "Time Sync")
        threading.Thread(target=self._sync_device_time_thread, daemon=True).start()

    def _sync_device_time_thread(
        self,
    ):  # Identical to original logic, uses self.after, parent=self for dialogs
        """Synchronizes the device time in a separate thread."""
        self.after(0, lambda: self.update_status_bar(progress_text="Syncing device time..."))
        result = self.dock.set_device_time(datetime.now())
        if result and result.get("result") == "success":
            self.after(
                0,
                lambda: messagebox.showinfo("Time Sync", "Device time synchronized.", parent=self),
            )
        else:
            err = result.get("error", "Unknown") if result else "Comm error"
            if result and "device_code" in result:
                err += f" (Dev code: {result['device_code']})"
            self.after(
                0,
                lambda e=err: messagebox.showerror(
                    "Time Sync Error", f"Failed to sync time: {e}", parent=self
                ),
            )
        self.after(0, self._set_long_operation_active_state, False, "Time Sync")
        self.after(0, lambda: self.update_status_bar(progress_text="Time sync finished."))

    def _execute_single_download(
        self, file_info, file_index, total_files_to_download
    ):  # Identical to original logic, uses self.after
        """Executes a single file download operation.
        Args:
            file_info (dict): Information about the file to download.
            file_index (int): The index of the file in the download queue.
            total_files_to_download (int): Total number of files to download in the batch.
        Returns:
            bool: True if the download was successful, False otherwise.
        """
        self.after(
            0,
            self._update_file_status_in_treeview,
            file_info["name"],
            "Downloading",
            ("downloading",),
        )
        self.after(
            0,
            lambda: self.update_status_bar(
                progress_text=f"Batch ({file_index}/{total_files_to_download}): Downloading {file_info['name']}..."
            ),
        )
        self.after(
            0,
            lambda fi=file_info: (
                self.update_file_progress(0, 1, f"Starting {fi['name']}...")
                if hasattr(self, "status_file_progress_bar")
                and self.status_file_progress_bar.winfo_exists()
                else None
            ),
        )
        start_time, operation_succeeded = time.time(), False
        safe_name = (
            file_info["name"]
            .replace(":", "-")
            .replace(" ", "_")
            .replace("\\", "_")
            .replace("/", "_")
        )
        temp_path = os.path.join(self.download_directory, f"_temp_{safe_name}")
        final_path = os.path.join(self.download_directory, safe_name)
        try:
            with open(temp_path, "wb") as outfile:

                def data_cb(chunk):
                    outfile.write(chunk)

                def progress_cb(rcvd, total):
                    elapsed = time.time() - start_time
                    speed_bps = rcvd / elapsed if elapsed > 0 else 0
                    etr_s = (total - rcvd) / speed_bps if speed_bps > 0 else float("inf")
                    etr_str = (
                        f"ETR: {time.strftime('%M:%S',time.gmtime(etr_s))}"
                        if etr_s != float("inf")
                        else "ETR: ..."
                    )
                    speed_str = (
                        f"{speed_bps/1024:.1f}KB/s"
                        if speed_bps < 1024 * 1024
                        else f"{speed_bps/(1024*1024):.1f}MB/s"
                    )
                    percentage_val = (rcvd / total) * 100 if total > 0 else 0
                    tree_status_text = f"Downloading ({percentage_val:.0f}%)"
                    self.after(
                        0,
                        self._update_file_status_in_treeview,
                        file_info["name"],
                        tree_status_text,
                        ("downloading",),
                    )
                    self.after(
                        0,
                        self.update_file_progress,
                        rcvd,
                        total,
                        f"Batch {file_index}/{total_files_to_download} | {speed_str} | {etr_str}",
                    )

                stream_status = self.dock.stream_file(
                    file_info["name"],
                    file_info["length"],
                    data_cb,
                    progress_cb,
                    timeout_s=self.file_stream_timeout_s_var.get(),
                    cancel_event=self.cancel_operation_event,
                )
            if stream_status == "OK":
                if os.path.exists(final_path):
                    os.remove(final_path)
                os.rename(temp_path, final_path)
                self.after(
                    0,
                    self.update_file_progress,
                    file_info["length"],
                    file_info["length"],
                    file_info["name"],
                )
                self.after(
                    0,
                    self._update_file_status_in_treeview,
                    file_info["name"],
                    "Downloaded",
                    ("downloaded_ok",),
                )
                operation_succeeded = True
            else:
                msg = f"Download failed for {file_info['name']}. Status: {stream_status}."
                if stream_status not in ["cancelled", "fail_disconnected"]:
                    msg += f" Temp file kept: {os.path.basename(temp_path)}"
                else:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                logger.error("GUI", "_execute_single_download", msg)
                self.after(0, lambda m=msg: self.update_status_bar(progress_text=m))
                final_status_text, final_tags = (
                    ("Error (Disconnect)", ("size_mismatch",))
                    if stream_status == "fail_disconnected"
                    else (
                        ("Cancelled", ("cancelled",))
                        if stream_status == "cancelled"
                        else ("Download Failed", ("size_mismatch",))
                    )
                )
                self.after(
                    0,
                    self._update_file_status_in_treeview,
                    file_info["name"],
                    final_status_text,
                    final_tags,
                )
                if stream_status == "fail_disconnected":  # type: ignore
                    self.after(0, self.handle_auto_disconnect_ui)  # type: ignore
                if stream_status == "cancelled" and self.cancel_operation_event:
                    self.cancel_operation_event.set()
        except (
            IOError,
            OSError,
            tkinter.TclError,
        ) as e:  # Removed ConnectionError and usb.core.USBError as they are less likely here directly
            logger.error(
                "GUI",
                "_execute_single_download",
                f"Error DL {file_info['name']}: {e}\n{traceback.format_exc()}",
            )
            self.after(
                0,
                lambda: self.update_status_bar(
                    progress_text=f"Error with {file_info['name']}. Temp file kept."
                ),
            )
            self.after(
                0,
                self._update_file_status_in_treeview,
                file_info["name"],
                "Error (Download)",
                ("size_mismatch",),
            )
            if not self.dock.is_connected():
                self.after(0, self.handle_auto_disconnect_ui)
        return operation_succeeded

    def update_file_progress(
        self, received, total, status_text_prefix=""
    ):  # Identical to original logic
        """Updates the file download progress bar and status text.
        Args:
            received (int): The number of bytes received.
            total (int): The total number of bytes to receive.
            status_text_prefix (str, optional): A prefix for the status text. Defaults to "".
        """
        if (
            hasattr(self, "status_file_progress_bar")
            and self.status_file_progress_bar.winfo_exists()
        ):
            percentage = (received / total) if total > 0 else 0
            self.status_file_progress_bar.set(float(percentage))
            if self.default_progressbar_fg_color and self.default_progressbar_progress_color:
                epsilon = 0.001
                if percentage <= epsilon or percentage >= (1.0 - epsilon):
                    self.status_file_progress_bar.configure(
                        progress_color=self.default_progressbar_fg_color
                    )
                else:
                    self.status_file_progress_bar.configure(
                        progress_color=self.default_progressbar_progress_color
                    )
        self.update_status_bar(
            progress_text=f"{status_text_prefix} ({received/ (1024*1024):.2f}/{total/ (1024*1024):.2f} MB)"
        )
        if self.winfo_exists():
            self.update_idletasks()

    def _update_default_progressbar_colors(self):  # Identical to original logic
        """Updates the default colors of the progress bar based on the current appearance mode."""
        if (
            hasattr(self, "status_file_progress_bar")
            and self.status_file_progress_bar.winfo_exists()
        ):
            fg_color_tuple = self.status_file_progress_bar.cget("fg_color")
            progress_color_tuple = self.status_file_progress_bar.cget("progress_color")
            self.default_progressbar_fg_color = self.apply_appearance_mode_theme_color(
                fg_color_tuple
            )
            self.default_progressbar_progress_color = self.apply_appearance_mode_theme_color(
                progress_color_tuple
            )
            current_progress_value = self.status_file_progress_bar.get()
            epsilon = 0.001
            if current_progress_value <= epsilon and self.default_progressbar_fg_color:
                self.status_file_progress_bar.configure(
                    progress_color=self.default_progressbar_fg_color
                )
                logger.debug(
                    "GUI",
                    "_update_default_progressbar_colors",
                    (f"Progress bar at {current_progress_value}%. "
                    f"Set progress_color to default fg_color: {self.default_progressbar_fg_color} "
                    f"to hide initial sliver."),
                )
        else:
            logger.warning(
                "GUI",
                "_update_default_progressbar_colors",
                "Could not update progressbar colors as widget not ready.",
            )

    def on_closing(self):  # Identical to original, parent=self for dialogs
        """Handles the window close event."""
        if self._recording_check_timer_id:
            self.after_cancel(self._recording_check_timer_id)
        if self._auto_file_refresh_timer_id:
            self.after_cancel(self._auto_file_refresh_timer_id)
        if self.is_audio_playing:
            self._stop_audio_playback()
        if pygame and pygame.mixer.get_init():
            pygame.mixer.quit()
        operational_keys = [
            "autoconnect",
            "log_level",
            "selected_vid",
            "selected_pid",
            "target_interface",
            "recording_check_interval_s",
            "default_command_timeout_ms",
            "file_stream_timeout_s",
            "auto_refresh_files",
            "auto_refresh_interval_s",
            "suppress_gui_log_output",
            "quit_without_prompt_if_connected",
            "appearance_mode",
            "color_theme",
            "suppress_console_output",
        ]
        for config_key_on_close in operational_keys:
            var_to_get_from_on_close = None
            if config_key_on_close == "appearance_mode":
                var_to_get_from_on_close = self.appearance_mode_var
            elif config_key_on_close == "color_theme":
                var_to_get_from_on_close = self.color_theme_var
            elif config_key_on_close == "quit_without_prompt_if_connected":
                var_to_get_from_on_close = self.quit_without_prompt_var
            elif config_key_on_close == "log_level":
                var_to_get_from_on_close = self.logger_processing_level_var
            elif config_key_on_close == "recording_check_interval_s":
                var_to_get_from_on_close = self.recording_check_interval_var
            elif hasattr(self, f"{config_key_on_close}_var"):
                var_to_get_from_on_close = getattr(self, f"{config_key_on_close}_var")
            if var_to_get_from_on_close is not None and isinstance(
                var_to_get_from_on_close, ctk.Variable
            ):
                self.config[config_key_on_close] = var_to_get_from_on_close.get()
            else:
                logger.warning(
                    "GUI",
                    "on_closing",
                    f"Could not find ctk.Variable for config key '{config_key_on_close}' during on_closing.",
                )
        self.config["download_directory"] = self.download_directory
        if "log_colors" not in self.config:
            self.config["log_colors"] = {}
        for level_key_save_exit in Logger.LEVELS:
            level_l_save_exit = level_key_save_exit.lower()
            self.config["log_colors"][level_key_save_exit] = [
                getattr(self, f"log_color_{level_l_save_exit}_light_var").get(),
                getattr(self, f"log_color_{level_l_save_exit}_dark_var").get(),
            ]
        if hasattr(self, "file_tree") and self.file_tree.winfo_exists():
            try:
                current_display_order = list(self.file_tree["displaycolumns"])
                if current_display_order and current_display_order[0] != "#all":
                    self.config["treeview_columns_display_order"] = ",".join(current_display_order)
                elif (
                    current_display_order
                    and current_display_order[0] == "#all"
                    and "treeview_columns_display_order" in self.config
                    and self.config["treeview_columns_display_order"]
                    != ",".join(list(self.file_tree["columns"]))
                ):
                    del self.config["treeview_columns_display_order"]  # type: ignore
                elif (
                    "treeview_columns_display_order" in self.config
                    and current_display_order
                    and current_display_order[0] == "#all"
                ):
                    del self.config["treeview_columns_display_order"]
            except tkinter.TclError:
                logger.warning("GUI", "on_closing", "Could not retrieve treeview displaycolumns.")
        if hasattr(self, "winfo_exists") and self.winfo_exists():
            try:
                self.config["window_geometry"] = self.geometry()
            except tkinter.TclError as _e:  # More specific for geometry operations
                logger.warning("GUI", "on_closing", "Could not retrieve window geometry.")
        if hasattr(self, "logs_visible_var"):
            self.config["logs_pane_visible"] = self.logs_visible_var.get()
        if hasattr(self, "gui_log_filter_level_var"):
            self.config["gui_log_filter_level"] = self.gui_log_filter_level_var.get()
        if hasattr(self, "loop_playback_var"):
            self.config["loop_playback"] = self.loop_playback_var.get()
        if hasattr(self, "volume_var"):
            self.config["playback_volume"] = self.volume_var.get()
        if hasattr(self, "treeview_sort_column") and self.treeview_sort_column:
            self.config["treeview_sort_col_id"] = self.treeview_sort_column
            self.config["treeview_sort_descending"] = self.treeview_sort_reverse
        elif "treeview_sort_col_id" in self.config:
            del self.config["treeview_sort_col_id"]
            if "treeview_sort_descending" in self.config:
                del self.config["treeview_sort_descending"]
        save_config(self.config)
        if self.dock and self.dock.is_connected():
            if self.quit_without_prompt_var.get() or messagebox.askokcancel(
                "Quit", "Disconnect HiDock and quit?", parent=self
            ):
                self.dock.disconnect()
                self.destroy()
            else:
                logger.info("GUI", "on_closing", "Quit cancelled by user.")
        else:
            self.destroy()

    def _set_minimum_window_size(self):  # Identical to original
        """Sets the minimum window size based on the toolbar and file treeview content."""
        self.update_idletasks()
        min_toolbar_content_width = 0
        toolbar_buttons = [
            self.toolbar_connect_button,
            self.toolbar_refresh_button,
            self.toolbar_download_button,
            self.toolbar_play_button,
            self.toolbar_delete_button,
            self.toolbar_settings_button,
        ]
        for btn in toolbar_buttons:
            if btn.winfo_exists():
                min_toolbar_content_width += btn.winfo_reqwidth()
        min_toolbar_content_width += (len(toolbar_buttons) + 1) * 4 + 20
        menubar_height_estimate = 30
        toolbar_h = (
            self.toolbar_frame.winfo_reqheight()
            if hasattr(self, "toolbar_frame") and self.toolbar_frame.winfo_exists()
            else 0
        )
        statusbar_h = (
            self.status_bar_frame.winfo_reqheight()
            if hasattr(self, "status_bar_frame") and self.status_bar_frame.winfo_exists()
            else 0
        )
        files_label_h = (
            self.status_storage_label_header.winfo_reqheight()
            if hasattr(self, "status_storage_label_header")
            and self.status_storage_label_header.winfo_exists()
            else 20
        )  # Estimate using one of the header labels
        treeview_row_h = 25
        treeview_header_estimate = 30
        min_tree_rows = 4
        min_treeview_plus_header_h = treeview_header_estimate + (min_tree_rows * treeview_row_h)
        files_frame_internal_vertical_padding = 5 + 5 + 5 + 5
        min_files_frame_content_h = (
            files_label_h + min_treeview_plus_header_h + files_frame_internal_vertical_padding
        )
        inter_section_padding = 2 + 5 + 5
        min_total_height = (
            menubar_height_estimate
            + toolbar_h
            + min_files_frame_content_h
            + statusbar_h
            + inter_section_padding
            + 10
        )
        logger.info(
            "GUI",
            "_set_minimum_window_size",
            f"Calculated min_width: {int(min_toolbar_content_width)}, min_height: {int(min_total_height)}",
        )
        self.minsize(int(min_toolbar_content_width), int(min_total_height))
